import { afterEach, describe, it, expect, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { hex } from "../sdk/bytes";
import { verify } from "../sdk/winternitz";
import { genesisAuthorities } from "../sdk/v3/authority";
import { Descriptor } from "../sdk/v3/derive";
import { authorizeAnnouncement, journalKey, journalStatus } from "../sdk/v3/journal";
import {
  decryptArchival,
  decryptDayKey,
  descriptorOf,
  encryptFile,
  ArchivalKit,
  DayKey,
} from "../sdk/v3/kit";
import { decodeAnnounce, vaultAddress, VaultState } from "../sdk/v3/protocol";
import { formatDuration } from "../sdk/v3/chain";
import { memoryBrowser } from "./recovery-fixture";
afterEach(() => vi.unstubAllGlobals());
const program = new PublicKey(new Uint8Array(32).fill(11));
const genesis = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
const vaultId = new Uint8Array(32).fill(7);
const master = new Uint8Array(32).fill(0x42);
const identity = {
  genesis,
  program: program.toBase58(),
  vault: vaultAddress(program, vaultId).toBase58(),
};
const base = { version: 3 as const, network: "localnet" as const, ...identity, vaultId: hex(vaultId) };
const d: Descriptor = descriptorOf(base);
const g = genesisAuthorities(master, d);
const chain = (over: Partial<VaultState> = {}): VaultState => ({
  vaultId,
  chainTag: d.chainTag,
  opRoot: g.opRoot,
  opIndex: 0n,
  epoch: 0n,
  recRoot: g.recRoot,
  delaySecs: 86_400,
  pending: null,
  bump: 255,
  ...over,
});
const withdrawal = {
  kind: 0 as const,
  mint: PublicKey.default,
  destination: new PublicKey(new Uint8Array(32).fill(3)),
  amount: 5n,
  announceBy: 2_000_000_000n,
};
function browser() {
  const b = memoryBrowser();
  vi.stubGlobal("navigator", b.navigator);
  vi.stubGlobal("localStorage", b.localStorage);
  return b;
}
describe("Protocol 3 signing journal", () => {
  it("signs once, saves the exact bytes, and refuses a second signature", async () => {
    browser();
    const signed = await authorizeAnnouncement(identity, g.seed, d, chain(), withdrawal);
    expect(verify(signed.signature, signed.message, g.opRoot)).toBe(true);
    expect(decodeAnnounce(signed.payload).amount).toBe(5n);
    const status = journalStatus(identity, chain());
    expect(status.state).toBe("signed");
    if (status.state === "signed")
      expect(hex(status.announcement.signature)).toBe(hex(signed.signature));
    await expect(
      authorizeAnnouncement(identity, g.seed, d, chain(), { ...withdrawal, amount: 6n }),
    ).rejects.toThrow("already signed");
    await expect(
      authorizeAnnouncement(identity, g.seed, d, chain(), withdrawal),
    ).rejects.toThrow("already signed");
  });
  it("two tabs racing different withdrawals produce exactly one signature", async () => {
    browser();
    const results = await Promise.allSettled([
      authorizeAnnouncement(identity, g.seed, d, chain(), withdrawal),
      authorizeAnnouncement(identity, g.seed, d, chain(), { ...withdrawal, amount: 9n }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
  });
  it("a reservation without a saved signature is orphaned, not reusable", async () => {
    const b = browser();
    let writes = 0;
    vi.stubGlobal("localStorage", {
      ...b.localStorage,
      setItem: (k: string, v: string) => {
        if (++writes === 2) throw new Error("save failed");
        b.localStorage.setItem(k, v);
      },
    });
    await expect(
      authorizeAnnouncement(identity, g.seed, d, chain(), withdrawal),
    ).rejects.toThrow("save failed");
    vi.stubGlobal("localStorage", b.localStorage);
    expect(JSON.parse(b.storage.get(journalKey(identity))!).status).toBe("reserved");
    expect(journalStatus(identity, chain()).state).toBe("orphaned");
    await expect(
      authorizeAnnouncement(identity, g.seed, d, chain(), withdrawal),
    ).rejects.toThrow("Recover to a new key");
  });
  it("moves on when the chain advances the index or the epoch", async () => {
    browser();
    await authorizeAnnouncement(identity, g.seed, d, chain(), withdrawal);
    expect(journalStatus(identity, chain({ opIndex: 1n })).state).toBe("unused");
    expect(journalStatus(identity, chain({ epoch: 1n })).state).toBe("unused");
    const next = await authorizeAnnouncement(identity, g.seed, d, chain({ opIndex: 1n }), withdrawal);
    expect(decodeAnnounce(next.payload).opIndex).toBe(1n);
  });
  it("refuses while a withdrawal is pending, without reserving", async () => {
    const b = browser();
    const pending = { ...withdrawal, opensAt: 1n, deadline: 2n, epoch: 0n, digest: new Uint8Array(32) };
    await expect(
      authorizeAnnouncement(identity, g.seed, d, chain({ pending }), withdrawal),
    ).rejects.toThrow("already pending");
    expect(b.storage.size).toBe(0);
  });
  it("fails closed without locks or storage", async () => {
    const b = browser();
    vi.stubGlobal("navigator", {});
    await expect(
      authorizeAnnouncement(identity, g.seed, d, chain(), withdrawal),
    ).rejects.toThrow("Web Locks");
    vi.stubGlobal("navigator", b.navigator);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    await expect(
      authorizeAnnouncement(identity, g.seed, d, chain(), withdrawal),
    ).rejects.toThrow("persist");
  });
});
describe("Protocol 3 key files", () => {
  const password = "public testing password";
  const archival: ArchivalKit = { ...base, kind: "archival", delaySecs: 86_400, master: hex(master) };
  const day: DayKey = { ...base, kind: "day-key", epoch: "0", seed: hex(g.seed) };
  it("round-trips both files and keeps them from being mistaken for each other", async () => {
    const a = await encryptFile(archival, password);
    const k = await encryptFile(day, password);
    expect(await decryptArchival(a, password)).toEqual(archival);
    expect(await decryptDayKey(k, password)).toEqual(day);
    expect(a).not.toContain(hex(master));
    await expect(decryptDayKey(a, password)).rejects.toThrow("not a day key");
    await expect(decryptArchival(k, password)).rejects.toThrow("not an archival");
    await expect(decryptArchival(a, "wrong password here")).rejects.toThrow("Incorrect password");
    await expect(decryptArchival("{}", password)).rejects.toThrow("not a Bunker key file");
  });
  it("rejects a file whose vault address does not match its identity", async () => {
    const other = vaultAddress(program, new Uint8Array(32).fill(8)).toBase58();
    await expect(encryptFile({ ...day, vault: other }, password)).rejects.toThrow("does not match");
    await expect(encryptFile({ ...archival, delaySecs: 604_801 }, password)).rejects.toThrow();
    await expect(encryptFile({ ...archival, delaySecs: -1 }, password)).rejects.toThrow();
    expect(await decryptArchival(await encryptFile({ ...archival, delaySecs: 0 }, password), password)).toMatchObject({ delaySecs: 0 });
  });
  it("detects tampering with the envelope", async () => {
    const e = JSON.parse(await encryptFile(day, password));
    e.iv = e.iv.replace(/^../, e.iv.startsWith("00") ? "01" : "00");
    await expect(decryptDayKey(JSON.stringify(e), password)).rejects.toThrow("Incorrect password or damaged");
  });
});
describe("Durations", () => {
  it("formats waiting periods", () => {
    expect([86_400n, 86_399n, 3_661n, 90n, 0n, -5n].map(formatDuration)).toEqual([
      "1d 0h", "23h 59m", "1h 1m", "1m 30s", "0m 00s", "0m 00s",
    ]);
  });
});
