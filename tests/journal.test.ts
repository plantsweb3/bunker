import { afterEach, describe, it, expect, vi } from "vitest";
import {
  adoptRecovery,
  authorizeWithdrawal,
  decryptKit,
  encryptKit,
  journalKey,
  recoveryCheckpoint,
  reconcileKit,
  validateRecoveryKit,
} from "../sdk/recovery";
import { encodeIntent } from "../sdk/protocol";
import { hex } from "../sdk/bytes";
import { memoryBrowser, recoveryFixture, password } from "./recovery-fixture";
afterEach(() => vi.unstubAllGlobals());
async function setup() {
  const b = memoryBrowser();
  vi.stubGlobal("navigator", b.navigator);
  vi.stubGlobal("localStorage", b.localStorage);
  const f = recoveryFixture();
  const encrypted = await encryptKit(f.kit, password);
  await adoptRecovery(f.kit, encrypted, f.chain, "create");
  const sign = (payload = f.payload, kit = f.kit) =>
    authorizeWithdrawal(
      kit,
      payload,
      f.next.secret,
      { recipient: f.recipient.toBase58() },
      password,
      async () => f.chain,
    );
  return { ...b, ...f, encrypted, sign };
}
describe("Canonical recovery and one-time journal", () => {
  it("two explicitly restored copies cannot sign different intents in one persistent origin", async () => {
    const f = await setup();
    const a = await adoptRecovery(
      await decryptKit(f.encrypted, password),
      f.encrypted,
      f.chain,
      "import",
    );
    const b = await adoptRecovery(
      await decryptKit(f.encrypted, password),
      f.encrypted,
      f.chain,
      "import",
    );
    const results = await Promise.allSettled([
      f.sign(f.payload, a),
      f.sign(encodeIntent({ ...f.intent, amount: 2n }), b),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    await expect(
      adoptRecovery(b, f.encrypted, f.chain, "import"),
    ).rejects.toThrow("disagree");
    await expect(f.sign()).rejects.toThrow("unused key"); // Even identical signing cannot repeat.
  });
  it("stores the exact signature, keeps a failed key consumed, and reconciles only the next on-chain commitment", async () => {
    const f = await setup(),
      signed = await f.sign();
    const saved = await decryptKit(recoveryCheckpoint(f.kit)!, password);
    expect(saved).toEqual(signed.kit);
    expect(saved.currentIndex).toBe("0");
    expect(saved.nextUnusedIndex).toBe("2");
    expect(saved.secret).toBeUndefined();
    expect(
      reconcileKit(saved, { ...f.chain, slot: f.intent.expirySlot + 1n }),
    ).toEqual(saved);
    await expect(f.sign()).rejects.toThrow();
    const chain = { nonce: 1n, root: f.next.root, slot: 100n };
    const ready = await adoptRecovery(
      saved,
      signed.encrypted,
      chain,
      "reconcile",
    );
    expect(ready.currentIndex).toBe("1");
    expect(ready.nextUnusedIndex).toBe("2");
    expect(ready.root).toBe(hex(f.next.root));
    expect(() => reconcileKit(f.kit, chain)).toThrow("stale");
  });
  it("crash after journal advance but before checkpoint completion cannot reuse a key", async () => {
    const f = await setup();
    let writes = 0;
    vi.stubGlobal("localStorage", {
      ...f.localStorage,
      setItem: (k: string, v: string) => {
        if (++writes === 2) throw new Error("checkpoint write failed");
        f.localStorage.setItem(k, v);
      },
    });
    await expect(f.sign()).rejects.toThrow("checkpoint write failed");
    const journal = JSON.parse(f.storage.get(journalKey(f.kit))!);
    expect(journal.status).toBe("consumed");
    expect(journal.nextUnusedIndex).toBe("2");
    await expect(f.sign()).rejects.toThrow();
    await expect(
      adoptRecovery(f.kit, f.encrypted, f.chain, "import"),
    ).rejects.toThrow();
  });
  it("refuses expiry, wrong password, chain mismatch, and substituted next commitment before consuming", async () => {
    const f = await setup();
    await expect(
      f.sign(encodeIntent({ ...f.intent, expirySlot: 9n })),
    ).rejects.toThrow("expired");
    await expect(
      authorizeWithdrawal(
        f.kit,
        f.payload,
        f.next.secret,
        { recipient: f.recipient.toBase58() },
        "incorrect password",
        async () => f.chain,
      ),
    ).rejects.toThrow();
    await expect(
      f.sign(encodeIntent({ ...f.intent, nextRoot: f.key.root })),
    ).rejects.toThrow();
    f.chain.nonce = 1n;
    await expect(f.sign()).rejects.toThrow("stale");
    expect(JSON.parse(f.storage.get(journalKey(f.kit))!).status).toBe("ready");
  });
  it("fails closed on a missing journal, unavailable lock or failed persistence", async () => {
    const f = await setup();
    f.storage.clear();
    await expect(f.sign()).rejects.toThrow("unused key");
    await expect(
      adoptRecovery(f.kit, f.encrypted, f.chain, "reconcile"),
    ).rejects.toThrow("Journal missing");
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage unavailable");
      },
    });
    await expect(
      adoptRecovery(f.kit, f.encrypted, f.chain, "import"),
    ).rejects.toThrow("storage");
    vi.stubGlobal("navigator", {});
    await expect(f.sign()).rejects.toThrow("Web Locks");
  });
  it("refuses an authenticated blob with inconsistent indices, root, vault, or pending signature", async () => {
    const f = await setup();
    for (const patch of [
      { currentIndex: "1" },
      { nextUnusedIndex: "2" },
      { root: "00".repeat(32) },
      { vaultId: "00".repeat(32) },
    ])
      expect(() => validateRecoveryKit({ ...f.kit, ...patch })).toThrow();
    const signed = await f.sign();
    expect(() =>
      validateRecoveryKit({
        ...signed.kit,
        pending: { ...signed.kit.pending!, signature: "00".repeat(1088) },
      }),
    ).toThrow();
    const envelope = JSON.parse(signed.encrypted);
    envelope.tagBits = 96;
    await expect(
      decryptKit(JSON.stringify(envelope), password),
    ).rejects.toThrow();
  });
  it("signing compares the encrypted checkpoint, journal and supplied blob", async () => {
    const f = await setup();
    const other = recoveryFixture();
    const j = JSON.parse(f.storage.get(journalKey(f.kit))!);
    j.checkpoint = await encryptKit(other.kit, password);
    f.storage.set(journalKey(f.kit), JSON.stringify(j));
    await expect(f.sign()).rejects.toThrow();
    expect(JSON.parse(f.storage.get(journalKey(f.kit))!).status).toBe("ready");
  });
});
