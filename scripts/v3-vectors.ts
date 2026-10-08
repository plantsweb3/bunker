// PUBLIC TEST MATERIAL ONLY. Reproducible protocol-3 derivation, encoding and
// signature vectors from the TypeScript client. Never fund these keys.
//   npx tsx scripts/v3-vectors.ts > fixtures/bunker-v3.json
import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { hex } from "../sdk/bytes";
import { context, Descriptor, epochSeed } from "../sdk/v3/derive";
import {
  genesisAuthorities,
  operationalRoot,
  recoveryPacket,
  signAnnouncement,
} from "../sdk/v3/authority";
import { initializeIx, vaultAddress } from "../sdk/v3/protocol";
export function vectors() {
  const master = new Uint8Array(32).fill(0x42);
  const program = new PublicKey(new Uint8Array(32).fill(11));
  const d: Descriptor = {
    chainTag: new Uint8Array(32).fill(9),
    programId: program.toBytes(),
    vaultId: new Uint8Array(32).fill(7),
  };
  const delaySecs = 86_400;
  const genesis = genesisAuthorities(master, d);
  const payer = new PublicKey(new Uint8Array(32).fill(5));
  const init = initializeIx(program, payer, {
    vaultId: d.vaultId,
    chainTag: d.chainTag,
    opRoot: genesis.opRoot,
    recRoot: genesis.recRoot,
    delaySecs,
  });
  const destination = new PublicKey(new Uint8Array(32).fill(3));
  const withdrawal = {
    kind: 0 as const,
    mint: PublicKey.default,
    destination,
    amount: 2_000_000_000n,
    announceBy: 1_800_003_600n,
  };
  const signed = (m: { payload: Uint8Array; message: Uint8Array; signature: Uint8Array }) => ({
    payload: hex(m.payload),
    message: hex(m.message),
    digest: hex(sha256(m.message)),
    signature: hex(m.signature),
  });
  const announce = signAnnouncement(genesis.seed, d, { ...withdrawal, epoch: 0n, opIndex: 0n });
  const recover = recoveryPacket(master, d, 0n);
  const seed1 = epochSeed(master, d, 1n);
  const announce1 = signAnnouncement(seed1, d, { ...withdrawal, epoch: 1n, opIndex: 0n });
  return {
    warning: "PUBLIC TEST KEYS. Never fund or use outside isolated tests.",
    protocolVersion: 3,
    upstreamRevision: "672fc6789b1532ee680f24842d235e0be8737b61",
    master: hex(master),
    chainTag: hex(d.chainTag),
    program: program.toBase58(),
    programBytes: hex(d.programId),
    vaultId: hex(d.vaultId),
    vault: vaultAddress(program, d.vaultId).toBase58(),
    delaySecs,
    context: hex(context(d)),
    destination: hex(destination.toBytes()),
    amount: withdrawal.amount.toString(),
    announceBy: withdrawal.announceBy.toString(),
    epoch0: {
      seed: hex(genesis.seed),
      opRoot: hex(genesis.opRoot),
      opRootIndex1: hex(operationalRoot(genesis.seed, d, 0n, 1n)),
      recRoot: hex(genesis.recRoot),
    },
    epoch1: {
      seed: hex(seed1),
      opRoot: hex(operationalRoot(seed1, d, 1n, 0n)),
      opRootIndex1: hex(operationalRoot(seed1, d, 1n, 1n)),
    },
    initializeData: hex(init.data.subarray(1)),
    announce: signed(announce),
    recover: signed(recover),
    announceAfterRecovery: signed(announce1),
  };
}
if (process.argv[1]?.endsWith("v3-vectors.ts"))
  console.log(JSON.stringify(vectors(), null, 2));
