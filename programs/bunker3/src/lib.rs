//! Protocol 3 draft implementation: recovery authority and delayed withdrawals.
//! NOT deployed, NOT audited, NOT enabled anywhere. Specification and open
//! questions: docs/PROTOCOL-3-DRAFT.md. Signature verification is the unchanged
//! vendored Winterwallet core, as in protocol 2.
pub mod state;
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
use state::*;
use winterwallet_core::{WinternitzRoot, WinternitzSignature};
#[cfg(not(feature = "no-entrypoint"))]
solana_program_entrypoint::entrypoint!(process_instruction);

pub const PROOF_LEN: usize = 1162;
pub const SIGNATURE_LEN: usize = 1088;
const PROOF_MAGIC: &[u8; 8] = b"BKPROOF3";
const SPENT_MAGIC: &[u8; 8] = b"BKSPENT3";
const VAULT_SEED: &[u8] = b"bunker3";
const PROOF_SEED: &[u8] = b"proof";
const SPENT_SEED: &[u8] = b"spent-v3";

fn owned(a: &AccountInfo, id: &Pubkey, len: usize, magic: &[u8; 8]) -> ProgramResult {
    require(a.owner == id && a.data_len() == len)?;
    require(&a.try_borrow_data()?[..8] == magic)
}
/// The marker for `root` must not exist yet. Returns its bump.
fn unspent(id: &Pubkey, account: &AccountInfo, root: &[u8; 32]) -> Result<u8, ProgramError> {
    let (expected, bump) = Pubkey::find_program_address(&[SPENT_SEED, root], id);
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
/// Permanently marks `root` as used, in either role, for this program.
fn mark_spent<'a>(
    payer: &AccountInfo<'a>,
    marker: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    id: &Pubkey,
    root: &[u8; 32],
) -> ProgramResult {
    let bump = unspent(id, marker, root)?;
    create(
        payer,
        marker,
        system,
        id,
        SPENT_MAGIC.len(),
        &[SPENT_SEED, root, &[bump]],
    )?;
    marker.try_borrow_mut_data()?.copy_from_slice(SPENT_MAGIC);
    Ok(())
}
/// Loads a vault and proves the account is the PDA of its own stored identity.
fn load_vault(id: &Pubkey, vault: &AccountInfo) -> Result<Vault, ProgramError> {
    require(vault.owner == id && vault.is_writable)?;
    let v = Vault::unpack(&vault.try_borrow_data()?)?;
    require(
        Pubkey::create_program_address(&[VAULT_SEED, &v.vault_id, &[v.bump]], id)
            .map_err(|_| invalid())?
            == *vault.key,
    )?;
    Ok(v)
}
fn store_vault(vault: &AccountInfo, v: &Vault) -> ProgramResult {
    v.pack(&mut vault.try_borrow_mut_data()?)
}
/// Checks the staged proof is complete and is for exactly this message, then
/// verifies it against `root`.
#[inline(never)]
fn verify_proof(
    id: &Pubkey,
    proof: &AccountInfo,
    message: &[&[u8]],
    digest: &[u8; 32],
    root: &[u8; 32],
) -> ProgramResult {
    owned(proof, id, PROOF_LEN, PROOF_MAGIC)?;
    let d = proof.try_borrow_data()?;
    require(
        u16::from_le_bytes(d[72..74].try_into().unwrap()) as usize == SIGNATURE_LEN
            && d[40..72] == *digest,
    )?;
    let signature: &WinternitzSignature<32> = (&d[74..]).try_into().map_err(|_| invalid())?;
    if !signature.verify(message, &WinternitzRoot::new(*root)) {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

pub fn process_instruction(id: &Pubkey, accounts: &[AccountInfo], input: &[u8]) -> ProgramResult {
    let (op, data) = input.split_first().ok_or_else(invalid)?;
    match op {
        0 => initialize(id, accounts, data),
        1 => stage(id, accounts, data),
        2 => announce(id, accounts, data),
        3 => execute(id, accounts, data),
        4 => expire(id, accounts, data),
        5 => recover(id, accounts, data),
        6 => close_proof(id, accounts, data),
        _ => Err(invalid()),
    }
}

fn initialize(id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    require(accounts.len() == 5 && data.len() == INIT_LEN)?;
    let it = &mut accounts.iter();
    let payer = next_account_info(it)?;
    let vault = next_account_info(it)?;
    let system = next_account_info(it)?;
    let op_marker = next_account_info(it)?;
    let rec_marker = next_account_info(it)?;
    let (expected, bump) = Pubkey::find_program_address(&[VAULT_SEED, &data[..32]], id);
    require(vault.key == &expected)?;
    let v = new_vault(data, bump)?;
    unspent(id, op_marker, &v.op_root)?;
    unspent(id, rec_marker, &v.rec_root)?;
    create(
        payer,
        vault,
        system,
        id,
        VAULT_LEN,
        &[VAULT_SEED, &v.vault_id, &[bump]],
    )?;
    store_vault(vault, &v)
}

fn stage(id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    require(accounts.len() == 3 && data.len() > 34 && data.len() <= 634)?;
    let digest = &data[..32];
    let offset = u16::from_le_bytes(data[32..34].try_into().unwrap()) as usize;
    let chunk = &data[34..];
    require(offset.checked_add(chunk.len()).ok_or_else(invalid)? <= SIGNATURE_LEN)?;
    let it = &mut accounts.iter();
    let payer = next_account_info(it)?;
    let proof = next_account_info(it)?;
    let system = next_account_info(it)?;
    require(payer.is_signer && proof.is_writable)?;
    let (expected, bump) =
        Pubkey::find_program_address(&[PROOF_SEED, payer.key.as_ref(), digest], id);
    require(proof.key == &expected)?;
    if proof.data_is_empty() {
        require(offset == 0)?;
        create(
            payer,
            proof,
            system,
            id,
            PROOF_LEN,
            &[PROOF_SEED, payer.key.as_ref(), digest, &[bump]],
        )?;
        let mut d = proof.try_borrow_mut_data()?;
        d[..8].copy_from_slice(PROOF_MAGIC);
        d[8..40].copy_from_slice(payer.key.as_ref());
        d[40..72].copy_from_slice(digest);
    }
    owned(proof, id, PROOF_LEN, PROOF_MAGIC)?;
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

/// Verifies an operational signature, rotates that authority and records the
/// withdrawal. Moves no assets.
fn announce(id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let a = decode_announce(data)?;
    require(accounts.len() == 6)?;
    let it = &mut accounts.iter();
    let vault = next_account_info(it)?;
    let proof = next_account_info(it)?;
    let payer = next_account_info(it)?;
    let spent = next_account_info(it)?;
    let next_spent = next_account_info(it)?;
    let system = next_account_info(it)?;
    let mut v = load_vault(id, vault)?;
    for reserved in [vault.key, proof.key, spent.key, next_spent.key] {
        require(a.destination != reserved.to_bytes())?;
    }
    unspent(id, next_spent, &a.next_op_root)?;
    let message: &[&[u8]] = &[ANNOUNCE_DOMAIN, id.as_ref(), vault.key.as_ref(), data];
    let digest = hashv(message).to_bytes();
    // Cheap state checks first; `displaced` is the root the signature must match.
    let displaced = apply_announce(&mut v, &a, digest, Clock::get()?.unix_timestamp)?;
    verify_proof(id, proof, message, &digest, &displaced)?;
    mark_spent(payer, spent, system, id, &displaced)?;
    store_vault(vault, &v)
}

/// Carries out the recorded withdrawal inside its window. Takes no data: every
/// transfer field comes from the record. Permissionless.
fn execute(id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    require(data.is_empty() && accounts.len() >= 2)?;
    let it = &mut accounts.iter();
    let vault = next_account_info(it)?;
    let destination = next_account_info(it)?;
    let mut v = load_vault(id, vault)?;
    let p = check_execute(&v, Clock::get()?.unix_timestamp)?;
    require(
        destination.is_writable
            && destination.key.to_bytes() == p.destination
            && destination.key != vault.key,
    )?;
    if p.kind == 0 {
        require(accounts.len() == 2)?;
        let remaining = vault
            .lamports()
            .checked_sub(p.amount)
            .ok_or(ProgramError::InsufficientFunds)?;
        require(remaining >= Rent::get()?.minimum_balance(VAULT_LEN))?;
        let received = destination
            .lamports()
            .checked_add(p.amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        **vault.try_borrow_mut_lamports()? = remaining;
        **destination.try_borrow_mut_lamports()? = received;
    } else {
        require(accounts.len() == 5)?;
        let source = next_account_info(it)?;
        let mint_account = next_account_info(it)?;
        let token = next_account_info(it)?;
        let mint = Pubkey::new_from_array(p.mint);
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
                p.amount,
                m.decimals,
            )?,
            &[
                source.clone(),
                mint_account.clone(),
                destination.clone(),
                vault.clone(),
                token.clone(),
            ],
            &[&[VAULT_SEED, &v.vault_id, &[v.bump]]],
        )?;
    }
    // Cleared in the same instruction as the transfer: at most one execution.
    v.pending = None;
    store_vault(vault, &v)
}

/// Clears a record past its deadline. Moves nothing. Permissionless.
fn expire(id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    require(data.is_empty() && accounts.len() == 1)?;
    let vault = &accounts[0];
    let mut v = load_vault(id, vault)?;
    apply_expire(&mut v, Clock::get()?.unix_timestamp)?;
    store_vault(vault, &v)
}

/// Verifies the fixed recovery packet for the current epoch and installs the
/// next epoch's authorities. Clears any pending withdrawal. Never debits the vault.
fn recover(id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let r = decode_recover(data)?;
    require(accounts.len() == 8)?;
    let it = &mut accounts.iter();
    let vault = next_account_info(it)?;
    let proof = next_account_info(it)?;
    let payer = next_account_info(it)?;
    let rec_spent = next_account_info(it)?;
    let op_spent = next_account_info(it)?;
    let next_rec_spent = next_account_info(it)?;
    let next_op_spent = next_account_info(it)?;
    let system = next_account_info(it)?;
    let mut v = load_vault(id, vault)?;
    unspent(id, next_rec_spent, &r.next_rec_root)?;
    unspent(id, next_op_spent, &r.next_op_root)?;
    let message: &[&[u8]] = &[RECOVER_DOMAIN, id.as_ref(), vault.key.as_ref(), data];
    let digest = hashv(message).to_bytes();
    let (old_rec, old_op) = apply_recover(&mut v, &r)?;
    verify_proof(id, proof, message, &digest, &old_rec)?;
    mark_spent(payer, rec_spent, system, id, &old_rec)?;
    // An offline signature under the displaced operational root may exist even
    // if it was never announced, so that root is retired too.
    mark_spent(payer, op_spent, system, id, &old_op)?;
    store_vault(vault, &v)
}

fn close_proof(id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    require(accounts.len() == 2 && data.is_empty())?;
    let it = &mut accounts.iter();
    let proof = next_account_info(it)?;
    let payer = next_account_info(it)?;
    owned(proof, id, PROOF_LEN, PROOF_MAGIC)?;
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
