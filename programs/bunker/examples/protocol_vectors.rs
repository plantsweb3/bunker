//! PUBLIC TEST MATERIAL ONLY. Reproducible v2 encoding, verification and rotation vectors.
use bunker::{decode_intent, DOMAIN, VERSION};
use solana_pubkey::Pubkey;
use solana_sha256_hasher::hashv;
use winterwallet_core::WinternitzKeypair;
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn main() {
    let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    let mut signer = WinternitzKeypair::from_mnemonic(phrase, 0).unwrap();
    let program = Pubkey::new_from_array([1; 32]);
    let id = [2u8; 32];
    let vault = Pubkey::find_program_address(&[b"bunker", &id], &program).0;
    let destination = Pubkey::new_from_array([3; 32]);
    let mut vectors = Vec::new();
    for nonce in 0u64..2 {
        let key = signer.derive::<32>();
        let root = key.to_pubkey().merklize();
        let next_signer =
            WinternitzKeypair::from_mnemonic_at(phrase, 0, 0, nonce as u32 + 1).unwrap();
        let next_key = next_signer.derive::<32>();
        let next_root = next_key.to_pubkey().merklize();
        let mut payload = vec![VERSION];
        payload.extend(id);
        payload.extend(nonce.to_le_bytes());
        payload.push(0);
        payload.extend([0u8; 32]);
        payload.extend(destination.to_bytes());
        payload.extend((123456789u64 + nonce).to_le_bytes());
        payload.extend(987654321u64.to_le_bytes());
        payload.extend(next_root.as_bytes());
        decode_intent(&payload).unwrap();
        let mut message = DOMAIN.to_vec();
        message.extend(program.to_bytes());
        message.extend(vault.to_bytes());
        message.extend(&payload);
        let signature = signer.sign_and_increment::<32>(&[&message]);
        assert!(signature.verify(&[&message], &root));
        vectors.push(serde_json::json!({ "nonce": nonce.to_string(), "nextNonce": (nonce+1).to_string(),
          "secret": hex(key.as_bytes()), "root": hex(root.as_bytes()), "nextRoot": hex(next_root.as_bytes()),
          "payload": hex(&payload), "message": hex(&message), "digest": hex(&hashv(&[&message]).to_bytes()), "signature": hex(signature.as_bytes()) }));
    }
    println!("{}", serde_json::to_string_pretty(&serde_json::json!({
      "warning": "PUBLIC TEST KEYS. Never fund or use outside isolated tests.", "protocolVersion": VERSION,
      "upstreamRevision": "672fc6789b1532ee680f24842d235e0be8737b61", "program": program.to_string(), "vault": vault.to_string(),
      "vaultId": hex(&id), "destination": destination.to_string(), "expirySlot": "987654321", "vectors": vectors
    })).unwrap());
}
