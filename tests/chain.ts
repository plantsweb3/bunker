import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
} from "./token-fixture";
import assert from "node:assert/strict";
import fs from "node:fs";
import { generateKey, signOnce, verify } from "../sdk/winternitz";
import { equal, unhex } from "../sdk/bytes";
import {
  vaultAddress,
  initializeIx,
  encodeIntent,
  message,
  stageIxs,
  withdrawIx,
  computeIx,
  parseVault,
  closeProofIx,
  spentAddress,
} from "../sdk/protocol";
import {
  adoptRecovery,
  authorizeWithdrawal,
  decryptKit,
  encryptKit,
  recoveryCheckpoint,
} from "../sdk/recovery";
import { memoryBrowser, password, recoveryFixture } from "./recovery-fixture";
import { depositIxs } from "../sdk/client";
const c = new Connection("http://127.0.0.1:19099", "confirmed");
const program = new PublicKey("AhZPKQAwKeCJ47PVKz5QZmBwf1PE8BHcmcqsjvSdPaZ");
const payer = Keypair.generate(),
  recipient = Keypair.generate();
const checks: string[] = [];
async function send(ixs: TransactionInstruction[]) {
  return sendAndConfirmTransaction(c, new Transaction().add(...ixs), [payer], {
    commitment: "confirmed",
  });
}
async function reject(label: string, ixs: TransactionInstruction[]) {
  await assert.rejects(() => send(ixs));
  checks.push(label);
}
async function main() {
  const genesis = await c.getGenesisHash();
  assert(
    ![
      "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
      "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    ].includes(genesis),
    "Local tests must never run on a public cluster",
  );
  await c.requestAirdrop(payer.publicKey, 20_000_000_000);
  const deadline = Date.now() + 30000;
  while ((await c.getBalance(payer.publicKey)) === 0) {
    assert(Date.now() < deadline, "Local faucet timed out");
    await new Promise((r) => setTimeout(r, 300));
  }
  const id = crypto.getRandomValues(new Uint8Array(32)),
    key = generateKey(),
    next = generateKey();
  const vault = vaultAddress(program, id);
  await send([
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: vault,
      lamports: 890880,
    }),
  ]);
  await send([initializeIx(program, payer.publicKey, id, key.root)]);
  checks.push("prefunded PDA initialization");
  await reject("duplicate initialization rejected", [
    initializeIx(program, payer.publicKey, id, key.root),
  ]);
  await send([
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: vault,
      lamports: 1_000_000_000,
    }),
  ]);
  checks.push("SOL deposit");
  const expirySlot = BigInt(await c.getSlot()) + 10000n;
  const payload = encodeIntent({
    vaultId: id,
    expirySlot,
    nonce: 0n,
    kind: 0,
    mint: PublicKey.default,
    destination: recipient.publicKey,
    amount: 100_000_000n,
    nextRoot: next.root,
  });
  // Deliberately unsafe test signer: exercise a valid second signature from a stale copy.
  const staleCopy = key.secret.slice();
  const sig = signOnce(key.secret, message(program, vault, payload));
  const stages = stageIxs(program, payer.publicKey, vault, payload, sig);
  await send([stages[0]]);
  await send([stages[0]]);
  checks.push("identical proof chunk retry");
  await reject("incomplete signature rejected", [
    computeIx(),
    withdrawIx(program, payer.publicKey, vault, payload, key.root),
  ]);
  const modified = stageIxs(
    program,
    payer.publicKey,
    vault,
    payload,
    sig.slice(),
  );
  modified[0].data[40] ^= 1;
  await reject("proof overwrite rejected", [modified[0]]);
  await send([stages[1]]);
  const before = await c.getBalance(vault);
  for (const [field, patch] of [
    ["recipient", { destination: payer.publicKey }],
    ["amount", { amount: 200_000_000n }],
    ["nonce", { nonce: 1n }],
    ["expiry", { expirySlot: expirySlot + 1n }],
    ["next root", { nextRoot: key.root }],
  ] as const) {
    const altered = encodeIntent(
      Object.assign(
        {
          vaultId: id,
          expirySlot,
          nonce: 0n,
          kind: 0 as const,
          mint: PublicKey.default,
          destination: recipient.publicKey,
          amount: 100_000_000n,
          nextRoot: next.root,
        },
        patch,
      ),
    );
    for (const ix of stageIxs(program, payer.publicKey, vault, altered, sig))
      await send([ix]);
    await reject(`tampered ${field} rejected`, [
      computeIx(),
      withdrawIx(program, payer.publicKey, vault, altered, key.root),
    ]);
  }
  // Bypass all SDK validation as a compromised frontend could.
  for (const [label, mutate] of [
    [
      "truncated payload",
      (ix: TransactionInstruction) => {
        ix.data = ix.data.subarray(0, -1);
      },
    ],
    [
      "trailing payload",
      (ix: TransactionInstruction) => {
        ix.data = Buffer.concat([ix.data, Buffer.from([0])]);
      },
    ],
    [
      "wrong version",
      (ix: TransactionInstruction) => {
        ix.data[1] = 1;
      },
    ],
    [
      "wrong vault id",
      (ix: TransactionInstruction) => {
        ix.data[2] ^= 1;
      },
    ],
    [
      "missing next commitment",
      (ix: TransactionInstruction) => {
        ix.data.fill(0, 123, 155);
      },
    ],
    [
      "missing next commitment account",
      (ix: TransactionInstruction) => {
        ix.keys.splice(5, 1);
      },
    ],
    [
      "wrong destination account",
      (ix: TransactionInstruction) => {
        ix.keys[2].pubkey = payer.publicKey;
      },
    ],
    [
      "wrong vault account",
      (ix: TransactionInstruction) => {
        ix.keys[0].pubkey = recipient.publicKey;
      },
    ],
    [
      "wrong program",
      (ix: TransactionInstruction) => {
        ix.programId = SystemProgram.programId;
      },
    ],
    [
      "wrong SOL mint",
      (ix: TransactionInstruction) => {
        ix.data[43] = 1;
      },
    ],
  ] as const) {
    const ix = withdrawIx(program, payer.publicKey, vault, payload, key.root);
    mutate(ix);
    await reject(`${label} rejected without trusting SDK`, [computeIx(), ix]);
  }
  const competingPayload = encodeIntent({
    vaultId: id,
    expirySlot,
    nonce: 0n,
    kind: 0,
    mint: PublicKey.default,
    destination: payer.publicKey,
    amount: 100_000_001n,
    nextRoot: next.root,
  });
  const competingSignature = signOnce(
    staleCopy,
    message(program, vault, competingPayload),
  );
  assert(
    verify(
      competingSignature,
      message(program, vault, competingPayload),
      key.root,
    ),
  );
  for (const ix of stageIxs(
    program,
    payer.publicKey,
    vault,
    competingPayload,
    competingSignature,
  ))
    await send([ix]);
  assert.equal(await c.getBalance(vault), before);
  await send([
    computeIx(),
    withdrawIx(program, payer.publicKey, vault, payload, key.root),
  ]);
  assert.equal(await c.getBalance(recipient.publicKey), 100_000_000);
  let state = parseVault((await c.getAccountInfo(vault))!.data);
  assert.equal(state.nonce, 1n);
  assert.ok(equal(state.root, next.root));
  checks.push("SOL withdrawal and atomic root rotation");
  await reject("withdrawal replay rejected", [
    computeIx(),
    withdrawIx(program, payer.publicKey, vault, payload, key.root),
  ]);
  await reject("second valid signature under spent commitment rejected", [
    computeIx(),
    withdrawIx(program, payer.publicKey, vault, competingPayload, key.root),
  ]);
  assert(
    (await c.getAccountInfo(spentAddress(program, key.root)))!.owner.equals(
      program,
    ),
  );
  await reject("spent root cannot initialize another vault", [
    initializeIx(
      program,
      payer.publicKey,
      crypto.getRandomValues(new Uint8Array(32)),
      key.root,
    ),
  ]);
  const reinstall = encodeIntent({
    vaultId: id,
    expirySlot,
    nonce: 1n,
    kind: 0,
    mint: PublicKey.default,
    destination: recipient.publicKey,
    amount: 1n,
    nextRoot: key.root,
  });
  // Test-only copy to challenge an invalid rotation without sacrificing this scenario's next fixture key.
  const reinstallSig = signOnce(
    next.secret.slice(),
    message(program, vault, reinstall),
  );
  for (const ix of stageIxs(
    program,
    payer.publicKey,
    vault,
    reinstall,
    reinstallSig,
  ))
    await send([ix]);
  await reject("spent root cannot be reinstalled", [
    computeIx(),
    withdrawIx(program, payer.publicKey, vault, reinstall, next.root),
  ]);
  await send([closeProofIx(program, payer.publicKey, vault, payload)]);
  checks.push("proof rent reclaim");
  const mint = await createMint(c, payer, payer.publicKey, null, 6);
  const source = await getOrCreateAssociatedTokenAccount(
    c,
    payer,
    mint,
    vault,
    true,
  );
  const dest = await getOrCreateAssociatedTokenAccount(
    c,
    payer,
    mint,
    recipient.publicKey,
  );
  const walletToken = await getOrCreateAssociatedTokenAccount(
    c,
    payer,
    mint,
    payer.publicKey,
  );
  await mintTo(c, payer, mint, walletToken.address, payer, 500_000_000);
  await send(
    await depositIxs(
      payer.publicKey,
      vault,
      {
        key: walletToken.address.toBase58(),
        mint: mint.toBase58(),
        account: walletToken.address.toBase58(),
        label: "local fixture",
        amount: 500_000_000n,
        decimals: 6,
        frozen: false,
      },
      500_000_000n,
    ),
  );
  assert.equal((await getAccount(c, source.address)).amount, 500_000_000n);
  checks.push("classic SPL deposit through client instruction builder");
  const third = generateKey();
  const tokenPayload = encodeIntent({
    vaultId: id,
    expirySlot,
    nonce: 1n,
    kind: 1,
    mint,
    destination: dest.address,
    amount: 125_000_000n,
    nextRoot: third.root,
  });
  const tokenSig = signOnce(next.secret, message(program, vault, tokenPayload));
  for (const ix of stageIxs(
    program,
    payer.publicKey,
    vault,
    tokenPayload,
    tokenSig,
  ))
    await send([ix]);
  const badIx = withdrawIx(
    program,
    payer.publicKey,
    vault,
    tokenPayload,
    next.root,
    source.address,
  );
  badIx.keys[9].pubkey = TOKEN_2022_PROGRAM_ID;
  await reject("Token-2022 substitution rejected", [computeIx(), badIx]);
  const wrongMint = withdrawIx(
    program,
    payer.publicKey,
    vault,
    tokenPayload,
    next.root,
    source.address,
  );
  wrongMint.keys[8].pubkey = recipient.publicKey;
  await reject("SPL mint substitution rejected", [computeIx(), wrongMint]);
  const foreign = await getOrCreateAssociatedTokenAccount(
    c,
    payer,
    mint,
    payer.publicKey,
  );
  await reject("foreign token source rejected", [
    computeIx(),
    withdrawIx(
      program,
      payer.publicKey,
      vault,
      tokenPayload,
      next.root,
      foreign.address,
    ),
  ]);
  await send([
    computeIx(),
    withdrawIx(
      program,
      payer.publicKey,
      vault,
      tokenPayload,
      next.root,
      source.address,
    ),
  ]);
  assert.equal((await getAccount(c, dest.address)).amount, 125_000_000n);
  state = parseVault((await c.getAccountInfo(vault))!.data);
  assert.equal(state.nonce, 2n);
  assert.ok(equal(state.root, third.root));
  assert.equal((await getAccount(c, source.address)).amount, 375_000_000n);
  assert.equal(await c.getBalance(vault), before - 100_000_000);
  checks.push(
    "SPL withdrawal rotates authority for all remaining SOL and SPL value",
  );
  const fourth = generateKey();
  const tooMuch = encodeIntent({
    vaultId: id,
    expirySlot,
    nonce: 2n,
    kind: 0,
    mint: PublicKey.default,
    destination: recipient.publicKey,
    amount: BigInt(await c.getBalance(vault)),
    nextRoot: fourth.root,
  });
  const rentSig = signOnce(third.secret, message(program, vault, tooMuch));
  for (const ix of stageIxs(program, payer.publicKey, vault, tooMuch, rentSig))
    await send([ix]);
  await reject("rent reserve cannot be drained", [
    computeIx(),
    withdrawIx(program, payer.publicKey, vault, tooMuch, third.root),
  ]);
  assert.equal(parseVault((await c.getAccountInfo(vault))!.data).nonce, 2n);
  checks.push("failed transfer does not rotate key");
  assert.equal(await c.getAccountInfo(spentAddress(program, third.root)), null);
  checks.push(
    "failed transfer rolls back spent marker and preserves all value",
  );
  await recoveryCases(genesis);
  const report = {
    network: "local-validator",
    protocolVersion: 2,
    binarySha256: (await import("node:crypto"))
      .createHash("sha256")
      .update(fs.readFileSync("target/deploy/bunker.so"))
      .digest("hex"),
    genesis: await c.getGenesisHash(),
    program: program.toBase58(),
    passed: checks.length,
    checks,
  };
  fs.mkdirSync("docs/evidence", { recursive: true });
  fs.writeFileSync(
    "docs/evidence/local-chain-tests.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}
function installBrowser(b: ReturnType<typeof memoryBrowser>) {
  Object.defineProperty(globalThis, "localStorage", {
    value: b.localStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: b.navigator,
    configurable: true,
  });
}
async function recoveryCases(genesis: string) {
  const f = recoveryFixture(program, genesis),
    browser = memoryBrowser();
  installBrowser(browser);
  await send([initializeIx(program, payer.publicKey, f.id, f.key.root)]);
  const read = async () => ({
    ...parseVault((await c.getAccountInfo(f.vault))!.data),
    slot: BigInt(await c.getSlot()),
  });
  const encrypted = await encryptKit(f.kit, password);
  await adoptRecovery(f.kit, encrypted, await read(), "create");
  const payload = encodeIntent({
    ...f.intent,
    amount: 2_000_000n,
    expirySlot: BigInt(await c.getSlot()) + 10000n,
  });
  const signed = await authorizeWithdrawal(
    f.kit,
    payload,
    f.next.secret,
    { recipient: f.recipient.toBase58() },
    password,
    read,
  );
  for (const ix of stageIxs(
    program,
    payer.publicKey,
    f.vault,
    payload,
    unhex(signed.kit.pending!.signature),
  ))
    await send([ix]);
  await reject("partial failure after key advance: insufficient balance", [
    computeIx(),
    withdrawIx(program, payer.publicKey, f.vault, payload, f.key.root),
  ]);
  assert.equal((await read()).nonce, 0n);
  assert.equal(await c.getAccountInfo(spentAddress(program, f.key.root)), null);
  assert.equal(
    (await decryptKit(recoveryCheckpoint(f.kit)!, password)).nextUnusedIndex,
    "2",
  );
  await assert.rejects(() =>
    authorizeWithdrawal(
      f.kit,
      f.payload,
      f.next.secret,
      { recipient: f.recipient.toBase58() },
      password,
      read,
    ),
  );
  await assert.rejects(() =>
    adoptRecovery(f.kit, encrypted, { ...f.chain, slot: 0n }, "import"),
  );
  checks.push(
    "failed/unconfirmed key remains consumed; stale import cannot re-sign",
  );
  await send([
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: f.vault,
      lamports: 5_000_000,
    }),
  ]);
  await send([
    computeIx(),
    withdrawIx(program, payer.publicKey, f.vault, payload, f.key.root),
  ]);
  const recovered = await adoptRecovery(
    signed.kit,
    signed.encrypted,
    await read(),
    "reconcile",
  );
  assert.equal(recovered.currentIndex, "1");
  assert.equal(recovered.nextUnusedIndex, "2");
  checks.push(
    "exact saved signature retries after failure and reconciles rotation",
  );

  const expired = recoveryFixture(program, genesis);
  installBrowser(memoryBrowser());
  await send([
    initializeIx(program, payer.publicKey, expired.id, expired.key.root),
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: expired.vault,
      lamports: 5_000_000,
    }),
  ]);
  const expiry = BigInt(await c.getSlot()) + 12n;
  const expPayload = encodeIntent({ ...expired.intent, expirySlot: expiry });
  const expCipher = await encryptKit(expired.kit, password);
  const expRead = async () => ({
    ...parseVault((await c.getAccountInfo(expired.vault))!.data),
    slot: BigInt(await c.getSlot()),
  });
  await adoptRecovery(expired.kit, expCipher, await expRead(), "create");
  const expSigned = await authorizeWithdrawal(
    expired.kit,
    expPayload,
    expired.next.secret,
    { recipient: expired.recipient.toBase58() },
    password,
    expRead,
  );
  for (const ix of stageIxs(
    program,
    payer.publicKey,
    expired.vault,
    expPayload,
    unhex(expSigned.kit.pending!.signature),
  ))
    await send([ix]);
  const expiryDeadline = Date.now() + 30000;
  while (BigInt(await c.getSlot()) <= expiry) {
    assert(Date.now() < expiryDeadline, "Validator slots stopped");
    await new Promise((r) => setTimeout(r, 200));
  }
  const before = await c.getBalance(expired.vault);
  await reject("valid signature expires on-chain by slot", [
    computeIx(),
    withdrawIx(
      program,
      payer.publicKey,
      expired.vault,
      expPayload,
      expired.key.root,
    ),
  ]);
  assert.equal(await c.getBalance(expired.vault), before);
  assert.equal((await expRead()).nonce, 0n);
  await assert.rejects(() =>
    authorizeWithdrawal(
      expired.kit,
      expired.payload,
      expired.next.secret,
      { recipient: expired.recipient.toBase58() },
      password,
      expRead,
    ),
  );
  checks.push(
    "expired authorization cannot be replaced from old recovery state",
  );

  // Two separate origins/devices have NO shared journal. This is a documented limitation:
  // they can sign twice, but the program must accept at most one successful withdrawal.
  const twin = recoveryFixture(program, genesis),
    nextB = generateKey();
  await send([
    initializeIx(program, payer.publicKey, twin.id, twin.key.root),
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: twin.vault,
      lamports: 5_000_000,
    }),
  ]);
  const twinCipher = await encryptKit(twin.kit, password);
  const twinRead = async () => ({
    ...parseVault((await c.getAccountInfo(twin.vault))!.data),
    slot: BigInt(await c.getSlot()),
  });
  const twins: {
    p: Uint8Array;
    result: Awaited<ReturnType<typeof authorizeWithdrawal>>;
  }[] = [];
  for (const [amount, nextKey] of [
    [1_000_000n, twin.next],
    [2_000_000n, nextB],
  ] as const) {
    installBrowser(memoryBrowser());
    const restored = await adoptRecovery(
      await decryptKit(twinCipher, password),
      twinCipher,
      await twinRead(),
      "import",
    );
    const p = encodeIntent({ ...twin.intent, amount, nextRoot: nextKey.root });
    const result = await authorizeWithdrawal(
      restored,
      p,
      nextKey.secret,
      { recipient: twin.recipient.toBase58() },
      password,
      twinRead,
    );
    assert(
      verify(
        unhex(result.kit.pending!.signature),
        message(program, twin.vault, p),
        twin.key.root,
      ),
    );
    twins.push({ p, result });
  }
  for (const t of twins)
    for (const ix of stageIxs(
      program,
      payer.publicKey,
      twin.vault,
      t.p,
      unhex(t.result.kit.pending!.signature),
    ))
      await send([ix]);
  await send([
    computeIx(),
    withdrawIx(program, payer.publicKey, twin.vault, twins[0].p, twin.key.root),
  ]);
  await reject(
    "two separately restored copies cannot both get different authorizations accepted",
    [
      computeIx(),
      withdrawIx(
        program,
        payer.publicKey,
        twin.vault,
        twins[1].p,
        twin.key.root,
      ),
    ],
  );
  assert.equal((await twinRead()).nonce, 1n);
  await assert.rejects(() =>
    adoptRecovery(
      twins[1].result.kit,
      twins[1].result.encrypted,
      { nonce: 1n, root: twin.next.root, slot: 1n },
      "import",
    ),
  );
  checks.push("losing restored copy refuses divergent chain commitment");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
