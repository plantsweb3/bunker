import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha256";
import { concat, hex, unhex } from "../sdk/bytes";
import {
  candidateKey,
  publicKey,
  SECRET_BYTES,
  sign,
  SIGNATURE_BYTES,
  Signer,
  verificationSteps,
  verify,
} from "../sdk/lmots";
import { ONE_TIME_BYTES, rootOf, signOnce, verifies, VERIFY_STEP_LIMIT } from "../sdk/v3/onetime";

type Case = {
  I: string;
  q: number;
  message: string;
  C: string;
  y: string[];
  lmsPath: string[];
  lmsPublicKey: string;
  lmotsPublicKey: string;
};
const rfc: { cases: Case[] } = JSON.parse(readFileSync("fixtures/rfc8554-test-case-1.json", "utf8"));
const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
};
const signatureOf = (c: Pick<Case, "C" | "y">) => unhex(`00000004${c.C}${c.y.join("")}`);
const signerOfCase = (c: Pick<Case, "I" | "q">): Signer => ({ identifier: unhex(c.I), q: c.q });
const secret = (tag: number) =>
  concat(...Array.from({ length: 34 }, (_, i) => sha256(new Uint8Array([tag, i]))));
const text = (s: string) => new TextEncoder().encode(s);
const s: Signer = { identifier: new Uint8Array(16).fill(7), q: 5 };

describe("LM-OTS against RFC 8554, Appendix F, Test Case 1", () => {
  it("verifies both signatures to the public keys the RFC's LMS path leads to", () => {
    expect(rfc.cases.length).toBe(2);
    for (const c of rfc.cases) {
      const signature = signatureOf(c);
      expect(signature.length).toBe(SIGNATURE_BYTES);
      const candidate = candidateKey(signerOfCase(c), unhex(c.message), signature)!;
      expect(hex(candidate)).toBe(c.lmotsPublicKey);
      // The candidate is not printed in the RFC; the LMS public key it must
      // lead to is. Walk the printed path (Algorithm 6a): height 5.
      const I = unhex(c.I);
      let node = 32 + c.q;
      let value = sha256(concat(I, u32(node), new Uint8Array([0x82, 0x82]), candidate));
      for (const sibling of c.lmsPath.map((p) => unhex(p))) {
        const [left, right] = node % 2 === 1 ? [sibling, value] : [value, sibling];
        value = sha256(concat(I, u32(node >> 1), new Uint8Array([0x83, 0x83]), left, right));
        node >>= 1;
      }
      expect(hex(value)).toBe(c.lmsPublicKey);
      expect(verify(signerOfCase(c), signature, unhex(c.message), unhex(c.lmotsPublicKey))).toBe(true);
    }
  });
  it("rejects an RFC signature for any other message, signer or byte", () => {
    for (const c of rfc.cases) {
      const key = unhex(c.lmotsPublicKey);
      const [signature, message, who] = [signatureOf(c), unhex(c.message), signerOfCase(c)];
      const other = message.slice();
      other[0] ^= 1;
      expect(verify(who, signature, other, key)).toBe(false);
      expect(verify({ ...who, q: c.q + 1 }, signature, message, key)).toBe(false);
      const identifier = who.identifier.slice();
      identifier[15] ^= 1;
      expect(verify({ ...who, identifier }, signature, message, key)).toBe(false);
      for (let at = 4; at < SIGNATURE_BYTES; at += 97) {
        const bad = signature.slice();
        bad[at] ^= 1;
        expect(verify(who, bad, message, key)).toBe(false);
      }
    }
  });
});

describe("LM-OTS against RFC 8554, Appendix F, Test Case 2", () => {
  it("reproduces the RFC's signature and public key from the RFC's private key", () => {
    const c: Omit<Case, "lmotsPublicKey"> & { seed: string } = JSON.parse(readFileSync("fixtures/rfc8554-test-case-2.json", "utf8"));
    const who = signerOfCase(c);
    // Appendix A: x[i] = H(I || u32str(q) || u16str(i) || u8str(0xff) || SEED).
    const x = concat(
      ...Array.from({ length: 34 }, (_, i) =>
        sha256(concat(who.identifier, u32(c.q), new Uint8Array([i >> 8, i & 255, 0xff]), unhex(c.seed))),
      ),
    );
    const message = unhex(c.message);
    expect(new TextDecoder().decode(message)).toContain("The enumeration in the Constitution");
    expect(hex(sign(who, x, unhex(c.C), message))).toBe(hex(signatureOf(c)));
    const key = publicKey(who, x);
    expect(verify(who, signatureOf(c), message, key)).toBe(true);
    let node = 32 + c.q;
    let value = sha256(concat(who.identifier, u32(node), new Uint8Array([0x82, 0x82]), key));
    for (const sibling of c.lmsPath.map((p) => unhex(p))) {
      const [left, right] = node % 2 === 1 ? [sibling, value] : [value, sibling];
      value = sha256(concat(who.identifier, u32(node >> 1), new Uint8Array([0x83, 0x83]), left, right));
      node >>= 1;
    }
    expect(hex(value)).toBe(c.lmsPublicKey);
  });
});

describe("LM-OTS signing", () => {
  it("signs what the verifier accepts, and nothing else", () => {
    const x = secret(1);
    const key = publicKey(s, x);
    const signature = sign(s, x, new Uint8Array(32).fill(9), text("pay the recipient"));
    expect(signature.length).toBe(1124);
    expect(hex(signature.slice(0, 4))).toBe("00000004");
    expect(verify(s, signature, text("pay the recipient"), key)).toBe(true);
    expect(verify(s, signature, text("pay the attacker!"), key)).toBe(false);
    expect(verify({ ...s, q: 6 }, signature, text("pay the recipient"), key)).toBe(false);
    expect(verify(s, signature, text("pay the recipient"), publicKey(s, secret(2)))).toBe(false);
  });
  it("refuses anything that is not a well-formed signature of the parameter set", () => {
    const x = secret(3);
    const key = publicKey(s, x);
    const signature = sign(s, x, new Uint8Array(32).fill(1), text("m"));
    expect(candidateKey(s, text("m"), signature.slice(0, -1))).toBeNull();
    expect(candidateKey(s, text("m"), concat(signature, new Uint8Array(1)))).toBeNull();
    expect(candidateKey(s, text("m"), new Uint8Array(0))).toBeNull();
    for (const typecode of ["00000003", "00000000", "04000000"]) {
      const bad = signature.slice();
      bad.set(unhex(typecode));
      expect(verify(s, bad, text("m"), key)).toBe(false);
    }
    expect(() => publicKey(s, new Uint8Array(SECRET_BYTES - 1))).toThrow();
    expect(() => publicKey({ ...s, q: -1 }, x)).toThrow();
    expect(() => publicKey({ ...s, q: 2 ** 32 }, x)).toThrow();
    expect(() => publicKey({ identifier: new Uint8Array(15), q: 0 }, x)).toThrow();
    expect(() => sign(s, x, new Uint8Array(31), text("m"))).toThrow();
  });
  it("counts verification steps as 255 for each unit of the checksum's high byte, plus 510", () => {
    for (let n = 0; n < 200; n++) {
      const steps = verificationSteps(s, sha256(new Uint8Array([n])), text("m"));
      expect((steps - 510) % 255).toBe(0);
    }
  });
});

describe("Bunker's use of LM-OTS", () => {
  const material = (tag: number) => {
    const m = new Uint8Array(ONE_TIME_BYTES);
    m.set(secret(tag));
    m.set(sha256(new Uint8Array([tag, 255])), SECRET_BYTES);
    return m;
  };
  it("signs within the program's verification limit, the same way every time", () => {
    for (let n = 0; n < 12; n++) {
      const message = text(`withdrawal ${n}`);
      const root = rootOf(material(n), s);
      const signature = signOnce(material(n), s, message);
      expect(hex(signOnce(material(n), s, message))).toBe(hex(signature));
      expect(verificationSteps(s, signature.slice(4, 36), message)).toBeLessThanOrEqual(VERIFY_STEP_LIMIT);
      expect(verifies(s, signature, message, root)).toBe(true);
      expect(verifies(s, signature, text("another"), root)).toBe(false);
    }
  });
  it("refuses a correct signature that would cost more than the limit to verify", () => {
    const x = secret(4);
    const key = publicKey(s, x);
    const message = text("costly");
    let randomizer: Uint8Array = new Uint8Array(32);
    for (let n = 0; ; n++) {
      randomizer = sha256(new Uint8Array([n >> 8, n & 255]));
      if (verificationSteps(s, randomizer, message) > VERIFY_STEP_LIMIT) break;
    }
    const signature = sign(s, x, randomizer, message);
    expect(verify(s, signature, message, key)).toBe(true);
    expect(verifies(s, signature, message, key)).toBe(false);
  });
  it("wipes the key it signed with, and refuses a key of the wrong size", () => {
    const m = material(9);
    signOnce(m, s, text("once"));
    expect(m.every((b) => b === 0)).toBe(true);
    expect(() => signOnce(new Uint8Array(SECRET_BYTES), s, text("m"))).toThrow("Invalid one-time key length");
  });
});
