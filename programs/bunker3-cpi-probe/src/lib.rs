//! TEST ONLY: forwards its instruction to another program by cross-program
//! invocation. The first account is the program to call; the rest are passed
//! on with the signer and writable flags they arrived with; the data is passed
//! on unchanged. It holds no authority and signs for nothing.
use solana_account_info::AccountInfo;
use solana_cpi::invoke;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_entrypoint::ProgramResult;
use solana_program_error::ProgramError;
use solana_pubkey::Pubkey;
solana_program_entrypoint::entrypoint!(process_instruction);

pub fn process_instruction(_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (target, rest) = accounts.split_first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let metas = rest
        .iter()
        .map(|a| AccountMeta { pubkey: *a.key, is_signer: a.is_signer, is_writable: a.is_writable })
        .collect();
    invoke(&Instruction { program_id: *target.key, accounts: metas, data: data.to_vec() }, rest)
}
