//! Isolation between vaults and between a vault and whoever creates it, run
//! against the compiled `target/deploy/bunker3.so`. Each test is an attack
//! that once worked against an earlier draft and must now fail.
//! PUBLIC TEST KEYS ONLY.
use litesvm::{types::TransactionResult, LiteSVM};
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
use common::{root, root_in, sign_in, CHAIN, PROOF_LEN};

const T0: i64 = 1_800_000_000;
const DAY: i64 = 86_400;
const SOL: u64 = 1_000_000_000;

fn system() -> Pubkey {
    Pubkey::default()
}

/// One party: a fee wallet and the vault its parameters derive.
struct Party {
    payer: Keypair,
    salt: [u8; 32],
    op: [u8; 32],
    rec: [u8; 32],
    delay: u32,
    trusted: Vec<Pubkey>,
    id: [u8; 32],
    vault: Pubkey,
}
struct World {
    svm: LiteSVM,
    program: Pubkey,
    now: i64,
}
impl World {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let program = Pubkey::new_from_array(common::PROGRAM);
        let so = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/bunker3.so");
        svm.add_program_from_file(program, so).expect("build bunker3.so first");
        let mut w = Self { svm, program, now: T0 };
        w.set_time(T0);
        w
    }
    fn init_data(salt: &[u8; 32], chain: &[u8; 32], op: &[u8; 32], rec: &[u8; 32], delay: u32) -> Vec<u8> {
        Self::init_data_with(salt, chain, op, rec, delay, &[])
    }
    fn init_data_with(salt: &[u8; 32], chain: &[u8; 32], op: &[u8; 32], rec: &[u8; 32], delay: u32, trusted: &[Pubkey]) -> Vec<u8> {
        let mut list = [[0u8; 32]; 4];
        for (slot, w) in list.iter_mut().zip(trusted) {
            *slot = w.to_bytes();
        }
        [salt.to_vec(), chain.to_vec(), op.to_vec(), rec.to_vec(), delay.to_le_bytes().to_vec(), list.concat()].concat()
    }
    fn address(&self, data: &[u8]) -> ([u8; 32], Pubkey) {
        let id = hashv(&[b"BUNKER3_VAULT_ID", data]).to_bytes();
        (id, Pubkey::find_program_address(&[b"bunker3", &id], &self.program).0)
    }
    fn party(&mut self, salt: u8, op: [u8; 32], rec: [u8; 32], delay: u32) -> Party {
        self.party_trusting(salt, op, rec, delay, &[])
    }
    /// A party whose vault names `trusted` as wallets it may pay without waiting.
    fn party_trusting(&mut self, salt: u8, op: [u8; 32], rec: [u8; 32], delay: u32, trusted: &[Pubkey]) -> Party {
        let payer = Keypair::new();
        self.svm.airdrop(&payer.pubkey(), 100 * SOL).unwrap();
        let salt = [salt; 32];
        let (id, vault) = self.address(&Self::init_data_with(&salt, &CHAIN, &op, &rec, delay, trusted));
        Party { payer, salt, op, rec, delay, trusted: trusted.to_vec(), id, vault }
    }
    fn set_time(&mut self, unix: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = unix;
        self.now = unix;
        self.svm.set_sysvar(&clock);
    }
    fn send(&mut self, signer: &Keypair, ixs: &[Instruction]) -> TransactionResult {
        self.svm.expire_blockhash();
        let budget = Instruction {
            program_id: Pubkey::from_str("ComputeBudget111111111111111111111111111111").unwrap(),
            accounts: vec![],
            data: [vec![2u8], 800_000u32.to_le_bytes().to_vec()].concat(),
        };
        let all = [vec![budget], ixs.to_vec()].concat();
        let tx = Transaction::new_signed_with_payer(&all, Some(&signer.pubkey()), &[signer], self.svm.latest_blockhash());
        self.svm.send_transaction(tx)
    }
    fn marker(&self, p: &Party, root: &[u8; 32]) -> Pubkey {
        Pubkey::find_program_address(&[b"spent-v3", p.vault.as_ref(), root], &self.program).0
    }
    fn spent(&self, p: &Party, root: &[u8; 32]) -> bool {
        self.svm.get_account(&self.marker(p, root)).is_some_and(|a| a.owner == self.program && a.data == b"BKSPENT3")
    }
    fn vault_data(&self, p: &Party) -> Vec<u8> {
        self.svm.get_account(&p.vault).unwrap().data
    }
    fn lamports(&self, k: &Pubkey) -> u64 {
        self.svm.get_balance(k).unwrap_or(0)
    }
    /// `initialize` aimed at `vault` with arbitrary data, paid by `payer`.
    fn init_ix(&self, payer: &Keypair, vault: Pubkey, data: &[u8]) -> Instruction {
        Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new(vault, false),
                AccountMeta::new_readonly(system(), false),
            ],
            data: [vec![0u8], data.to_vec()].concat(),
        }
    }
    fn init(&mut self, p: &Party, fund: u64) {
        let ix = self.init_ix(&p.payer, p.vault, &Self::init_data_with(&p.salt, &CHAIN, &p.op, &p.rec, p.delay, &p.trusted));
        self.send(&p.payer, &[ix]).unwrap();
        if fund > 0 {
            let f = system_instruction::transfer(&p.payer.pubkey(), &p.vault, fund);
            self.send(&p.payer, &[f]).unwrap();
        }
    }
    fn message(&self, p: &Party, domain: &[u8; 16], payload: &[u8]) -> Vec<u8> {
        [domain.to_vec(), self.program.to_bytes().to_vec(), p.vault.to_bytes().to_vec(), payload.to_vec()].concat()
    }
    fn proof_addr(&self, payer: &Pubkey, digest: &[u8; 32]) -> Pubkey {
        Pubkey::find_program_address(&[b"proof", payer.as_ref(), digest], &self.program).0
    }
    fn stage_ix(&self, payer: &Pubkey, digest: &[u8; 32], offset: u16, chunk: &[u8]) -> Instruction {
        Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(*payer, true),
                AccountMeta::new(self.proof_addr(payer, digest), false),
                AccountMeta::new_readonly(system(), false),
            ],
            data: [vec![1u8], digest.to_vec(), offset.to_le_bytes().to_vec(), chunk.to_vec()].concat(),
        }
    }
    fn stage(&mut self, p: &Party, tag: u32, message: &[u8]) -> Pubkey {
        let bytes = sign_in(&p.salt, tag, message);
        let digest = hashv(&[message]).to_bytes();
        for offset in [0usize, 600] {
            let ix = self.stage_ix(&p.payer.pubkey(), &digest, offset as u16, &bytes[offset..(offset + 600).min(bytes.len())]);
            self.send(&p.payer, &[ix]).unwrap();
        }
        self.proof_addr(&p.payer.pubkey(), &digest)
    }
    #[allow(clippy::too_many_arguments)]
    fn announce(&mut self, p: &Party, signer_tag: u32, epoch: u64, index: u64, destination: Pubkey, amount: u64, next: [u8; 32]) -> TransactionResult {
        let mut d = vec![3u8, 1];
        d.extend(p.id);
        d.extend(CHAIN);
        d.extend(epoch.to_le_bytes());
        d.extend(index.to_le_bytes());
        d.push(0);
        d.extend([0u8; 32]);
        d.extend(destination.to_bytes());
        d.extend(amount.to_le_bytes());
        d.extend((self.now + 3600).to_le_bytes());
        d.extend(next);
        d.push(0);
        let message = self.message(p, b"BUNKER3_ANNOUNCE", &d);
        let proof = self.stage(p, signer_tag, &message);
        let current: [u8; 32] = self.vault_data(p)[72..104].try_into().unwrap();
        let ix = Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(p.vault, false),
                AccountMeta::new_readonly(proof, false),
                AccountMeta::new(p.payer.pubkey(), true),
                AccountMeta::new(self.marker(p, &current), false),
                AccountMeta::new_readonly(self.marker(p, &next), false),
                AccountMeta::new_readonly(system(), false),
            ],
            data: [vec![2u8], d].concat(),
        };
        self.send(&p.payer, &[ix])
    }
    fn recover(&mut self, p: &Party, signer_tag: u32, epoch: u64, next_rec: [u8; 32], next_op: [u8; 32]) -> TransactionResult {
        let mut d = vec![3u8, 2];
        d.extend(p.id);
        d.extend(CHAIN);
        d.extend(epoch.to_le_bytes());
        d.extend(next_rec);
        d.extend(next_op);
        let message = self.message(p, b"BUNKER3_RECOVER_", &d);
        let proof = self.stage(p, signer_tag, &message);
        let data = self.vault_data(p);
        let rec: [u8; 32] = data[120..152].try_into().unwrap();
        let ix = Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(p.vault, false),
                AccountMeta::new_readonly(proof, false),
                AccountMeta::new(p.payer.pubkey(), true),
                AccountMeta::new(self.marker(p, &rec), false),
                AccountMeta::new_readonly(self.marker(p, &next_rec), false),
                AccountMeta::new_readonly(self.marker(p, &next_op), false),
                AccountMeta::new_readonly(system(), false),
            ],
            data: [vec![5u8], d].concat(),
        };
        self.send(&p.payer, &[ix])
    }
    fn execute(&mut self, p: &Party, destination: Pubkey) -> TransactionResult {
        let ix = Instruction {
            program_id: self.program,
            accounts: vec![AccountMeta::new(p.vault, false), AccountMeta::new(destination, false)],
            data: vec![3u8],
        };
        self.send(&p.payer, &[ix])
    }
}

/// Markers are per vault. A stranger who installs the owner's public roots in
/// a vault of their own and retires them there changes nothing for the owner.
#[test]
fn retiring_a_root_in_one_vault_does_not_retire_it_in_another() {
    let mut w = World::new();
    let owner = w.party(7, root(1), root(100), DAY as u32);
    w.init(&owner, 10 * SOL);
    // The stranger copies each root the owner depends on: the live operational
    // root, the live recovery root and the next operational root.
    for (salt, copied) in [(60u8, root(1)), (61, root(100)), (62, root(2))] {
        // The stranger's own recovery key belongs to the stranger's salt.
        let own = |tag| root_in(&[salt; 32], tag);
        let stranger = w.party(salt, copied, own(500), 0);
        w.init(&stranger, 0);
        w.recover(&stranger, 500, 0, own(501), own(10)).unwrap();
        assert!(w.spent(&stranger, &own(500)) && !w.spent(&owner, &copied));
    }
    let destination = Pubkey::new_unique();
    w.announce(&owner, 1, 0, 0, destination, SOL, root(2)).unwrap();
    assert!(w.spent(&owner, &root(1)));
    // Cancel by recovery still works inside the wait.
    w.set_time(T0 + 3600);
    w.recover(&owner, 100, 0, root(101), root(10)).unwrap();
    let d = w.vault_data(&owner);
    assert_eq!((&d[72..104], &d[120..152], d[112], d[156]), (&root(10)[..], &root(101)[..], 1, 0));
    assert_eq!(w.lamports(&destination), 0);
}

/// Two vaults can hold the same root without either blocking the other. A
/// key is bound to the salt, so the two here share a salt and differ in their
/// waiting period. (The client never does this: its keys also depend on the
/// waiting period. Signing in both vaults with one key is one-time-key reuse.)
#[test]
fn two_vaults_may_hold_the_same_root() {
    let mut w = World::new();
    let a = w.party(7, root(1), root(100), 0);
    let b = w.party(7, root(1), root(100), 60);
    assert_ne!(a.vault, b.vault);
    w.init(&a, 10 * SOL);
    w.init(&b, 10 * SOL);
    w.announce(&a, 1, 0, 0, Pubkey::new_unique(), SOL, root(2)).unwrap();
    // The signature made for vault A names A's address and identity.
    assert!(w.spent(&a, &root(1)) && !w.spent(&b, &root(1)));
    w.recover(&b, 100, 0, root(101), root(10)).unwrap();
    assert!(!w.spent(&a, &root(100)));
    w.recover(&a, 100, 0, root(101), root(10)).unwrap();
}

/// The vault address is a hash of every creation parameter. Whoever sends
/// `initialize` first can only create the vault the owner derived.
#[test]
fn the_address_commits_to_every_creation_parameter() {
    let mut w = World::new();
    let owner = w.party(7, root(1), root(100), DAY as u32);
    let stranger = Keypair::new();
    w.svm.airdrop(&stranger.pubkey(), 10 * SOL).unwrap();
    let good = World::init_data(&owner.salt, &CHAIN, &owner.op, &owner.rec, owner.delay);
    let changed = [
        World::init_data(&[8; 32], &CHAIN, &owner.op, &owner.rec, owner.delay),
        World::init_data(&owner.salt, &[0xEE; 32], &owner.op, &owner.rec, owner.delay),
        World::init_data(&owner.salt, &CHAIN, &root(500), &owner.rec, owner.delay),
        World::init_data(&owner.salt, &CHAIN, &owner.op, &root(500), owner.delay),
        World::init_data(&owner.salt, &CHAIN, &owner.op, &owner.rec, 0),
        // A trusted wallet the owner did not choose.
        World::init_data_with(&owner.salt, &CHAIN, &owner.op, &owner.rec, owner.delay, &[Pubkey::new_unique()]),
    ];
    for data in &changed {
        assert_ne!(w.address(data).1, owner.vault);
        let ix = w.init_ix(&stranger, owner.vault, data);
        assert!(w.send(&stranger, &[ix]).is_err(), "other parameters cannot take the owner's address");
        assert!(w.svm.get_account(&owner.vault).is_none_or(|a| a.data.is_empty()));
    }
    // Racing the owner with the owner's own parameters creates the owner's vault.
    let ix = w.init_ix(&stranger, owner.vault, &good);
    w.send(&stranger, &[ix]).unwrap();
    let d = w.vault_data(&owner);
    assert_eq!((&d[8..40], &d[72..104], &d[120..152]), (&owner.id[..], &root(1)[..], &root(100)[..]));
    assert_eq!(u32::from_le_bytes(d[152..156].try_into().unwrap()), DAY as u32);
    let fund = system_instruction::transfer(&owner.payer.pubkey(), &owner.vault, 5 * SOL);
    w.send(&owner.payer, &[fund]).unwrap();
    w.announce(&owner, 1, 0, 0, Pubkey::new_unique(), SOL, root(2)).unwrap();
    w.recover(&owner, 100, 0, root(101), root(10)).unwrap();
}

/// A closed proof address goes back to the system program, so it can be staged
/// again even if something refunds it inside the closing transaction.
#[test]
fn a_closed_proof_can_be_staged_again() {
    let mut w = World::new();
    let p = w.party(7, root(1), root(100), 0);
    let message = b"any message".to_vec();
    let digest = hashv(&[&message]).to_bytes();
    let proof = w.stage(&p, 1, &message);
    let close = Instruction {
        program_id: w.program,
        accounts: vec![AccountMeta::new(proof, false), AccountMeta::new(p.payer.pubkey(), true)],
        data: vec![6u8],
    };
    let rent = w.svm.minimum_balance_for_rent_exemption(PROOF_LEN);
    let refund = system_instruction::transfer(&p.payer.pubkey(), &proof, rent);
    w.send(&p.payer, &[close.clone(), refund]).unwrap();
    let a = w.svm.get_account(&proof).unwrap();
    assert_eq!((a.owner, a.data.len()), (system(), 0));
    assert!(w.send(&p.payer, &[close.clone()]).is_err(), "nothing left to close");
    let proof = w.stage(&p, 1, &message);
    let a = w.svm.get_account(&proof).unwrap();
    assert_eq!((a.owner, a.data.len(), &a.data[40..72]), (w.program, PROOF_LEN, &digest[..]));
    // And a plain close leaves no account behind.
    w.send(&p.payer, &[close]).unwrap();
    assert!(w.svm.get_account(&proof).is_none_or(|a| a.lamports == 0 && a.data.is_empty()));
}

/// Documented behaviour, not a defect: SOL sent to an address that would be
/// left below the rent-exempt minimum cannot execute. The record stays until
/// the destination is funded or the record expires. Clients check this before
/// signing (sdk/preflight.ts).
#[test]
fn a_sol_withdrawal_below_the_destination_rent_minimum_waits_for_funding() {
    let mut w = World::new();
    let p = w.party(7, root(1), root(100), 0);
    w.init(&p, 10 * SOL);
    let destination = Pubkey::new_unique();
    w.announce(&p, 1, 0, 0, destination, 500_000, root(2)).unwrap();
    assert!(w.execute(&p, destination).is_err());
    assert_eq!(w.vault_data(&p)[156], 1);
    let top_up = system_instruction::transfer(&p.payer.pubkey(), &destination, SOL);
    w.send(&p.payer, &[top_up]).unwrap();
    w.execute(&p, destination).unwrap();
    assert_eq!((w.lamports(&destination), w.vault_data(&p)[156]), (SOL + 500_000, 0));
}

/// Lamports sent ahead of time to a vault or marker address do not block it.
#[test]
fn prefunded_vault_and_marker_addresses_do_not_block() {
    let mut w = World::new();
    let p = w.party(7, root(1), root(100), 0);
    for k in [p.vault, w.marker(&p, &root(1)), w.marker(&p, &root(100)), w.marker(&p, &root(2))] {
        let ix = system_instruction::transfer(&p.payer.pubkey(), &k, SOL);
        w.send(&p.payer, &[ix]).unwrap();
    }
    w.init(&p, 10 * SOL);
    w.announce(&p, 1, 0, 0, Pubkey::new_unique(), SOL, root(2)).unwrap();
    assert!(w.spent(&p, &root(1)));
    w.recover(&p, 100, 0, root(101), root(10)).unwrap();
    assert!(w.spent(&p, &root(100)) && !w.spent(&p, &root(2)));
}

/// Only the marker derived for this vault and this root is accepted.
#[test]
fn a_marker_from_another_vault_is_refused() {
    let mut w = World::new();
    let p = w.party(7, root(1), root(100), 0);
    let other = w.party(8, root(1), root(100), 0);
    w.init(&p, 10 * SOL);
    w.init(&other, 0);
    let destination = Pubkey::new_unique();
    let mut d = vec![3u8, 1];
    d.extend(p.id);
    d.extend(CHAIN);
    d.extend(0u64.to_le_bytes());
    d.extend(0u64.to_le_bytes());
    d.push(0);
    d.extend([0u8; 32]);
    d.extend(destination.to_bytes());
    d.extend(SOL.to_le_bytes());
    d.extend((T0 + 3600).to_le_bytes());
    d.extend(root(2));
    d.push(0);
    let message = w.message(&p, b"BUNKER3_ANNOUNCE", &d);
    let proof = w.stage(&p, 1, &message);
    let ix = |spent: Pubkey, next: Pubkey| Instruction {
        program_id: w.program,
        accounts: vec![
            AccountMeta::new(p.vault, false),
            AccountMeta::new_readonly(proof, false),
            AccountMeta::new(p.payer.pubkey(), true),
            AccountMeta::new(spent, false),
            AccountMeta::new_readonly(next, false),
            AccountMeta::new_readonly(system(), false),
        ],
        data: [vec![2u8], d.clone()].concat(),
    };
    let wrong_spent = ix(w.marker(&other, &root(1)), w.marker(&p, &root(2)));
    let wrong_next = ix(w.marker(&p, &root(1)), w.marker(&other, &root(2)));
    let right = ix(w.marker(&p, &root(1)), w.marker(&p, &root(2)));
    assert!(w.send(&p.payer, &[wrong_spent]).is_err());
    assert!(w.send(&p.payer, &[wrong_next]).is_err());
    w.send(&p.payer, &[right]).unwrap();
}

/// A thief with the day key who has seen the recovery packet plants one of the
/// roots it names as the live operational root. Recovery must still land and
/// cancel the theft, and the new epoch must work.
#[test]
fn a_day_key_cannot_block_recovery_by_planting_the_packets_roots() {
    for planted in [root(10), root(101)] {
        let mut w = World::new();
        let owner = w.party(7, root(1), root(100), DAY as u32);
        w.init(&owner, 10 * SOL);
        let thief = Pubkey::new_unique();
        // The packet for epoch 0 will name root(101) and root(10).
        w.announce(&owner, 1, 0, 0, thief, 9 * SOL, planted).unwrap();
        w.set_time(T0 + 3600);
        w.recover(&owner, 100, 0, root(101), root(10)).unwrap();
        let d = w.vault_data(&owner);
        assert_eq!((&d[72..104], &d[120..152], d[112], d[156]), (&root(10)[..], &root(101)[..], 1, 0));
        // The planted root was installed, not retired; the old recovery root was retired.
        assert!(!w.spent(&owner, &planted) && w.spent(&owner, &root(100)));
        w.set_time(T0 + 2 * DAY);
        assert!(w.execute(&owner, thief).is_err());
        assert_eq!(w.lamports(&thief), 0);
        // The owner continues in the new epoch with the keys the packet installed.
        let destination = Pubkey::new_unique();
        w.announce(&owner, 10, 1, 0, destination, SOL, root(11)).unwrap();
        w.recover(&owner, 101, 1, root(102), root(20)).unwrap();
    }
}

/// The same attack one epoch ahead. The thief plants a root that a LATER
/// recovery packet names. The current recovery must not retire it, or that
/// later packet could never land and the vault would be left with no way to
/// recover again.
#[test]
fn a_day_key_cannot_kill_a_future_recovery() {
    // Packet 0 installs rec 101 / op 10; packet 1 installs rec 102 / op 20.
    for planted in [root(102), root(20)] {
        let mut w = World::new();
        let owner = w.party(7, root(1), root(100), DAY as u32);
        w.init(&owner, 10 * SOL);
        let thief = Pubkey::new_unique();
        w.announce(&owner, 1, 0, 0, thief, 9 * SOL, planted).unwrap();
        w.set_time(T0 + 3600);
        w.recover(&owner, 100, 0, root(101), root(10)).unwrap();
        assert!(!w.spent(&owner, &planted), "a root that signed nothing must not be marked");
        assert_eq!(w.lamports(&thief), 0);
        // Epoch 1 is used normally, then recovered with the packet that names the planted root.
        w.announce(&owner, 10, 1, 0, Pubkey::new_unique(), SOL, root(11)).unwrap();
        w.recover(&owner, 101, 1, root(102), root(20)).unwrap();
        let d = w.vault_data(&owner);
        assert_eq!((&d[72..104], &d[120..152], d[112]), (&root(20)[..], &root(102)[..], 2));
        // And epoch 2 works with the keys it installed.
        w.announce(&owner, 20, 2, 0, Pubkey::new_unique(), SOL, root(21)).unwrap();
        w.recover(&owner, 102, 2, root(103), root(30)).unwrap();
    }
}

/// A recovery transaction names nothing that an announcement can change, so
/// an announcement landing first cannot make it fail.
#[test]
fn recovery_does_not_depend_on_operational_progress() {
    let mut w = World::new();
    let owner = w.party(7, root(1), root(100), 0);
    w.init(&owner, 10 * SOL);
    // Build the recovery, then let three instant withdrawals land before it.
    for (i, tag) in [(0u64, 1u32), (1, 2), (2, 3)] {
        let to = Pubkey::new_unique();
        w.announce(&owner, tag, 0, i, to, SOL, root(tag + 1)).unwrap();
        w.execute(&owner, to).unwrap();
    }
    w.recover(&owner, 100, 0, root(101), root(10)).unwrap();
    assert_eq!(w.vault_data(&owner)[112], 1);
}

/// Passing one account in two slots of an instruction never succeeds. Every
/// pair of slots in `announce` and `recover` is tried, then the untouched
/// instruction is shown to work, so the failures are not incidental.
#[test]
fn no_instruction_accepts_one_account_in_two_slots() {
    let mut w = World::new();
    let p = w.party(7, root(1), root(100), 0);
    w.init(&p, 10 * SOL);
    let destination = Pubkey::new_unique();
    let mut a = vec![3u8, 1];
    a.extend(p.id);
    a.extend(CHAIN);
    a.extend(0u64.to_le_bytes());
    a.extend(0u64.to_le_bytes());
    a.push(0);
    a.extend([0u8; 32]);
    a.extend(destination.to_bytes());
    a.extend(SOL.to_le_bytes());
    a.extend((T0 + 3600).to_le_bytes());
    a.extend(root(2));
    a.push(0);
    let message = w.message(&p, b"BUNKER3_ANNOUNCE", &a);
    let proof = w.stage(&p, 1, &message);
    let announce = Instruction {
        program_id: w.program,
        accounts: vec![
            AccountMeta::new(p.vault, false),
            AccountMeta::new_readonly(proof, false),
            AccountMeta::new(p.payer.pubkey(), true),
            AccountMeta::new(w.marker(&p, &root(1)), false),
            AccountMeta::new_readonly(w.marker(&p, &root(2)), false),
            AccountMeta::new_readonly(system(), false),
        ],
        data: [vec![2u8], a].concat(),
    };
    let mut r = vec![3u8, 2];
    r.extend(p.id);
    r.extend(CHAIN);
    r.extend(0u64.to_le_bytes());
    r.extend(root(101));
    r.extend(root(10));
    let message = w.message(&p, b"BUNKER3_RECOVER_", &r);
    let proof = w.stage(&p, 100, &message);
    let recover = Instruction {
        program_id: w.program,
        accounts: vec![
            AccountMeta::new(p.vault, false),
            AccountMeta::new_readonly(proof, false),
            AccountMeta::new(p.payer.pubkey(), true),
            AccountMeta::new(w.marker(&p, &root(100)), false),
            AccountMeta::new_readonly(w.marker(&p, &root(101)), false),
            AccountMeta::new_readonly(w.marker(&p, &root(10)), false),
            AccountMeta::new_readonly(system(), false),
        ],
        data: [vec![5u8], r].concat(),
    };
    let before = w.vault_data(&p);
    for good in [&announce, &recover] {
        let n = good.accounts.len();
        for from in 0..n {
            for to in 0..n {
                if from == to {
                    continue;
                }
                let mut ix = good.clone();
                ix.accounts[to].pubkey = good.accounts[from].pubkey;
                // The harness cannot sign for another slot's account; the program
                // must refuse a payer that has not signed.
                ix.accounts[to].is_signer = false;
                assert!(w.send(&p.payer, &[ix]).is_err(), "opcode {} slot {to} given the account of slot {from}", good.data[0]);
                assert_eq!(w.vault_data(&p), before);
            }
        }
    }
    // Execute with the vault as its own destination, and close_proof with the proof as its own payer.
    w.send(&p.payer, &[announce]).unwrap();
    let own = Instruction {
        program_id: w.program,
        accounts: vec![AccountMeta::new(p.vault, false), AccountMeta::new(p.vault, false)],
        data: vec![3u8],
    };
    assert!(w.send(&p.payer, &[own]).is_err());
    w.execute(&p, destination).unwrap();
    w.send(&p.payer, &[recover]).unwrap();
    assert_eq!(w.vault_data(&p)[112], 1);
}

/// `stage` requires the system program in its third slot on every chunk.
#[test]
fn stage_requires_the_system_program_on_every_chunk() {
    let mut w = World::new();
    let p = w.party(7, root(1), root(100), 0);
    let message = b"any message".to_vec();
    let digest = hashv(&[&message]).to_bytes();
    let bytes = sign_in(&p.salt, 1, &message);
    let first = w.stage_ix(&p.payer.pubkey(), &digest, 0, &bytes[..600]);
    w.send(&p.payer, &[first]).unwrap();
    let mut second = w.stage_ix(&p.payer.pubkey(), &digest, 600, &bytes[600..]);
    let good = second.clone();
    second.accounts[2] = AccountMeta::new_readonly(Pubkey::new_unique(), false);
    assert!(w.send(&p.payer, &[second]).is_err());
    w.send(&p.payer, &[good]).unwrap();
}

/// The point of trusted wallets: a stolen day key can pay the owner's own
/// wallets at once, and anyone else only after a wait the owner can cancel in.
#[test]
fn a_stolen_day_key_can_only_pay_trusted_wallets_without_waiting() {
    let mut w = World::new();
    let (cold, exchange) = (Pubkey::new_unique(), Pubkey::new_unique());
    let owner = w.party_trusting(7, root(1), root(100), DAY as u32, &[cold, exchange]);
    w.init(&owner, 10 * SOL);
    let d = w.vault_data(&owner);
    assert_eq!((&d[287..319], &d[319..351]), (&cold.to_bytes()[..], &exchange.to_bytes()[..]));
    assert!(d[351..415].iter().all(|b| *b == 0));
    assert_eq!(&d[415..447], &owner.salt, "the salt is kept after the trusted wallets");
    // To a trusted wallet: released in the same moment, no waiting.
    w.announce(&owner, 1, 0, 0, cold, SOL, root(2)).unwrap();
    w.execute(&owner, cold).unwrap();
    assert_eq!(w.lamports(&cold), SOL);
    w.announce(&owner, 2, 0, 1, exchange, SOL, root(3)).unwrap();
    w.execute(&owner, exchange).unwrap();
    // The thief, holding the same day key, pays themselves: it waits.
    let thief = Pubkey::new_unique();
    w.announce(&owner, 3, 0, 2, thief, 7 * SOL, root(4)).unwrap();
    assert!(w.execute(&owner, thief).is_err(), "not trusted: nothing leaves yet");
    let d = w.vault_data(&owner);
    assert_eq!(i64::from_le_bytes(d[230..238].try_into().unwrap()), T0 + DAY, "opens after the full waiting period");
    w.set_time(T0 + DAY - 1);
    assert!(w.execute(&owner, thief).is_err());
    // The owner cancels with the recovery kit; the thief's key is dead.
    w.recover(&owner, 100, 0, root(101), root(10)).unwrap();
    w.set_time(T0 + 2 * DAY);
    assert!(w.execute(&owner, thief).is_err());
    assert_eq!(w.lamports(&thief), 0);
    // The trusted list survives recovery, and still applies under the new keys.
    assert_eq!(&w.vault_data(&owner)[287..319], &cold.to_bytes()[..]);
    w.announce(&owner, 10, 1, 0, cold, SOL, root(11)).unwrap();
    w.execute(&owner, cold).unwrap();
    assert_eq!(w.lamports(&cold), 2 * SOL);
}

/// A vault with no waiting period and a trusted list behaves as before: the
/// list only ever shortens a wait.
#[test]
fn trusted_wallets_never_add_a_wait() {
    let mut w = World::new();
    let cold = Pubkey::new_unique();
    let owner = w.party_trusting(7, root(1), root(100), 0, &[cold]);
    w.init(&owner, 10 * SOL);
    let anyone = Pubkey::new_unique();
    w.announce(&owner, 1, 0, 0, anyone, SOL, root(2)).unwrap();
    w.execute(&owner, anyone).unwrap();
    assert_eq!(w.lamports(&anyone), SOL);
}

/// Creation data with a malformed trusted list is refused.
#[test]
fn a_malformed_trusted_list_cannot_create_a_vault() {
    let mut w = World::new();
    let payer = Keypair::new();
    w.svm.airdrop(&payer.pubkey(), 10 * SOL).unwrap();
    let (a, b) = (Pubkey::new_unique(), Pubkey::new_unique());
    let z = Pubkey::default();
    for (what, list) in [("a duplicate", vec![a, a]), ("a gap", vec![z, a]), ("a gap between", vec![a, z, b])] {
        let data = World::init_data_with(&[7; 32], &CHAIN, &root(1), &root(100), 0, &list);
        let (_, vault) = w.address(&data);
        let ix = w.init_ix(&payer, vault, &data);
        assert!(w.send(&payer, &[ix]).is_err(), "{what}");
    }
    let data = World::init_data_with(&[7; 32], &CHAIN, &root(1), &root(100), 0, &[a, b]);
    let (_, vault) = w.address(&data);
    let ix = w.init_ix(&payer, vault, &data);
    w.send(&payer, &[ix]).unwrap();
}


/// A key is bound to the vault's salt: a vault that copies another vault's
/// roots under a different salt cannot be signed for with the original keys.
#[test]
fn a_root_copied_under_another_salt_cannot_be_signed_for() {
    let mut w = World::new();
    let owner = w.party(7, root(1), root(100), 0);
    let copy = w.party(8, root(1), root(100), 0);
    w.init(&owner, 10 * SOL);
    w.init(&copy, 10 * SOL);
    // The owner's keys, signing where they belong for the owner's salt, placed
    // in the copy: refused for both roles.
    let as_owner = Party { payer: copy.payer.insecure_clone(), salt: owner.salt, ..party_like(&copy) };
    assert!(w.announce(&as_owner, 1, 0, 0, Pubkey::new_unique(), SOL, root(2)).is_err());
    assert!(w.recover(&as_owner, 100, 0, root(101), root(10)).is_err());
    assert!(!w.spent(&copy, &root(1)) && !w.spent(&copy, &root(100)));
    // The same keys work in the vault they were made for.
    w.announce(&owner, 1, 0, 0, Pubkey::new_unique(), SOL, root(2)).unwrap();
    w.recover(&owner, 100, 0, root(101), root(10)).unwrap();
}
fn party_like(p: &Party) -> Party {
    Party { payer: p.payer.insecure_clone(), salt: p.salt, op: p.op, rec: p.rec, delay: p.delay, trusted: p.trusted.clone(), id: p.id, vault: p.vault }
}
