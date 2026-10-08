#!/usr/bin/env python3
"""A third implementation, for checking the other two.

Recomputes every value in fixtures/bunker-v3.json from the master secret, using
only docs/PROTOCOL.md, RFC 5869 and RFC 8554 and the Python standard library.
It shares no code with the TypeScript client or the Rust program. It also
checks the LM-OTS code here against RFC 8554 Appendix F.

    python3 scripts/independent-check.py

PUBLIC TEST KEYS ONLY. This shows that the specification can be implemented
from its text and that three implementations agree. It is not an audit, and
all three were written by the same project.
"""
import hashlib
import hmac
import json
import os
import struct
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
H = lambda b: hashlib.sha256(b).digest()
u32be = lambda n: struct.pack(">I", n)
u16be = lambda n: struct.pack(">H", n)
u64le = lambda n: struct.pack("<Q", n)
checks = 0


def same(got, want, what):
    global checks
    checks += 1
    if got != want:
        show = lambda v: v.hex()[:64] if isinstance(v, (bytes, bytearray)) else v
        sys.exit(f"MISMATCH: {what}\n  computed {show(got)}\n  expected {show(want)}")


# ── RFC 5869: HKDF-SHA256 with an empty salt ────────────────────────────────
def hkdf(ikm, info, length):
    prk = hmac.new(b"\x00" * 32, ikm, hashlib.sha256).digest()
    out, block, counter = b"", b"", 1
    while len(out) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        out += block
        counter += 1
    return out[:length]


# ── RFC 8554 section 4: LM-OTS, LMOTS_SHA256_N32_W8 ─────────────────────────
N, P = 32, 34
TYPECODE = bytes([0, 0, 0, 4])


def chain(I, q, i, start, end, value):
    for j in range(start, end):
        value = H(I + u32be(q) + u16be(i) + bytes([j]) + value)
    return value


def digits(I, q, C, message):
    Q = H(I + u32be(q) + b"\x81\x81" + C + message)
    checksum = sum(255 - b for b in Q)
    return list(Q) + [checksum >> 8, checksum & 255]


def lmots_public_key(I, q, x):
    return H(I + u32be(q) + b"\x80\x80" + b"".join(chain(I, q, i, 0, 255, x[i]) for i in range(P)))


def lmots_sign(I, q, x, C, message):
    a = digits(I, q, C, message)
    return TYPECODE + C + b"".join(chain(I, q, i, 0, a[i], x[i]) for i in range(P))


def lmots_candidate(I, q, message, signature):
    if len(signature) != 4 + N + N * P or signature[:4] != TYPECODE:
        return None, None
    C, y = signature[4:36], signature[36:]
    a = digits(I, q, C, message)
    steps = sum(255 - v for v in a)
    z = b"".join(chain(I, q, i, a[i], 255, y[N * i : N * i + N]) for i in range(P))
    return H(I + u32be(q) + b"\x80\x80" + z), steps


def lms_root(I, q, key, path):
    """RFC 8554 Algorithm 6a: from an LM-OTS public key up to the LMS root."""
    node = (1 << len(path)) + q
    value = H(I + u32be(node) + b"\x82\x82" + key)
    for sibling in path:
        left, right = (sibling, value) if node % 2 else (value, sibling)
        value = H(I + u32be(node // 2) + b"\x83\x83" + left + right)
        node //= 2
    return value


def rfc_vectors():
    load = lambda n: json.load(open(os.path.join(ROOT, "fixtures", f"rfc8554-test-case-{n}.json")))
    for c in load(1)["cases"]:
        I, q, message = bytes.fromhex(c["I"]), c["q"], bytes.fromhex(c["message"])
        signature = TYPECODE + bytes.fromhex(c["C"]) + b"".join(bytes.fromhex(y) for y in c["y"])
        key, _ = lmots_candidate(I, q, message, signature)
        same(lms_root(I, q, key, [bytes.fromhex(p) for p in c["lmsPath"]]).hex(), c["lmsPublicKey"], "RFC 8554 Test Case 1: verification")
    c = load(2)
    I, q, message = bytes.fromhex(c["I"]), c["q"], bytes.fromhex(c["message"])
    x = [H(I + u32be(q) + u16be(i) + b"\xff" + bytes.fromhex(c["seed"])) for i in range(P)]
    printed = TYPECODE + bytes.fromhex(c["C"]) + b"".join(bytes.fromhex(y) for y in c["y"])
    same(lmots_sign(I, q, x, bytes.fromhex(c["C"]), message), printed, "RFC 8554 Test Case 2: signing")
    same(lms_root(I, q, lmots_public_key(I, q, x), [bytes.fromhex(p) for p in c["lmsPath"]]).hex(), c["lmsPublicKey"], "RFC 8554 Test Case 2: public key")


# ── Solana addresses: base58 and program-derived addresses ──────────────────
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def base58(b):
    n, out = int.from_bytes(b, "big"), ""
    while n:
        n, r = divmod(n, 58)
        out = ALPHABET[r] + out
    return "1" * (len(b) - len(b.lstrip(b"\x00"))) + out


def on_curve(b):
    """Whether 32 bytes are a valid Ed25519 point (a program address is not)."""
    p = 2**255 - 19
    d = (-121665 * pow(121666, p - 2, p)) % p
    y = int.from_bytes(b, "little") & ((1 << 255) - 1)
    if y >= p:
        return False
    x2 = (y * y - 1) * pow(d * y * y + 1, p - 2, p) % p
    if x2 == 0:
        return b[31] >> 7 == 0
    x = pow(x2, (p + 3) // 8, p)
    if (x * x - x2) % p:
        x = x * pow(2, (p - 1) // 4, p) % p
    return (x * x - x2) % p == 0


def program_address(seeds, program):
    for bump in range(255, -1, -1):
        candidate = H(b"".join(seeds) + bytes([bump]) + program + b"ProgramDerivedAddress")
        if not on_curve(candidate):
            return candidate
    raise ValueError("no program address")


# ── docs/PROTOCOL.md ────────────────────────────────────────────────────────
STEP_LIMIT = 4080
OPERATIONAL, RECOVERY = 1, 2


def main():
    rfc_vectors()
    f = json.load(open(os.path.join(ROOT, "fixtures", "bunker-v3.json")))
    hx = bytes.fromhex
    master, chain_tag, program, salt = hx(f["master"]), hx(f["chainTag"]), hx(f["programBytes"]), hx(f["salt"])
    delay = struct.pack("<I", f["delaySecs"])
    trusted = b"".join(hx(t) for t in f["trusted"]).ljust(128, b"\x00")
    same(base58(program), f["program"], "program address")

    # §1.1 derivation
    ctx = b"BUNKER-KDF-4" + b"\x00" + chain_tag + program + salt + delay + trusted
    same(ctx, hx(f["context"]), "key derivation context")
    recovery_key = lambda e: hkdf(master, ctx + b"\x01" + u64le(e), 1120)
    seed = lambda e: hkdf(master, ctx + b"\x02" + u64le(e), 32)
    operational_key = lambda e, i: hkdf(seed(e), ctx + b"\x03" + u64le(e) + u64le(i), 1120)
    same(seed(0), hx(f["epoch0"]["seed"]), "seed of epoch 0")
    same(seed(1), hx(f["epoch1"]["seed"]), "seed of epoch 1")

    # §1.3 one-time keys: identifier, public key ("root"), randomizer, signature
    identifier = lambda role, e, i: H(b"BUNKER3_LMOTS_ID" + program + chain_tag + salt + bytes([role]) + u64le(e) + u64le(i))[:16]
    starts = lambda material: [material[32 * i : 32 * i + 32] for i in range(P)]
    root = lambda material, role, e, i: lmots_public_key(identifier(role, e, i), 0, starts(material))
    op_root = lambda e, i: root(operational_key(e, i), OPERATIONAL, e, i)
    rec_root = lambda e: root(recovery_key(e), RECOVERY, e, 0)
    same(op_root(0, 0), hx(f["epoch0"]["opRoot"]), "operational root, epoch 0 index 0")
    same(op_root(0, 1), hx(f["epoch0"]["opRootIndex1"]), "operational root, epoch 0 index 1")
    same(rec_root(0), hx(f["epoch0"]["recRoot"]), "recovery root, epoch 0")
    same(op_root(1, 0), hx(f["epoch1"]["opRoot"]), "operational root, epoch 1 index 0")
    same(op_root(1, 1), hx(f["epoch1"]["opRootIndex1"]), "operational root, epoch 1 index 1")

    def sign(material, role, e, i, message):
        I, x, n = identifier(role, e, i), starts(material), 0
        while True:
            C = hkdf(material[1088:], b"BUNKER-LMOTS-C" + struct.pack("<I", n), 32)
            if sum(255 - a for a in digits(I, 0, C, message)) <= STEP_LIMIT:
                return lmots_sign(I, 0, x, C, message), n
            n += 1

    # §1.2 vault identity and address; §4.0 creation data
    init = salt + chain_tag + op_root(0, 0) + rec_root(0) + delay + trusted
    same(init, hx(f["initializeData"]), "initialize data")
    vault_id = H(b"BUNKER3_VAULT_ID" + init)
    same(vault_id, hx(f["vaultId"]), "vault identity")
    vault = program_address([b"bunker3", vault_id], program)
    same(base58(vault), f["vault"], "vault address")

    # §3.1 announcement
    def announcement(e, i, announce_by):
        payload = (
            bytes([3, OPERATIONAL]) + vault_id + chain_tag + u64le(e) + u64le(i)
            + bytes([0]) + bytes(32) + hx(f["destination"]) + u64le(int(f["amount"]))
            + struct.pack("<q", announce_by) + op_root(e, i + 1) + bytes([0])
        )
        return payload, b"BUNKER3_ANNOUNCE" + program + vault + payload

    later_randomizers = 0
    for name, e, i in [("announce", 0, 0), ("announceAfterRecovery", 1, 0), ("announceLaterRandomizer", 0, 1)]:
        v = f[name]
        # The deadline of the last vector is not listed separately; read it from the payload.
        announce_by = struct.unpack("<q", hx(v["payload"])[155:163])[0]
        if name != "announceLaterRandomizer":
            same(announce_by, int(f["announceBy"]), f"{name}: deadline")
        payload, message = announcement(e, i, announce_by)
        same(payload, hx(v["payload"]), f"{name}: payload")
        same(message, hx(v["message"]), f"{name}: signed message")
        same(H(message), hx(v["digest"]), f"{name}: digest")
        signature, n = sign(operational_key(e, i), OPERATIONAL, e, i, message)
        later_randomizers += n > 0
        same(signature, hx(v["signature"]), f"{name}: signature")
        candidate, steps = lmots_candidate(identifier(OPERATIONAL, e, i), 0, message, signature)
        same((candidate, steps <= STEP_LIMIT), (op_root(e, i), True), f"{name}: verifies within the step limit")
    same(later_randomizers >= 1, True, "one vector needs a randomizer after the first")

    # §3.2 recovery packet
    payload = bytes([3, RECOVERY]) + vault_id + chain_tag + u64le(0) + rec_root(1) + op_root(1, 0)
    message = b"BUNKER3_RECOVER_" + program + vault + payload
    same(payload, hx(f["recover"]["payload"]), "recover: payload")
    same(message, hx(f["recover"]["message"]), "recover: signed message")
    same(H(message), hx(f["recover"]["digest"]), "recover: digest")
    signature, _ = sign(recovery_key(0), RECOVERY, 0, 0, message)
    same(signature, hx(f["recover"]["signature"]), "recover: signature")
    candidate, steps = lmots_candidate(identifier(RECOVERY, 0, 0), 0, message, signature)
    same((candidate, steps <= STEP_LIMIT), (rec_root(0), True), "recover: verifies within the step limit")
    # A signature does not verify at another position.
    for what, I in [("another role", identifier(OPERATIONAL, 0, 0)), ("another epoch", identifier(RECOVERY, 1, 0))]:
        same(lmots_candidate(I, 0, message, signature)[0] == rec_root(0), False, f"recover: refused under {what}")

    print(f"independent check: {checks} values recomputed from the specification, all equal")


if __name__ == "__main__":
    main()
