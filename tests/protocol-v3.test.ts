import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";
import { hex, unhex } from "../sdk/bytes";
import { rootFromSecret, verify } from "../sdk/winternitz";
import {
  context,
  Descriptor,
  epochSeed,
  operationalKey,
  recoveryKey,
} from "../sdk/v3/derive";
import {
  genesisAuthorities,
  genesisVault,
  recoveryPacket,
  signAnnouncement,
} from "../sdk/v3/authority";
import {
  ANNOUNCE_SIZE,
  RECOVER_SIZE,
  VAULT_SIZE,
  announceIx,
  announceMessage,
  decodeAnnounce,
  decodeRecover,
  encodeAnnounce,
  executeIx,
  initializeIx,
  parseVault,
  pendingPhase,
  recoverIx,
  recoverMessage,
  spentAddress,
  stageIxs,
  vaultAddress,
  vaultIdOf,
} from "../sdk/v3/protocol";
import { vectors } from "../scripts/v3-vectors";

const fixture = JSON.parse(readFileSync("fixtures/bunker-v3.json", "utf8"));
const program = new PublicKey(fixture.program);
const d: Descriptor = {
  chainTag: unhex(fixture.chainTag),
  programId: program.toBytes(),
  salt: unhex(fixture.salt),
  vaultId: unhex(fixture.vaultId),
};
const master = unhex(fixture.master);
const payer = new PublicKey(new Uint8Array(32).fill(5));

describe("Protocol 3 derivation", () => {
  it("uses HKDF-SHA256 as published (RFC 5869 test case 1)", () => {
    const okm = hkdf(
      sha256,
      unhex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"),
      unhex("000102030405060708090a0b0c"),
      unhex("f0f1f2f3f4f5f6f7f8f9"),
      42,
    );
    expect(hex(okm)).toBe(
      "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
    );
  });
  it("builds the 109-byte context in the specified order", () => {
    const c = context(d);
    expect(c.length).toBe(109);
    expect(new TextDecoder().decode(c.slice(0, 12))).toBe("BUNKER-KDF-3");
    expect(c[12]).toBe(0);
    expect(hex(c.slice(13, 45))).toBe(fixture.chainTag);
    expect(hex(c.slice(45, 77))).toBe(fixture.programBytes);
    expect(hex(c.slice(77))).toBe(fixture.salt);
    expect(() => context({ ...d, salt: new Uint8Array(31) })).toThrow();
  });
  it("separates roles, epochs, indices and vaults", () => {
    const seen = new Set<string>();
    const add = (b: Uint8Array) => {
      const h = hex(b.slice(0, 32));
      expect(seen.has(h)).toBe(false);
      seen.add(h);
    };
    const seed0 = epochSeed(master, d, 0n);
    const seed1 = epochSeed(master, d, 1n);
    add(seed0);
    add(seed1);
    add(recoveryKey(master, d, 0n));
    add(recoveryKey(master, d, 1n));
    add(operationalKey(seed0, d, 0n, 0n));
    add(operationalKey(seed0, d, 0n, 1n));
    add(operationalKey(seed1, d, 1n, 0n));
    // Same seed bytes used under the wrong epoch label derive something else.
    add(operationalKey(seed0, d, 1n, 0n));
    const other = { ...d, salt: new Uint8Array(32).fill(8) };
    add(epochSeed(master, other, 0n));
    add(recoveryKey(master, other, 0n));
    const otherChain = { ...d, chainTag: new Uint8Array(32).fill(1) };
    add(recoveryKey(master, otherChain, 0n));
    expect(recoveryKey(master, d, 0n).length).toBe(1088);
    expect(seed0.length).toBe(32);
  });
  it("rejects wrong-length key material and out-of-range indices", () => {
    expect(() => recoveryKey(new Uint8Array(31), d, 0n)).toThrow();
    expect(() => operationalKey(new Uint8Array(33), d, 0n, 0n)).toThrow();
    expect(() => epochSeed(master, d, -1n)).toThrow();
    expect(() => epochSeed(master, d, 1n << 64n)).toThrow();
  });
});

describe("Protocol 3 encodings", () => {
  const a = decodeAnnounce(unhex(fixture.announce.payload));
  it("round-trips an announcement at the specified offsets", () => {
    const bytes = unhex(fixture.announce.payload);
    expect(bytes.length).toBe(ANNOUNCE_SIZE);
    expect([bytes[0], bytes[1], bytes[82]]).toEqual([3, 1, 0]);
    expect(hex(bytes.slice(2, 34))).toBe(fixture.vaultId);
    expect(hex(bytes.slice(34, 66))).toBe(fixture.chainTag);
    expect(hex(bytes.slice(115, 147))).toBe(fixture.destination);
    expect(a.amount.toString()).toBe(fixture.amount);
    expect(a.announceBy.toString()).toBe(fixture.announceBy);
    expect(hex(a.nextOpRoot)).toBe(fixture.epoch0.opRootIndex1);
    expect(hex(encodeAnnounce(a))).toBe(fixture.announce.payload);
  });
  it("rejects malformed announcements", () => {
    const bytes = unhex(fixture.announce.payload);
    const longer = new Uint8Array([...bytes, 0]);
    for (const length of [0, 1, ANNOUNCE_SIZE - 1, ANNOUNCE_SIZE + 1])
      expect(() => decodeAnnounce(longer.slice(0, length))).toThrow();
    const edit = (offset: number, value: number) => {
      const b = bytes.slice();
      b[offset] = value;
      return () => decodeAnnounce(b);
    };
    expect(edit(0, 2)).toThrow();
    expect(edit(1, 2)).toThrow();
    expect(edit(82, 2)).toThrow();
    expect(edit(82, 1)).toThrow(); // token kind with a zero mint
    expect(edit(83, 1)).toThrow(); // SOL kind with a mint
    expect(() => encodeAnnounce({ ...a, amount: 0n })).toThrow();
    expect(() => encodeAnnounce({ ...a, announceBy: 0n })).toThrow();
    expect(() => encodeAnnounce({ ...a, nextOpRoot: new Uint8Array(32) })).toThrow();
  });
  it("round-trips a recovery packet and keeps the roles apart", () => {
    const bytes = unhex(fixture.recover.payload);
    expect(bytes.length).toBe(RECOVER_SIZE);
    const r = decodeRecover(bytes);
    expect(r.epoch).toBe(0n);
    expect(hex(r.nextOpRoot)).toBe(fixture.epoch1.opRoot);
    expect(() => decodeRecover(unhex(fixture.announce.payload))).toThrow();
    expect(() => decodeAnnounce(bytes)).toThrow();
    const sameRoots = bytes.slice();
    sameRoots.set(bytes.slice(74, 106), 106);
    expect(() => decodeRecover(sameRoots)).toThrow();
  });
  it("binds messages to the program and the vault address", () => {
    const m = announceMessage(program, unhex(fixture.announce.payload));
    expect(m.length).toBe(275);
    expect(new TextDecoder().decode(m.slice(0, 16))).toBe("BUNKER3_ANNOUNCE");
    expect(hex(m.slice(16, 48))).toBe(fixture.programBytes);
    expect(new PublicKey(m.slice(48, 80)).toBase58()).toBe(fixture.vault);
    const r = recoverMessage(program, unhex(fixture.recover.payload));
    expect(r.length).toBe(218);
    expect(new TextDecoder().decode(r.slice(0, 16))).toBe("BUNKER3_RECOVER_");
    const elsewhere = new PublicKey(new Uint8Array(32).fill(12));
    expect(hex(announceMessage(elsewhere, unhex(fixture.announce.payload)))).not.toBe(hex(m));
  });
  it("parses a vault and reports the phase of its withdrawal", () => {
    const data = new Uint8Array(VAULT_SIZE);
    data.set(new TextEncoder().encode("BUNKER03"));
    data.set(d.vaultId, 8);
    data.set(d.chainTag, 40);
    data.set(unhex(fixture.epoch0.opRoot), 72);
    data.set(unhex(fixture.epoch0.recRoot), 120);
    new DataView(data.buffer).setUint32(152, 86_400, true);
    data[286] = 254;
    const idle = parseVault(data);
    expect([idle.epoch, idle.opIndex, idle.delaySecs, idle.pending, idle.bump]).toEqual([0n, 0n, 86_400, null, 254]);
    expect(pendingPhase(idle, 5n)).toBe("none");
    const stale = data.slice();
    stale[200] = 1;
    expect(() => parseVault(stale)).toThrow();
    const pending = data.slice();
    pending[156] = 1;
    pending.set(unhex(fixture.destination), 190);
    const view = new DataView(pending.buffer);
    view.setBigUint64(222, 7n, true);
    view.setBigInt64(230, 1000n, true);
    view.setBigInt64(238, 2000n, true);
    const v = parseVault(pending);
    expect(v.pending!.amount).toBe(7n);
    expect([999n, 1000n, 2000n, 2001n].map((t) => pendingPhase(v, t))).toEqual(["waiting", "open", "open", "expired"]);
    expect(() => parseVault(data.slice(1))).toThrow();
  });
});

describe("Protocol 3 authorities", () => {
  it("reproduces the checked-in vectors byte for byte", () => {
    expect(vectors()).toEqual(fixture);
  });
  it("derives genesis roots and signs with the derived keys", () => {
    const g = genesisAuthorities(master, d);
    expect(hex(g.opRoot)).toBe(fixture.epoch0.opRoot);
    expect(hex(g.recRoot)).toBe(fixture.epoch0.recRoot);
    expect(hex(g.opRoot)).toBe(hex(rootFromSecret(operationalKey(g.seed, d, 0n, 0n))));
    expect(
      verify(unhex(fixture.announce.signature), unhex(fixture.announce.message), g.opRoot),
    ).toBe(true);
    expect(
      verify(unhex(fixture.recover.signature), unhex(fixture.recover.message), g.recRoot),
    ).toBe(true);
    // Neither signature verifies under the other role's root.
    expect(verify(unhex(fixture.announce.signature), unhex(fixture.announce.message), g.recRoot)).toBe(false);
    expect(verify(unhex(fixture.recover.signature), unhex(fixture.recover.message), g.opRoot)).toBe(false);
  });
  it("the recovery packet is a pure function of master, vault and epoch", () => {
    const a = recoveryPacket(master, d, 0n);
    const b = recoveryPacket(master, d, 0n);
    expect(hex(a.payload)).toBe(hex(b.payload));
    expect(hex(a.signature)).toBe(hex(b.signature));
    expect(hex(a.nextSeed)).toBe(fixture.epoch1.seed);
    expect(hex(recoveryPacket(master, d, 1n).payload)).not.toBe(hex(a.payload));
  });
  it("an operational signer cannot choose its next root", () => {
    const seed = unhex(fixture.epoch0.seed);
    const signed = signAnnouncement(seed, d, {
      epoch: 0n,
      opIndex: 0n,
      kind: 0,
      mint: PublicKey.default,
      destination: new PublicKey(unhex(fixture.destination)),
      amount: 1n,
      announceBy: 5n,
    });
    expect(hex(decodeAnnounce(signed.payload).nextOpRoot)).toBe(fixture.epoch0.opRootIndex1);
  });
  it("builds instructions with the account order the program expects", () => {
    const g = genesisAuthorities(master, d);
    const vault = vaultAddress(program, d.vaultId);
    const genesis = { salt: d.salt, chainTag: d.chainTag, opRoot: g.opRoot, recRoot: g.recRoot, delaySecs: 86_400 };
    const init = initializeIx(program, payer, genesis);
    expect([init.data[0], init.data.length, init.keys.length]).toEqual([0, 133, 3]);
    expect(init.keys[1].pubkey.equals(vault)).toBe(true);
    expect(() => initializeIx(program, payer, { ...genesis, delaySecs: 604_801 })).toThrow();
    expect(() => initializeIx(program, payer, { ...genesis, recRoot: g.opRoot })).toThrow();
    const stage = stageIxs(program, payer, unhex(fixture.announce.message), unhex(fixture.announce.signature));
    expect(stage.map((s) => s.data.length)).toEqual([1 + 32 + 2 + 600, 1 + 32 + 2 + 488]);
    const announce = announceIx(program, payer, unhex(fixture.announce.payload), g.opRoot);
    expect([announce.data[0], announce.keys.length]).toEqual([2, 6]);
    expect(announce.keys[3].pubkey.equals(spentAddress(program, vault, g.opRoot))).toBe(true);
    expect(announce.keys.map((k) => k.isWritable)).toEqual([true, false, true, true, false, false]);
    const recover = recoverIx(program, payer, unhex(fixture.recover.payload), g);
    expect([recover.data[0], recover.keys.length]).toEqual([5, 8]);
    const destination = new PublicKey(unhex(fixture.destination));
    const pending = { kind: 0 as const, mint: PublicKey.default, destination, amount: 1n, opensAt: 0n, deadline: 1n, epoch: 0n, digest: new Uint8Array(32) };
    const execute = executeIx(program, vault, pending);
    expect([execute.data.length, execute.keys.length]).toEqual([1, 2]);
    expect(() => executeIx(program, vault, { ...pending, kind: 1 })).toThrow();
  });
});
describe("Protocol 3 vault identity", () => {
  const g = genesisAuthorities(master, d);
  const genesis = { salt: d.salt, chainTag: d.chainTag, opRoot: g.opRoot, recRoot: g.recRoot, delaySecs: fixture.delaySecs as number };
  it("is the hash of the creation data, and the address follows from it", () => {
    expect(hex(vaultIdOf(genesis))).toBe(fixture.vaultId);
    expect(vaultAddress(program, vaultIdOf(genesis)).toBase58()).toBe(fixture.vault);
    expect(hex(genesisVault(master, d, genesis.delaySecs).d.vaultId)).toBe(fixture.vaultId);
  });
  it("changes with every creation parameter", () => {
    const other = new Uint8Array(32).fill(0xee);
    const ids = new Set(
      [
        genesis,
        { ...genesis, salt: other },
        { ...genesis, chainTag: other },
        { ...genesis, opRoot: other },
        { ...genesis, recRoot: other },
        { ...genesis, delaySecs: 0 },
      ].map((x) => hex(vaultIdOf(x))),
    );
    expect(ids.size).toBe(6);
  });
  it("scopes spent markers to one vault", () => {
    const a = vaultAddress(program, vaultIdOf(genesis));
    const b = vaultAddress(program, vaultIdOf({ ...genesis, delaySecs: 0 }));
    expect(spentAddress(program, a, g.opRoot).equals(spentAddress(program, b, g.opRoot))).toBe(false);
    expect(() => spentAddress(program, a, new Uint8Array(32))).toThrow();
  });
});
