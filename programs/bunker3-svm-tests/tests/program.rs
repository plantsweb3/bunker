//! Runs the compiled protocol-3 program (`target/deploy/bunker3.so`) in an
//! in-process Solana VM with a controllable clock. Build it first:
//!   cargo-build-sbf --manifest-path programs/bunker3/Cargo.toml --sbf-out-dir target/deploy
//! PUBLIC TEST KEYS ONLY. Nothing here is a deployment or an audit.
use litesvm::{types::TransactionResult, LiteSVM};
use solana_account::Account;
use solana_address::Address as Pubkey;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_sha256_hasher::hashv;
use solana_signer::Signer;
use solana_system_interface::instruction as system_instruction;
use solana_transaction::Transaction;
use std::str::FromStr;
use winterwallet_core::WinternitzKeypair;

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const T0: i64 = 1_800_000_000;
const DAY: i64 = 86_400;
const WINDOW: i64 = 604_800;
const VAULT_LEN: usize = 287;
const SOL: u64 = 1_000_000_000;

fn system() -> Pubkey {
    Pubkey::default()
}
fn token_program() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}
/// A distinct public-test one-time key per tag.
fn key(tag: u32) -> WinternitzKeypair {
    WinternitzKeypair::from_mnemonic_at(PHRASE, 0, 0, tag).unwrap()
}
fn root(tag: u32) -> [u8; 32] {
    *key(tag).derive::<32>().to_pubkey().merklize().as_bytes()
}

struct Env {
    svm: LiteSVM,
    program: Pubkey,
    payer: Keypair,
    salt: [u8; 32],
    /// `sha256("BUNKER3_VAULT_ID" || salt || chain || op || rec || delay)`.
    id: [u8; 32],
    chain: [u8; 32],
    vault: Pubkey,
}
#[derive(Clone)]
struct Withdrawal {
    epoch: u64,
    index: u64,
    kind: u8,
    mint: [u8; 32],
    destination: Pubkey,
    amount: u64,
    announce_by: i64,
    next: [u8; 32],
}
impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let program = Pubkey::new_unique();
        let so = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/bunker3.so");
        svm.add_program_from_file(program, so)
            .expect("build bunker3.so first (see the header of this file)");
        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100 * SOL).unwrap();
        let mut env = Self { svm, program, payer, salt: [7u8; 32], id: [0; 32], chain: [9u8; 32], vault: Pubkey::default() };
        env.adopt(root(1), root(100), DAY as u32);
        env.set_time(T0);
        env
    }
    fn set_time(&mut self, unix: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = unix;
        self.svm.set_sysvar(&clock);
    }
    fn send_as(&mut self, signer: &Keypair, ixs: &[Instruction]) -> TransactionResult {
        // A fresh blockhash each time so an intentional retry is a new transaction.
        self.svm.expire_blockhash();
        let budget = Instruction {
            program_id: Pubkey::from_str("ComputeBudget111111111111111111111111111111").unwrap(),
            accounts: vec![],
            data: [vec![2u8], 1_400_000u32.to_le_bytes().to_vec()].concat(),
        };
        let all = [vec![budget], ixs.to_vec()].concat();
        let tx = Transaction::new_signed_with_payer(
            &all,
            Some(&signer.pubkey()),
            &[signer],
            self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx)
    }
    fn send(&mut self, ixs: &[Instruction]) -> TransactionResult {
        let payer = self.payer.insecure_clone();
        self.send_as(&payer, ixs)
    }
    fn marker(&self, root: &[u8; 32]) -> Pubkey {
        self.marker_in(&self.vault, root)
    }
    fn marker_in(&self, vault: &Pubkey, root: &[u8; 32]) -> Pubkey {
        Pubkey::find_program_address(&[b"spent-v3", vault.as_ref(), root], &self.program).0
    }
    fn init_data(&self, salt: &[u8; 32], op: [u8; 32], rec: [u8; 32], delay: u32) -> Vec<u8> {
        [salt.to_vec(), self.chain.to_vec(), op.to_vec(), rec.to_vec(), delay.to_le_bytes().to_vec()].concat()
    }
    /// The identity and address the program will derive for these parameters.
    fn derive(&self, salt: &[u8; 32], op: [u8; 32], rec: [u8; 32], delay: u32) -> ([u8; 32], Pubkey) {
        let id = hashv(&[b"BUNKER3_VAULT_ID", &self.init_data(salt, op, rec, delay)]).to_bytes();
        (id, Pubkey::find_program_address(&[b"bunker3", &id], &self.program).0)
    }
    /// Points the harness at the vault these parameters create.
    fn adopt(&mut self, op: [u8; 32], rec: [u8; 32], delay: u32) {
        (self.id, self.vault) = self.derive(&self.salt, op, rec, delay);
    }
    fn init_ix_at(&self, vault: Pubkey, salt: &[u8; 32], op: [u8; 32], rec: [u8; 32], delay: u32) -> Instruction {
        Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(self.payer.pubkey(), true),
                AccountMeta::new(vault, false),
                AccountMeta::new_readonly(system(), false),
            ],
            data: [vec![0u8], self.init_data(salt, op, rec, delay)].concat(),
        }
    }
    fn spent(&self, root: &[u8; 32]) -> bool {
        self.svm
            .get_account(&self.marker(root))
            .is_some_and(|a| a.owner == self.program && a.data == b"BKSPENT3")
    }
    fn vault_data(&self) -> Vec<u8> {
        self.svm.get_account(&self.vault).unwrap().data
    }
    fn lamports(&self, key: &Pubkey) -> u64 {
        self.svm.get_balance(key).unwrap_or(0)
    }
    fn pending(&self) -> bool {
        self.vault_data()[156] == 1
    }
    fn epoch(&self) -> u64 {
        u64::from_le_bytes(self.vault_data()[112..120].try_into().unwrap())
    }
    fn op_index(&self) -> u64 {
        u64::from_le_bytes(self.vault_data()[104..112].try_into().unwrap())
    }
    fn op_root(&self) -> [u8; 32] {
        self.vault_data()[72..104].try_into().unwrap()
    }

    /// Creates the vault for these parameters and makes it the harness's vault.
    fn init_ix(&mut self, op: [u8; 32], rec: [u8; 32], delay: u32) -> Instruction {
        self.adopt(op, rec, delay);
        self.init_ix_at(self.vault, &self.salt, op, rec, delay)
    }
    /// Operational key `tag 1`, recovery key `tag 100`, funded with 10 SOL.
    fn init(&mut self) {
        let ix = self.init_ix(root(1), root(100), DAY as u32);
        self.send(&[ix]).unwrap();
        let fund = system_instruction::transfer(&self.payer.pubkey(), &self.vault, 10 * SOL);
        self.send(&[fund]).unwrap();
    }

    fn announce_payload(&self, w: &Withdrawal) -> Vec<u8> {
        let mut d = vec![3u8, 1];
        d.extend(self.id);
        d.extend(self.chain);
        d.extend(w.epoch.to_le_bytes());
        d.extend(w.index.to_le_bytes());
        d.push(w.kind);
        d.extend(w.mint);
        d.extend(w.destination.to_bytes());
        d.extend(w.amount.to_le_bytes());
        d.extend(w.announce_by.to_le_bytes());
        d.extend(w.next);
        d
    }
    fn recover_payload(&self, epoch: u64, next_rec: [u8; 32], next_op: [u8; 32]) -> Vec<u8> {
        let mut d = vec![3u8, 2];
        d.extend(self.id);
        d.extend(self.chain);
        d.extend(epoch.to_le_bytes());
        d.extend(next_rec);
        d.extend(next_op);
        d
    }
    fn message(&self, domain: &[u8; 16], payload: &[u8]) -> Vec<u8> {
        [domain.to_vec(), self.program.to_bytes().to_vec(), self.vault.to_bytes().to_vec(), payload.to_vec()].concat()
    }
    fn proof(&self, digest: &[u8; 32]) -> Pubkey {
        Pubkey::find_program_address(&[b"proof", self.payer.pubkey().as_ref(), digest], &self.program).0
    }
    /// Signs `message` with one-time key `tag` and uploads the signature in two chunks.
    fn stage(&mut self, tag: u32, message: &[u8]) -> Pubkey {
        let signature = key(tag).derive::<32>().sign(&[message]);
        let bytes = signature.as_bytes().to_vec();
        let digest = hashv(&[message]).to_bytes();
        let proof = self.proof(&digest);
        // A proof address is fixed by (payer, message). If an earlier attempt left a
        // different signature there, the payer reclaims it before staging again.
        if self.svm.get_account(&proof).is_some_and(|a| !a.data.is_empty()) {
            let close = Instruction {
                program_id: self.program,
                accounts: vec![AccountMeta::new(proof, false), AccountMeta::new(self.payer.pubkey(), true)],
                data: vec![6u8],
            };
            self.send(&[close]).unwrap();
        }
        for offset in [0usize, 600] {
            let chunk = &bytes[offset..(offset + 600).min(bytes.len())];
            let data = [vec![1u8], digest.to_vec(), (offset as u16).to_le_bytes().to_vec(), chunk.to_vec()].concat();
            let ix = Instruction {
                program_id: self.program,
                accounts: vec![
                    AccountMeta::new(self.payer.pubkey(), true),
                    AccountMeta::new(proof, false),
                    AccountMeta::new_readonly(system(), false),
                ],
                data,
            };
            self.send(&[ix]).unwrap();
        }
        proof
    }
    fn announce_ix(&self, payload: &[u8], proof: Pubkey, current: &[u8; 32], next: &[u8; 32]) -> Instruction {
        Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(self.vault, false),
                AccountMeta::new_readonly(proof, false),
                AccountMeta::new(self.payer.pubkey(), true),
                AccountMeta::new(self.marker(current), false),
                AccountMeta::new_readonly(self.marker(next), false),
                AccountMeta::new_readonly(system(), false),
            ],
            data: [vec![2u8], payload.to_vec()].concat(),
        }
    }
    /// Signs with `signer_tag` and announces against the vault's current root.
    fn announce(&mut self, signer_tag: u32, w: &Withdrawal) -> TransactionResult {
        let payload = self.announce_payload(w);
        let message = self.message(b"BUNKER3_ANNOUNCE", &payload);
        let proof = self.stage(signer_tag, &message);
        let current = self.op_root();
        let ix = self.announce_ix(&payload, proof, &current, &w.next);
        self.send(&[ix])
    }
    fn sol(&self, destination: Pubkey, amount: u64, index: u64, next_tag: u32) -> Withdrawal {
        Withdrawal {
            epoch: self.epoch(),
            index,
            kind: 0,
            mint: [0; 32],
            destination,
            amount,
            announce_by: T0 + 3600,
            next: root(next_tag),
        }
    }
    fn execute_ix(&self, destination: Pubkey, extra: Vec<AccountMeta>) -> Instruction {
        Instruction {
            program_id: self.program,
            accounts: [vec![AccountMeta::new(self.vault, false), AccountMeta::new(destination, false)], extra].concat(),
            data: vec![3u8],
        }
    }
    fn execute(&mut self, destination: Pubkey) -> TransactionResult {
        let ix = self.execute_ix(destination, vec![]);
        self.send(&[ix])
    }
    fn expire(&mut self) -> TransactionResult {
        let ix = Instruction {
            program_id: self.program,
            accounts: vec![AccountMeta::new(self.vault, false)],
            data: vec![4u8],
        };
        self.send(&[ix])
    }
    fn recover_ix(&self, payload: &[u8], proof: Pubkey, rec: &[u8; 32], op: &[u8; 32], next_rec: &[u8; 32], next_op: &[u8; 32]) -> Instruction {
        Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(self.vault, false),
                AccountMeta::new_readonly(proof, false),
                AccountMeta::new(self.payer.pubkey(), true),
                AccountMeta::new(self.marker(rec), false),
                AccountMeta::new(self.marker(op), false),
                AccountMeta::new_readonly(self.marker(next_rec), false),
                AccountMeta::new_readonly(self.marker(next_op), false),
                AccountMeta::new_readonly(system(), false),
            ],
            data: [vec![5u8], payload.to_vec()].concat(),
        }
    }
    /// Recovery signed by `signer_tag`, installing recovery key `next_rec_tag`
    /// and operational key `next_op_tag`.
    fn recover(&mut self, signer_tag: u32, epoch: u64, next_rec_tag: u32, next_op_tag: u32) -> TransactionResult {
        let (next_rec, next_op) = (root(next_rec_tag), root(next_op_tag));
        let payload = self.recover_payload(epoch, next_rec, next_op);
        let message = self.message(b"BUNKER3_RECOVER_", &payload);
        let proof = self.stage(signer_tag, &message);
        let data = self.vault_data();
        let rec: [u8; 32] = data[120..152].try_into().unwrap();
        let op: [u8; 32] = data[72..104].try_into().unwrap();
        let ix = self.recover_ix(&payload, proof, &rec, &op, &next_rec, &next_op);
        self.send(&[ix])
    }
}

#[test]
fn initialize_writes_the_specified_layout_and_cannot_be_repeated() {
    let mut e = Env::new();
    e.init();
    let d = e.vault_data();
    assert_eq!(d.len(), VAULT_LEN);
    assert_eq!(&d[..8], b"BUNKER03");
    assert_eq!(&d[8..40], &e.id);
    assert_eq!(&d[40..72], &e.chain);
    assert_eq!(&d[72..104], &root(1));
    assert_eq!(&d[120..152], &root(100));
    assert_eq!(u32::from_le_bytes(d[152..156].try_into().unwrap()), DAY as u32);
    assert!(d[104..120].iter().all(|b| *b == 0) && d[156..286].iter().all(|b| *b == 0));
    assert_eq!(e.svm.get_account(&e.vault).unwrap().owner, e.program);
    // Neither initial root is marked spent by creation.
    assert!(!e.spent(&root(1)) && !e.spent(&root(100)));
    let again = e.init_ix_at(e.vault, &e.salt, root(1), root(100), DAY as u32);
    assert!(e.send(&[again]).is_err(), "an existing vault cannot be re-initialized");
    assert_eq!(&e.vault_data()[72..104], &root(1));
}

#[test]
fn initialize_rejects_bad_roots_and_delays() {
    for (op, rec, delay) in [
        (root(1), root(1), DAY as u32),
        ([0; 32], root(100), DAY as u32),
        (root(1), [0; 32], DAY as u32),
        (root(1), root(100), WINDOW as u32 + 1),
    ] {
        let mut e = Env::new();
        let ix = e.init_ix(op, rec, delay);
        assert!(e.send(&[ix]).is_err());
        assert!(e.svm.get_account(&e.vault).is_none_or(|a| a.data.is_empty()));
    }
}

#[test]
fn announce_rotates_and_records_but_moves_nothing() {
    let mut e = Env::new();
    e.init();
    let destination = Pubkey::new_unique();
    let before = e.lamports(&e.vault);
    let w = e.sol(destination, 2 * SOL, 0, 2);
    let meta = e.announce(1, &w).unwrap();
    println!("announce compute units: {}", meta.compute_units_consumed);
    assert_eq!(e.lamports(&e.vault), before, "announcing must not debit the vault");
    assert_eq!(e.lamports(&destination), 0);
    assert!(e.pending());
    assert_eq!((e.op_index(), e.epoch(), e.op_root()), (1, 0, root(2)));
    assert!(e.spent(&root(1)), "the used operational root is retired at announcement");
    let d = e.vault_data();
    assert_eq!(&d[190..222], destination.as_ref());
    assert_eq!(u64::from_le_bytes(d[222..230].try_into().unwrap()), 2 * SOL);
    assert_eq!(i64::from_le_bytes(d[230..238].try_into().unwrap()), T0 + DAY);
    assert_eq!(i64::from_le_bytes(d[238..246].try_into().unwrap()), T0 + DAY + WINDOW);
}

#[test]
fn nothing_leaves_before_the_wait_and_exactly_once_after() {
    let mut e = Env::new();
    e.init();
    let destination = Pubkey::new_unique();
    let w = e.sol(destination, 2 * SOL, 0, 2);
    e.announce(1, &w).unwrap();
    let before = e.lamports(&e.vault);
    for early in [T0, T0 + 1, T0 + DAY - 1] {
        e.set_time(early);
        assert!(e.execute(destination).is_err(), "executed {} s after announcing", early - T0);
        assert_eq!(e.lamports(&e.vault), before);
    }
    e.set_time(T0 + DAY);
    // Anyone can submit the execution; it needs no key.
    let stranger = Keypair::new();
    e.svm.airdrop(&stranger.pubkey(), SOL).unwrap();
    let ix = e.execute_ix(destination, vec![]);
    e.send_as(&stranger, &[ix]).unwrap();
    assert_eq!(e.lamports(&destination), 2 * SOL);
    assert_eq!(e.lamports(&e.vault), before - 2 * SOL);
    assert!(!e.pending());
    assert!(e.vault_data()[157..286].iter().all(|b| *b == 0), "the record is zeroed");
    assert!(e.execute(destination).is_err(), "a withdrawal executes at most once");
    assert_eq!(e.lamports(&destination), 2 * SOL);
}

/// A vault created with no waiting period: announce and execute in ONE
/// transaction, and the other protections are unchanged.
#[test]
fn a_vault_without_a_waiting_period_withdraws_in_one_transaction() {
    let mut e = Env::new();
    let ix = e.init_ix(root(1), root(100), 0);
    e.send(&[ix]).unwrap();
    let fund = system_instruction::transfer(&e.payer.pubkey(), &e.vault, 10 * SOL);
    e.send(&[fund]).unwrap();
    assert_eq!(u32::from_le_bytes(e.vault_data()[152..156].try_into().unwrap()), 0);
    let destination = Pubkey::new_unique();
    let before = e.lamports(&e.vault);
    let w = e.sol(destination, 2 * SOL, 0, 2);
    let payload = e.announce_payload(&w);
    let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
    let proof = e.stage(1, &message);
    let announce = e.announce_ix(&payload, proof, &root(1), &w.next);
    // Execution alone, before any announcement, does nothing.
    assert!(e.execute(destination).is_err());
    // A different recipient in the same transaction fails the whole thing.
    let thief = Pubkey::new_unique();
    let steal = e.execute_ix(thief, vec![]);
    assert!(e.send(&[announce.clone(), steal]).is_err());
    assert_eq!((e.lamports(&e.vault), e.pending(), e.spent(&root(1))), (before, false, false));
    let execute = e.execute_ix(destination, vec![]);
    e.send(&[announce.clone(), execute]).unwrap();
    assert_eq!(e.lamports(&destination), 2 * SOL);
    assert_eq!(e.lamports(&e.vault), before - 2 * SOL);
    assert!(!e.pending());
    assert_eq!((e.op_index(), e.op_root()), (1, root(2)));
    assert!(e.spent(&root(1)));
    // Still exactly once, still not replayable, still not without the key.
    assert!(e.execute(destination).is_err());
    assert!(e.send(&[announce]).is_err());
    let again = e.sol(destination, SOL, 1, 3);
    assert!(e.announce(55, &again).is_err());
    assert_eq!(e.lamports(&destination), 2 * SOL);
    // Recovery still works on such a vault.
    e.recover(100, 0, 101, 10).unwrap();
    assert_eq!(e.epoch(), 1);
}

#[test]
fn execution_window_closes_and_expiry_keeps_the_authority() {
    let mut e = Env::new();
    e.init();
    let destination = Pubkey::new_unique();
    let w = e.sol(destination, SOL, 0, 2);
    e.announce(1, &w).unwrap();
    let deadline = T0 + DAY + WINDOW;
    e.set_time(deadline);
    assert!(e.expire().is_err(), "not expired at the deadline itself");
    e.set_time(deadline + 1);
    assert!(e.execute(destination).is_err(), "one second past the deadline");
    assert_eq!(e.lamports(&destination), 0);
    e.expire().unwrap();
    assert!(!e.pending());
    assert!(e.expire().is_err());
    // The rotated operational key still works: expiry strands nothing.
    let mut again = e.sol(destination, SOL, 1, 3);
    again.announce_by = deadline + 3600;
    e.announce(2, &again).unwrap();
    assert_eq!(e.op_index(), 2);
}

#[test]
fn execution_at_the_deadline_second_succeeds() {
    let mut e = Env::new();
    e.init();
    let destination = Pubkey::new_unique();
    let w = e.sol(destination, SOL, 0, 2);
    e.announce(1, &w).unwrap();
    e.set_time(T0 + DAY + WINDOW);
    e.execute(destination).unwrap();
    assert_eq!(e.lamports(&destination), SOL);
}

#[test]
fn only_the_current_operational_key_can_announce() {
    let mut e = Env::new();
    e.init();
    let destination = Pubkey::new_unique();
    let w = e.sol(destination, SOL, 0, 2);
    // Signed by a key that is not the vault's operational key.
    assert!(e.announce(55, &w).is_err());
    // Signed by the recovery key: wrong role.
    assert!(e.announce(100, &w).is_err());
    assert!(!e.pending() && !e.spent(&root(1)));
    // A valid signature, then one byte of the payload changed after signing.
    let payload = e.announce_payload(&w);
    let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
    let proof = e.stage(1, &message);
    for offset in [2usize, 34, 66, 74, 82, 115, 147, 155, 163] {
        let mut altered = payload.clone();
        altered[offset] ^= 1;
        let ix = e.announce_ix(&altered, proof, &root(1), &w.next);
        assert!(e.send(&[ix]).is_err(), "altered payload byte {offset}");
    }
    assert!(!e.pending());
    let ix = e.announce_ix(&payload, proof, &root(1), &w.next);
    e.send(&[ix]).unwrap();
    assert!(e.pending());
}

#[test]
fn announce_respects_its_deadline_and_the_single_pending_slot() {
    let mut e = Env::new();
    e.init();
    let destination = Pubkey::new_unique();
    let w = e.sol(destination, SOL, 0, 2);
    e.set_time(T0 + 3601);
    assert!(e.announce(1, &w).is_err(), "after announce_by");
    assert!(!e.spent(&root(1)), "a rejected announcement retires nothing on-chain");
    e.set_time(T0 + 3600);
    let payload = e.announce_payload(&w);
    let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
    let proof = e.proof(&hashv(&[&message]).to_bytes());
    let ix = e.announce_ix(&payload, proof, &root(1), &w.next);
    e.send(&[ix]).unwrap();
    let second = e.sol(destination, SOL, 1, 3);
    assert!(e.announce(2, &second).is_err(), "one pending withdrawal at a time");
    assert_eq!(e.op_index(), 1);
}

#[test]
fn a_spent_operational_signature_cannot_be_replayed() {
    let mut e = Env::new();
    e.init();
    let destination = Pubkey::new_unique();
    let w = e.sol(destination, SOL, 0, 2);
    let payload = e.announce_payload(&w);
    let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
    let proof = e.stage(1, &message);
    let ix = e.announce_ix(&payload, proof, &root(1), &w.next);
    e.send(&[ix.clone()]).unwrap();
    e.set_time(T0 + DAY);
    e.execute(destination).unwrap();
    assert!(e.send(&[ix]).is_err(), "the same announcement cannot land twice");
    assert_eq!(e.lamports(&destination), SOL);
}

#[test]
fn recovery_cancels_a_pending_withdrawal_and_retires_both_roots() {
    let mut e = Env::new();
    e.init();
    let destination = Pubkey::new_unique();
    let w = e.sol(destination, 3 * SOL, 0, 2);
    e.announce(1, &w).unwrap();
    let before = e.lamports(&e.vault);
    let meta = e.recover(100, 0, 101, 10).unwrap();
    println!("recover compute units: {}", meta.compute_units_consumed);
    assert_eq!(e.lamports(&e.vault), before, "recovery never debits the vault");
    assert!(!e.pending());
    assert_eq!((e.epoch(), e.op_index(), e.op_root()), (1, 0, root(10)));
    assert_eq!(&e.vault_data()[120..152], &root(101));
    assert!(e.spent(&root(100)), "used recovery root retired");
    assert!(e.spent(&root(2)), "displaced operational root retired though never used");
    // The cancelled withdrawal cannot execute, even once its window would have opened.
    e.set_time(T0 + DAY);
    assert!(e.execute(destination).is_err());
    assert_eq!(e.lamports(&destination), 0);
    // The displaced operational key has no authority in the new epoch.
    let mut stale = e.sol(destination, SOL, 0, 3);
    stale.announce_by = T0 + DAY + 3600;
    assert!(e.announce(2, &stale).is_err());
    // The new operational key does.
    e.announce(10, &stale).unwrap();
}

#[test]
fn recovery_works_when_idle_and_its_packet_is_bound_to_one_epoch() {
    let mut e = Env::new();
    e.init();
    let payload = e.recover_payload(0, root(101), root(10));
    let message = e.message(b"BUNKER3_RECOVER_", &payload);
    let proof = e.stage(100, &message);
    let ix = e.recover_ix(&payload, proof, &root(100), &root(1), &root(101), &root(10));
    e.send(&[ix.clone()]).unwrap();
    assert_eq!(e.epoch(), 1);
    assert!(e.send(&[ix]).is_err(), "the epoch-0 packet cannot apply to epoch 1");
    assert!(e.recover(101, 0, 102, 11).is_err(), "a packet naming the wrong epoch");
    e.recover(101, 1, 102, 11).unwrap();
    assert_eq!((e.epoch(), e.op_root()), (2, root(11)));
}

#[test]
fn recovery_needs_the_recovery_key() {
    let mut e = Env::new();
    e.init();
    assert!(e.recover(1, 0, 101, 10).is_err(), "signed by the operational key");
    assert!(e.recover(55, 0, 101, 10).is_err(), "signed by an unrelated key");
    assert_eq!(e.epoch(), 0);
    assert!(!e.spent(&root(100)) && !e.spent(&root(1)));
}

#[test]
fn proofs_do_not_cross_roles() {
    let mut e = Env::new();
    e.init();
    let destination = Pubkey::new_unique();
    // A valid recovery proof submitted as an announcement.
    let recover_payload = e.recover_payload(0, root(101), root(10));
    let recover_proof = e.stage(100, &e.message(b"BUNKER3_RECOVER_", &recover_payload));
    let w = e.sol(destination, SOL, 0, 2);
    let announce_payload = e.announce_payload(&w);
    let ix = e.announce_ix(&announce_payload, recover_proof, &root(1), &w.next);
    assert!(e.send(&[ix]).is_err());
    // A valid announcement proof submitted as a recovery.
    let announce_proof = e.stage(1, &e.message(b"BUNKER3_ANNOUNCE", &announce_payload));
    let ix = e.recover_ix(&recover_payload, announce_proof, &root(100), &root(1), &root(101), &root(10));
    assert!(e.send(&[ix]).is_err());
    assert_eq!((e.epoch(), e.pending()), (0, false));
}

#[test]
fn a_retired_root_can_never_be_installed_again() {
    let mut e = Env::new();
    e.init();
    let destination = Pubkey::new_unique();
    let w = e.sol(destination, SOL, 0, 2);
    e.announce(1, &w).unwrap(); // retires root 1
    e.set_time(T0 + DAY);
    e.execute(destination).unwrap();
    // As the next operational root of an announcement.
    let mut reuse = e.sol(destination, SOL, 1, 1);
    reuse.announce_by = T0 + DAY + 3600;
    assert!(e.announce(2, &reuse).is_err());
    // As either next root of a recovery.
    assert!(e.recover(100, 0, 101, 1).is_err());
    assert!(e.recover(100, 0, 1, 10).is_err());
    assert_eq!(e.epoch(), 0);
}

#[test]
fn execution_pays_only_the_recorded_destination() {
    let mut e = Env::new();
    e.init();
    let destination = Pubkey::new_unique();
    let w = e.sol(destination, SOL, 0, 2);
    e.announce(1, &w).unwrap();
    e.set_time(T0 + DAY);
    // An otherwise valid execution naming a different recipient account.
    let thief = Pubkey::new_unique();
    assert!(e.execute(thief).is_err());
    assert_eq!(e.lamports(&thief), 0);
    assert!(e.pending());
    e.execute(destination).unwrap();
    assert_eq!(e.lamports(&destination), SOL);
}

#[test]
fn execution_is_bound_to_the_recorded_destination_and_the_rent_reserve() {
    let mut e = Env::new();
    e.init();
    let destination = Pubkey::new_unique();
    let rent = e.svm.minimum_balance_for_rent_exemption(VAULT_LEN);
    let available = e.lamports(&e.vault) - rent;
    // One lamport more than the vault can release.
    let w = e.sol(destination, available + 1, 0, 2);
    e.announce(1, &w).unwrap();
    e.set_time(T0 + DAY);
    let thief = Pubkey::new_unique();
    assert!(e.execute(thief).is_err(), "a different destination account");
    assert_eq!(e.lamports(&thief), 0);
    assert!(e.execute(destination).is_err(), "would breach the vault's rent reserve");
    assert!(e.pending(), "a failed execution leaves the record retryable");
    // Top the vault up by one lamport and the same record now executes.
    let top_up = system_instruction::transfer(&e.payer.pubkey(), &e.vault, 1);
    e.send(&[top_up]).unwrap();
    e.execute(destination).unwrap();
    assert_eq!(e.lamports(&destination), available + 1);
    assert_eq!(e.lamports(&e.vault), rent);
}

#[test]
fn a_forged_vault_account_is_rejected() {
    let mut e = Env::new();
    e.init();
    // A program-owned account with valid-looking state at an address that is
    // not the PDA of its stored identity.
    let fake = Pubkey::new_unique();
    let mut data = e.vault_data();
    data[156] = 1;
    data[230..238].copy_from_slice(&T0.to_le_bytes());
    data[238..246].copy_from_slice(&(T0 + WINDOW).to_le_bytes());
    data[222..230].copy_from_slice(&SOL.to_le_bytes());
    let destination = Pubkey::new_unique();
    data[190..222].copy_from_slice(destination.as_ref());
    e.svm
        .set_account(fake, Account { lamports: 50 * SOL, data, owner: e.program, executable: false, rent_epoch: 0 })
        .unwrap();
    let ix = Instruction {
        program_id: e.program,
        accounts: vec![AccountMeta::new(fake, false), AccountMeta::new(destination, false)],
        data: vec![3u8],
    };
    assert!(e.send(&[ix]).is_err());
    assert_eq!(e.lamports(&destination), 0);
}

#[test]
fn proof_staging_is_append_only_and_only_its_payer_can_close_it() {
    let mut e = Env::new();
    e.init();
    let w = e.sol(Pubkey::new_unique(), SOL, 0, 2);
    let message = e.message(b"BUNKER3_ANNOUNCE", &e.announce_payload(&w));
    let proof = e.stage(1, &message);
    let stored = e.svm.get_account(&proof).unwrap();
    assert_eq!((stored.data.len(), &stored.data[..8]), (1162, &b"BKPROOF3"[..]));
    assert_eq!(u16::from_le_bytes(stored.data[72..74].try_into().unwrap()), 1088);
    let digest: [u8; 32] = stored.data[40..72].try_into().unwrap();
    let chunk = |offset: u16, bytes: &[u8]| Instruction {
        program_id: e.program,
        accounts: vec![
            AccountMeta::new(e.payer.pubkey(), true),
            AccountMeta::new(proof, false),
            AccountMeta::new_readonly(system(), false),
        ],
        data: [vec![1u8], digest.to_vec(), offset.to_le_bytes().to_vec(), bytes.to_vec()].concat(),
    };
    // Re-sending identical bytes is a safe retry; different bytes are refused.
    let same = chunk(0, &stored.data[74..174]);
    let different = chunk(0, &[0xAA; 100]);
    let overflow = chunk(1088, &[1]);
    e.send(&[same]).unwrap();
    assert!(e.send(&[different]).is_err());
    assert!(e.send(&[overflow]).is_err());
    assert_eq!(e.svm.get_account(&proof).unwrap().data, stored.data);
    // Someone else cannot reclaim it.
    let stranger = Keypair::new();
    e.svm.airdrop(&stranger.pubkey(), SOL).unwrap();
    let steal = Instruction {
        program_id: e.program,
        accounts: vec![AccountMeta::new(proof, false), AccountMeta::new(stranger.pubkey(), true)],
        data: vec![6u8],
    };
    assert!(e.send_as(&stranger, &[steal]).is_err());
    assert!(e.svm.get_account(&proof).is_some_and(|a| a.lamports > 0));
}

#[test]
fn unknown_instructions_and_stray_bytes_are_rejected() {
    let mut e = Env::new();
    e.init();
    for data in [vec![], vec![7u8], vec![255u8], vec![3u8, 0], vec![4u8, 0]] {
        let ix = Instruction {
            program_id: e.program,
            accounts: vec![AccountMeta::new(e.vault, false), AccountMeta::new(Pubkey::new_unique(), false)],
            data,
        };
        assert!(e.send(&[ix]).is_err());
    }
}

fn mint_data(decimals: u8) -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[36..44].copy_from_slice(&1_000_000u64.to_le_bytes());
    d[44] = decimals;
    d[45] = 1;
    d
}
fn token_data(mint: &Pubkey, owner: &Pubkey, amount: u64, frozen: bool) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = if frozen { 2 } else { 1 };
    d
}
fn token_amount(e: &Env, account: &Pubkey) -> u64 {
    u64::from_le_bytes(e.svm.get_account(account).unwrap().data[64..72].try_into().unwrap())
}

#[test]
fn classic_token_withdrawal_waits_executes_once_and_survives_a_frozen_destination() {
    let mut e = Env::new();
    e.init();
    let (mint, source, destination, owner) =
        (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
    let put = |e: &mut Env, key: Pubkey, data: Vec<u8>| {
        let lamports = e.svm.minimum_balance_for_rent_exemption(data.len());
        e.svm
            .set_account(key, Account { lamports, data, owner: token_program(), executable: false, rent_epoch: 0 })
            .unwrap();
    };
    let vault = e.vault;
    put(&mut e, mint, mint_data(6));
    put(&mut e, source, token_data(&mint, &vault, 900, false));
    put(&mut e, destination, token_data(&mint, &owner, 0, true));
    let w = Withdrawal {
        epoch: 0,
        index: 0,
        kind: 1,
        mint: mint.to_bytes(),
        destination,
        amount: 400,
        announce_by: T0 + 3600,
        next: root(2),
    };
    e.announce(1, &w).unwrap();
    let extra = |source: Pubkey, mint: Pubkey| {
        vec![
            AccountMeta::new(source, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(token_program(), false),
        ]
    };
    let ix = e.execute_ix(destination, extra(source, mint));
    assert!(e.send(&[ix.clone()]).is_err(), "before the wait");
    e.set_time(T0 + DAY);
    assert!(e.send(&[ix.clone()]).is_err(), "destination is frozen");
    assert!(e.pending(), "still retryable");
    assert_eq!(token_amount(&e, &source), 900);
    // The issuer thaws the destination; the same record then executes.
    put(&mut e, destination, token_data(&mint, &owner, 0, false));
    // A different mint account is refused.
    let other_mint = Pubkey::new_unique();
    put(&mut e, other_mint, mint_data(6));
    let wrong = e.execute_ix(destination, extra(source, other_mint));
    assert!(e.send(&[wrong]).is_err());
    e.send(&[ix.clone()]).unwrap();
    assert_eq!((token_amount(&e, &source), token_amount(&e, &destination)), (500, 400));
    assert!(e.send(&[ix]).is_err(), "at most once");
    assert_eq!(token_amount(&e, &destination), 400);
}

/// Every way of handing `execute` the wrong token accounts fails and leaves
/// the record and both balances untouched.
#[test]
fn a_token_withdrawal_accepts_only_the_recorded_mint_destination_and_a_clean_vault_source() {
    let mut e = Env::new();
    e.init();
    let (mint, source, destination, owner) =
        (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
    let put_as = |e: &mut Env, key: Pubkey, data: Vec<u8>, program: Pubkey| {
        let lamports = e.svm.minimum_balance_for_rent_exemption(data.len());
        e.svm
            .set_account(key, Account { lamports, data, owner: program, executable: false, rent_epoch: 0 })
            .unwrap();
    };
    let put = |e: &mut Env, key: Pubkey, data: Vec<u8>| put_as(e, key, data, token_program());
    let vault = e.vault;
    put(&mut e, mint, mint_data(6));
    put(&mut e, source, token_data(&mint, &vault, 900, false));
    put(&mut e, destination, token_data(&mint, &owner, 0, false));
    let w = Withdrawal {
        epoch: 0,
        index: 0,
        kind: 1,
        mint: mint.to_bytes(),
        destination,
        amount: 400,
        announce_by: T0 + 3600,
        next: root(2),
    };
    e.announce(1, &w).unwrap();
    e.set_time(T0 + DAY);
    let accounts = |source: Pubkey, mint: Pubkey, program: Pubkey| {
        vec![
            AccountMeta::new(source, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(program, false),
        ]
    };
    let other_mint = Pubkey::new_unique();
    put(&mut e, other_mint, mint_data(6));
    // Sources that are not a plain token account of the vault for this mint.
    let strangers = Pubkey::new_unique();
    put(&mut e, strangers, token_data(&mint, &owner, 900, false));
    let wrong_mint = Pubkey::new_unique();
    put(&mut e, wrong_mint, token_data(&other_mint, &vault, 900, false));
    let delegated = Pubkey::new_unique();
    let mut d = token_data(&mint, &vault, 900, false);
    d[72..76].copy_from_slice(&1u32.to_le_bytes());
    d[76..108].copy_from_slice(owner.as_ref());
    d[121..129].copy_from_slice(&900u64.to_le_bytes());
    put(&mut e, delegated, d);
    let closable = Pubkey::new_unique();
    let mut d = token_data(&mint, &vault, 900, false);
    d[129..133].copy_from_slice(&1u32.to_le_bytes());
    d[133..165].copy_from_slice(owner.as_ref());
    put(&mut e, closable, d);
    // The right bytes under the wrong program.
    let imitation = Pubkey::new_unique();
    put_as(&mut e, imitation, token_data(&mint, &vault, 900, false), system());
    // Destinations other than the recorded one.
    let elsewhere = Pubkey::new_unique();
    put(&mut e, elsewhere, token_data(&mint, &owner, 0, false));
    let attempts = [
        ("source owned by someone else", e.execute_ix(destination, accounts(strangers, mint, token_program()))),
        ("source of another mint", e.execute_ix(destination, accounts(wrong_mint, mint, token_program()))),
        ("source with a delegate", e.execute_ix(destination, accounts(delegated, mint, token_program()))),
        ("source with a close authority", e.execute_ix(destination, accounts(closable, mint, token_program()))),
        ("source not owned by the token program", e.execute_ix(destination, accounts(imitation, mint, token_program()))),
        ("source equal to destination", e.execute_ix(destination, accounts(destination, mint, token_program()))),
        ("another mint account", e.execute_ix(destination, accounts(source, other_mint, token_program()))),
        ("another program in place of the token program", e.execute_ix(destination, accounts(source, mint, system()))),
        ("a destination that was not recorded", e.execute_ix(elsewhere, accounts(source, mint, token_program()))),
        ("no token accounts at all", e.execute_ix(destination, vec![])),
        ("an extra account", e.execute_ix(destination, [accounts(source, mint, token_program()), vec![AccountMeta::new_readonly(owner, false)]].concat())),
    ];
    for (what, ix) in attempts {
        assert!(e.send(&[ix]).is_err(), "{what}");
        assert!(e.pending(), "{what}: the record must survive");
        assert_eq!((token_amount(&e, &source), token_amount(&e, &destination)), (900, 0), "{what}");
    }
    // A destination whose mint differs from the record's cannot receive it.
    put(&mut e, destination, token_data(&other_mint, &owner, 0, false));
    let ix = e.execute_ix(destination, accounts(source, mint, token_program()));
    assert!(e.send(&[ix.clone()]).is_err(), "destination of another mint");
    put(&mut e, destination, token_data(&mint, &owner, 0, false));
    // More than the source holds: the token program refuses, the record stays.
    put(&mut e, source, token_data(&mint, &vault, 399, false));
    assert!(e.send(&[ix.clone()]).is_err(), "insufficient token balance");
    assert!(e.pending());
    put(&mut e, source, token_data(&mint, &vault, 900, false));
    e.send(&[ix]).unwrap();
    assert_eq!((token_amount(&e, &source), token_amount(&e, &destination), e.pending()), (500, 400, false));
}
