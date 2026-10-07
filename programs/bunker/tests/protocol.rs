use bunker::{check_expiry, decode_intent, DOMAIN, INTENT_LEN};
use solana_pubkey::Pubkey;
use solana_sha256_hasher::hashv;
use std::str::FromStr;
use winterwallet_core::{WinternitzRoot, WinternitzSignature};
fn bytes(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}
fn fixture() -> serde_json::Value {
    serde_json::from_str(include_str!("../../../fixtures/bunker-v2.json")).unwrap()
}
#[test]
fn canonical_fixture_verification_and_rotation() {
    let f = fixture();
    let program = Pubkey::from_str(f["program"].as_str().unwrap()).unwrap();
    let vault = Pubkey::from_str(f["vault"].as_str().unwrap()).unwrap();
    let vectors = f["vectors"].as_array().unwrap();
    for (index, v) in vectors.iter().enumerate() {
        let payload = bytes(v["payload"].as_str().unwrap());
        let w = decode_intent(&payload).unwrap();
        assert_eq!(w.nonce, index as u64);
        assert_eq!(w.amount, 123456789 + index as u64);
        assert_eq!(w.expiry, 987654321);
        assert_eq!(w.vault_id.to_vec(), bytes(f["vaultId"].as_str().unwrap()));
        assert_eq!(
            w.destination.to_string(),
            f["destination"].as_str().unwrap()
        );
        let expected_message = [DOMAIN, program.as_ref(), vault.as_ref(), &payload].concat();
        assert_eq!(expected_message, bytes(v["message"].as_str().unwrap()));
        assert_eq!(
            hashv(&[&expected_message]).to_bytes().to_vec(),
            bytes(v["digest"].as_str().unwrap())
        );
        let root = WinternitzRoot::new(bytes(v["root"].as_str().unwrap()).try_into().unwrap());
        let sig_bytes = bytes(v["signature"].as_str().unwrap());
        let signature: &WinternitzSignature<32> = sig_bytes.as_slice().try_into().unwrap();
        assert!(signature.verify(&[&expected_message], &root));
        for offset in [0, 20, 52, 84, 85, 117, 125, 126, 158, 190, 198, 206] {
            let mut altered = expected_message.clone();
            altered[offset] ^= 1;
            assert!(
                !signature.verify(&[&altered], &root),
                "changed signed byte {offset}"
            );
        }
        assert_eq!(w.next.to_vec(), bytes(v["nextRoot"].as_str().unwrap()));
        if index + 1 < vectors.len() {
            assert_eq!(v["nextRoot"], vectors[index + 1]["root"]);
        }
    }
}
#[test]
fn rejects_noncanonical_encodings() {
    let f = fixture();
    let valid = bytes(f["vectors"][0]["payload"].as_str().unwrap());
    for length in 0..INTENT_LEN {
        assert!(decode_intent(&valid[..length]).is_err());
    }
    let mut trailing = valid.clone();
    trailing.push(0);
    assert!(decode_intent(&trailing).is_err());
    for (offset, value) in [(0, 1), (41, 2), (42, 1)] {
        let mut bad = valid.clone();
        bad[offset] = value;
        assert!(decode_intent(&bad).is_err());
    }
    for range in [106..114, 114..122, 122..154] {
        let mut bad = valid.clone();
        bad[range].fill(0);
        assert!(decode_intent(&bad).is_err());
    }
    let mut exhausted = valid;
    exhausted[33..41].fill(255);
    assert!(decode_intent(&exhausted).is_err());
}
#[test]
fn expiry_is_inclusive_and_past_slot_fails() {
    assert!(check_expiry(100, 99).is_ok());
    assert!(check_expiry(100, 100).is_ok());
    assert!(check_expiry(100, 101).is_err());
}
