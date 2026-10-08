import { afterEach, describe, it, expect, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { hex } from "../sdk/bytes";
import { verify } from "../sdk/winternitz";
import { genesisVault, operationalRoot } from "../sdk/v3/authority";
import {
  authorizeAnnouncement,
  journalKey,
  journalStatus,
  readJournal,
  safeJournalStatus,
} from "../sdk/v3/journal";
import {
  decryptArchival,
  decryptDayKey,
  encryptFile,
  ArchivalKit,
  DayKey,
} from "../sdk/v3/kit";
import { decodeAnnounce, vaultAddress, VaultState } from "../sdk/v3/protocol";
import { formatDuration } from "../sdk/v3/chain";
import { memoryBrowser } from "./memory-browser";
afterEach(() => vi.unstubAllGlobals());
const program = new PublicKey(new Uint8Array(32).fill(11));
const genesis = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
const salt = new Uint8Array(32).fill(7);
const master = new Uint8Array(32).fill(0x42);
const g = genesisVault(master, { chainTag: new PublicKey(genesis).toBytes(), programId: program.toBytes(), salt, delaySecs: 86_400 });
const { d } = g;
const vaultId = d.vaultId;
const identity = {
  genesis,
  program: program.toBase58(),
  vault: vaultAddress(program, vaultId).toBase58(),
};
const base = {
  version: 3 as const,
  network: "localnet" as const,
  ...identity,
  salt: hex(salt),
  vaultId: hex(vaultId),
};
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
  announceBy: BigInt(Math.floor(Date.now() / 1000)) + 3600n,
  decimals: 0,
};
/** The chain as it honestly is at `opIndex` in epoch 0. */
const at = (opIndex: bigint) => chain({ opIndex, opRoot: operationalRoot(g.seed, d, 0n, opIndex) });
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
    expect(JSON.parse(b.storage.get(journalKey(identity))!).entries[0].status).toBe("reserved");
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
    const next = await authorizeAnnouncement(identity, g.seed, d, at(1n), withdrawal);
    expect(decodeAnnounce(next.payload).opIndex).toBe(1n);
  });
  it("never signs twice when the chain view goes forward and then back", async () => {
    browser();
    // The connection shows index 5, then 6, then 5 again (a lagging or lying node).
    const first = await authorizeAnnouncement(identity, g.seed, d, at(5n), withdrawal);
    await authorizeAnnouncement(identity, g.seed, d, at(6n), { ...withdrawal, amount: 6n });
    const back = journalStatus(identity, at(5n));
    expect(back.state).toBe("signed");
    if (back.state === "signed")
      expect(hex(back.announcement.signature)).toBe(hex(first.signature));
    await expect(
      authorizeAnnouncement(identity, g.seed, d, at(5n), { ...withdrawal, amount: 7n }),
    ).rejects.toThrow("already signed");
    // An index below everything signed, with no saved bytes, is refused outright.
    expect(journalStatus(identity, at(4n)).state).toBe("behind");
    await expect(
      authorizeAnnouncement(identity, g.seed, d, at(4n), withdrawal),
    ).rejects.toThrow("older state");
    // So is an earlier epoch after a later one has been signed in.
    const seed1 = new Uint8Array(32).fill(1);
    const epoch1 = chain({ epoch: 1n, opRoot: operationalRoot(seed1, d, 1n, 0n) });
    await authorizeAnnouncement(identity, seed1, d, epoch1, withdrawal);
    expect(journalStatus(identity, at(7n)).state).toBe("behind");
  });
  it("remembers a used key after its signed bytes are no longer kept", async () => {
    browser();
    for (let i = 0n; i < 20n; i++)
      await authorizeAnnouncement(identity, g.seed, d, at(i), withdrawal);
    const j = readJournal(identity);
    expect(j.entries.length).toBe(16);
    expect(j.used).toEqual({ "0": "19" });
    expect(journalStatus(identity, at(0n)).state).toBe("behind");
    expect(journalStatus(identity, at(19n)).state).toBe("signed");
    expect(journalStatus(identity, at(20n)).state).toBe("unused");
  });
  it("only signs for the key this day key derives, and bounds the deadline", async () => {
    const b = browser();
    // A vault view whose current root is not this seed's root for the tuple.
    await expect(
      authorizeAnnouncement(identity, g.seed, d, chain({ opIndex: 3n }), withdrawal),
    ).rejects.toThrow("does not match");
    await expect(
      authorizeAnnouncement(identity, new Uint8Array(32).fill(9), d, chain(), withdrawal),
    ).rejects.toThrow("does not match");
    await expect(
      authorizeAnnouncement(identity, g.seed, d, chain(), {
        ...withdrawal,
        announceBy: withdrawal.announceBy + 90_000n,
      }),
    ).rejects.toThrow("clock");
    // A network clock in the past would yield a signature that is already
    // dead, or an invalid message: refused before the key is reserved.
    for (const announceBy of [withdrawal.announceBy - 7200n, 0n, -5n])
      await expect(
        authorizeAnnouncement(identity, g.seed, d, chain(), { ...withdrawal, announceBy }),
      ).rejects.toThrow("clock");
    await expect(
      authorizeAnnouncement(identity, g.seed, d, chain(), { ...withdrawal, amount: 0n }),
    ).rejects.toThrow("Invalid announcement");
    expect(b.storage.size).toBe(0);
  });
  it("reads the earlier single-entry format and refuses an unreadable journal", async () => {
    const b = browser();
    b.localStorage.setItem(
      journalKey(identity),
      JSON.stringify({ version: 3, epoch: "0", opIndex: "2", status: "reserved" }),
    );
    expect(journalStatus(identity, at(2n)).state).toBe("orphaned");
    expect(journalStatus(identity, at(1n)).state).toBe("behind");
    b.localStorage.setItem(journalKey(identity), "{not json");
    expect(safeJournalStatus(identity, at(3n)).state).toBe("unreadable");
    await expect(
      authorizeAnnouncement(identity, g.seed, d, at(3n), withdrawal),
    ).rejects.toThrow();
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
  const day: DayKey = { ...base, kind: "day-key", delaySecs: 86_400, epoch: "0", seed: hex(g.seed) };
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
    // A kit whose master does not create the vault it names is refused.
    const wrong = hex(new Uint8Array(32).fill(0x43));
    await expect(encryptFile({ ...archival, master: wrong }, password)).rejects.toThrow("does not match its vault");
    await expect(encryptFile({ ...archival, delaySecs: 0 }, password)).rejects.toThrow("does not match its vault");
    await expect(encryptFile(day, "123456789012")).rejects.toThrow("too easy");
    await expect(encryptFile(day, "short")).rejects.toThrow("at least 12");
    await expect(encryptFile({ ...archival, delaySecs: 604_801 }, password)).rejects.toThrow();
    await expect(encryptFile({ ...archival, delaySecs: -1 }, password)).rejects.toThrow();
  });
  it("refuses the wrong kind of file before the password is used", async () => {
    const a = await encryptFile(archival, password);
    // Even the right password for a recovery kit opens nothing where a day
    // key is expected, and the answer does not depend on the password.
    await expect(decryptDayKey(a, password)).rejects.toThrow("not a day key");
    await expect(decryptDayKey(a, "some other password!")).rejects.toThrow("not a day key");
    // Relabelling the file does not help: the label is authenticated.
    const relabelled = JSON.stringify({ ...JSON.parse(a), kind: "day-key" });
    await expect(decryptDayKey(relabelled, password)).rejects.toThrow("Incorrect password or damaged");
  });
  it("derives the file key with scrypt and holds the recovery kit to a higher floor", async () => {
    const e = JSON.parse(await encryptFile(archival, password));
    expect([e.format, e.kdf, e.N, e.r, e.p, e.kind]).toEqual(["bunker3-encrypted-v3", "scrypt", 131072, 8, 1, "archival"]);
    // Weakening the cost in the file does not make it open faster: the cost is fixed.
    await expect(decryptArchival(JSON.stringify({ ...e, N: 1024 }), password)).rejects.toThrow("not a Bunker key file");
    // Fourteen characters is enough for a day key and not for the kit.
    await expect(encryptFile(archival, "fourteen chars")).rejects.toThrow("at least 16");
    expect(typeof (await encryptFile(day, "fourteen chars"))).toBe("string");
  });
  it("opens with the same password however the keyboard composed it", async () => {
    // "é" as one code point and as "e" plus a combining accent.
    const composed = "caf\u00e9 au lait every day";
    const decomposed = "cafe\u0301 au lait every day";
    expect(composed).not.toBe(decomposed);
    const file = await encryptFile(day, composed);
    expect(await decryptDayKey(file, decomposed)).toEqual(day);
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
