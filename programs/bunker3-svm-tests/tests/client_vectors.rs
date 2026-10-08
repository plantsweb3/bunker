//! Cross-checks the TypeScript client against an independent Rust derivation and
//! against the compiled program: `fixtures/bunker-v3.json` is produced by
//! `scripts/v3-vectors.ts`. PUBLIC TEST KEYS ONLY.
use hkdf::Hkdf;
use litesvm::LiteSVM;
use sha2::Sha256;
use solana_address::Address as Pubkey;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_sha256_hasher::hashv;
use solana_signer::Signer;
use solana_system_interface::instruction as system_instruction;
use solana_transaction::Transaction;
use std::str::FromStr;
mod common;
use bunker_lmots::{candidate_key, signer};
use common::{identifier, ROLE_OPERATIONAL, ROLE_RECOVERY, STEP_LIMIT};

fn fixture() -> serde_json::Value {
    serde_json::from_str(include_str!("../../../fixtures/bunker-v3.json")).unwrap()
}
fn bytes(v: &serde_json::Value) -> Vec<u8> {
    let s = v.as_str().unwrap();
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}
fn arr(v: &serde_json::Value) -> [u8; 32] {
    bytes(v).try_into().unwrap()
}
/// RFC 5869 with an empty salt, written against RustCrypto rather than the
/// library the client uses.
fn expand(ikm: &[u8], info: &[u8], length: usize) -> Vec<u8> {
    let mut out = vec![0u8; length];
    Hkdf::<Sha256>::new(None, ikm).expand(info, &mut out).unwrap();
    out
}
/// A derived one-time key is 34 chain starts followed by a randomizer seed.
const ONE_TIME: usize = 34 * 32 + 32;
fn secret_of(material: &[u8]) -> signer::Secret {
    assert_eq!(material.len(), ONE_TIME);
    let mut x = [[0u8; 32]; 34];
    for (i, v) in x.iter_mut().enumerate() {
        v.copy_from_slice(&material[32 * i..32 * i + 32]);
    }
    x
}
/// The client's signature for `message`, recomputed here: the first randomizer
/// of the key's own sequence that stays within the program's step limit.
fn sign(material: &[u8], id: &[u8; 16], message: &[u8]) -> Vec<u8> {
    let parts: [&[u8]; 4] = [message, &[], &[], &[]];
    let (c, _) = signer::grind(id, 0, parts, STEP_LIMIT, |n| {
        expand(&material[34 * 32..], &[b"BUNKER-LMOTS-C".as_slice(), &n.to_le_bytes()].concat(), 32).try_into().unwrap()
    });
    signer::sign(id, 0, &secret_of(material), &c, parts).to_vec()
}
/// Everything the test derives on its own from the fixture's master.
struct Derived {
    program: [u8; 32],
    chain: [u8; 32],
    salt: [u8; 32],
    master: Vec<u8>,
    context: Vec<u8>,
}
impl Derived {
    fn seed(&self, epoch: u64) -> Vec<u8> {
        expand(&self.master, &info(&self.context, 2, &[epoch]), 32)
    }
    fn recovery(&self, epoch: u64) -> Vec<u8> {
        expand(&self.master, &info(&self.context, 1, &[epoch]), ONE_TIME)
    }
    fn operational(&self, epoch: u64, index: u64) -> Vec<u8> {
        expand(&self.seed(epoch), &info(&self.context, 3, &[epoch, index]), ONE_TIME)
    }
    fn id(&self, role: u8, epoch: u64, index: u64) -> [u8; 16] {
        identifier(&self.program, &self.chain, &self.salt, role, epoch, index)
    }
    fn rec_root(&self, epoch: u64) -> [u8; 32] {
        signer::public_key(&self.id(ROLE_RECOVERY, epoch, 0), 0, &secret_of(&self.recovery(epoch)))
    }
    fn op_root(&self, epoch: u64, index: u64) -> [u8; 32] {
        signer::public_key(&self.id(ROLE_OPERATIONAL, epoch, index), 0, &secret_of(&self.operational(epoch, index)))
    }
}
fn info(context: &[u8], role: u8, numbers: &[u64]) -> Vec<u8> {
    let mut i = context.to_vec();
    i.push(role);
    for n in numbers {
        i.extend(n.to_le_bytes());
    }
    i
}

fn derived(f: &serde_json::Value) -> Derived {
    let mut context = b"BUNKER-KDF-4".to_vec();
    context.push(0);
    context.extend(bytes(&f["chainTag"]));
    context.extend(bytes(&f["programBytes"]));
    context.extend(bytes(&f["salt"]));
    context.extend((f["delaySecs"].as_u64().unwrap() as u32).to_le_bytes());
    // Four trusted-wallet slots, the listed ones first and the rest zero.
    let mut trusted = [0u8; 128];
    for (i, wallet) in f["trusted"].as_array().unwrap().iter().enumerate() {
        trusted[32 * i..32 * i + 32].copy_from_slice(&bytes(wallet));
    }
    context.extend(trusted);
    Derived { program: arr(&f["programBytes"]), chain: arr(&f["chainTag"]), salt: arr(&f["salt"]), master: bytes(&f["master"]), context }
}

#[test]
fn rust_derivation_matches_the_client() {
    let f = fixture();
    let d = derived(&f);
    assert_eq!(d.context, bytes(&f["context"]));
    assert_eq!(d.context.len(), 241);
    assert_eq!(d.seed(0), bytes(&f["epoch0"]["seed"]));
    assert_eq!(d.seed(1), bytes(&f["epoch1"]["seed"]));
    assert_eq!(d.rec_root(0), arr(&f["epoch0"]["recRoot"]));
    assert_eq!(d.op_root(0, 0), arr(&f["epoch0"]["opRoot"]));
    assert_eq!(d.op_root(0, 1), arr(&f["epoch0"]["opRootIndex1"]));
    assert_eq!(d.op_root(1, 0), arr(&f["epoch1"]["opRoot"]));
    assert_eq!(d.op_root(1, 1), arr(&f["epoch1"]["opRootIndex1"]));
    // The recovery packet names exactly the independently derived next roots.
    let packet = bytes(&f["recover"]["payload"]);
    assert_eq!(&packet[74..106], &d.rec_root(1));
    assert_eq!(&packet[106..138], &d.op_root(1, 0));
}

/// The client's three signatures, recomputed byte for byte from the master,
/// and checked by the verifier the program uses under the program's limit.
#[test]
fn client_signatures_are_reproduced_and_verify() {
    let f = fixture();
    let d = derived(&f);
    let mut later_randomizers = 0;
    for (name, material, role, epoch, index, root) in [
        ("announce", d.operational(0, 0), ROLE_OPERATIONAL, 0u64, 0u64, &f["epoch0"]["opRoot"]),
        ("recover", d.recovery(0), ROLE_RECOVERY, 0, 0, &f["epoch0"]["recRoot"]),
        ("announceAfterRecovery", d.operational(1, 0), ROLE_OPERATIONAL, 1, 0, &f["epoch1"]["opRoot"]),
        ("announceLaterRandomizer", d.operational(0, 1), ROLE_OPERATIONAL, 0, 1, &f["epoch0"]["opRootIndex1"]),
    ] {
        let message = bytes(&f[name]["message"]);
        let signature = bytes(&f[name]["signature"]);
        let id = d.id(role, epoch, index);
        assert_eq!(sign(&material, &id, &message), signature, "{name}");
        // Whether the first candidate randomizer was passed over for this one.
        let first: [u8; 32] = expand(&material[34 * 32..], &[b"BUNKER-LMOTS-C".as_slice(), &0u32.to_le_bytes()].concat(), 32).try_into().unwrap();
        later_randomizers += (signature[4..36] != first) as u32;
        assert_eq!(hashv(&[&message]).to_bytes().to_vec(), bytes(&f[name]["digest"]), "{name}");
        let verify = |message: &[u8], id: &[u8; 16], q: u32| candidate_key(id, q, [message, &[], &[], &[]], &signature, STEP_LIMIT) == Some(arr(root));
        assert!(verify(&message, &id, 0), "{name}");
        let mut altered = message.clone();
        altered[100] ^= 1;
        assert!(!verify(&altered, &id, 0), "{name}");
        assert!(!verify(&message, &id, 1), "{name}");
        assert!(!verify(&message, &d.id(role, epoch + 1, index), 0), "{name}");
        assert!(!verify(&message, &d.id(role, epoch, index + 1), 0), "{name}");
        assert!(!verify(&message, &d.id(3 - role, epoch, index), 0), "{name}");
    }
    assert!(later_randomizers >= 1, "one vector must exercise the search for a randomizer");
}

/// The exact bytes the client produces drive the compiled program through
/// create, announce, cancel by recovery, and announce again in the new epoch.
#[test]
fn the_compiled_program_accepts_the_client_bytes() {
    let f = fixture();
    let program = Pubkey::from_str(f["program"].as_str().unwrap()).unwrap();
    let vault = Pubkey::from_str(f["vault"].as_str().unwrap()).unwrap();
    // The identity is the hash of the creation data, as the program computes it.
    let id = hashv(&[b"BUNKER3_VAULT_ID", &bytes(&f["initializeData"])]).to_bytes();
    assert_eq!(id, arr(&f["vaultId"]));
    assert_eq!(Pubkey::find_program_address(&[b"bunker3", &id], &program).0, vault);
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(program, concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/bunker3.so"))
        .expect("build bunker3.so first");
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 50_000_000_000).unwrap();
    let announce_by: i64 = f["announceBy"].as_str().unwrap().parse().unwrap();
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = announce_by - 100;
    svm.set_sysvar(&clock);
    let system = Pubkey::default();
    let marker = |root: &[u8; 32]| Pubkey::find_program_address(&[b"spent-v3", vault.as_ref(), root], &program).0;
    let mut send = |svm: &mut LiteSVM, ixs: Vec<Instruction>| {
        svm.expire_blockhash();
        let budget = Instruction {
            program_id: Pubkey::from_str("ComputeBudget111111111111111111111111111111").unwrap(),
            accounts: vec![],
            data: [vec![2u8], 800_000u32.to_le_bytes().to_vec()].concat(),
        };
        let all = [vec![budget], ixs].concat();
        let tx = Transaction::new_signed_with_payer(&all, Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());
        svm.send_transaction(tx)
    };
    let stage = |svm: &mut LiteSVM, send: &mut dyn FnMut(&mut LiteSVM, Vec<Instruction>) -> litesvm::types::TransactionResult, name: &str| {
        let digest = arr(&f[name]["digest"]);
        let signature = bytes(&f[name]["signature"]);
        let proof = Pubkey::find_program_address(&[b"proof", payer.pubkey().as_ref(), &digest], &program).0;
        for offset in [0usize, 600] {
            let chunk = &signature[offset..(offset + 600).min(signature.len())];
            let data = [vec![1u8], digest.to_vec(), (offset as u16).to_le_bytes().to_vec(), chunk.to_vec()].concat();
            send(svm, vec![Instruction {
                program_id: program,
                accounts: vec![AccountMeta::new(payer.pubkey(), true), AccountMeta::new(proof, false), AccountMeta::new_readonly(system, false)],
                data,
            }])
            .unwrap();
        }
        proof
    };
    let (op0, op0b, rec0) = (arr(&f["epoch0"]["opRoot"]), arr(&f["epoch0"]["opRootIndex1"]), arr(&f["epoch0"]["recRoot"]));
    let (op1, op1b) = (arr(&f["epoch1"]["opRoot"]), arr(&f["epoch1"]["opRootIndex1"]));
    // Create, with the client's initialize data, and fund.
    send(&mut svm, vec![Instruction {
        program_id: program,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(system, false),
        ],
        data: [vec![0u8], bytes(&f["initializeData"])].concat(),
    }])
    .unwrap();
    send(&mut svm, vec![system_instruction::transfer(&payer.pubkey(), &vault, 5_000_000_000)]).unwrap();
    // Announce with the client's payload and signature.
    let announce = |payload: Vec<u8>, proof: Pubkey, current: &[u8; 32], next: &[u8; 32]| Instruction {
        program_id: program,
        accounts: vec![
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(proof, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(marker(current), false),
            AccountMeta::new_readonly(marker(next), false),
            AccountMeta::new_readonly(system, false),
        ],
        data: [vec![2u8], payload].concat(),
    };
    let proof = stage(&mut svm, &mut send, "announce");
    send(&mut svm, vec![announce(bytes(&f["announce"]["payload"]), proof, &op0, &op0b)]).unwrap();
    let data = svm.get_account(&vault).unwrap().data;
    assert_eq!(data[156], 1);
    assert_eq!(&data[72..104], &op0b);
    assert_eq!(&data[190..222], bytes(&f["destination"]).as_slice());
    // Cancel with the client's recovery packet.
    let recovery_payload = bytes(&f["recover"]["payload"]);
    let next_rec: [u8; 32] = recovery_payload[74..106].try_into().unwrap();
    let proof = stage(&mut svm, &mut send, "recover");
    send(&mut svm, vec![Instruction {
        program_id: program,
        accounts: vec![
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(proof, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(marker(&rec0), false),
            AccountMeta::new_readonly(marker(&next_rec), false),
            AccountMeta::new_readonly(marker(&op1), false),
            AccountMeta::new_readonly(system, false),
        ],
        data: [vec![5u8], recovery_payload].concat(),
    }])
    .unwrap();
    let data = svm.get_account(&vault).unwrap().data;
    assert_eq!((data[156], u64::from_le_bytes(data[112..120].try_into().unwrap())), (0, 1));
    assert_eq!(&data[72..104], &op1);
    // The next epoch's seed, as the client derived it, announces successfully.
    let proof = stage(&mut svm, &mut send, "announceAfterRecovery");
    send(&mut svm, vec![announce(bytes(&f["announceAfterRecovery"]["payload"]), proof, &op1, &op1b)]).unwrap();
    assert_eq!(svm.get_account(&vault).unwrap().data[156], 1);
}
