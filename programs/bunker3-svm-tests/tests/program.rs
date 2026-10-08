//! Runs the compiled protocol-3 program (`target/deploy/bunker3.so`) in an
//! in-process Solana VM with a controllable clock. Build it first:
//!   cargo-build-sbf --manifest-path programs/bunker3/Cargo.toml --sbf-out-dir target/deploy
//!   cargo-build-sbf --manifest-path programs/bunker3-cpi-probe/Cargo.toml --sbf-out-dir target/deploy
//! (`npm run program:build` does both.)
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
mod common;
use common::{identifier, root, sign_in, sign_under, PROOF_LEN, SIGNATURE_LEN, STEP_LIMIT, VAULT_LEN};

const T0: i64 = 1_800_000_000;
const DAY: i64 = 86_400;
/// The execution window of a vault with a one-day waiting period.
const WINDOW: i64 = 86_400;
const MAX_DELAY: u32 = 604_800;
/// Decimal places of every test mint.
const TOKEN_DECIMALS: u8 = 6;
const SOL: u64 = 1_000_000_000;
/// What the reference client requests (`computeIx` in sdk/v3/protocol.ts).
const COMPUTE_LIMIT: u32 = 800_000;

fn system() -> Pubkey {
    Pubkey::default()
}
fn probe_id() -> Pubkey {
    Pubkey::new_from_array([0xC1; 32])
}
/// The same instruction, sent to the forwarding program so that it reaches
/// the vault program by cross-program invocation.
fn through_probe(ix: &Instruction) -> Instruction {
    Instruction {
        program_id: probe_id(),
        accounts: [vec![AccountMeta::new_readonly(ix.program_id, false)], ix.accounts.clone()].concat(),
        data: ix.data.clone(),
    }
}
fn token_program() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
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
    /// Trusted wallets the next vault is created with. Unused slots are zero.
    trusted: [[u8; 32]; 4],
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
        let program = Pubkey::new_from_array(common::PROGRAM);
        let so = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/bunker3.so");
        svm.add_program_from_file(program, so)
            .expect("build bunker3.so first (see the header of this file)");
        // A test-only program that forwards an instruction by cross-program invocation.
        let probe = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/bunker3_cpi_probe.so");
        svm.add_program_from_file(probe_id(), probe)
            .expect("build bunker3_cpi_probe.so first: cargo-build-sbf --manifest-path programs/bunker3-cpi-probe/Cargo.toml --sbf-out-dir target/deploy");
        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100 * SOL).unwrap();
        let mut env = Self { svm, program, payer, salt: common::SALT, id: [0; 32], chain: common::CHAIN, vault: Pubkey::default(), trusted: [[0; 32]; 4] };
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
            data: [vec![2u8], COMPUTE_LIMIT.to_le_bytes().to_vec()].concat(),
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
        [salt.to_vec(), self.chain.to_vec(), op.to_vec(), rec.to_vec(), delay.to_le_bytes().to_vec(), self.trusted.concat()].concat()
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
        d.push(if w.kind == 1 { TOKEN_DECIMALS } else { 0 });
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
        let bytes = sign_in(&self.salt, tag, message);
        self.stage_bytes(&bytes, message)
    }
    /// Uploads an arbitrary signature for `message`.
    fn stage_bytes(&mut self, bytes: &[u8], message: &[u8]) -> Pubkey {
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
            ]
            .into_iter()
            // A token announcement also names its mint.
            .chain((payload[82] == 1).then(|| {
                AccountMeta::new_readonly(Pubkey::new_from_array(payload[83..115].try_into().unwrap()), false)
            }))
            .collect(),
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
    fn recover_ix(&self, payload: &[u8], proof: Pubkey, rec: &[u8; 32], next_rec: &[u8; 32], next_op: &[u8; 32]) -> Instruction {
        Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(self.vault, false),
                AccountMeta::new_readonly(proof, false),
                AccountMeta::new(self.payer.pubkey(), true),
                AccountMeta::new(self.marker(rec), false),
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
        let ix = self.recover_ix(&payload, proof, &rec, &next_rec, &next_op);
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
    assert!(d[287..415].iter().all(|b| *b == 0), "no trusted wallets");
    assert_eq!(&d[415..447], &e.salt, "the salt, which names the signer");
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
        (root(1), root(100), MAX_DELAY + 1),
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
fn recovery_cancels_a_pending_withdrawal_and_retires_only_the_root_that_signed() {
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
    assert!(!e.spent(&root(2)), "the displaced operational root signed nothing and is not marked");
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
    let ix = e.recover_ix(&payload, proof, &root(100), &root(101), &root(10));
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
    let ix = e.recover_ix(&recover_payload, announce_proof, &root(100), &root(101), &root(10));
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
    assert_eq!((stored.data.len(), &stored.data[..8]), (PROOF_LEN, &b"BKPROOF3"[..]));
    assert_eq!(u16::from_le_bytes(stored.data[72..74].try_into().unwrap()) as usize, SIGNATURE_LEN);
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
    let overflow = chunk(SIGNATURE_LEN as u16, &[1]);
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

/// A token announcement is refused unless its mint is a classic mint with the
/// decimal places the signer stated. Nothing is recorded and no key is retired.
#[test]
fn a_token_announcement_is_checked_against_its_mint() {
    let mut e = Env::new();
    e.init();
    let (mint, destination) = (Pubkey::new_unique(), Pubkey::new_unique());
    let put = |e: &mut Env, key: Pubkey, data: Vec<u8>, program: Pubkey| {
        let lamports = e.svm.minimum_balance_for_rent_exemption(data.len());
        e.svm
            .set_account(key, Account { lamports, data, owner: program, executable: false, rent_epoch: 0 })
            .unwrap();
    };
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
    // Signs `payload` with the current key and announces with `accounts` after the usual six.
    let attempt = |e: &mut Env, payload: Vec<u8>, extra: Vec<AccountMeta>| {
        let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
        let proof = e.stage(1, &message);
        let mut ix = e.announce_ix(&payload, proof, &root(1), &root(2));
        ix.accounts.truncate(6);
        ix.accounts.extend(extra);
        let result = e.send(&[ix]);
        // Free the proof address for the next attempt with other bytes.
        let close = Instruction {
            program_id: e.program,
            accounts: vec![AccountMeta::new(proof, false), AccountMeta::new(e.payer.pubkey(), true)],
            data: vec![6u8],
        };
        e.send(&[close]).unwrap();
        result
    };
    let named = |key: Pubkey| vec![AccountMeta::new_readonly(key, false)];
    let good = e.announce_payload(&w);
    // No mint account exists yet.
    assert!(attempt(&mut e, good.clone(), named(mint)).is_err(), "a mint that does not exist");
    // The right bytes under another program, as a Token-2022 mint would be.
    put(&mut e, mint, mint_data(TOKEN_DECIMALS), Pubkey::new_unique());
    assert!(attempt(&mut e, good.clone(), named(mint)).is_err(), "a mint owned by another program");
    put(&mut e, mint, mint_data(TOKEN_DECIMALS), token_program());
    // The signer believed a different number of decimal places.
    let mut wrong = good.clone();
    wrong[195] = TOKEN_DECIMALS + 3;
    assert!(attempt(&mut e, wrong, named(mint)).is_err(), "decimals that are not the mint's");
    // The mint account left out, replaced, or followed by another.
    assert!(attempt(&mut e, good.clone(), vec![]).is_err(), "no mint account");
    let other = Pubkey::new_unique();
    put(&mut e, other, mint_data(TOKEN_DECIMALS), token_program());
    assert!(attempt(&mut e, good.clone(), named(other)).is_err(), "another mint's account");
    assert!(attempt(&mut e, good.clone(), [named(mint), named(other)].concat()).is_err(), "an extra account");
    // A token account is not a mint.
    let account = Pubkey::new_unique();
    let vault = e.vault;
    put(&mut e, account, token_data(&mint, &vault, 900, false), token_program());
    let mut as_mint = w.clone();
    as_mint.mint = account.to_bytes();
    let payload = e.announce_payload(&as_mint);
    assert!(attempt(&mut e, payload, named(account)).is_err(), "a token account named as the mint");
    assert!(!e.pending() && !e.spent(&root(1)) && e.op_index() == 0);
    // SOL takes no seventh account.
    let sol = e.sol(destination, SOL, 0, 2);
    let payload = e.announce_payload(&sol);
    assert!(attempt(&mut e, payload, named(mint)).is_err(), "SOL with a mint account");
    // And the correct announcement lands.
    assert!(attempt(&mut e, good, named(mint)).is_ok());
    assert!(e.pending() && e.spent(&root(1)));
}


/// For a token, "trusted" means the trusted wallet's associated token account
/// for that mint and nothing else: another token account the same wallet owns
/// is an address someone else could have chosen, and waits like any stranger's.
#[test]
fn a_token_withdrawal_is_instant_only_to_a_trusted_wallets_associated_account() {
    let mut e = Env::new();
    let wallet = Pubkey::new_unique();
    e.trusted[0] = wallet.to_bytes();
    let ix = e.init_ix(root(1), root(100), DAY as u32);
    e.send(&[ix]).unwrap();
    let put = |e: &mut Env, key: Pubkey, data: Vec<u8>| {
        let lamports = e.svm.minimum_balance_for_rent_exemption(data.len());
        e.svm
            .set_account(key, Account { lamports, data, owner: token_program(), executable: false, rent_epoch: 0 })
            .unwrap();
    };
    let (mint, source) = (Pubkey::new_unique(), Pubkey::new_unique());
    let associated = Pubkey::find_program_address(
        &[wallet.as_ref(), token_program().as_ref(), mint.as_ref()],
        &Pubkey::from_str("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL").unwrap(),
    )
    .0;
    let other_account_of_wallet = Pubkey::new_unique();
    let vault = e.vault;
    put(&mut e, mint, mint_data(TOKEN_DECIMALS));
    put(&mut e, source, token_data(&mint, &vault, 900, false));
    put(&mut e, associated, token_data(&mint, &wallet, 0, false));
    put(&mut e, other_account_of_wallet, token_data(&mint, &wallet, 0, false));
    let to = |destination: Pubkey, index: u64, next: u32| Withdrawal {
        epoch: 0,
        index,
        kind: 1,
        mint: mint.to_bytes(),
        destination,
        amount: 100,
        announce_by: T0 + 3600,
        next: root(next),
    };
    let accounts = vec![
        AccountMeta::new(source, false),
        AccountMeta::new_readonly(mint, false),
        AccountMeta::new_readonly(token_program(), false),
    ];
    // The associated account: opens at once.
    e.announce(1, &to(associated, 0, 2)).unwrap();
    let ix = e.execute_ix(associated, accounts.clone());
    e.send(&[ix]).unwrap();
    assert_eq!((token_amount(&e, &associated), e.pending()), (100, false));
    // Another account of the same wallet: waits the full period.
    e.announce(2, &to(other_account_of_wallet, 1, 3)).unwrap();
    let ix = e.execute_ix(other_account_of_wallet, accounts.clone());
    assert!(e.send(&[ix.clone()]).is_err(), "not the associated account: waits");
    let d = e.vault_data();
    assert_eq!(i64::from_le_bytes(d[230..238].try_into().unwrap()), T0 + DAY);
    e.set_time(T0 + DAY);
    e.send(&[ix]).unwrap();
    assert_eq!(token_amount(&e, &other_account_of_wallet), 100);
}

/// The compiled program returns the documented refusal code for each outcome a
/// person can act on, so a client can say why instead of "it failed".
#[test]
fn the_program_says_why_it_refused() {
    fn code(r: TransactionResult) -> String {
        format!("{:?}", r.expect_err("expected a refusal").err)
    }
    let refused = |r: TransactionResult, n: u32, what: &str| {
        let got = code(r);
        assert!(got.contains(&format!("Custom({n})")), "{what}: expected code {n}, got {got}");
    };
    let mut e = Env::new();
    e.init();
    let destination = Pubkey::new_unique();
    let r = e.execute(destination);
    refused(r, 120, "nothing pending");
    let r = e.expire();
    refused(r, 120, "nothing to clear");
    // A key generation the vault is not on.
    let r = e.recover(100, 1, 101, 10);
    refused(r, 140, "a packet for another generation");
    // A deadline already passed, and one too far ahead.
    let mut late = e.sol(destination, SOL, 0, 2);
    late.announce_by = T0 - 1;
    let r = e.announce(1, &late);
    refused(r, 112, "announced too late");
    let mut far = e.sol(destination, SOL, 0, 2);
    far.announce_by = T0 + 2 * DAY;
    let r = e.announce(1, &far);
    refused(r, 113, "deadline too far ahead");
    // An announcement lands; then the waiting-state refusals.
    let w = e.sol(destination, SOL, 0, 2);
    e.announce(1, &w).unwrap();
    let r = e.execute(destination);
    refused(r, 121, "before the wait is over");
    let r = e.expire();
    refused(r, 130, "not expired yet");
    let again = e.sol(destination, SOL, 1, 3);
    let r = e.announce(2, &again);
    refused(r, 111, "one already pending");
    let stale = e.sol(destination, SOL, 0, 3);
    let r = e.announce(2, &stale);
    refused(r, 110, "an index already used");
    e.set_time(T0 + DAY);
    let r = e.execute(Pubkey::new_unique());
    refused(r, 123, "a destination that was not announced");
    e.set_time(T0 + DAY + WINDOW + 1);
    let r = e.execute(destination);
    refused(r, 122, "past the window");
    e.expire().unwrap();
    // A next root that has already signed.
    let mut reuse = e.sol(destination, SOL, 1, 1);
    reuse.announce_by = T0 + DAY + WINDOW + 3600;
    let r = e.announce(2, &reuse);
    refused(r, 114, "a next root that already signed");
    // More than the vault can pay while keeping its reserve.
    let mut all = e.sol(destination, 0, 1, 3);
    all.amount = e.lamports(&e.vault);
    all.announce_by = T0 + DAY + WINDOW + 3600;
    e.announce(2, &all).unwrap();
    e.set_time(T0 + 3 * DAY + WINDOW);
    let r = e.execute(destination);
    refused(r, 124, "below the rent reserve");
}

/// The identifier a signature is checked under comes from the vault, not
/// from the signer: the right key at any other position is refused.
#[test]
fn a_signature_is_bound_to_the_role_generation_and_index_of_its_key() {
    let mut e = Env::new();
    e.init();
    let w = e.sol(Pubkey::new_unique(), SOL, 0, 2);
    let payload = e.announce_payload(&w);
    let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
    let (chain, salt) = (e.chain, e.salt);
    let id = |role, epoch, index| identifier(&common::PROGRAM, &chain, &salt, role, epoch, index);
    let right = id(1, 0, 0);
    for (what, id, q) in [
        ("another index", id(1, 0, 1), 0u32),
        ("the recovery role", id(2, 0, 0), 0),
        ("another generation", id(1, 1, 0), 0),
        ("another salt", identifier(&common::PROGRAM, &e.chain, &[8; 32], 1, 0, 0), 0),
        ("another chain", identifier(&common::PROGRAM, &[10; 32], &e.salt, 1, 0, 0), 0),
        ("another program", identifier(&[0xB4; 32], &e.chain, &e.salt, 1, 0, 0), 0),
        ("a nonzero q", right, 1),
    ] {
        let proof = e.stage_bytes(&sign_under(&id, q, 1, &message, STEP_LIMIT), &message);
        let ix = e.announce_ix(&payload, proof, &root(1), &w.next);
        assert!(e.send(&[ix]).is_err(), "signed under {what}");
    }
    assert!(!e.pending() && !e.spent(&root(1)));
    let proof = e.stage_bytes(&sign_under(&right, 0, 1, &message, STEP_LIMIT), &message);
    let ix = e.announce_ix(&payload, proof, &root(1), &w.next);
    e.send(&[ix]).unwrap();
}

/// A correct signature that would take more chain steps than the limit is
/// refused, so verification has a ceiling whatever the signer chose.
#[test]
fn verification_cost_is_bounded() {
    use bunker_lmots::{digits, message_hash, signer};
    let mut e = Env::new();
    e.init();
    let w = e.sol(Pubkey::new_unique(), SOL, 0, 2);
    let payload = e.announce_payload(&w);
    let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
    let id = identifier(&common::PROGRAM, &e.chain, &e.salt, 1, 0, 0);
    let parts: [&[u8]; 4] = [&message, &[], &[], &[]];
    let steps = |c: &[u8; 32]| digits(&message_hash(&id, 0, c, parts)).1;
    let randomizer = |n: u32| hashv(&[b"cost", &n.to_le_bytes()]).to_bytes();
    // The costliest signature the program accepts, and the cheapest it refuses,
    // among a few thousand randomizers.
    let (mut best, mut over) = (None::<[u8; 32]>, None::<[u8; 32]>);
    for n in 0..4000 {
        let c = randomizer(n);
        let s = steps(&c);
        if s <= STEP_LIMIT && best.is_none_or(|b| s > steps(&b)) {
            best = Some(c);
        }
        if s > STEP_LIMIT && over.is_none_or(|o| s < steps(&o)) {
            over = Some(c);
        }
    }
    let (best, over) = (best.unwrap(), over.unwrap());
    // The step count only takes the values 255 * (h + 2): the limit itself, then 255 more.
    assert_eq!((steps(&best), steps(&over)), (STEP_LIMIT, STEP_LIMIT + 255));
    let sign = |c: &[u8; 32]| signer::sign(&id, 0, &common::secret(1), c, parts).to_vec();

    let proof = e.stage_bytes(&sign(&over), &message);
    let ix = e.announce_ix(&payload, proof, &root(1), &w.next);
    let refused = e.send(&[ix]).unwrap_err();
    assert!(!e.pending());
    // Refused before any chain is walked.
    assert!(refused.meta.compute_units_consumed < 40_000, "{}", refused.meta.compute_units_consumed);

    let proof = e.stage_bytes(&sign(&best), &message);
    let ix = e.announce_ix(&payload, proof, &root(1), &w.next);
    let meta = e.send(&[ix]).unwrap();
    println!("announce at {} of {STEP_LIMIT} steps: {} compute units", steps(&best), meta.compute_units_consumed);
    assert!(meta.compute_units_consumed < 700_000, "{}", meta.compute_units_consumed);
    assert!(e.pending());

    // The same for recovery, which checks one more marker.
    let (next_rec, next_op) = (root(101), root(10));
    let payload = e.recover_payload(0, next_rec, next_op);
    let message = e.message(b"BUNKER3_RECOVER_", &payload);
    let proof = e.stage_bytes(&common::sign_at_limit(&e.salt, 100, &message), &message);
    let ix = e.recover_ix(&payload, proof, &root(100), &next_rec, &next_op);
    let meta = e.send(&[ix]).unwrap();
    println!("recover at {STEP_LIMIT} of {STEP_LIMIT} steps: {} compute units", meta.compute_units_consumed);
    assert!(meta.compute_units_consumed < 700_000, "{}", meta.compute_units_consumed);
}

/// Anything that is not a well-formed signature of the one parameter set.
#[test]
fn a_malformed_signature_is_refused() {
    let mut e = Env::new();
    e.init();
    let w = e.sol(Pubkey::new_unique(), SOL, 0, 2);
    let payload = e.announce_payload(&w);
    let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
    let good = sign_in(&e.salt, 1, &message);
    assert_eq!((good.len(), &good[..4]), (SIGNATURE_LEN, &[0u8, 0, 0, 4][..]));
    let mut cases = Vec::new();
    for typecode in [[0u8, 0, 0, 3], [0, 0, 0, 0], [4, 0, 0, 0], [0, 0, 0, 8]] {
        let mut bad = good.clone();
        bad[..4].copy_from_slice(&typecode);
        cases.push(bad);
    }
    for at in [4usize, 35, 36, 67, 68, 600, SIGNATURE_LEN - 1] {
        let mut bad = good.clone();
        bad[at] ^= 0x80;
        cases.push(bad);
    }
    for bad in cases {
        let proof = e.stage_bytes(&bad, &message);
        let ix = e.announce_ix(&payload, proof, &root(1), &w.next);
        assert!(e.send(&[ix]).is_err());
    }
    assert!(!e.pending() && !e.spent(&root(1)));
    let proof = e.stage_bytes(&good, &message);
    let ix = e.announce_ix(&payload, proof, &root(1), &w.next);
    e.send(&[ix]).unwrap();
}

/// The operation index is 64 bits all the way through: a key far past 2^32
/// signs like any other, and only at the position it was made for.
#[test]
fn an_operation_index_beyond_32_bits_signs_like_any_other() {
    use bunker_lmots::signer::public_key;
    let mut e = Env::new();
    e.init();
    let index = (1u64 << 32) + 5;
    let (chain, salt) = (e.chain, e.salt);
    let id = |index| identifier(&common::PROGRAM, &chain, &salt, 1, 0, index);
    // Put the vault at that index, holding the key that belongs there.
    let key = public_key(&id(index), 0, &common::secret(1));
    let mut account = e.svm.get_account(&e.vault).unwrap();
    account.data[72..104].copy_from_slice(&key);
    account.data[104..112].copy_from_slice(&index.to_le_bytes());
    e.svm.set_account(e.vault, account).unwrap();

    let w = e.sol(Pubkey::new_unique(), SOL, index, 2);
    let payload = e.announce_payload(&w);
    let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
    // The same key signing as if the index had wrapped to 32 bits: refused.
    for wrong in [5u64, index - 1, index + 1] {
        let proof = e.stage_bytes(&sign_under(&id(wrong), 0, 1, &message, STEP_LIMIT), &message);
        let ix = e.announce_ix(&payload, proof, &key, &w.next);
        assert!(e.send(&[ix]).is_err(), "signed for index {wrong}");
    }
    let proof = e.stage_bytes(&sign_under(&id(index), 0, 1, &message, STEP_LIMIT), &message);
    let ix = e.announce_ix(&payload, proof, &key, &w.next);
    e.send(&[ix]).unwrap();
    assert_eq!(e.op_index(), index + 1);
    assert!(e.pending() && e.spent(&key));
}

/// The heaviest transaction the reference client builds, inside the compute
/// limit it requests: a token withdrawal to the last of four trusted wallets,
/// with the costliest signature the program accepts, creating the recipient's
/// token account, announcing, releasing and reclaiming the proof's deposit.
#[test]
fn the_heaviest_client_transaction_fits_the_requested_compute_limit() {
    let mut e = Env::new();
    let wallets: Vec<Pubkey> = (0..4).map(|_| Pubkey::new_unique()).collect();
    for (slot, wallet) in e.trusted.iter_mut().zip(&wallets) {
        *slot = wallet.to_bytes();
    }
    let ix = e.init_ix(root(1), root(100), DAY as u32);
    e.send(&[ix]).unwrap();
    let ata_program = Pubkey::from_str("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL").unwrap();
    let (mint, source, wallet) = (Pubkey::new_unique(), Pubkey::new_unique(), wallets[3]);
    let associated = Pubkey::find_program_address(&[wallet.as_ref(), token_program().as_ref(), mint.as_ref()], &ata_program).0;
    let vault = e.vault;
    for (key, data) in [(mint, mint_data(TOKEN_DECIMALS)), (source, token_data(&mint, &vault, 900, false))] {
        let lamports = e.svm.minimum_balance_for_rent_exemption(data.len());
        e.svm.set_account(key, Account { lamports, data, owner: token_program(), executable: false, rent_epoch: 0 }).unwrap();
    }
    let w = Withdrawal { epoch: 0, index: 0, kind: 1, mint: mint.to_bytes(), destination: associated, amount: 100, announce_by: T0 + 3600, next: root(2) };
    let payload = e.announce_payload(&w);
    let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
    let proof = e.stage_bytes(&common::sign_at_limit(&e.salt, 1, &message), &message);
    // Create the recipient's associated token account if it is missing.
    let create = Instruction {
        program_id: ata_program,
        accounts: vec![
            AccountMeta::new(e.payer.pubkey(), true),
            AccountMeta::new(associated, false),
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(system(), false),
            AccountMeta::new_readonly(token_program(), false),
        ],
        data: vec![1],
    };
    let announce = e.announce_ix(&payload, proof, &root(1), &w.next);
    let execute = e.execute_ix(
        associated,
        vec![AccountMeta::new(source, false), AccountMeta::new_readonly(mint, false), AccountMeta::new_readonly(token_program(), false)],
    );
    let close = Instruction {
        program_id: e.program,
        accounts: vec![AccountMeta::new(proof, false), AccountMeta::new(e.payer.pubkey(), true)],
        data: vec![6u8],
    };
    assert!(e.svm.get_account(&associated).is_none());
    let meta = e.send(&[create, announce, execute, close]).unwrap();
    println!("heaviest client transaction: {} of {COMPUTE_LIMIT} compute units", meta.compute_units_consumed);
    assert_eq!((token_amount(&e, &associated), e.pending(), e.spent(&root(1))), (100, false, true));
    // Room left for address searches that take more tries than these did.
    assert!(meta.compute_units_consumed < 700_000, "{}", meta.compute_units_consumed);
}

// ── Differential fuzzing of account handling ───────────────────────────────
//
// For each instruction, in a state where the honest instruction succeeds, many
// damaged copies are sent to a copy of the VM: accounts swapped for each
// other, for another vault's, for look-alikes owned by other programs, for
// unrelated addresses; accounts dropped, repeated or added; writable flags
// flipped; data bytes flipped, cut or extended. A damaged instruction may
// fail. If it succeeds, every account that matters must end exactly as the
// honest instruction leaves it. Fixed seed; not coverage-guided.

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}
type Snapshot = Vec<Option<(u64, Vec<u8>, Pubkey)>>;
impl Env {
    fn fork(&self) -> Env {
        Env {
            svm: self.svm.clone(),
            program: self.program,
            payer: self.payer.insecure_clone(),
            salt: self.salt,
            id: self.id,
            chain: self.chain,
            vault: self.vault,
            trusted: self.trusted,
        }
    }
    fn snapshot(&self, keys: &[Pubkey]) -> Snapshot {
        keys.iter().map(|k| self.svm.get_account(k).map(|a| (a.lamports, a.data, a.owner))).collect()
    }
    fn plant(&mut self, key: Pubkey, owner: Pubkey, data: Vec<u8>) {
        let lamports = self.svm.minimum_balance_for_rent_exemption(data.len()).max(1);
        self.svm.set_account(key, Account { lamports, data, owner, executable: false, rent_epoch: 0 }).unwrap();
    }
}
struct Case {
    name: &'static str,
    env: Env,
    honest: Instruction,
    /// Data bytes from this offset on are free-form for this instruction
    /// (the signature bytes of `stage`), so they are not damaged.
    data_limit: usize,
}
/// A second vault of the same program with a withdrawal pending, and
/// look-alike accounts, to substitute into the first vault's instructions.
fn decoys(e: &mut Env) -> Vec<Pubkey> {
    let mut other = e.fork();
    other.salt = [0x51; 32];
    let own = |tag| common::root_in(&[0x51; 32], tag);
    let ix = other.init_ix(own(1), own(100), 0);
    other.send(&[ix]).unwrap();
    let fund = system_instruction::transfer(&other.payer.pubkey(), &other.vault, 5 * SOL);
    other.send(&[fund]).unwrap();
    let mut w = other.sol(Pubkey::new_unique(), SOL, 0, 2);
    w.next = own(2);
    w.announce_by = i64::from_le_bytes(other.svm.get_sysvar::<Clock>().unix_timestamp.to_le_bytes()) + 600;
    other.announce(1, &w).unwrap();
    let other_vault = other.vault;
    let other_markers = [other.marker(&own(1)), other.marker(&own(2)), other.marker(&own(100))];
    e.svm = other.svm;
    // (A vault that does not exist yet has no bytes to copy; use its shape.)
    let vault_data = e.svm.get_account(&e.vault).map(|a| a.data).unwrap_or_else(|| [b"BUNKER03".to_vec(), vec![0; VAULT_LEN - 8]].concat());
    // The other vault's own destination is deliberately not offered: naming
    // that vault together with it is that vault's own valid release, which
    // anyone may send, and not a damaged form of this one.
    let mut out = vec![other_vault, system(), e.program, token_program(), e.payer.pubkey(), Pubkey::new_unique()];
    out.extend(other_markers);
    // Copies of this vault's bytes that the program does not own.
    for owner in [system(), token_program(), Pubkey::new_unique()] {
        let key = Pubkey::new_unique();
        e.plant(key, owner, vault_data.clone());
        out.push(key);
    }
    // A marker-shaped and a proof-shaped account owned by someone else.
    let (fake_marker, fake_proof) = (Pubkey::new_unique(), Pubkey::new_unique());
    e.plant(fake_marker, system(), b"BKSPENT3".to_vec());
    e.plant(fake_proof, Pubkey::new_unique(), [b"BKPROOF3".to_vec(), vec![0; PROOF_LEN - 8]].concat());
    out.extend([fake_marker, fake_proof]);
    out
}
fn damage(rng: &mut Rng, honest: &Instruction, pool: &[Pubkey], data_limit: usize, signers: [&Pubkey; 2]) -> Instruction {
    let mut ix = honest.clone();
    for _ in 0..1 + rng.below(2) {
        let n = ix.accounts.len();
        match rng.below(9) {
            // Another address in an account's place: from the pool, or from the instruction itself.
            0..=2 if n > 0 => {
                let at = rng.below(n);
                // Where a signature is wanted, usually offer a real one from someone else.
                ix.accounts[at].pubkey = if ix.accounts[at].is_signer && rng.below(3) > 0 { *signers[1] } else { pool[rng.below(pool.len())] };
            }
            3 if n > 1 => {
                let (a, b) = (rng.below(n), rng.below(n));
                let (ka, kb) = (ix.accounts[a].pubkey, ix.accounts[b].pubkey);
                if !ix.accounts[a].is_signer && !ix.accounts[b].is_signer {
                    ix.accounts[a].pubkey = kb;
                    ix.accounts[b].pubkey = ka;
                }
            }
            4 if n > 0 => {
                let at = rng.below(n);
                ix.accounts[at].is_writable = !ix.accounts[at].is_writable;
            }
            5 if n > 0 => {
                ix.accounts.remove(rng.below(n));
            }
            6 => {
                let extra = if rng.below(2) == 0 && n > 0 { ix.accounts[rng.below(n)].clone() } else { AccountMeta::new(pool[rng.below(pool.len())], false) };
                let at = rng.below(n + 1);
                ix.accounts.insert(at, AccountMeta { is_signer: false, ..extra });
            }
            7 => {
                let limit = ix.data.len().min(data_limit);
                if limit > 0 {
                    let at = rng.below(limit);
                    ix.data[at] ^= 1 << rng.below(8);
                }
            }
            _ => {
                if rng.below(2) == 0 && ix.data.len() > 1 && data_limit == usize::MAX {
                    let keep = 1 + rng.below(ix.data.len() - 1);
                    ix.data.truncate(keep);
                } else if data_limit == usize::MAX {
                    ix.data.push(rng.next() as u8);
                }
            }
        }
    }
    // Two signatures exist: the fee payer's and a stranger's. Nothing else can
    // be marked a signer.
    for account in &mut ix.accounts {
        account.is_signer &= signers.contains(&&account.pubkey);
    }
    ix
}
fn fuzz_cases() -> Vec<Case> {
    let mut cases = Vec::new();
    let all = usize::MAX;
    // initialize: a vault that does not exist yet.
    {
        let mut e = Env::new();
        let honest = e.init_ix(root(1), root(100), DAY as u32);
        cases.push(Case { name: "initialize", env: e, honest, data_limit: all });
    }
    // stage: the second chunk of a signature.
    {
        let mut e = Env::new();
        e.init();
        let w = e.sol(Pubkey::new_unique(), SOL, 0, 2);
        let message = e.message(b"BUNKER3_ANNOUNCE", &e.announce_payload(&w));
        let bytes = sign_in(&e.salt, 1, &message);
        let digest = hashv(&[&message]).to_bytes();
        let proof = e.proof(&digest);
        let chunk = |offset: usize, bytes: &[u8]| Instruction {
            program_id: e.program,
            accounts: vec![AccountMeta::new(e.payer.pubkey(), true), AccountMeta::new(proof, false), AccountMeta::new_readonly(system(), false)],
            data: [vec![1u8], digest.to_vec(), (offset as u16).to_le_bytes().to_vec(), bytes.to_vec()].concat(),
        };
        let (first, honest) = (chunk(0, &bytes[..600]), chunk(600, &bytes[600..]));
        e.send(&[first]).unwrap();
        cases.push(Case { name: "stage", env: e, honest, data_limit: 35 });
    }
    // announce: SOL, with the signature staged.
    {
        let mut e = Env::new();
        e.init();
        let w = e.sol(Pubkey::new_unique(), SOL, 0, 2);
        let payload = e.announce_payload(&w);
        let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
        let proof = e.stage(1, &message);
        let honest = e.announce_ix(&payload, proof, &root(1), &w.next);
        cases.push(Case { name: "announce", env: e, honest, data_limit: all });
    }
    // execute (SOL) once the wait is over; expire once the window has closed;
    // close_proof of the used proof.
    {
        let mut e = Env::new();
        e.init();
        let w = e.sol(Pubkey::new_unique(), SOL, 0, 2);
        let payload = e.announce_payload(&w);
        let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
        let proof = e.stage(1, &message);
        let ix = e.announce_ix(&payload, proof, &root(1), &w.next);
        e.send(&[ix]).unwrap();
        let close = Instruction {
            program_id: e.program,
            accounts: vec![AccountMeta::new(proof, false), AccountMeta::new(e.payer.pubkey(), true)],
            data: vec![6u8],
        };
        cases.push(Case { name: "close_proof", env: e.fork(), honest: close, data_limit: all });
        let mut open = e.fork();
        open.set_time(T0 + DAY);
        let honest = open.execute_ix(w.destination, vec![]);
        cases.push(Case { name: "execute (SOL)", env: open, honest, data_limit: all });
        e.set_time(T0 + DAY + WINDOW + 1);
        let honest = Instruction { program_id: e.program, accounts: vec![AccountMeta::new(e.vault, false)], data: vec![4u8] };
        cases.push(Case { name: "expire", env: e, honest, data_limit: all });
    }
    // recover, while a withdrawal is pending.
    {
        let mut e = Env::new();
        e.init();
        let w = e.sol(Pubkey::new_unique(), SOL, 0, 2);
        e.announce(1, &w).unwrap();
        let (next_rec, next_op) = (root(101), root(10));
        let payload = e.recover_payload(0, next_rec, next_op);
        let message = e.message(b"BUNKER3_RECOVER_", &payload);
        let proof = e.stage(100, &message);
        let honest = e.recover_ix(&payload, proof, &root(100), &next_rec, &next_op);
        cases.push(Case { name: "recover", env: e, honest, data_limit: all });
    }
    // announce and execute for a token.
    {
        let mut e = Env::new();
        e.init();
        let (mint, source, destination, owner) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
        let vault = e.vault;
        e.plant(mint, token_program(), mint_data(TOKEN_DECIMALS));
        e.plant(source, token_program(), token_data(&mint, &vault, 900, false));
        e.plant(destination, token_program(), token_data(&mint, &owner, 0, false));
        let w = Withdrawal { epoch: 0, index: 0, kind: 1, mint: mint.to_bytes(), destination, amount: 100, announce_by: T0 + 3600, next: root(2) };
        let payload = e.announce_payload(&w);
        let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
        let proof = e.stage(1, &message);
        let announce = e.announce_ix(&payload, proof, &root(1), &w.next);
        cases.push(Case { name: "announce (token)", env: e.fork(), honest: announce.clone(), data_limit: all });
        e.send(&[announce]).unwrap();
        e.set_time(T0 + DAY);
        let honest = e.execute_ix(
            destination,
            vec![AccountMeta::new(source, false), AccountMeta::new_readonly(mint, false), AccountMeta::new_readonly(token_program(), false)],
        );
        cases.push(Case { name: "execute (token)", env: e, honest, data_limit: all });
    }
    cases
}

#[test]
fn a_damaged_instruction_fails_or_does_exactly_what_the_honest_one_does() {
    let rounds: usize = std::env::var("FUZZ_ROUNDS").ok().and_then(|v| v.parse().ok()).unwrap_or(250);
    let mut rng = Rng(0x00B0_0B1E_5EED_2026);
    let (mut sent, mut accepted) = (0usize, 0usize);
    for mut case in fuzz_cases() {
        let mut pool = decoys(&mut case.env);
        // Someone with a funded wallet and a real signature, and no rights here.
        let stranger = Keypair::new();
        case.env.svm.airdrop(&stranger.pubkey(), 10 * SOL).unwrap();
        pool.push(stranger.pubkey());
        pool.extend(case.honest.accounts.iter().map(|a| a.pubkey));
        // Everything that matters: the instruction's own accounts and every decoy.
        let mut watched = pool.clone();
        watched.sort();
        watched.dedup();
        let mut honest = case.env.fork();
        honest.send(&[case.honest.clone()]).unwrap_or_else(|e| panic!("{}: the honest instruction must succeed: {e:?}", case.name));
        let expected = honest.snapshot(&watched);
        assert_ne!(expected, case.env.snapshot(&watched), "{}: the honest instruction changes something", case.name);
        let mut passed = 0usize;
        for round in 0..rounds {
            let ix = damage(&mut rng, &case.honest, &pool, case.data_limit, [&case.env.payer.pubkey(), &stranger.pubkey()]);
            if ix == case.honest {
                continue;
            }
            let mut trial = case.env.fork();
            sent += 1;
            // The fee payer always signs; the stranger signs when named as a signer.
            let budget = Instruction {
                program_id: Pubkey::from_str("ComputeBudget111111111111111111111111111111").unwrap(),
                accounts: vec![],
                data: [vec![2u8], COMPUTE_LIMIT.to_le_bytes().to_vec()].concat(),
            };
            let payer = trial.payer.insecure_clone();
            let mut keys: Vec<&Keypair> = vec![&payer];
            if ix.accounts.iter().any(|a| a.is_signer && a.pubkey == stranger.pubkey()) {
                keys.push(&stranger);
            }
            trial.svm.expire_blockhash();
            let tx = Transaction::new_signed_with_payer(&[budget, ix.clone()], Some(&payer.pubkey()), &keys, trial.svm.latest_blockhash());
            if trial.svm.send_transaction(tx).is_ok() {
                passed += 1;
                // Accounts the damaged instruction named that the honest one did not.
                let mut all = watched.clone();
                all.extend(ix.accounts.iter().map(|a| a.pubkey));
                all.sort();
                all.dedup();
                // Which of the two wallets paid is the sender's business: the
                // two are compared by their sum. Everything else must match.
                let wallets = [payer.pubkey(), stranger.pubkey()];
                all.retain(|k| !wallets.contains(k));
                let paid = |e: &Env| wallets.iter().map(|w| e.lamports(w)).sum::<u64>();
                // Paying is allowed to anyone; being paid is not.
                assert!(
                    trial.lamports(&stranger.pubkey()) <= case.env.lamports(&stranger.pubkey()),
                    "{} round {round}: a stranger's wallet gained from a damaged instruction",
                    case.name
                );
                let (got, want) = (trial.snapshot(&all), honest.snapshot(&all));
                let differing: Vec<&Pubkey> = all.iter().zip(got.iter().zip(&want)).filter(|(_, (g, w))| g != w).map(|(k, _)| k).collect();
                assert!(
                    // A second signature costs a second fee of 5,000 lamports.
                    differing.is_empty() && paid(&trial) + 5_000 * (keys.len() as u64 - 1) == paid(&honest),
                    "{} round {round}: a damaged instruction succeeded with a different result\ndiffering accounts {differing:?}\ninstruction accounts {:?}\ndata length {}",
                    case.name,
                    ix.accounts.iter().map(|a| (a.pubkey, a.is_signer, a.is_writable)).collect::<Vec<_>>(),
                    ix.data.len()
                );
            }
        }
        accepted += passed;
        println!("{}: {passed} damaged instructions accepted, all identical in effect", case.name);
    }
    println!("{sent} damaged instructions sent, {accepted} accepted");
    assert!(sent > 1000 || rounds < 250);
}

/// Every instruction behaves the same when another program calls it: a whole
/// life of a vault, with each instruction sent through a forwarding program.
#[test]
fn every_instruction_works_when_called_by_another_program() {
    let mut e = Env::new();
    let init = e.init_ix(root(1), root(100), DAY as u32);
    e.send(&[through_probe(&init)]).unwrap();
    let fund = system_instruction::transfer(&e.payer.pubkey(), &e.vault, 10 * SOL);
    e.send(&[fund]).unwrap();
    assert_eq!(&e.vault_data()[72..104], &root(1));

    // stage, in two chunks, then announce with the costliest signature.
    let destination = Pubkey::new_unique();
    let w = e.sol(destination, 2 * SOL, 0, 2);
    let payload = e.announce_payload(&w);
    let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
    let bytes = common::sign_at_limit(&e.salt, 1, &message);
    let digest = hashv(&[&message]).to_bytes();
    let proof = e.proof(&digest);
    for offset in [0usize, 600] {
        let chunk = Instruction {
            program_id: e.program,
            accounts: vec![AccountMeta::new(e.payer.pubkey(), true), AccountMeta::new(proof, false), AccountMeta::new_readonly(system(), false)],
            data: [vec![1u8], digest.to_vec(), (offset as u16).to_le_bytes().to_vec(), bytes[offset..(offset + 600).min(bytes.len())].to_vec()].concat(),
        };
        e.send(&[through_probe(&chunk)]).unwrap();
    }
    let announce = e.announce_ix(&payload, proof, &root(1), &w.next);
    let meta = e.send(&[through_probe(&announce)]).unwrap();
    println!("announce through another program: {} of {COMPUTE_LIMIT} compute units", meta.compute_units_consumed);
    assert!(e.pending() && e.spent(&root(1)));
    assert_eq!(e.op_root(), root(2));

    // close_proof, execute before and after the wait.
    let close = Instruction {
        program_id: e.program,
        accounts: vec![AccountMeta::new(proof, false), AccountMeta::new(e.payer.pubkey(), true)],
        data: vec![6u8],
    };
    e.send(&[through_probe(&close)]).unwrap();
    let execute = e.execute_ix(destination, vec![]);
    assert!(e.send(&[through_probe(&execute)]).is_err(), "still waiting");
    // The caller cannot redirect the payment.
    e.set_time(T0 + DAY);
    let thief = Pubkey::new_unique();
    assert!(e.send(&[through_probe(&e.execute_ix(thief, vec![]))]).is_err());
    e.send(&[through_probe(&execute)]).unwrap();
    assert_eq!((e.lamports(&destination), e.pending()), (2 * SOL, false));

    // An announcement left to expire, then recovery.
    let mut second = e.sol(Pubkey::new_unique(), SOL, 1, 3);
    second.announce_by = T0 + DAY + 3600;
    e.announce(2, &second).unwrap();
    e.set_time(T0 + 3 * DAY + 1);
    let expire = Instruction { program_id: e.program, accounts: vec![AccountMeta::new(e.vault, false)], data: vec![4u8] };
    e.send(&[through_probe(&expire)]).unwrap();
    assert!(!e.pending());
    let (next_rec, next_op) = (root(101), root(10));
    let payload = e.recover_payload(0, next_rec, next_op);
    let message = e.message(b"BUNKER3_RECOVER_", &payload);
    let proof = e.stage_bytes(&common::sign_at_limit(&e.salt, 100, &message), &message);
    let recover = e.recover_ix(&payload, proof, &root(100), &next_rec, &next_op);
    let meta = e.send(&[through_probe(&recover)]).unwrap();
    println!("recover through another program: {} of {COMPUTE_LIMIT} compute units", meta.compute_units_consumed);
    assert_eq!((e.epoch(), e.op_index(), e.op_root()), (1, 0, root(10)));
    assert!(e.spent(&root(100)));
}

/// A token withdrawal released through another program: the vault program's
/// own call into the token program is then two levels down.
#[test]
fn a_token_withdrawal_is_released_when_called_by_another_program() {
    let mut e = Env::new();
    e.init();
    let (mint, source, destination, owner) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
    let vault = e.vault;
    e.plant(mint, token_program(), mint_data(TOKEN_DECIMALS));
    e.plant(source, token_program(), token_data(&mint, &vault, 900, false));
    e.plant(destination, token_program(), token_data(&mint, &owner, 0, false));
    let w = Withdrawal { epoch: 0, index: 0, kind: 1, mint: mint.to_bytes(), destination, amount: 100, announce_by: T0 + 3600, next: root(2) };
    let payload = e.announce_payload(&w);
    let message = e.message(b"BUNKER3_ANNOUNCE", &payload);
    let proof = e.stage(1, &message);
    let announce = e.announce_ix(&payload, proof, &root(1), &w.next);
    e.send(&[through_probe(&announce)]).unwrap();
    e.set_time(T0 + DAY);
    let execute = e.execute_ix(
        destination,
        vec![AccountMeta::new(source, false), AccountMeta::new_readonly(mint, false), AccountMeta::new_readonly(token_program(), false)],
    );
    e.send(&[through_probe(&execute)]).unwrap();
    assert_eq!((token_amount(&e, &destination), token_amount(&e, &source), e.pending()), (100, 800, false));
}

/// The clock moving backwards (a validator reporting an earlier time) never
/// opens a withdrawal early or reopens a closed window.
#[test]
fn a_clock_that_goes_backwards_releases_nothing_early() {
    let mut e = Env::new();
    e.init();
    let destination = Pubkey::new_unique();
    let w = e.sol(destination, SOL, 0, 2);
    e.announce(1, &w).unwrap();
    for earlier in [T0 - 1, T0 - DAY, 0, -5, T0 + DAY - 1] {
        e.set_time(earlier);
        assert!(e.execute(destination).is_err(), "at {earlier}");
        assert!(e.expire().is_err(), "at {earlier}");
    }
    assert!(e.pending() && e.lamports(&destination) == 0);
    // Past the window, then back inside it: the record is still there and still
    // pays only inside the window it was given.
    e.set_time(T0 + DAY + WINDOW + 1);
    assert!(e.execute(destination).is_err());
    e.set_time(T0 + DAY + 5);
    e.execute(destination).unwrap();
    assert_eq!(e.lamports(&destination), SOL);
}
