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
use winterwallet_core::WinternitzKeypair;

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const T0: i64 = 1_800_000_000;
const DAY: i64 = 86_400;
const SOL: u64 = 1_000_000_000;
const CHAIN: [u8; 32] = [9u8; 32];

fn system() -> Pubkey {
    Pubkey::default()
}
fn key(tag: u32) -> WinternitzKeypair {
    WinternitzKeypair::from_mnemonic_at(PHRASE, 0, 0, tag).unwrap()
}
fn root(tag: u32) -> [u8; 32] {
    *key(tag).derive::<32>().to_pubkey().merklize().as_bytes()
}

/// One party: a fee wallet and the vault its parameters derive.
struct Party {
    payer: Keypair,
    salt: [u8; 32],
    op: [u8; 32],
    rec: [u8; 32],
    delay: u32,
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
        let program = Pubkey::new_unique();
        let so = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/bunker3.so");
        svm.add_program_from_file(program, so).expect("build bunker3.so first");
        let mut w = Self { svm, program, now: T0 };
        w.set_time(T0);
        w
    }
    fn init_data(salt: &[u8; 32], chain: &[u8; 32], op: &[u8; 32], rec: &[u8; 32], delay: u32) -> Vec<u8> {
        [salt.to_vec(), chain.to_vec(), op.to_vec(), rec.to_vec(), delay.to_le_bytes().to_vec()].concat()
    }
    fn address(&self, data: &[u8]) -> ([u8; 32], Pubkey) {
        let id = hashv(&[b"BUNKER3_VAULT_ID", data]).to_bytes();
        (id, Pubkey::find_program_address(&[b"bunker3", &id], &self.program).0)
    }
    fn party(&mut self, salt: u8, op: [u8; 32], rec: [u8; 32], delay: u32) -> Party {
        let payer = Keypair::new();
        self.svm.airdrop(&payer.pubkey(), 100 * SOL).unwrap();
        let salt = [salt; 32];
        let (id, vault) = self.address(&Self::init_data(&salt, &CHAIN, &op, &rec, delay));
        Party { payer, salt, op, rec, delay, id, vault }
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
            data: [vec![2u8], 1_400_000u32.to_le_bytes().to_vec()].concat(),
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
        let ix = self.init_ix(&p.payer, p.vault, &Self::init_data(&p.salt, &CHAIN, &p.op, &p.rec, p.delay));
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
        let bytes = key(tag).derive::<32>().sign(&[message]).as_bytes().to_vec();
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
        let op: [u8; 32] = data[72..104].try_into().unwrap();
        let ix = Instruction {
            program_id: self.program,
            accounts: vec![
                AccountMeta::new(p.vault, false),
                AccountMeta::new_readonly(proof, false),
                AccountMeta::new(p.payer.pubkey(), true),
                AccountMeta::new(self.marker(p, &rec), false),
                AccountMeta::new(self.marker(p, &op), false),
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
        let stranger = w.party(salt, copied, root(500), 0);
        w.init(&stranger, 0);
        w.recover(&stranger, 500, 0, root(501), root(502)).unwrap();
        assert!(w.spent(&stranger, &copied) && !w.spent(&owner, &copied));
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

/// The same owner can also reuse one root across two vaults of their own
/// without either blocking the other.
#[test]
fn two_vaults_may_hold_the_same_root() {
    let mut w = World::new();
    let a = w.party(7, root(1), root(100), 0);
    let b = w.party(8, root(1), root(100), 0);
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
    let rent = w.svm.minimum_balance_for_rent_exemption(1162);
    let refund = system_instruction::transfer(&p.payer.pubkey(), &proof, rent);
    w.send(&p.payer, &[close.clone(), refund]).unwrap();
    let a = w.svm.get_account(&proof).unwrap();
    assert_eq!((a.owner, a.data.len()), (system(), 0));
    assert!(w.send(&p.payer, &[close.clone()]).is_err(), "nothing left to close");
    let proof = w.stage(&p, 1, &message);
    let a = w.svm.get_account(&proof).unwrap();
    assert_eq!((a.owner, a.data.len(), &a.data[40..72]), (w.program, 1162, &digest[..]));
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
    assert!(w.spent(&p, &root(100)) && w.spent(&p, &root(2)));
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
