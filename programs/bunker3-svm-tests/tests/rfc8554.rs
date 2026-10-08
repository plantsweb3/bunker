//! LM-OTS against RFC 8554, Appendix F. Test Case 1 gives two signatures and
//! no private key, so it checks verification. Test Case 2 gives the private
//! key of its second-level tree as a seed, so it checks key generation and
//! signing. `fixtures/rfc8554-test-case-*.json` hold the values as printed.
use bunker_lmots::{candidate_key, signer, IDENTIFIER_LEN, SIGNATURE_LEN, TYPECODE};
use solana_sha256_hasher::hashv;

fn hex(v: &serde_json::Value) -> Vec<u8> {
    let s = v.as_str().unwrap();
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}
struct Case {
    identifier: [u8; IDENTIFIER_LEN],
    q: u32,
    message: Vec<u8>,
    signature: Vec<u8>,
    key: [u8; 32],
    path: Vec<Vec<u8>>,
    lms_root: Vec<u8>,
}
fn cases() -> Vec<Case> {
    let f: serde_json::Value = serde_json::from_str(include_str!("../../../fixtures/rfc8554-test-case-1.json")).unwrap();
    f["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            let mut signature = TYPECODE.to_vec();
            signature.extend(hex(&c["C"]));
            for y in c["y"].as_array().unwrap() {
                signature.extend(hex(y));
            }
            Case {
                identifier: hex(&c["I"]).try_into().unwrap(),
                q: c["q"].as_u64().unwrap() as u32,
                message: hex(&c["message"]),
                signature,
                key: hex(&c["lmotsPublicKey"]).try_into().unwrap(),
                path: c["lmsPath"].as_array().unwrap().iter().map(hex).collect(),
                lms_root: hex(&c["lmsPublicKey"]),
            }
        })
        .collect()
}
const NO_LIMIT: u32 = u32::MAX;

#[test]
fn the_rfc_signatures_verify_to_the_rfc_public_keys() {
    let cases = cases();
    assert_eq!(cases.len(), 2);
    for c in &cases {
        assert_eq!(c.signature.len(), SIGNATURE_LEN);
        let parts: [&[u8]; 4] = [&c.message, &[], &[], &[]];
        let candidate = candidate_key(&c.identifier, c.q, parts, &c.signature, NO_LIMIT).unwrap();
        assert_eq!(candidate, c.key);
        // The candidate is not printed in the RFC. What is printed is the LMS
        // public key it must lead to through the printed path (RFC 8554,
        // Algorithm 6a), so walk it: height 5, leaf number 2^5 + q.
        let mut node = 32 + c.q;
        let mut value = hashv(&[&c.identifier, &node.to_be_bytes(), &[0x82, 0x82], &candidate]).to_bytes();
        for sibling in &c.path {
            let parent = (node / 2).to_be_bytes();
            let (left, right): (&[u8], &[u8]) = if node % 2 == 1 { (sibling, &value) } else { (&value, sibling) };
            value = hashv(&[&c.identifier, &parent, &[0x83, 0x83], left, right]).to_bytes();
            node /= 2;
        }
        assert_eq!(value.to_vec(), c.lms_root, "the LMS public key printed in the RFC");
    }
}

#[test]
fn an_rfc_signature_does_not_verify_for_anything_else() {
    for c in &cases() {
        let parts: [&[u8]; 4] = [&c.message, &[], &[], &[]];
        let mut other = c.message.clone();
        other[0] ^= 1;
        assert_ne!(candidate_key(&c.identifier, c.q, [&other, &[], &[], &[]], &c.signature, NO_LIMIT), Some(c.key));
        assert_ne!(candidate_key(&c.identifier, c.q + 1, parts, &c.signature, NO_LIMIT), Some(c.key));
        let mut identifier = c.identifier;
        identifier[15] ^= 1;
        assert_ne!(candidate_key(&identifier, c.q, parts, &c.signature, NO_LIMIT), Some(c.key));
        for at in (4..SIGNATURE_LEN).step_by(97) {
            let mut bad = c.signature.clone();
            bad[at] ^= 1;
            assert_ne!(candidate_key(&c.identifier, c.q, parts, &bad, NO_LIMIT), Some(c.key), "byte {at}");
        }
    }
}

/// The test signer agrees with the verifier, so the keys the other VM tests
/// use are ordinary keys of the parameter set.
#[test]
fn the_test_signer_produces_signatures_the_verifier_accepts() {
    let c = &cases()[0];
    let mut x = [[0u8; 32]; 34];
    for (i, v) in x.iter_mut().enumerate() {
        *v = hashv(&[b"rfc test", &[i as u8]]).to_bytes();
    }
    let key = signer::public_key(&c.identifier, c.q, &x);
    let parts: [&[u8]; 4] = [&c.message, &[], &[], &[]];
    let signature = signer::sign(&c.identifier, c.q, &x, &[3; 32], parts);
    assert_eq!(candidate_key(&c.identifier, c.q, parts, &signature, NO_LIMIT), Some(key));
}

/// RFC 8554 Appendix F, Test Case 2: with the private key the RFC gives, the
/// signer reproduces the RFC's signature byte for byte, and its public key
/// leads through the RFC's path to the RFC's LMS public key.
#[test]
fn the_signer_reproduces_the_rfc_signature_from_the_rfc_private_key() {
    let f: serde_json::Value = serde_json::from_str(include_str!("../../../fixtures/rfc8554-test-case-2.json")).unwrap();
    let identifier: [u8; IDENTIFIER_LEN] = hex(&f["I"]).try_into().unwrap();
    let q = f["q"].as_u64().unwrap() as u32;
    let (seed, message) = (hex(&f["seed"]), hex(&f["message"]));
    // Appendix A: x[i] = H(I || u32str(q) || u16str(i) || u8str(0xff) || SEED).
    let mut x = [[0u8; 32]; 34];
    for (i, v) in x.iter_mut().enumerate() {
        *v = hashv(&[&identifier, &q.to_be_bytes(), &(i as u16).to_be_bytes(), &[0xff], &seed]).to_bytes();
    }
    let randomizer: [u8; 32] = hex(&f["C"]).try_into().unwrap();
    let parts: [&[u8]; 4] = [&message, &[], &[], &[]];
    let signature = signer::sign(&identifier, q, &x, &randomizer, parts);
    let mut printed = TYPECODE.to_vec();
    printed.extend(&randomizer);
    for y in f["y"].as_array().unwrap() {
        printed.extend(hex(y));
    }
    assert_eq!(signature.to_vec(), printed);

    let key = signer::public_key(&identifier, q, &x);
    assert_eq!(candidate_key(&identifier, q, parts, &printed, NO_LIMIT), Some(key));
    let mut node = 32 + q;
    let mut value = hashv(&[&identifier, &node.to_be_bytes(), &[0x82, 0x82], &key]).to_bytes();
    for sibling in f["lmsPath"].as_array().unwrap().iter().map(hex) {
        let parent = (node / 2).to_be_bytes();
        let (left, right): (&[u8], &[u8]) = if node % 2 == 1 { (&sibling, &value) } else { (&value, &sibling) };
        value = hashv(&[&identifier, &parent, &[0x83, 0x83], left, right]).to_bytes();
        node /= 2;
    }
    assert_eq!(value.to_vec(), hex(&f["lmsPublicKey"]));
}
