//! Pure protocol-3 state, encodings and transitions. No account or syscall access,
//! so every rule here is exercised directly by the tests in `tests/state.rs`.
//! Layouts are specified in docs/PROTOCOL-3-DRAFT.md.
use solana_program_error::ProgramError;

pub const VAULT_LEN: usize = 287;
pub const ANNOUNCE_LEN: usize = 195;
pub const RECOVER_LEN: usize = 138;
pub const INIT_LEN: usize = 132;
pub const VERSION: u8 = 3;
pub const ROLE_OPERATIONAL: u8 = 1;
pub const ROLE_RECOVERY: u8 = 2;
pub const VAULT_MAGIC: &[u8; 8] = b"BUNKER03";
pub const ANNOUNCE_DOMAIN: &[u8; 16] = b"BUNKER3_ANNOUNCE";
pub const RECOVER_DOMAIN: &[u8; 16] = b"BUNKER3_RECOVER_";
pub const MIN_DELAY_SECS: u32 = 86_400;
pub const MAX_DELAY_SECS: u32 = 604_800;
pub const EXECUTE_WINDOW_SECS: i64 = 604_800;
const ZERO: [u8; 32] = [0; 32];

pub fn invalid() -> ProgramError {
    ProgramError::InvalidInstructionData
}
pub fn require(condition: bool) -> Result<(), ProgramError> {
    if condition {
        Ok(())
    } else {
        Err(ProgramError::InvalidArgument)
    }
}
fn arr(bytes: &[u8]) -> [u8; 32] {
    bytes.try_into().unwrap()
}
fn u64le(bytes: &[u8]) -> u64 {
    u64::from_le_bytes(bytes.try_into().unwrap())
}
fn i64le(bytes: &[u8]) -> i64 {
    i64::from_le_bytes(bytes.try_into().unwrap())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pending {
    pub kind: u8,
    pub mint: [u8; 32],
    pub destination: [u8; 32],
    pub amount: u64,
    pub opens_at: i64,
    pub deadline: i64,
    pub epoch: u64,
    pub digest: [u8; 32],
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Vault {
    pub vault_id: [u8; 32],
    pub chain_tag: [u8; 32],
    pub op_root: [u8; 32],
    pub op_index: u64,
    pub epoch: u64,
    pub rec_root: [u8; 32],
    pub delay_secs: u32,
    pub pending: Option<Pending>,
    pub bump: u8,
}
impl Vault {
    pub fn unpack(d: &[u8]) -> Result<Self, ProgramError> {
        require(d.len() == VAULT_LEN && &d[..8] == VAULT_MAGIC)?;
        let pending = match d[156] {
            0 => {
                // An absent record must be all zero so stale fields cannot be revived.
                require(d[157..286].iter().all(|b| *b == 0))?;
                None
            }
            1 => Some(Pending {
                kind: d[157],
                mint: arr(&d[158..190]),
                destination: arr(&d[190..222]),
                amount: u64le(&d[222..230]),
                opens_at: i64le(&d[230..238]),
                deadline: i64le(&d[238..246]),
                epoch: u64le(&d[246..254]),
                digest: arr(&d[254..286]),
            }),
            _ => return Err(ProgramError::InvalidAccountData),
        };
        Ok(Self {
            vault_id: arr(&d[8..40]),
            chain_tag: arr(&d[40..72]),
            op_root: arr(&d[72..104]),
            op_index: u64le(&d[104..112]),
            epoch: u64le(&d[112..120]),
            rec_root: arr(&d[120..152]),
            delay_secs: u32::from_le_bytes(d[152..156].try_into().unwrap()),
            pending,
            bump: d[286],
        })
    }
    pub fn pack(&self, d: &mut [u8]) -> Result<(), ProgramError> {
        require(d.len() == VAULT_LEN)?;
        d[..8].copy_from_slice(VAULT_MAGIC);
        d[8..40].copy_from_slice(&self.vault_id);
        d[40..72].copy_from_slice(&self.chain_tag);
        d[72..104].copy_from_slice(&self.op_root);
        d[104..112].copy_from_slice(&self.op_index.to_le_bytes());
        d[112..120].copy_from_slice(&self.epoch.to_le_bytes());
        d[120..152].copy_from_slice(&self.rec_root);
        d[152..156].copy_from_slice(&self.delay_secs.to_le_bytes());
        d[156..286].fill(0);
        if let Some(p) = &self.pending {
            d[156] = 1;
            d[157] = p.kind;
            d[158..190].copy_from_slice(&p.mint);
            d[190..222].copy_from_slice(&p.destination);
            d[222..230].copy_from_slice(&p.amount.to_le_bytes());
            d[230..238].copy_from_slice(&p.opens_at.to_le_bytes());
            d[238..246].copy_from_slice(&p.deadline.to_le_bytes());
            d[246..254].copy_from_slice(&p.epoch.to_le_bytes());
            d[254..286].copy_from_slice(&p.digest);
        }
        d[286] = self.bump;
        Ok(())
    }
}

/// `vault_id || chain_tag || op_root || rec_root || delay_secs`
pub fn new_vault(data: &[u8], bump: u8) -> Result<Vault, ProgramError> {
    require(data.len() == INIT_LEN)?;
    let v = Vault {
        vault_id: arr(&data[..32]),
        chain_tag: arr(&data[32..64]),
        op_root: arr(&data[64..96]),
        op_index: 0,
        epoch: 0,
        rec_root: arr(&data[96..128]),
        delay_secs: u32::from_le_bytes(data[128..132].try_into().unwrap()),
        pending: None,
        bump,
    };
    require(
        v.op_root != ZERO
            && v.rec_root != ZERO
            && v.op_root != v.rec_root
            && (MIN_DELAY_SECS..=MAX_DELAY_SECS).contains(&v.delay_secs),
    )?;
    Ok(v)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Announce {
    pub vault_id: [u8; 32],
    pub chain_tag: [u8; 32],
    pub epoch: u64,
    pub op_index: u64,
    pub kind: u8,
    pub mint: [u8; 32],
    pub destination: [u8; 32],
    pub amount: u64,
    pub announce_by: i64,
    pub next_op_root: [u8; 32],
}
pub fn decode_announce(d: &[u8]) -> Result<Announce, ProgramError> {
    if d.len() != ANNOUNCE_LEN || d[0] != VERSION || d[1] != ROLE_OPERATIONAL {
        return Err(invalid());
    }
    let a = Announce {
        vault_id: arr(&d[2..34]),
        chain_tag: arr(&d[34..66]),
        epoch: u64le(&d[66..74]),
        op_index: u64le(&d[74..82]),
        kind: d[82],
        mint: arr(&d[83..115]),
        destination: arr(&d[115..147]),
        amount: u64le(&d[147..155]),
        announce_by: i64le(&d[155..163]),
        next_op_root: arr(&d[163..195]),
    };
    require(
        a.amount > 0
            && a.kind <= 1
            && (a.kind == 1 || a.mint == ZERO)
            && (a.kind == 0 || a.mint != ZERO)
            && a.announce_by > 0
            && a.next_op_root != ZERO,
    )?;
    Ok(a)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recover {
    pub vault_id: [u8; 32],
    pub chain_tag: [u8; 32],
    pub epoch: u64,
    pub next_rec_root: [u8; 32],
    pub next_op_root: [u8; 32],
}
pub fn decode_recover(d: &[u8]) -> Result<Recover, ProgramError> {
    if d.len() != RECOVER_LEN || d[0] != VERSION || d[1] != ROLE_RECOVERY {
        return Err(invalid());
    }
    let r = Recover {
        vault_id: arr(&d[2..34]),
        chain_tag: arr(&d[34..66]),
        epoch: u64le(&d[66..74]),
        next_rec_root: arr(&d[74..106]),
        next_op_root: arr(&d[106..138]),
    };
    require(r.next_rec_root != ZERO && r.next_op_root != ZERO && r.next_rec_root != r.next_op_root)?;
    Ok(r)
}

/// Rotates the operational authority and records the pending withdrawal.
/// Returns the displaced operational root, which the caller must mark spent.
/// The caller has already verified the signature against `v.op_root`.
pub fn apply_announce(
    v: &mut Vault,
    a: &Announce,
    digest: [u8; 32],
    now: i64,
) -> Result<[u8; 32], ProgramError> {
    require(
        a.vault_id == v.vault_id
            && a.chain_tag == v.chain_tag
            && a.epoch == v.epoch
            && a.op_index == v.op_index,
    )?;
    require(v.pending.is_none())?;
    require(now <= a.announce_by)?;
    require(a.next_op_root != v.op_root && a.next_op_root != v.rec_root)?;
    let opens_at = now
        .checked_add(v.delay_secs as i64)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let deadline = opens_at
        .checked_add(EXECUTE_WINDOW_SECS)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let displaced = v.op_root;
    v.op_index = v
        .op_index
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    v.op_root = a.next_op_root;
    v.pending = Some(Pending {
        kind: a.kind,
        mint: a.mint,
        destination: a.destination,
        amount: a.amount,
        opens_at,
        deadline,
        epoch: v.epoch,
        digest,
    });
    Ok(displaced)
}

/// Returns the record to execute. Does not clear it; the caller clears it only
/// after the transfer has succeeded in the same instruction.
pub fn check_execute(v: &Vault, now: i64) -> Result<Pending, ProgramError> {
    let p = v.pending.clone().ok_or(ProgramError::InvalidArgument)?;
    require(p.epoch == v.epoch && now >= p.opens_at && now <= p.deadline)?;
    Ok(p)
}

pub fn apply_expire(v: &mut Vault, now: i64) -> Result<(), ProgramError> {
    let p = v.pending.as_ref().ok_or(ProgramError::InvalidArgument)?;
    require(now > p.deadline)?;
    v.pending = None;
    Ok(())
}

/// Installs a new epoch. Returns `(displaced recovery root, displaced operational
/// root)`; the caller must mark both spent. The caller has already verified the
/// signature against `v.rec_root`. Never touches balances and has no time guard.
pub fn apply_recover(v: &mut Vault, r: &Recover) -> Result<([u8; 32], [u8; 32]), ProgramError> {
    require(r.vault_id == v.vault_id && r.chain_tag == v.chain_tag && r.epoch == v.epoch)?;
    for next in [r.next_rec_root, r.next_op_root] {
        require(next != v.rec_root && next != v.op_root)?;
    }
    let displaced = (v.rec_root, v.op_root);
    v.epoch = v
        .epoch
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    v.rec_root = r.next_rec_root;
    v.op_root = r.next_op_root;
    v.op_index = 0;
    v.pending = None;
    Ok(displaced)
}
