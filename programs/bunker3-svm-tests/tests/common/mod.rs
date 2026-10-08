//! One-time test keys shared by the VM tests. PUBLIC TEST KEYS ONLY.
//!
//! An LM-OTS public key is bound to the identifier `I` it will sign under, and
//! the program fixes it from the vault: the program, chain tag, salt, role, key
//! generation and operation index (`q` is always zero). So a test key is named
//! by a tag, and the tag says where the key belongs:
//!
//! | tag        | role        | generation | index     |
//! |------------|-------------|------------|-----------|
//! | 1..=9      | operational | 0          | tag - 1   |
//! | 10..=99    | operational | tag / 10   | tag % 10  |
//! | 100..=499  | recovery    | tag - 100  | 0         |
//! | 500..      | recovery    | tag - 500  | 0         |
#![allow(dead_code)]
use bunker_lmots::signer::{grind, public_key, sign, Secret};
use bunker_lmots::{IDENTIFIER_LEN, N, P};
use solana_sha256_hasher::hashv;

/// Every VM test loads the program at this address, so a key depends only on
/// its tag and the vault's salt.
pub const PROGRAM: [u8; 32] = [0xB3; 32];
pub const CHAIN: [u8; 32] = [9u8; 32];
pub const SALT: [u8; 32] = [7u8; 32];
pub const ROLE_OPERATIONAL: u8 = 1;
pub const ROLE_RECOVERY: u8 = 2;
/// The program's `VERIFY_STEP_LIMIT`.
pub const STEP_LIMIT: u32 = 4080;
pub const SIGNATURE_LEN: usize = bunker_lmots::SIGNATURE_LEN;
pub const PROOF_LEN: usize = 74 + SIGNATURE_LEN;
pub const VAULT_LEN: usize = 447;

/// Where a tagged key belongs: `(role, generation, index)`.
pub fn slot(tag: u32) -> (u8, u64, u64) {
    match tag {
        1..=9 => (ROLE_OPERATIONAL, 0, (tag - 1) as u64),
        10..=99 => (ROLE_OPERATIONAL, (tag / 10) as u64, (tag % 10) as u64),
        100..=499 => (ROLE_RECOVERY, (tag - 100) as u64, 0),
        _ => (ROLE_RECOVERY, (tag - 500) as u64, 0),
    }
}
/// Written out here rather than imported, so the test states the rule itself.
pub fn identifier(program: &[u8; 32], chain: &[u8; 32], salt: &[u8; 32], role: u8, epoch: u64, index: u64) -> [u8; IDENTIFIER_LEN] {
    let h = hashv(&[b"BUNKER3_LMOTS_ID", program, chain, salt, &[role], &epoch.to_le_bytes(), &index.to_le_bytes()]).to_bytes();
    h[..IDENTIFIER_LEN].try_into().unwrap()
}
pub fn secret(tag: u32) -> Secret {
    let mut x = [[0u8; N]; P];
    for (i, v) in x.iter_mut().enumerate() {
        *v = hashv(&[b"bunker public test key", &tag.to_le_bytes(), &[i as u8]]).to_bytes();
    }
    x
}
/// The public key of `tag` in a vault with this salt.
pub fn root_in(salt: &[u8; 32], tag: u32) -> [u8; 32] {
    let (role, epoch, index) = slot(tag);
    public_key(&identifier(&PROGRAM, &CHAIN, salt, role, epoch, index), 0, &secret(tag))
}
pub fn root(tag: u32) -> [u8; 32] {
    root_in(&SALT, tag)
}
/// Signs with `tag` under an arbitrary identifier and `q`, within `limit` steps.
/// The program only ever verifies with `q` zero.
pub fn sign_under(id: &[u8; IDENTIFIER_LEN], q: u32, tag: u32, message: &[u8], limit: u32) -> Vec<u8> {
    let parts: [&[u8]; 4] = [message, &[], &[], &[]];
    let (c, _) = grind(id, q, parts, limit, |n| hashv(&[b"bunker test randomizer", &tag.to_le_bytes(), &n.to_le_bytes()]).to_bytes());
    sign(id, q, &secret(tag), &c, parts).to_vec()
}
/// Signs `message` with `tag` where it belongs, in a vault with this salt.
pub fn sign_in(salt: &[u8; 32], tag: u32, message: &[u8]) -> Vec<u8> {
    let (role, epoch, index) = slot(tag);
    sign_under(&identifier(&PROGRAM, &CHAIN, salt, role, epoch, index), 0, tag, message, STEP_LIMIT)
}
/// Signs like `sign_in`, with a randomizer that costs the verifier exactly the
/// step limit: the most expensive signature the program accepts.
pub fn sign_at_limit(salt: &[u8; 32], tag: u32, message: &[u8]) -> Vec<u8> {
    let (role, epoch, index) = slot(tag);
    let id = identifier(&PROGRAM, &CHAIN, salt, role, epoch, index);
    let parts: [&[u8]; 4] = [message, &[], &[], &[]];
    let c = (0u32..1 << 16)
        .map(|n| hashv(&[b"bunker costly randomizer", &n.to_le_bytes()]).to_bytes())
        .find(|c| bunker_lmots::digits(&bunker_lmots::message_hash(&id, 0, c, parts)).1 == STEP_LIMIT)
        .unwrap();
    sign(&id, 0, &secret(tag), &c, parts).to_vec()
}
