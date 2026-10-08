//! Every row of the transition table in docs/PROTOCOL.md, plus encoding
//! and boundary cases, against the pure state logic the program executes.
use bunker3::state::*;

const NOW: i64 = 1_800_000_000;
/// The waiting period most tests opt into.
const DAY: u32 = 86_400;
fn root(tag: u8) -> [u8; 32] {
    [tag; 32]
}
fn vault() -> Vault {
    Vault {
        vault_id: root(1),
        chain_tag: root(2),
        op_root: root(10),
        op_index: 0,
        epoch: 0,
        rec_root: root(20),
        delay_secs: DAY,
        pending: None,
        bump: 254,
    }
}
fn announce_bytes(v: &Vault, next: [u8; 32]) -> Vec<u8> {
    let mut d = vec![VERSION, ROLE_OPERATIONAL];
    d.extend(v.vault_id);
    d.extend(v.chain_tag);
    d.extend(v.epoch.to_le_bytes());
    d.extend(v.op_index.to_le_bytes());
    d.push(0);
    d.extend([0u8; 32]);
    d.extend(root(77));
    d.extend(5_000_000u64.to_le_bytes());
    d.extend((NOW + 3600).to_le_bytes());
    d.extend(next);
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
fn announced() -> Vault {
    let mut v = vault();
    let a = decode_announce(&announce_bytes(&v, root(11))).unwrap();
    assert_eq!(apply_announce(&mut v, &a, root(99), NOW).unwrap(), root(10));
    v
}

#[test]
fn layout_sizes_match_the_specification() {
    assert_eq!(announce_bytes(&vault(), root(11)).len(), ANNOUNCE_LEN);
    assert_eq!(recover_bytes(&vault(), root(21), root(12)).len(), RECOVER_LEN);
    assert_eq!(ANNOUNCE_DOMAIN.len(), RECOVER_DOMAIN.len());
    assert_ne!(ANNOUNCE_DOMAIN, RECOVER_DOMAIN);
    assert_eq!((VAULT_LEN, ANNOUNCE_LEN, RECOVER_LEN, INIT_LEN), (287, 195, 138, 132));
}

#[test]
fn vault_round_trips_with_and_without_a_pending_record() {
    for v in [vault(), announced()] {
        let mut bytes = [0u8; VAULT_LEN];
        v.pack(&mut bytes).unwrap();
        assert_eq!(Vault::unpack(&bytes).unwrap(), v);
    }
    let mut bytes = [0u8; VAULT_LEN];
    announced().pack(&mut bytes).unwrap();
    assert_eq!(&bytes[..8], b"BUNKER03");
    assert_eq!(bytes[156], 1);
    assert_eq!(&bytes[190..222], &root(77));
    assert_eq!(bytes[286], 254);
}

#[test]
fn vault_rejects_bad_magic_length_flag_and_stale_pending_bytes() {
    let mut bytes = [0u8; VAULT_LEN];
    vault().pack(&mut bytes).unwrap();
    assert!(Vault::unpack(&bytes[..VAULT_LEN - 1]).is_err());
    let mut bad = bytes;
    bad[0] ^= 1;
    assert!(Vault::unpack(&bad).is_err());
    let mut bad = bytes;
    bad[156] = 2;
    assert!(Vault::unpack(&bad).is_err());
    // With the flag clear, any leftover record byte is rejected.
    for offset in 157..286 {
        let mut bad = bytes;
        bad[offset] = 1;
        assert!(Vault::unpack(&bad).is_err(), "stale byte {offset}");
    }
}

#[test]
fn initialization_rules() {
    let mut data = Vec::new();
    data.extend(root(1));
    data.extend(root(2));
    data.extend(root(10));
    data.extend(root(20));
    data.extend(DAY.to_le_bytes());
    let v = new_vault(root(1), &data, 250).unwrap();
    assert_eq!((v.op_index, v.epoch, v.pending.clone(), v.bump), (0, 0, None, 250));
    let with = |range: std::ops::Range<usize>, bytes: &[u8]| {
        let mut d = data.clone();
        d[range].copy_from_slice(bytes);
        new_vault(root(1), &d, 250)
    };
    assert!(with(64..96, &[0; 32]).is_err(), "zero operational root");
    assert!(with(96..128, &[0; 32]).is_err(), "zero recovery root");
    assert!(with(96..128, &root(10)).is_err(), "equal roots");
    // The waiting period is optional: zero and anything up to the maximum.
    for delay in [0u32, 1, 3_600, DAY - 1, DAY] {
        assert_eq!(with(128..132, &delay.to_le_bytes()).unwrap().delay_secs, delay);
    }
    assert!(with(128..132, &(MAX_DELAY_SECS + 1).to_le_bytes()).is_err());
    assert!(with(128..132, &MAX_DELAY_SECS.to_le_bytes()).is_ok());
    assert!(new_vault(root(1), &data[..131], 250).is_err());
}

#[test]
fn announce_decoding_is_strict() {
    let good = announce_bytes(&vault(), root(11));
    assert!(decode_announce(&good).is_ok());
    for length in 0..ANNOUNCE_LEN {
        assert!(decode_announce(&good[..length]).is_err());
    }
    let mut long = good.clone();
    long.push(0);
    assert!(decode_announce(&long).is_err());
    let with = |offset: usize, bytes: &[u8]| {
        let mut d = good.clone();
        d[offset..offset + bytes.len()].copy_from_slice(bytes);
        decode_announce(&d)
    };
    assert!(with(0, &[2]).is_err(), "version");
    assert!(with(1, &[ROLE_RECOVERY]).is_err(), "role");
    assert!(with(82, &[2]).is_err(), "kind");
    assert!(with(83, &[1]).is_err(), "SOL with a mint");
    assert!(with(82, &[1]).is_err(), "token without a mint");
    assert!(with(147, &0u64.to_le_bytes()).is_err(), "zero amount");
    assert!(with(155, &0i64.to_le_bytes()).is_err(), "zero announce_by");
    assert!(with(155, &(-1i64).to_le_bytes()).is_err(), "negative announce_by");
    assert!(with(163, &[0; 32]).is_err(), "zero next root");
    let mut token = good.clone();
    token[82] = 1;
    token[83..115].copy_from_slice(&root(50));
    assert_eq!(decode_announce(&token).unwrap().mint, root(50));
}

#[test]
fn recover_decoding_is_strict_and_roles_do_not_cross() {
    let good = recover_bytes(&vault(), root(21), root(12));
    assert!(decode_recover(&good).is_ok());
    for length in 0..RECOVER_LEN {
        assert!(decode_recover(&good[..length]).is_err());
    }
    let with = |offset: usize, bytes: &[u8]| {
        let mut d = good.clone();
        d[offset..offset + bytes.len()].copy_from_slice(bytes);
        decode_recover(&d)
    };
    assert!(with(0, &[2]).is_err());
    assert!(with(1, &[ROLE_OPERATIONAL]).is_err());
    assert!(with(74, &[0; 32]).is_err());
    assert!(with(106, &[0; 32]).is_err());
    assert!(with(106, &root(21)).is_err(), "identical next roots");
    // Neither message parses as the other.
    assert!(decode_recover(&announce_bytes(&vault(), root(11))).is_err());
    assert!(decode_announce(&good).is_err());
}

#[test]
fn announce_rotates_records_and_moves_nothing() {
    let v = announced();
    assert_eq!((v.epoch, v.op_index, v.op_root), (0, 1, root(11)));
    assert_eq!(v.rec_root, root(20));
    let p = v.pending.unwrap();
    assert_eq!(p.opens_at, NOW + DAY as i64);
    assert_eq!(p.deadline, p.opens_at + EXECUTE_WINDOW_SECS);
    assert_eq!((p.amount, p.destination, p.epoch, p.digest), (5_000_000, root(77), 0, root(99)));
}

#[test]
fn announce_guards() {
    let base = vault();
    let try_with = |edit: &dyn Fn(&mut Vec<u8>), now: i64, state: &Vault| {
        let mut d = announce_bytes(&base, root(11));
        edit(&mut d);
        let mut v = state.clone();
        let before = v.clone();
        let result = decode_announce(&d).and_then(|a| apply_announce(&mut v, &a, root(99), now));
        if result.is_err() {
            assert_eq!(v, before, "a rejected announcement must not change state");
        }
        result
    };
    assert!(try_with(&|_| {}, NOW + 3600, &base).is_ok(), "inclusive announce_by");
    assert!(try_with(&|_| {}, NOW + 3601, &base).is_err(), "after announce_by");
    // A deadline further ahead than the protocol allows is refused.
    let far = |ahead: i64| move |d: &mut Vec<u8>| d[155..163].copy_from_slice(&(NOW + ahead).to_le_bytes());
    assert!(try_with(&far(MAX_ANNOUNCE_AHEAD_SECS), NOW, &base).is_ok(), "furthest allowed deadline");
    assert!(try_with(&far(MAX_ANNOUNCE_AHEAD_SECS + 1), NOW, &base).is_err(), "deadline too far ahead");
    assert!(try_with(&|d| d[2] ^= 1, NOW, &base).is_err(), "vault id");
    assert!(try_with(&|d| d[34] ^= 1, NOW, &base).is_err(), "chain tag");
    assert!(try_with(&|d| d[66] = 1, NOW, &base).is_err(), "epoch");
    assert!(try_with(&|d| d[74] = 1, NOW, &base).is_err(), "operational index");
    assert!(
        try_with(&|d| d[163..195].copy_from_slice(&root(10)), NOW, &base).is_err(),
        "next root equals current operational root"
    );
    assert!(
        try_with(&|d| d[163..195].copy_from_slice(&root(20)), NOW, &base).is_err(),
        "next root equals recovery root"
    );
    // One pending operation at a time, even with the correct next index.
    let pending = announced();
    let mut d = announce_bytes(&pending, root(12));
    d[74..82].copy_from_slice(&1u64.to_le_bytes());
    let mut v = pending.clone();
    let a = decode_announce(&d).unwrap();
    assert!(apply_announce(&mut v, &a, root(98), NOW).is_err());
    assert_eq!(v, pending);
}

#[test]
fn announce_fails_closed_on_counter_and_time_overflow() {
    let mut v = vault();
    v.op_index = u64::MAX;
    let a = decode_announce(&announce_bytes(&v, root(11))).unwrap();
    assert!(apply_announce(&mut v, &a, root(99), NOW).is_err());
    let mut v = vault();
    let mut d = announce_bytes(&v, root(11));
    d[155..163].copy_from_slice(&i64::MAX.to_le_bytes());
    let a = decode_announce(&d).unwrap();
    assert!(apply_announce(&mut v, &a, root(99), i64::MAX - 10).is_err());
    assert_eq!(v, vault());
}

#[test]
fn execute_only_inside_the_window() {
    let v = announced();
    let p = v.pending.clone().unwrap();
    assert!(check_execute(&v, p.opens_at - 1).is_err(), "one second early");
    assert!(check_execute(&v, NOW).is_err(), "immediately after announcing");
    assert_eq!(check_execute(&v, p.opens_at).unwrap(), p, "opens inclusively");
    assert_eq!(check_execute(&v, p.deadline).unwrap(), p, "deadline inclusive");
    assert!(check_execute(&v, p.deadline + 1).is_err(), "one second late");
    assert!(check_execute(&vault(), NOW).is_err(), "nothing pending");
    // The wait is exactly the vault's own setting.
    assert_eq!(p.opens_at - NOW, DAY as i64);
}

#[test]
fn a_vault_without_a_waiting_period_can_execute_at_once() {
    let mut v = vault();
    v.delay_secs = 0;
    let a = decode_announce(&announce_bytes(&v, root(11))).unwrap();
    apply_announce(&mut v, &a, root(99), NOW).unwrap();
    let p = v.pending.clone().unwrap();
    assert_eq!((p.opens_at, p.deadline), (NOW, NOW + EXECUTE_WINDOW_SECS));
    assert_eq!(check_execute(&v, NOW).unwrap(), p, "same second as the announcement");
    assert!(check_execute(&v, NOW - 1).is_err());
    // The authority still rotated and the record still clears on recovery.
    assert_eq!((v.op_index, v.op_root), (1, root(11)));
    let r = decode_recover(&recover_bytes(&v, root(21), root(12))).unwrap();
    apply_recover(&mut v, &r).unwrap();
    assert!(check_execute(&v, NOW).is_err());
}

#[test]
fn execute_refuses_a_record_from_another_epoch() {
    let mut v = announced();
    let opens = v.pending.as_ref().unwrap().opens_at;
    v.epoch = 1;
    assert!(check_execute(&v, opens).is_err());
}

#[test]
fn expire_only_after_the_deadline_and_keeps_the_authority() {
    let mut v = announced();
    let deadline = v.pending.as_ref().unwrap().deadline;
    assert!(apply_expire(&mut v, deadline).is_err());
    assert!(v.pending.is_some());
    apply_expire(&mut v, deadline + 1).unwrap();
    assert_eq!((v.pending.clone(), v.op_root, v.op_index, v.epoch), (None, root(11), 1, 0));
    assert!(apply_expire(&mut v, deadline + 2).is_err(), "nothing left to expire");
}

#[test]
fn recover_installs_a_new_epoch_from_every_state() {
    for (label, start) in [("idle", vault()), ("pending", announced())] {
        let mut v = start.clone();
        let r = decode_recover(&recover_bytes(&v, root(21), root(12))).unwrap();
        let displaced = apply_recover(&mut v, &r).unwrap();
        assert_eq!(displaced, (start.rec_root, Some(start.op_root)), "{label}");
        assert_eq!(
            (v.epoch, v.op_index, v.rec_root, v.op_root, v.pending.clone()),
            (1, 0, root(21), root(12), None),
            "{label}"
        );
        assert_eq!((v.vault_id, v.chain_tag, v.delay_secs, v.bump), (root(1), root(2), DAY, 254));
        // A stale execute now finds nothing; the same packet cannot apply twice.
        assert!(check_execute(&v, NOW + 200_000).is_err());
        assert!(apply_recover(&mut v, &r).is_err(), "{label}: packet is bound to its epoch");
    }
}

#[test]
fn recover_does_not_depend_on_operational_progress() {
    // The packet for epoch 0 is the same bytes before and after announcements.
    let before = recover_bytes(&vault(), root(21), root(12));
    let after = recover_bytes(&announced(), root(21), root(12));
    assert_eq!(before, after);
    let mut v = announced();
    assert!(apply_recover(&mut v, &decode_recover(&before).unwrap()).is_ok());
}

#[test]
fn recover_guards() {
    let base = announced();
    let try_with = |edit: &dyn Fn(&mut Vec<u8>)| {
        let mut d = recover_bytes(&base, root(21), root(12));
        edit(&mut d);
        let mut v = base.clone();
        let result = decode_recover(&d).and_then(|r| apply_recover(&mut v, &r));
        if result.is_err() {
            assert_eq!(v, base, "a rejected recovery must not change state");
        }
        result
    };
    assert!(try_with(&|_| {}).is_ok());
    assert!(try_with(&|d| d[2] ^= 1).is_err(), "vault id");
    assert!(try_with(&|d| d[34] ^= 1).is_err(), "chain tag");
    assert!(try_with(&|d| d[66] = 1).is_err(), "future epoch");
    for (offset, label) in [(74, "next recovery root"), (106, "next operational root")] {
        assert!(
            try_with(&|d| d[offset..offset + 32].copy_from_slice(&root(20))).is_err(),
            "{label} reuses the current recovery root"
        );
    }
    let mut v = vault();
    v.epoch = u64::MAX;
    let r = decode_recover(&recover_bytes(&v, root(21), root(12))).unwrap();
    assert!(apply_recover(&mut v, &r).is_err(), "epoch overflow fails closed");
}

#[test]
fn a_full_life_cycle_never_reuses_an_authority_tuple() {
    let mut v = vault();
    let mut seen = std::collections::HashSet::new();
    let mut next = 100u8;
    for round in 0..3 {
        for _ in 0..2 {
            assert!(seen.insert((v.epoch, v.op_index)), "tuple reused");
            next += 1;
            let a = decode_announce(&announce_bytes(&v, root(next))).unwrap();
            apply_announce(&mut v, &a, root(99), NOW).unwrap();
            let deadline = v.pending.as_ref().unwrap().deadline;
            apply_expire(&mut v, deadline + 1).unwrap();
        }
        next += 2;
        let r = decode_recover(&recover_bytes(&v, root(next), root(next - 1))).unwrap();
        apply_recover(&mut v, &r).unwrap();
        assert_eq!((v.epoch, v.op_index), (round + 1, 0));
    }
}

/// The operational signer chooses the next operational root freely, so it can
/// install a root the recovery packet names. The packet must still apply:
/// otherwise a stolen day key could block cancel-by-recovery.
#[test]
fn an_operational_key_cannot_make_the_recovery_packet_fail() {
    for (label, planted) in [("next operational root", root(12)), ("next recovery root", root(21))] {
        let mut v = vault();
        let a = decode_announce(&announce_bytes(&v, planted)).unwrap();
        apply_announce(&mut v, &a, root(99), NOW).unwrap();
        assert_eq!(v.op_root, planted);
        let r = decode_recover(&recover_bytes(&v, root(21), root(12))).unwrap();
        let (old_rec, old_op) = apply_recover(&mut v, &r).unwrap();
        // The planted root is installed, not retired.
        assert_eq!((old_rec, old_op), (root(20), None), "{label}");
        assert_eq!(
            (v.epoch, v.op_index, v.rec_root, v.op_root, v.pending.clone()),
            (1, 0, root(21), root(12), None),
            "{label}"
        );
    }
}
