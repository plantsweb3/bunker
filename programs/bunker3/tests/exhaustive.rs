//! Every reachable state, not a sample of them.
//!
//! The randomized model in `model.rs` passed while a real flaw was present,
//! because its operational signer chose roots at random and never chose a
//! harmful one. This test removes chance: over a small alphabet of roots it
//! explores EVERY sequence of actions up to a fixed depth, with an operational
//! signer that may choose any root it could know, and checks the invariants in
//! every state reached.
//!
//! What is modelled besides `state.rs` itself: the spent markers the program
//! keeps (a set), the two marker checks the program makes before calling into
//! `state.rs`, and who can sign what. What is not: accounts, lamports, tokens.
use bunker3::state::*;
use std::collections::{BTreeSet, HashSet};

const fn root(id: u8) -> [u8; 32] {
    [id; 32]
}
/// What the master derives: epoch e has recovery root REC[e] and first
/// operational root OP0[e]. The packet for epoch e names REC[e+1] and OP0[e+1].
/// A packet is public once seen, so the operational signer may know all of them.
const REC: [[u8; 32]; 5] = [root(10), root(11), root(12), root(13), root(14)];
const OP0: [[u8; 32]; 5] = [root(20), root(21), root(22), root(23), root(24)];
/// Roots the operational signer makes up and holds keys for.
const OWN: [[u8; 32]; 2] = [root(30), root(31)];
const DESTINATION: [u8; 32] = root(77);
const START: i64 = 1_800_000_000;
/// Recoveries explored. Packets up to this epoch must always land.
const MAX_EPOCH: u64 = 2;
const DEPTH: usize = 12;

#[derive(Clone)]
struct World {
    v: Vault,
    marked: BTreeSet<[u8; 32]>,
    now: i64,
    /// When the pending record was announced and whether its destination was trusted.
    announced: Option<(i64, bool)>,
}
impl World {
    fn key(&self) -> Vec<u8> {
        let mut bytes = vec![0u8; VAULT_LEN];
        self.v.pack(&mut bytes).unwrap();
        for m in &self.marked {
            bytes.extend(m);
        }
        // Only where `now` stands relative to the record matters from here on.
        bytes.push(match &self.v.pending {
            None => 0,
            Some(p) if self.now < p.opens_at => 1,
            Some(p) if self.now <= p.deadline => 2,
            Some(_) => 3,
        });
        bytes
    }
    fn epoch(&self) -> usize {
        self.v.epoch as usize
    }
    /// The operational signer holds the current epoch's seed and whatever keys
    /// it generated itself. It cannot sign under a root only the master derives.
    fn can_sign(&self) -> bool {
        self.v.op_root == OP0[self.epoch()] || OWN.contains(&self.v.op_root)
    }
    fn packet(&self) -> Recover {
        Recover {
            vault_id: self.v.vault_id,
            chain_tag: self.v.chain_tag,
            epoch: self.v.epoch,
            next_rec_root: REC[self.epoch() + 1],
            next_op_root: OP0[self.epoch() + 1],
        }
    }
    /// `recover` as the program runs it: marker checks, then the state change.
    fn recover(&mut self, r: &Recover) -> bool {
        if self.marked.contains(&r.next_rec_root) || self.marked.contains(&r.next_op_root) {
            return false;
        }
        match apply_recover(&mut self.v, r) {
            Ok(old_rec) => {
                assert!(self.marked.insert(old_rec), "a recovery root signed twice");
                self.announced = None;
                true
            }
            Err(_) => false,
        }
    }
}

/// Checked in every state reached.
fn invariants(w: &World, trail: &[String]) {
    let at = || format!("after {trail:?}");
    assert!(w.v.op_root != w.v.rec_root, "one root in both roles {}", at());
    assert!(
        !w.marked.contains(&w.v.op_root) && !w.marked.contains(&w.v.rec_root),
        "a live root is marked spent {}",
        at()
    );
    assert_eq!(w.v.rec_root, REC[w.epoch()], "the recovery root is not the master's {}", at());
    if let (Some(p), Some((when, trusted))) = (&w.v.pending, w.announced) {
        let wait = if trusted { 0 } else { w.v.delay_secs as i64 };
        assert_eq!((p.opens_at, p.deadline), (when + wait, when + wait + execute_window(wait as u32)), "{}", at());
        assert_eq!(p.epoch, w.v.epoch, "a record outlived its epoch {}", at());
    }
    assert_eq!(w.v.pending.is_some(), w.announced.is_some(), "{}", at());
    // The property three review rounds were about: whatever the operational
    // signer has done, in this epoch or any before it, the one packet the
    // master makes for the current epoch lands.
    if w.v.epoch <= MAX_EPOCH {
        let mut after = w.clone();
        assert!(after.recover(&w.packet()), "the recovery packet for epoch {} is refused {}", w.v.epoch, at());
        assert_eq!((after.v.epoch, after.v.op_index, after.v.pending.is_none()), (w.v.epoch + 1, 0, true), "{}", at());
        assert_eq!((after.v.rec_root, after.v.op_root), (REC[w.epoch() + 1], OP0[w.epoch() + 1]), "{}", at());
        // And a packet for any other epoch does not.
        for other in [w.v.epoch + 1, w.v.epoch.wrapping_sub(1)] {
            let mut stale = w.packet();
            stale.epoch = other;
            assert!(!w.clone().recover(&stale), "a packet for another epoch landed {}", at());
        }
    }
}

fn explore(w: World, depth: usize, trail: &mut Vec<String>, seen: &mut HashSet<Vec<u8>>, counts: &mut [u64; 5]) {
    invariants(&w, trail);
    if depth == 0 || !seen.insert([w.key(), vec![depth as u8]].concat()) {
        return;
    }
    let e = w.epoch();
    // ── announce: every next root the signer could name, to a trusted or untrusted destination
    if w.can_sign() {
        let mut candidates = vec![w.v.op_root, w.v.rec_root, REC[e + 1], OP0[e + 1], REC[e + 2], OP0[e + 2], OWN[0], OWN[1]];
        candidates.extend(w.marked.iter().copied());
        for next in candidates {
            for trusted in [false, true] {
                // The program refuses a next root that is already marked.
                if w.marked.contains(&next) {
                    continue;
                }
                let mut n = w.clone();
                let a = Announce {
                    vault_id: n.v.vault_id,
                    chain_tag: n.v.chain_tag,
                    epoch: n.v.epoch,
                    op_index: n.v.op_index,
                    kind: 0,
                    mint: [0; 32],
                    destination: DESTINATION,
                    amount: 1,
                    announce_by: n.now + 10,
                    next_op_root: next,
                    decimals: 0,
                };
                let before = n.v.clone();
                match apply_announce(&mut n.v, &a, root(99), n.now, trusted) {
                    Ok(displaced) => {
                        assert_eq!(displaced, before.op_root);
                        assert!(before.pending.is_none(), "announced over a pending record");
                        assert!(n.marked.insert(displaced), "an operational root signed twice");
                        n.announced = Some((n.now, trusted));
                        counts[0] += 1;
                        trail.push(format!("announce(next={}, trusted={trusted})", next[0]));
                        explore(n, depth - 1, trail, seen, counts);
                        trail.pop();
                    }
                    Err(_) => assert_eq!(n.v, before, "a refused announcement changed state"),
                }
            }
        }
    }
    // ── execute
    if let Ok(p) = check_execute(&w.v, w.now) {
        assert!(w.now >= p.opens_at && w.now <= p.deadline);
        let (when, trusted) = w.announced.expect("a record with no announcement");
        assert!(trusted || w.now >= when + w.v.delay_secs as i64, "left before the wait was over");
        let mut n = w.clone();
        n.v.pending = None;
        n.announced = None;
        counts[1] += 1;
        trail.push("execute".into());
        explore(n, depth - 1, trail, seen, counts);
        trail.pop();
    }
    // ── expire
    {
        let mut n = w.clone();
        if apply_expire(&mut n.v, n.now).is_ok() {
            assert!(w.now > w.v.pending.as_ref().unwrap().deadline, "expired early");
            assert_eq!((n.v.op_root, n.v.op_index, n.v.epoch), (w.v.op_root, w.v.op_index, w.v.epoch));
            n.announced = None;
            counts[2] += 1;
            trail.push("expire".into());
            explore(n, depth - 1, trail, seen, counts);
            trail.pop();
        }
    }
    // ── recover with the master's packet
    if w.v.epoch < MAX_EPOCH {
        let mut n = w.clone();
        assert!(n.recover(&w.packet()));
        counts[3] += 1;
        trail.push("recover".into());
        explore(n, depth - 1, trail, seen, counts);
        trail.pop();
    }
    // ── time: to the moment the record opens, and to just past its deadline
    if let Some(p) = &w.v.pending {
        for to in [p.opens_at, p.deadline + 1] {
            if to > w.now {
                let mut n = w.clone();
                n.now = to;
                counts[4] += 1;
                trail.push(format!("wait until {}", to - START));
                explore(n, depth - 1, trail, seen, counts);
                trail.pop();
            }
        }
    }
}

#[test]
fn every_reachable_state_keeps_every_invariant() {
    let mut total = [0u64; 5];
    for delay in [0u32, 3_600] {
        let start = World {
            v: Vault {
                vault_id: root(1),
                chain_tag: root(2),
                op_root: OP0[0],
                op_index: 0,
                epoch: 0,
                rec_root: REC[0],
                delay_secs: delay,
                pending: None,
                bump: 255,
                trusted: [root(77), [0; 32], [0; 32], [0; 32]],
            },
            marked: BTreeSet::new(),
            now: START,
            announced: None,
        };
        let mut counts = [0u64; 5];
        explore(start, DEPTH, &mut Vec::new(), &mut HashSet::new(), &mut counts);
        for (t, c) in total.iter_mut().zip(counts) {
            *t += c;
        }
    }
    let [announces, executes, expiries, recoveries, waits] = total;
    println!("explored: {announces} announcements, {executes} executions, {expiries} expiries, {recoveries} recoveries, {waits} waits");
    // The search must have gone somewhere on every kind of action.
    assert!(announces > 1_000 && executes > 100 && expiries > 100 && recoveries > 100 && waits > 100, "{total:?}");
}
