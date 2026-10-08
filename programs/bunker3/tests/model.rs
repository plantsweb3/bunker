//! Randomized checks of the protocol-3 state machine and decoders. No external
//! crates: a fixed-seed xorshift generator makes every run identical, so a
//! failure is reproducible from the sequence number it prints.
use bunker3::state::*;
use std::collections::HashSet;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn root(&mut self) -> [u8; 32] {
        let mut r = [0u8; 32];
        for chunk in r.chunks_mut(8) {
            chunk.copy_from_slice(&self.next().to_le_bytes());
        }
        r[0] |= 1; // never the all-zero root
        r
    }
}
fn announce_bytes(v: &Vault, next: [u8; 32], amount: u64, announce_by: i64, token: bool) -> Vec<u8> {
    let mut d = vec![VERSION, ROLE_OPERATIONAL];
    d.extend(v.vault_id);
    d.extend(v.chain_tag);
    d.extend(v.epoch.to_le_bytes());
    d.extend(v.op_index.to_le_bytes());
    d.push(token as u8);
    d.extend(if token { [9u8; 32] } else { [0u8; 32] });
    d.extend([7u8; 32]);
    d.extend(amount.to_le_bytes());
    d.extend(announce_by.to_le_bytes());
    d.extend(next);
    d.push(if token { 6 } else { 0 });
    d
}
fn recover_bytes(v: &Vault, next_rec: [u8; 32], next_op: [u8; 32]) -> Vec<u8> {
    let mut d = vec![VERSION, ROLE_RECOVERY];
    d.extend(v.vault_id);
    d.extend(v.chain_tag);
    d.extend(v.epoch.to_le_bytes());
    d.extend(next_rec);
    d.extend(next_op);
    d
}

/// Many random interleavings of announce, execute, expire, recover and the
/// passage of time, valid and corrupted, against invariants that must hold
/// whatever the order.
#[test]
fn random_interleavings_keep_every_invariant() {
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    let (mut announced, mut executed, mut recovered, mut rejected) = (0u64, 0u64, 0u64, 0u64);
    for sequence in 0..20_000u32 {
        let delay = [0u32, 1, 3_600, 86_400, MAX_DELAY_SECS][rng.below(5) as usize];
        // What the master derives: for each epoch, its recovery root and its
        // first operational root. The packet for epoch e names rec[e+1] and
        // op0[e+1]. These are public once a packet has been seen, so the
        // operational signer is allowed to know and use all of them.
        let rec: Vec<[u8; 32]> = (0..45).map(|_| rng.root()).collect();
        let op0: Vec<[u8; 32]> = (0..45).map(|_| rng.root()).collect();
        let mut v = Vault {
            vault_id: rng.root(),
            chain_tag: rng.root(),
            op_root: op0[0],
            op_index: 0,
            epoch: 0,
            rec_root: rec[0],
            delay_secs: delay,
            pending: None,
            bump: 255,
            trusted: [[0; 32]; TRUSTED_SLOTS],
            salt: [5; 32],
        };
        let mut now: i64 = 1_800_000_000;
        // The spent markers the program keeps for this vault, and every announcement that paid out.
        let mut retired: HashSet<[u8; 32]> = HashSet::new();
        let mut paid: HashSet<[u8; 32]> = HashSet::new();
        for step in 0..40 {
            let before = v.clone();
            let context = format!("sequence {sequence} step {step}");
            let e = v.epoch as usize;
            match rng.below(6) {
                0 | 1 => {
                    // The operational signer can only sign under a root whose key it
                    // holds: never one that only the master can derive.
                    if rec.contains(&v.op_root) || op0[e + 1..].contains(&v.op_root) {
                        continue;
                    }
                    // It chooses the next root freely, and chooses adversarially.
                    let marked: Vec<[u8; 32]> = retired.iter().copied().collect();
                    let next = match rng.below(10) {
                        0 => v.op_root,
                        1 => v.rec_root,
                        2 if !marked.is_empty() => marked[rng.below(marked.len() as u64) as usize],
                        3 => rec[e + 1],
                        4 => op0[e + 1],
                        5 => rec[e + 2],
                        6 => op0[e + 2],
                        _ => rng.root(),
                    };
                    // The program refuses a next root that is already marked.
                    if retired.contains(&next) {
                        rejected += 1;
                        continue;
                    }
                    let mut bytes = announce_bytes(&v, next, 1 + rng.below(1_000_000), now + rng.below(7200) as i64 - 600, rng.below(4) == 0);
                    let corrupt = rng.below(4) == 0;
                    if corrupt {
                        let at = rng.below(bytes.len() as u64) as usize;
                        bytes[at] ^= 1 << rng.below(8);
                    }
                    let digest = rng.root();
                    // The program's finding about the destination; either may occur.
                    let to_trusted = rng.below(3) == 0;
                    let wait = if to_trusted { 0 } else { delay };
                    match decode_announce(&bytes).and_then(|a| apply_announce(&mut v, &a, digest, now, to_trusted).map(|old| (a, old))) {
                        Ok((a, displaced)) => {
                            assert_eq!(displaced, before.op_root, "{context}");
                            assert!(before.pending.is_none(), "{context}: announced over a pending record");
                            assert!(now <= a.announce_by, "{context}: landed after announce_by");
                            assert_eq!((v.epoch, v.op_index), (before.epoch, before.op_index + 1), "{context}");
                            assert!(retired.insert(displaced), "{context}: an authority was used twice");
                            assert!(!retired.contains(&v.op_root) && v.op_root != v.rec_root, "{context}");
                            let p = v.pending.as_ref().unwrap();
                            assert_eq!(p.opens_at - now, wait as i64, "{context}: wrong wait");
                            assert_eq!((p.deadline - p.opens_at, p.epoch, p.digest), (execute_window(wait), v.epoch, digest), "{context}");
                            announced += 1;
                        }
                        Err(_) => {
                            assert_eq!(v, before, "{context}: a rejected announcement changed state");
                            rejected += 1;
                        }
                    }
                }
                2 => match check_execute(&v, now) {
                    Ok(p) => {
                        assert!(now >= p.opens_at && now <= p.deadline && p.epoch == v.epoch, "{context}");
                        assert_eq!(Some(&p), v.pending.as_ref(), "{context}");
                        // The program clears the record with the transfer.
                        v.pending = None;
                        assert!(paid.insert(p.digest), "{context}: one announcement paid twice");
                        executed += 1;
                    }
                    Err(_) => assert_eq!(v, before, "{context}"),
                },
                3 => match apply_expire(&mut v, now) {
                    Ok(()) => {
                        let p = before.pending.as_ref().expect("expired nothing");
                        assert!(now > p.deadline, "{context}: expired early");
                        assert_eq!((v.pending.clone(), v.op_root, v.op_index, v.epoch), (None, before.op_root, before.op_index, before.epoch), "{context}");
                    }
                    Err(_) => assert_eq!(v, before, "{context}"),
                },
                4 => {
                    // The one packet the master makes for this epoch, sometimes damaged.
                    let mut bytes = recover_bytes(&v, rec[e + 1], op0[e + 1]);
                    let corrupt = rng.below(4) == 0;
                    if corrupt {
                        let at = rng.below(bytes.len() as u64) as usize;
                        bytes[at] ^= 1 << rng.below(8);
                    }
                    // The program refuses next roots that are already marked.
                    let unmarked = decode_recover(&bytes).is_ok_and(|r| !retired.contains(&r.next_rec_root) && !retired.contains(&r.next_op_root));
                    let result = if unmarked { decode_recover(&bytes).and_then(|r| apply_recover(&mut v, &r)) } else { Err(invalid()) };
                    // Whatever the operational signer has done, in this epoch or any
                    // earlier one, the undamaged packet always lands.
                    assert!(corrupt || result.is_ok(), "{context}: the recovery packet for epoch {e} was refused");
                    match result {
                        Ok(old_rec) => {
                            assert_eq!(old_rec, before.rec_root, "{context}");
                            assert_eq!((v.epoch, v.op_index, v.pending.clone()), (before.epoch + 1, 0, None), "{context}");
                            assert!(retired.insert(old_rec), "{context}: a recovery root was used twice");
                            assert!(!retired.contains(&v.op_root) && !retired.contains(&v.rec_root) && v.op_root != v.rec_root, "{context}");
                            assert!(check_execute(&v, now).is_err() && check_execute(&v, now + delay as i64).is_err(), "{context}: a cancelled withdrawal can still execute");
                            recovered += 1;
                        }
                        Err(_) => {
                            assert_eq!(v, before, "{context}: a rejected recovery changed state");
                            rejected += 1;
                        }
                    }
                }
                _ => now += [1, 60, 3_600, 86_400, 700_000][rng.below(5) as usize],
            }
            // Whatever happened: identity and delay never change, counters never go back, the layout round-trips.
            assert_eq!((v.vault_id, v.chain_tag, v.delay_secs, v.bump, v.trusted), (before.vault_id, before.chain_tag, before.delay_secs, before.bump, before.trusted), "{context}");
            assert!((v.epoch, v.op_index) >= (before.epoch, before.op_index) || v.epoch > before.epoch, "{context}: counters went backwards");
            let mut packed = [0u8; VAULT_LEN];
            v.pack(&mut packed).unwrap();
            assert_eq!(Vault::unpack(&packed).unwrap(), v, "{context}: layout did not round-trip");
        }
    }
    // The run must have actually exercised each path.
    assert!(announced > 50_000 && executed > 10_000 && recovered > 20_000 && rejected > 20_000, "{announced} {executed} {recovered} {rejected}");
}

/// Arbitrary bytes never panic a decoder, and anything accepted is canonical.
#[test]
fn decoders_never_panic_and_accept_only_canonical_bytes() {
    let mut rng = Rng(0xD1B5_4A32_D192_ED03);
    let mut accepted = 0u32;
    for _ in 0..300_000u32 {
        let length = match rng.below(6) {
            0 => ANNOUNCE_LEN,
            1 => RECOVER_LEN,
            2 => VAULT_LEN,
            3 => INIT_LEN,
            _ => rng.below(400) as usize,
        };
        let mut bytes: Vec<u8> = (0..length).map(|_| rng.next() as u8).collect();
        // Give most inputs a plausible header so they reach the field checks.
        if length >= 2 && rng.below(4) != 0 {
            bytes[0] = VERSION;
            bytes[1] = 1 + rng.below(2) as u8;
        }
        if length == ANNOUNCE_LEN && rng.below(2) == 0 {
            bytes[82] = rng.below(2) as u8;
            if bytes[82] == 0 {
                bytes[83..115].fill(0);
            }
        }
        if length == VAULT_LEN && rng.below(2) == 0 {
            bytes[..8].copy_from_slice(VAULT_MAGIC);
            bytes[156] = rng.below(2) as u8;
            if bytes[156] == 0 && rng.below(2) == 0 {
                bytes[157..286].fill(0);
            }
        }
        if let Ok(a) = decode_announce(&bytes) {
            accepted += 1;
            assert!(a.amount > 0 && a.announce_by > 0 && a.kind <= 1 && a.next_op_root != [0; 32]);
            assert_eq!(a.kind == 0, a.mint == [0; 32]);
        }
        if let Ok(r) = decode_recover(&bytes) {
            accepted += 1;
            assert!(r.next_rec_root != r.next_op_root && r.next_rec_root != [0; 32] && r.next_op_root != [0; 32]);
        }
        if let Ok(v) = Vault::unpack(&bytes) {
            accepted += 1;
            let mut again = [0u8; VAULT_LEN];
            v.pack(&mut again).unwrap();
            assert_eq!(again.to_vec(), bytes, "an accepted vault was not in canonical form");
        }
        if let Ok(v) = new_vault([7; 32], &bytes, 255) {
            accepted += 1;
            assert!(v.delay_secs <= MAX_DELAY_SECS && v.op_root != v.rec_root);
        }
    }
    assert!(accepted > 10_000, "the generator reached too few accepting paths: {accepted}");
}
