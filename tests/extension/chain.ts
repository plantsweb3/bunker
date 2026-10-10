// A stand-in chain for the extension's tests: it serves vault accounts, the
// clock and a genesis hash, and counts what was asked of it.
import { PublicKey } from "@solana/web3.js";
import { MAINNET_GENESIS, MAINNET_PROGRAM_ID } from "../../lib/bunker-config";
import { vaultAddress, VAULT_SIZE } from "../../sdk/v3/protocol";

export const PROGRAM = new PublicKey(MAINNET_PROGRAM_ID);
export const id = (n: number) => new Uint8Array(32).fill(n);
export const NOW = 1_800_000_000n;
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
export type Waiting = { amount: bigint; opensAt: bigint; deadline: bigint; digest: number; destination?: Uint8Array };
export type Sim = {
  epoch: bigint;
  opIndex: bigint;
  lamports: number;
  pending: Waiting | null;
  owner: PublicKey;
  trusted?: Uint8Array[];
};
/** A vault account's bytes, laid out as docs/PROTOCOL.md says. */
export function vaultData(vaultId: Uint8Array, v: Sim) {
  const d = new Uint8Array(VAULT_SIZE);
  const view = new DataView(d.buffer);
  d.set(new TextEncoder().encode("BUNKER03"));
  d.set(vaultId, 8);
  d.set(id(2), 40);
  d.set(id(3), 72);
  view.setBigUint64(104, v.opIndex, true);
  view.setBigUint64(112, v.epoch, true);
  d.set(id(4), 120);
  view.setUint32(152, 86_400, true);
  if (v.pending) {
    d[156] = 1;
    d.set(v.pending.destination ?? id(6), 190);
    view.setBigUint64(222, v.pending.amount, true);
    view.setBigInt64(230, v.pending.opensAt, true);
    view.setBigInt64(238, v.pending.deadline, true);
    view.setBigUint64(246, v.epoch, true);
    d.set(id(v.pending.digest), 254);
  }
  d[286] = 255;
  (v.trusted ?? []).forEach((t, i) => d.set(t, 287 + 32 * i));
  return d;
}
export function chain(vaultIds = [id(7)], genesis = MAINNET_GENESIS) {
  const state = new Map(
    vaultIds.map((v) => [
      vaultAddress(PROGRAM, v).toBase58(),
      { vaultId: v, v: { epoch: 1n, opIndex: 11n, lamports: 12_400_000_000, pending: null, owner: PROGRAM } as Sim },
    ]),
  );
  const asked: string[] = [];
  let failWith: Error | null = null;
  const clock = new Uint8Array(40);
  const at = { now: NOW, slot: 1000 };
  const account = (key: PublicKey) => {
    const found = state.get(key.toBase58());
    return found ? { data: Buffer.from(vaultData(found.vaultId, found.v)), owner: found.v.owner, lamports: found.v.lamports } : null;
  };
  const ask = <T>(name: string, answer: () => T) => {
    asked.push(name);
    if (failWith) throw failWith;
    return answer();
  };
  return {
    address: (n = 0) => vaultAddress(PROGRAM, vaultIds[n]).toBase58(),
    of: (n = 0) => state.get(vaultAddress(PROGRAM, vaultIds[n]).toBase58())!.v,
    asked,
    at,
    fail: (e: Error | null) => (failWith = e),
    connection: {
      getGenesisHash: async () => ask("getGenesisHash", () => genesis),
      getMinimumBalanceForRentExemption: async () => ask("getMinimumBalanceForRentExemption", () => 4_000_000),
      getAccountInfo: async (key: PublicKey) =>
        ask("getAccountInfo", () => {
          if (key.toBase58() !== CLOCK) return account(key);
          new DataView(clock.buffer).setBigInt64(32, at.now, true);
          return { data: Buffer.from(clock), owner: PublicKey.default, lamports: 1 };
        }),
      getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) =>
        ask("getMultipleAccountsInfoAndContext", () => ({
          context: { slot: at.slot++ },
          value: keys.map((key) => {
            if (key.toBase58() !== CLOCK) return account(key);
            new DataView(clock.buffer).setBigInt64(32, at.now, true);
            return { data: Buffer.from(clock), owner: PublicKey.default, lamports: 1 };
          }),
        })),
    } as never,
  };
}
