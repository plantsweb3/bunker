//! Experimental devnet custody. Fixed SOL/classic SPL withdrawals only.
//! Cryptographic verification is vendored unchanged from Winterwallet; see docs/CRYPTOGRAPHY.md.
use solana_account_info::{next_account_info, AccountInfo};
use solana_clock::Clock;
use solana_cpi::{invoke, invoke_signed};
use solana_program_entrypoint::ProgramResult;
use solana_program_error::ProgramError;
use solana_program_pack::Pack;
use solana_pubkey::Pubkey;
use solana_rent::Rent;
use solana_sha256_hasher::hashv;
use solana_system_interface::{instruction as system_instruction, program as system_program};
use solana_sysvar::Sysvar;
use winterwallet_core::{WinternitzRoot, WinternitzSignature};
#[cfg(not(feature = "no-entrypoint"))]
solana_program_entrypoint::entrypoint!(process_instruction);
pub const VAULT_LEN: usize = 81;
pub const PROOF_LEN: usize = 1162;
pub const SIGNATURE_LEN: usize = 1088;
pub const DOMAIN: &[u8] = b"BUNKER_WITHDRAW_TEST";
const VM: &[u8; 8] = b"BUNKER02";
pub const INTENT_LEN: usize = 154;
pub const VERSION: u8 = 2;
const SPENT: &[u8; 8] = b"BKSPENT2";
const PM: &[u8; 8] = b"BKPROOF2";
fn fail() -> ProgramError {
    ProgramError::InvalidInstructionData
}
fn key(bytes: &[u8]) -> Result<Pubkey, ProgramError> {
    Ok(Pubkey::new_from_array(
        bytes.try_into().map_err(|_| fail())?,
    ))
}
fn u64le(bytes: &[u8]) -> Result<u64, ProgramError> {
    Ok(u64::from_le_bytes(bytes.try_into().map_err(|_| fail())?))
}
fn require(v: bool) -> ProgramResult {
    if v {
        Ok(())
    } else {
        Err(ProgramError::InvalidArgument)
    }
}
fn owned(a: &AccountInfo, id: &Pubkey, len: usize, magic: &[u8; 8]) -> ProgramResult {
    require(a.owner == id && a.data_len() == len)?;
    require(&a.try_borrow_data()?[..8] == magic)
}
fn unspent(id: &Pubkey, account: &AccountInfo, root: &[u8]) -> Result<u8, ProgramError> {
    let (expected, bump) = Pubkey::find_program_address(&[b"spent-v2", root], id);
    require(
        account.key == &expected
            && account.owner == &system_program::id()
            && account.data_is_empty(),
    )?;
    Ok(bump)
}
fn create<'a>(
    payer: &AccountInfo<'a>,
    account: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    id: &Pubkey,
    len: usize,
    seeds: &[&[u8]],
) -> ProgramResult {
    require(
        payer.is_signer
            && payer.is_writable
            && account.is_writable
            && system.key == &system_program::id(),
    )?;
    // A prefunded PDA must not be a permanent denial of service.
    require(account.owner == &system_program::id() && account.data_is_empty())?;
    let needed = Rent::get()?
        .minimum_balance(len)
        .saturating_sub(account.lamports());
    if needed > 0 {
        invoke(
            &system_instruction::transfer(payer.key, account.key, needed),
            &[payer.clone(), account.clone(), system.clone()],
        )?;
    }
    invoke_signed(
        &system_instruction::allocate(account.key, len as u64),
        &[account.clone(), system.clone()],
        &[seeds],
    )?;
    invoke_signed(
        &system_instruction::assign(account.key, id),
        &[account.clone(), system.clone()],
        &[seeds],
    )
}
pub fn process_instruction(id: &Pubkey, accounts: &[AccountInfo], input: &[u8]) -> ProgramResult {
    let (op, data) = input.split_first().ok_or_else(fail)?;
    match op {
        0 => initialize(id, accounts, data),
        1 => stage(id, accounts, data),
        2 => withdraw(id, accounts, data),
        3 => close_proof(id, accounts, data),
        _ => Err(fail()),
    }
}
fn initialize(id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    require(accounts.len() == 4 && data.len() == 64 && data[32..] != [0u8; 32])?;
    let it = &mut accounts.iter();
    let payer = next_account_info(it)?;
    let vault = next_account_info(it)?;
    let system = next_account_info(it)?;
    let unused = next_account_info(it)?;
    unspent(id, unused, &data[32..64])?;
    let (expected, bump) = Pubkey::find_program_address(&[b"bunker", &data[..32]], id);
    require(vault.key == &expected)?;
    create(
        payer,
        vault,
        system,
        id,
        VAULT_LEN,
        &[b"bunker", &data[..32], &[bump]],
    )?;
    let mut state = vault.try_borrow_mut_data()?;
    state[..8].copy_from_slice(VM);
    state[8..40].copy_from_slice(&data[..32]);
    state[40..72].copy_from_slice(&data[32..64]);
    state[72..80].fill(0);
    state[80] = bump;
    Ok(())
}
fn stage(id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    require(accounts.len() == 3 && data.len() > 34 && data.len() <= 634)?;
    let digest = &data[..32];
    let offset = u16::from_le_bytes(data[32..34].try_into().unwrap()) as usize;
    let chunk = &data[34..];
    require(offset.checked_add(chunk.len()).ok_or_else(fail)? <= SIGNATURE_LEN)?;
    let it = &mut accounts.iter();
    let payer = next_account_info(it)?;
    let proof = next_account_info(it)?;
    let system = next_account_info(it)?;
    require(payer.is_signer && proof.is_writable)?;
    let (expected, bump) =
        Pubkey::find_program_address(&[b"proof", payer.key.as_ref(), digest], id);
    require(proof.key == &expected)?;
    if proof.data_is_empty() {
        require(offset == 0)?;
        create(
            payer,
            proof,
            system,
            id,
            PROOF_LEN,
            &[b"proof", payer.key.as_ref(), digest, &[bump]],
        )?;
        let mut d = proof.try_borrow_mut_data()?;
        d[..8].copy_from_slice(PM);
        d[8..40].copy_from_slice(payer.key.as_ref());
        d[40..72].copy_from_slice(digest);
    }
    owned(proof, id, PROOF_LEN, PM)?;
    let mut d = proof.try_borrow_mut_data()?;
    require(&d[8..40] == payer.key.as_ref() && &d[40..72] == digest)?;
    let used = u16::from_le_bytes(d[72..74].try_into().unwrap()) as usize;
    // Safe retry: identical previously appended chunks may be submitted again.
    if offset < used {
        return require(
            offset + chunk.len() <= used && &d[74 + offset..74 + offset + chunk.len()] == chunk,
        );
    }
    require(offset == used)?;
    d[74 + offset..74 + offset + chunk.len()].copy_from_slice(chunk);
    d[72..74].copy_from_slice(&((used + chunk.len()) as u16).to_le_bytes());
    Ok(())
}
/// Fixed-width v2 decoding shared with the fixture verification tests.
#[derive(Debug)]
pub struct Withdrawal {
    pub vault_id: [u8; 32],
    pub nonce: u64,
    pub kind: u8,
    pub mint: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub expiry: u64,
    pub next: [u8; 32],
}
pub fn decode_intent(data: &[u8]) -> Result<Withdrawal, ProgramError> {
    require(data.len() == INTENT_LEN && data[0] == VERSION)?;
    let w = Withdrawal {
        vault_id: data[1..33].try_into().unwrap(),
        nonce: u64le(&data[33..41])?,
        kind: data[41],
        mint: key(&data[42..74])?,
        destination: key(&data[74..106])?,
        amount: u64le(&data[106..114])?,
        expiry: u64le(&data[114..122])?,
        next: data[122..154].try_into().unwrap(),
    };
    require(
        w.amount > 0 && w.next != [0; 32] && w.kind <= 1 && w.expiry > 0 && w.nonce < u64::MAX,
    )?;
    require(w.kind != 0 || w.mint == Pubkey::default())?;
    Ok(w)
}
pub fn check_expiry(expiry: u64, slot: u64) -> ProgramResult {
    require(slot <= expiry)
}
fn withdraw(id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let w = decode_intent(data)?;
    let (signed_vault_id, nonce, kind, mint, dest, amount, expiry, next) = (
        &w.vault_id[..],
        w.nonce,
        w.kind,
        w.mint,
        w.destination,
        w.amount,
        w.expiry,
        w.next,
    );
    check_expiry(expiry, Clock::get()?.slot)?;
    require(accounts.len() == if kind == 0 { 7 } else { 10 })?;
    let it = &mut accounts.iter();
    let vault = next_account_info(it)?;
    let proof = next_account_info(it)?;
    let destination = next_account_info(it)?;
    let payer = next_account_info(it)?;
    let spent = next_account_info(it)?;
    let next_spent = next_account_info(it)?;
    let system = next_account_info(it)?;
    owned(vault, id, VAULT_LEN, VM)?;
    owned(proof, id, PROOF_LEN, PM)?;
    require(
        vault.is_writable
            && destination.is_writable
            && destination.key == &dest
            && destination.key != vault.key
            && destination.key != proof.key,
    )?;
    let (vault_id, root, bump) = {
        let d = vault.try_borrow_data()?;
        require(u64le(&d[72..80])? == nonce && d[40..72] != next && &d[8..40] == signed_vault_id)?;
        (
            <[u8; 32]>::try_from(&d[8..40]).unwrap(),
            <[u8; 32]>::try_from(&d[40..72]).unwrap(),
            d[80],
        )
    };
    require(
        Pubkey::create_program_address(&[b"bunker", &vault_id, &[bump]], id).map_err(|_| fail())?
            == *vault.key,
    )?;
    {
        let d = proof.try_borrow_data()?;
        require(u16::from_le_bytes(d[72..74].try_into().unwrap()) as usize == SIGNATURE_LEN)?;
        let message: &[&[u8]] = &[DOMAIN, id.as_ref(), vault.key.as_ref(), data];
        require(d[40..72] == hashv(message).to_bytes())?;
    }
    let spent_bump = unspent(id, spent, &root)?;
    unspent(id, next_spent, &next)?;
    require(destination.key != spent.key && destination.key != next_spent.key)?;
    verify_proof(id, vault, proof, data, &root)?;
    // Permanent per-program tombstone: an old root can never be reinstalled,
    // even in another vault. CPI/transfer/rotation failure rolls this back too.
    create(
        payer,
        spent,
        system,
        id,
        SPENT.len(),
        &[b"spent-v2", &root, &[spent_bump]],
    )?;
    spent.try_borrow_mut_data()?.copy_from_slice(SPENT);
    // All validation, transfer, and rotation are atomic under Solana transaction semantics.
    if kind == 0 {
        require(mint == Pubkey::default())?;
        let remaining = vault
            .lamports()
            .checked_sub(amount)
            .ok_or(ProgramError::InsufficientFunds)?;
        require(remaining >= Rent::get()?.minimum_balance(VAULT_LEN))?;
        let received = destination
            .lamports()
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        **vault.try_borrow_mut_lamports()? = remaining;
        **destination.try_borrow_mut_lamports()? = received;
    } else {
        let source = next_account_info(it)?;
        let mint_account = next_account_info(it)?;
        let token = next_account_info(it)?;
        require(
            token.key == &spl_token::id()
                && mint_account.key == &mint
                && mint_account.owner == &spl_token::id()
                && source.owner == &spl_token::id()
                && destination.owner == &spl_token::id()
                && source.is_writable
                && source.key != destination.key,
        )?;
        let src = spl_token::state::Account::unpack(&source.try_borrow_data()?)?;
        let dst = spl_token::state::Account::unpack(&destination.try_borrow_data()?)?;
        let m = spl_token::state::Mint::unpack(&mint_account.try_borrow_data()?)?;
        require(
            src.owner == *vault.key
                && src.mint == mint
                && dst.mint == mint
                && src.delegate.is_none()
                && src.close_authority.is_none(),
        )?;
        invoke_signed(
            &spl_token::instruction::transfer_checked(
                &spl_token::id(),
                source.key,
                &mint,
                destination.key,
                vault.key,
                &[],
                amount,
                m.decimals,
            )?,
            &[
                source.clone(),
                mint_account.clone(),
                destination.clone(),
                vault.clone(),
                token.clone(),
            ],
            &[&[b"bunker", &vault_id, &[bump]]],
        )?;
    }
    let mut d = vault.try_borrow_mut_data()?;
    d[40..72].copy_from_slice(&next);
    d[72..80].copy_from_slice(
        &nonce
            .checked_add(1)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .to_le_bytes(),
    );
    Ok(())
}
#[inline(never)]
fn verify_proof(
    id: &Pubkey,
    vault: &AccountInfo,
    proof: &AccountInfo,
    data: &[u8],
    root: &[u8; 32],
) -> ProgramResult {
    let d = proof.try_borrow_data()?;
    let sig: &WinternitzSignature<32> = (&d[74..]).try_into().map_err(|_| fail())?;
    if !sig.verify(
        &[DOMAIN, id.as_ref(), vault.key.as_ref(), data],
        &WinternitzRoot::new(*root),
    ) {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}
fn close_proof(id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    require(accounts.len() == 2 && data.is_empty())?;
    let it = &mut accounts.iter();
    let proof = next_account_info(it)?;
    let payer = next_account_info(it)?;
    owned(proof, id, PROOF_LEN, PM)?;
    require(
        payer.is_signer
            && payer.is_writable
            && proof.is_writable
            && payer.key != proof.key
            && &proof.try_borrow_data()?[8..40] == payer.key.as_ref(),
    )?;
    let total = payer
        .lamports()
        .checked_add(proof.lamports())
        .ok_or(ProgramError::ArithmeticOverflow)?;
    **payer.try_borrow_mut_lamports()? = total;
    **proof.try_borrow_mut_lamports()? = 0;
    proof.try_borrow_mut_data()?.fill(0);
    Ok(())
}
