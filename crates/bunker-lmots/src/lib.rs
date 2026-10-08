//! LM-OTS one-time signatures as specified in RFC 8554, section 4, for the
//! single parameter set `LMOTS_SHA256_N32_W8`: SHA-256, 32-byte values,
//! 8-bit Winternitz digits, 34 chains, a 1,124-byte signature.
//!
//! This crate verifies. It computes the candidate public key `Kc` of
//! Algorithm 4b from an identifier pair `(I, q)`, a message and a signature;
//! the caller compares `Kc` with the key it holds. Every hash input follows
//! the RFC byte for byte, so signatures and keys interoperate with any other
//! implementation of that parameter set, and the test vectors of the RFC's
//! Appendix F apply (`programs/bunker3-svm-tests/tests/rfc8554.rs`).
//!
//! One thing is added, and it only ever rejects: a limit on the number of
//! chain steps a signature may cost to verify. The steps follow from the
//! message digest, so a signer meets the limit by choosing the randomizer
//! `C`; a verifier that enforces it has a bounded cost. A signature within
//! the limit is an ordinary RFC 8554 signature.
#![cfg_attr(any(target_os = "solana", target_arch = "bpf"), no_std)]
use solana_sha256_hasher::hashv;

/// Bytes in a hash value and in each chain element.
pub const N: usize = 32;
/// Number of Winternitz chains: 32 message digits and 2 checksum digits.
pub const P: usize = 34;
/// `u32str(LMOTS_SHA256_N32_W8)`.
pub const TYPECODE: [u8; 4] = [0, 0, 0, 4];
/// `u32str(type) || C || y[0] || ... || y[33]`.
pub const SIGNATURE_LEN: usize = 4 + N + N * P;
/// The `I` of RFC 8554.
pub const IDENTIFIER_LEN: usize = 16;
const D_PBLC: [u8; 2] = [0x80, 0x80];
const D_MESG: [u8; 2] = [0x81, 0x81];
/// `I (16) || u32str(q) (4) || u16str(i) (2) || u8str(j) (1) || tmp (32)`.
const STEP_LEN: usize = IDENTIFIER_LEN + 4 + 2 + 1 + N;

/// `Q || Cksm(Q)` as 34 base-256 digits, and the number of chain steps a
/// verifier takes for them. The count is always `255 * (h + 2)` where `h` is
/// the high byte of the checksum. `ls` is zero for this parameter set, so the
/// checksum is simply the 16-bit sum, most significant byte first.
pub fn digits(q_hash: &[u8; N]) -> ([u8; P], u32) {
    let mut d = [0u8; P];
    d[..N].copy_from_slice(q_hash);
    let sum: u16 = q_hash.iter().map(|b| 255 - *b as u16).sum();
    d[N] = (sum >> 8) as u8;
    d[N + 1] = sum as u8;
    let steps = d.iter().map(|a| 255 - *a as u32).sum();
    (d, steps)
}

/// `Q = H(I || u32str(q) || u16str(D_MESG) || C || message)`.
/// `message` is given in parts, which are hashed in order as one string.
pub fn message_hash(
    identifier: &[u8; IDENTIFIER_LEN],
    q: u32,
    randomizer: &[u8; N],
    message: [&[u8]; 4],
) -> [u8; N] {
    let q = q.to_be_bytes();
    hashv(&[
        identifier, &q, &D_MESG, randomizer, message[0], message[1], message[2], message[3],
    ])
    .to_bytes()
}

/// One chain: applies steps `from..255` to `value` for chain `i`.
#[inline(always)]
fn chain(step: &mut [u8; STEP_LEN], i: u16, from: u8, value: &[u8]) {
    step[20..22].copy_from_slice(&i.to_be_bytes());
    step[23..].copy_from_slice(value);
    let mut j = from;
    while j < 255 {
        step[22] = j;
        let next = hashv(&[&step[..]]).to_bytes();
        step[23..].copy_from_slice(&next);
        j += 1;
    }
}

/// RFC 8554 Algorithm 4b. Returns the candidate public key `Kc`, or `None` if
/// the signature is not well formed for this parameter set or would take more
/// than `step_limit` chain steps to verify. The caller MUST compare the result
/// with the public key it trusts; a `Some` is not a verdict.
pub fn candidate_key(
    identifier: &[u8; IDENTIFIER_LEN],
    q: u32,
    message: [&[u8]; 4],
    signature: &[u8],
    step_limit: u32,
) -> Option<[u8; N]> {
    if signature.len() != SIGNATURE_LEN || signature[..4] != TYPECODE {
        return None;
    }
    let randomizer: &[u8; N] = signature[4..4 + N].try_into().ok()?;
    let (digits, steps) = digits(&message_hash(identifier, q, randomizer, message));
    if steps > step_limit {
        return None;
    }
    let mut step = [0u8; STEP_LEN];
    step[..IDENTIFIER_LEN].copy_from_slice(identifier);
    step[16..20].copy_from_slice(&q.to_be_bytes());
    let mut z = [0u8; N * P];
    for (i, a) in digits.iter().enumerate() {
        let y = &signature[4 + N + N * i..4 + N + N * (i + 1)];
        chain(&mut step, i as u16, *a, y);
        z[N * i..N * (i + 1)].copy_from_slice(&step[23..]);
    }
    Some(hashv(&[identifier, &q.to_be_bytes(), &D_PBLC, &z]).to_bytes())
}

/// Key generation and signing. Not used by the program.
#[cfg(any(test, feature = "signer"))]
pub mod signer {
    use super::*;
    /// The 34 secret chain starts, `x[0..33]`.
    pub type Secret = [[u8; N]; P];

    /// RFC 8554 Algorithm 1: `K`.
    pub fn public_key(identifier: &[u8; IDENTIFIER_LEN], q: u32, x: &Secret) -> [u8; N] {
        let mut step = [0u8; STEP_LEN];
        step[..IDENTIFIER_LEN].copy_from_slice(identifier);
        step[16..20].copy_from_slice(&q.to_be_bytes());
        let mut y = [0u8; N * P];
        for (i, start) in x.iter().enumerate() {
            chain(&mut step, i as u16, 0, start);
            y[N * i..N * (i + 1)].copy_from_slice(&step[23..]);
        }
        hashv(&[identifier, &q.to_be_bytes(), &D_PBLC, &y]).to_bytes()
    }

    /// RFC 8554 Algorithm 3, with the randomizer supplied by the caller.
    pub fn sign(
        identifier: &[u8; IDENTIFIER_LEN],
        q: u32,
        x: &Secret,
        randomizer: &[u8; N],
        message: [&[u8]; 4],
    ) -> [u8; SIGNATURE_LEN] {
        let (digits, _) = digits(&message_hash(identifier, q, randomizer, message));
        let mut out = [0u8; SIGNATURE_LEN];
        out[..4].copy_from_slice(&TYPECODE);
        out[4..4 + N].copy_from_slice(randomizer);
        let mut step = [0u8; STEP_LEN];
        step[..IDENTIFIER_LEN].copy_from_slice(identifier);
        step[16..20].copy_from_slice(&q.to_be_bytes());
        for (i, (start, a)) in x.iter().zip(digits).enumerate() {
            // Steps 0 to a - 1.
            step[20..22].copy_from_slice(&(i as u16).to_be_bytes());
            step[23..].copy_from_slice(start);
            for j in 0..a {
                step[22] = j;
                let next = hashv(&[&step[..]]).to_bytes();
                step[23..].copy_from_slice(&next);
            }
            out[4 + N + N * i..4 + N + N * (i + 1)].copy_from_slice(&step[23..]);
        }
        out
    }

    /// The first randomizer from `candidates` whose signature verifies within
    /// `step_limit` steps, with how many were tried before it. Panics after
    /// 65,536 misses, which no reasonable limit and honest candidates reach.
    pub fn grind(
        identifier: &[u8; IDENTIFIER_LEN],
        q: u32,
        message: [&[u8]; 4],
        step_limit: u32,
        mut candidates: impl FnMut(u32) -> [u8; N],
    ) -> ([u8; N], u32) {
        let mut k = 0u32;
        loop {
            let c = candidates(k);
            if digits(&message_hash(identifier, q, &c, message)).1 <= step_limit {
                return (c, k);
            }
            k += 1;
            assert!(k < 1 << 16, "no randomizer within the step limit");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::signer::*;
    use super::*;
    const I: [u8; 16] = [7; 16];
    const NO_LIMIT: u32 = u32::MAX;
    fn secret(tag: u8) -> Secret {
        let mut x = [[0u8; N]; P];
        for (i, v) in x.iter_mut().enumerate() {
            *v = hashv(&[b"test secret", &[tag, i as u8]]).to_bytes();
        }
        x
    }
    fn parts(m: &[u8]) -> [&[u8]; 4] {
        [m, &[], &[], &[]]
    }

    #[test]
    fn a_signature_verifies_to_its_public_key_and_to_nothing_else() {
        let x = secret(1);
        let k = public_key(&I, 5, &x);
        let sig = sign(&I, 5, &x, &[9; 32], parts(b"pay the recipient"));
        assert_eq!(candidate_key(&I, 5, parts(b"pay the recipient"), &sig, NO_LIMIT), Some(k));
        // Another message, identifier, q or randomizer gives another candidate.
        assert_ne!(candidate_key(&I, 5, parts(b"pay the attacker!"), &sig, NO_LIMIT), Some(k));
        assert_ne!(candidate_key(&[8; 16], 5, parts(b"pay the recipient"), &sig, NO_LIMIT), Some(k));
        assert_ne!(candidate_key(&I, 6, parts(b"pay the recipient"), &sig, NO_LIMIT), Some(k));
        // Every byte of the signature matters.
        for at in [4usize, 35, 36, 500, SIGNATURE_LEN - 1] {
            let mut bad = sig;
            bad[at] ^= 1;
            assert_ne!(candidate_key(&I, 5, parts(b"pay the recipient"), &bad, NO_LIMIT), Some(k), "byte {at}");
        }
    }

    #[test]
    fn how_the_message_is_split_into_parts_does_not_matter() {
        let x = secret(2);
        let whole = sign(&I, 0, &x, &[1; 32], parts(b"abcdefgh"));
        let split = sign(&I, 0, &x, &[1; 32], [b"ab", b"cd", b"", b"efgh"]);
        assert_eq!(whole, split);
    }

    #[test]
    fn malformed_signatures_are_refused() {
        let x = secret(3);
        let sig = sign(&I, 0, &x, &[1; 32], parts(b"m"));
        assert!(candidate_key(&I, 0, parts(b"m"), &sig[..SIGNATURE_LEN - 1], NO_LIMIT).is_none());
        assert!(candidate_key(&I, 0, parts(b"m"), &[sig.as_slice(), &[0]].concat(), NO_LIMIT).is_none());
        let mut wrong_type = sig;
        wrong_type[3] = 3; // LMOTS_SHA256_N32_W4
        assert!(candidate_key(&I, 0, parts(b"m"), &wrong_type, NO_LIMIT).is_none());
        assert!(candidate_key(&I, 0, parts(b"m"), &[], NO_LIMIT).is_none());
    }

    #[test]
    fn the_checksum_follows_the_rfc() {
        let (d, steps) = digits(&[0xff; 32]);
        assert_eq!((d[32], d[33], steps), (0, 0, 510), "all digits maximal: checksum zero");
        let (d, steps) = digits(&[0; 32]);
        assert_eq!((d[32], d[33]), (0x1f, 0xe0), "32 * 255 = 8160 = 0x1fe0");
        assert_eq!(steps, 32 * 255 + (255 - 0x1f) + (255 - 0xe0));
    }

    #[test]
    fn the_step_count_is_fixed_by_the_high_checksum_byte() {
        // steps = sum + (255 - hi) + (255 - lo) with sum = 256 * hi + lo.
        for n in 0u32..2000 {
            let (d, steps) = digits(&hashv(&[&n.to_le_bytes()]).to_bytes());
            assert_eq!(steps, 255 * (d[32] as u32 + 2));
        }
    }

    #[test]
    fn the_step_limit_only_ever_rejects() {
        let x = secret(4);
        let k = public_key(&I, 1, &x);
        let message = parts(b"bounded cost");
        let (c, tried) = grind(&I, 1, message, 4080, |n| hashv(&[b"c", &n.to_le_bytes()]).to_bytes());
        let sig = sign(&I, 1, &x, &c, message);
        let steps = digits(&message_hash(&I, 1, &c, message)).1;
        assert!(steps <= 4080 && tried < 200, "{steps} steps after {tried} tries");
        // Within the limit it is an ordinary signature; one step under, it is refused.
        assert_eq!(candidate_key(&I, 1, message, &sig, 4080), Some(k));
        assert_eq!(candidate_key(&I, 1, message, &sig, NO_LIMIT), Some(k));
        assert_eq!(candidate_key(&I, 1, message, &sig, steps), Some(k));
        assert_eq!(candidate_key(&I, 1, message, &sig, steps - 1), None);
    }

    #[test]
    fn signing_twice_with_one_randomizer_is_the_same_signature() {
        let x = secret(5);
        assert_eq!(sign(&I, 2, &x, &[3; 32], parts(b"same")), sign(&I, 2, &x, &[3; 32], parts(b"same")));
    }
}
