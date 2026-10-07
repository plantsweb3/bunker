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
import { generateKey, signOnce } from "../sdk/winternitz";
import { equal } from "../sdk/bytes";
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
} from "../sdk/protocol";
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
  assert(!["5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "EtWTRABZaYq6iMfeYKouRu166VU2xqa1"].includes(genesis), "Local tests must never run on a public cluster");
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
  const payload = encodeIntent({
    nonce: 0n,
    kind: 0,
    mint: PublicKey.default,
    destination: recipient.publicKey,
    amount: 100_000_000n,
    nextRoot: next.root,
  });
  const sig = signOnce(key.secret, message(program, vault, payload));
  const stages = stageIxs(program, payer.publicKey, vault, payload, sig);
  await send([stages[0]]);
  await send([stages[0]]);
  checks.push("identical proof chunk retry");
  await reject("incomplete signature rejected", [
    computeIx(),
    withdrawIx(program, payer.publicKey, vault, payload),
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
    ["next root", { nextRoot: key.root }],
  ] as const) {
    const altered = encodeIntent(
      Object.assign(
        {
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
      withdrawIx(program, payer.publicKey, vault, altered),
    ]);
  }
  assert.equal(await c.getBalance(vault), before);
  await send([
    computeIx(),
    withdrawIx(program, payer.publicKey, vault, payload),
  ]);
  assert.equal(await c.getBalance(recipient.publicKey), 100_000_000);
  let state = parseVault((await c.getAccountInfo(vault))!.data);
  assert.equal(state.nonce, 1n);
  assert.ok(equal(state.root, next.root));
  checks.push("SOL withdrawal and atomic root rotation");
  await reject("withdrawal replay rejected", [
    computeIx(),
    withdrawIx(program, payer.publicKey, vault, payload),
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
  await mintTo(c, payer, mint, source.address, payer, 500_000_000);
  checks.push("classic SPL custody");
  const third = generateKey();
  const tokenPayload = encodeIntent({
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
    source.address,
  );
  badIx.keys[5].pubkey = TOKEN_2022_PROGRAM_ID;
  await reject("Token-2022 substitution rejected", [computeIx(), badIx]);
  const foreign = await getOrCreateAssociatedTokenAccount(
    c,
    payer,
    mint,
    payer.publicKey,
  );
  await reject("foreign token source rejected", [
    computeIx(),
    withdrawIx(program, payer.publicKey, vault, tokenPayload, foreign.address),
  ]);
  await send([
    computeIx(),
    withdrawIx(program, payer.publicKey, vault, tokenPayload, source.address),
  ]);
  assert.equal((await getAccount(c, dest.address)).amount, 125_000_000n);
  state = parseVault((await c.getAccountInfo(vault))!.data);
  assert.equal(state.nonce, 2n);
  assert.ok(equal(state.root, third.root));
  checks.push("SPL withdrawal and rotation");
  const fourth = generateKey();
  const tooMuch = encodeIntent({
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
    withdrawIx(program, payer.publicKey, vault, tooMuch),
  ]);
  assert.equal(parseVault((await c.getAccountInfo(vault))!.data).nonce, 2n);
  checks.push("failed transfer does not rotate key");
  const report = {
    network: "local-validator",
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
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
