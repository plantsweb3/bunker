//! Pure protocol-3 state, encodings and transitions. No account or syscall access,
//! so every rule here is exercised directly by the tests in `tests/state.rs`.
//! Layouts are specified in docs/PROTOCOL.md.
use solana_program_error::ProgramError;

pub const VAULT_LEN: usize = 415;
pub const ANNOUNCE_LEN: usize = 196;
pub const RECOVER_LEN: usize = 138;
pub const INIT_LEN: usize = 260;
/// How many trusted destinations a vault may name.
pub const TRUSTED_SLOTS: usize = 4;
pub const VERSION: u8 = 3;
pub const ROLE_OPERATIONAL: u8 = 1;
pub const ROLE_RECOVERY: u8 = 2;
pub const VAULT_MAGIC: &[u8; 8] = b"BUNKER03";
pub const ANNOUNCE_DOMAIN: &[u8; 16] = b"BUNKER3_ANNOUNCE";
pub const RECOVER_DOMAIN: &[u8; 16] = b"BUNKER3_RECOVER_";
pub const VAULT_ID_DOMAIN: &[u8; 16] = b"BUNKER3_VAULT_ID";
/// A vault may be created with no waiting period. Zero means an announced
/// withdrawal can execute immediately, including in the same transaction.
pub const MAX_DELAY_SECS: u32 = 604_800;
/// How long an announced withdrawal stays executable once it opens: as long
/// as the vault's own waiting period, and never less than a day. Execution is
/// permissionless, so a day is enough for an honest release; a record that
/// cannot execute then blocks the vault for a day rather than a week.
pub const MIN_EXECUTE_WINDOW_SECS: i64 = 86_400;
pub fn execute_window(delay_secs: u32) -> i64 {
    (delay_secs as i64).max(MIN_EXECUTE_WINDOW_SECS)
}
/// A signed announcement that has not landed stops being usable at most this
/// long after it could first have landed.
pub const MAX_ANNOUNCE_AHEAD_SECS: i64 = 86_400;
const ZERO: [u8; 32] = [0; 32];

pub fn invalid() -> ProgramError {
    ProgramError::InvalidInstructionData
}
/// Why the program refused something, as a custom error code a client can
/// turn into a sentence. The numbers are part of the program's interface and
/// do not change. Malformed input (wrong lengths, wrong accounts, a bad
/// opcode) keeps the generic errors; these are the refusals a person can act on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Refusal {
    /// The payload names another vault or another network.
    NotThisVault = 101,
    /// The key that signed is not the vault's current one: it was already
    /// used, or the keys were replaced.
    KeyNotCurrent = 110,
    /// A withdrawal is already pending.
    WithdrawalPending = 111,
    /// The announcement landed after the deadline it was signed with.
    AnnouncedTooLate = 112,
    /// The announcement's deadline is more than a day ahead.
    DeadlineTooFar = 113,
    /// A next root equals a current root or has already signed.
    NextRootUnusable = 114,
    /// The mint is not a classic SPL mint.
    MintNotSupported = 116,
    /// The mint's decimal places are not the ones that were signed.
    WrongDecimals = 117,
    /// The destination is one of the accounts the instruction itself uses.
    DestinationNotAllowed = 118,
    /// There is no pending withdrawal.
    NothingPending = 120,
    /// The waiting period is not over.
    NotYetOpen = 121,
    /// The withdrawal was not released in time; it can only be cleared.
    WindowClosed = 122,
    /// The destination supplied is not the one that was announced.
    WrongDestination = 123,
    /// The vault would be left below its own rent reserve.
    BelowRentReserve = 124,
    /// The token accounts supplied do not fit the announced withdrawal.
    WrongTokenAccounts = 125,
    /// The pending withdrawal has not passed its deadline yet.
    NotExpired = 130,
    /// The recovery packet is for another key generation.
    WrongGeneration = 140,
    /// The uploaded signature is incomplete or is for another message.
    ProofNotReady = 150,
    /// The creation data is not acceptable.
    BadCreation = 160,
    /// The account is not the address this creation data derives.
    WrongVaultAddress = 161,
}
impl From<Refusal> for ProgramError {
    fn from(r: Refusal) -> Self {
        ProgramError::Custom(r as u32)
    }
}
/// Fails with `reason` unless `condition` holds.
pub fn need(condition: bool, reason: Refusal) -> Result<(), ProgramError> {
    if condition {
        Ok(())
    } else {
        Err(reason.into())
    }
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
    /// Wallets a withdrawal may go to with no waiting period. Fixed when the
    /// vault is created and part of its identity. Unused slots are zero and
    /// come last.
    pub trusted: [[u8; 32]; TRUSTED_SLOTS],
}
/// Unused slots zero and last; no wallet listed twice.
fn trusted_is_canonical(t: &[[u8; 32]; TRUSTED_SLOTS]) -> bool {
    let used = t.iter().take_while(|w| **w != ZERO).count();
    t[used..].iter().all(|w| *w == ZERO)
        && (0..used).all(|i| (i + 1..used).all(|j| t[i] != t[j]))
}
fn read_trusted(d: &[u8]) -> [[u8; 32]; TRUSTED_SLOTS] {
    let mut t = [ZERO; TRUSTED_SLOTS];
    for (slot, bytes) in t.iter_mut().zip(d.chunks_exact(32)) {
        *slot = arr(bytes);
    }
    t
}
impl Vault {
    /// Whether `wallet` is one of this vault's trusted destinations.
    pub fn trusts(&self, wallet: &[u8; 32]) -> bool {
        *wallet != ZERO && self.trusted.contains(wallet)
    }
    pub fn unpack(d: &[u8]) -> Result<Self, ProgramError> {
        require(d.len() == VAULT_LEN && &d[..8] == VAULT_MAGIC)?;
        let pending = match d[156] {
            0 => {
                // An absent record must be all zero so stale fields cannot be revived.
                require(d[157..286].iter().all(|b| *b == 0))?;
                None
            }
            1 if d[157] <= 1 => Some(Pending {
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
            trusted: {
                let t = read_trusted(&d[287..VAULT_LEN]);
                if !trusted_is_canonical(&t) {
                    return Err(ProgramError::InvalidAccountData);
                }
                t
            },
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
        for (i, wallet) in self.trusted.iter().enumerate() {
            d[287 + 32 * i..319 + 32 * i].copy_from_slice(wallet);
        }
        Ok(())
    }
}

/// `data` is `salt || chain_tag || op_root || rec_root || delay_secs ||
/// trusted (4 x 32)`.
/// `vault_id` is the caller's hash of `VAULT_ID_DOMAIN || data`; the salt is
/// not stored.
pub fn new_vault(vault_id: [u8; 32], data: &[u8], bump: u8) -> Result<Vault, ProgramError> {
    require(data.len() == INIT_LEN)?;
    let v = Vault {
        vault_id,
        chain_tag: arr(&data[32..64]),
        op_root: arr(&data[64..96]),
        op_index: 0,
        epoch: 0,
        rec_root: arr(&data[96..128]),
        delay_secs: u32::from_le_bytes(data[128..132].try_into().unwrap()),
        pending: None,
        bump,
        trusted: read_trusted(&data[132..INIT_LEN]),
    };
    need(
        trusted_is_canonical(&v.trusted)
            && v.op_root != ZERO
            && v.rec_root != ZERO
            && v.op_root != v.rec_root
            && v.delay_secs <= MAX_DELAY_SECS,
        Refusal::BadCreation,
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
    /// The decimal places the signer believed the token has. Zero for SOL.
    /// Checked against the mint, so a wrong belief fails instead of signing
    /// away a different amount than was shown.
    pub decimals: u8,
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
        decimals: d[195],
    };
    require(
        a.amount > 0
            && a.kind <= 1
            && (a.kind == 1 || a.mint == ZERO)
            && (a.kind == 0 || a.mint != ZERO)
            && (a.kind == 1 || a.decimals == 0)
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
///
/// `to_trusted` is the caller's finding that the destination belongs to one
/// of the vault's trusted wallets. Such a withdrawal opens at once; any other
/// waits the vault's waiting period.
pub fn apply_announce(
    v: &mut Vault,
    a: &Announce,
    digest: [u8; 32],
    now: i64,
    to_trusted: bool,
) -> Result<[u8; 32], ProgramError> {
    need(a.vault_id == v.vault_id && a.chain_tag == v.chain_tag, Refusal::NotThisVault)?;
    need(a.epoch == v.epoch && a.op_index == v.op_index, Refusal::KeyNotCurrent)?;
    need(v.pending.is_none(), Refusal::WithdrawalPending)?;
    need(now <= a.announce_by, Refusal::AnnouncedTooLate)?;
    need(
        a.announce_by.saturating_sub(now) <= MAX_ANNOUNCE_AHEAD_SECS,
        Refusal::DeadlineTooFar,
    )?;
    need(
        a.next_op_root != v.op_root && a.next_op_root != v.rec_root,
        Refusal::NextRootUnusable,
    )?;
    let wait = if to_trusted { 0 } else { v.delay_secs };
    let opens_at = now
        .checked_add(wait as i64)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let deadline = opens_at
        .checked_add(execute_window(wait))
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
    let p = v.pending.clone().ok_or(Refusal::NothingPending)?;
    need(p.epoch == v.epoch, Refusal::NothingPending)?;
    need(now >= p.opens_at, Refusal::NotYetOpen)?;
    need(now <= p.deadline, Refusal::WindowClosed)?;
    Ok(p)
}

pub fn apply_expire(v: &mut Vault, now: i64) -> Result<(), ProgramError> {
    let p = v.pending.as_ref().ok_or(Refusal::NothingPending)?;
    need(now > p.deadline, Refusal::NotExpired)?;
    v.pending = None;
    Ok(())
}

/// Installs a new epoch. Returns the displaced recovery root, which the caller
/// must mark spent. The caller has already verified the signature against
/// `v.rec_root`. Never touches balances and has no time guard.
///
/// Nothing here, and nothing the caller does, depends on what the operational
/// root is or has been. An operational signer can install any 32 bytes as the
/// live root, including a root that this packet or a later one names. If
/// recovery compared against that root, or retired it, a stolen day key could
/// make this packet or a future one fail. So the displaced operational root is
/// neither checked nor marked: a signature made under it names the epoch being
/// left and can never be accepted again.
pub fn apply_recover(v: &mut Vault, r: &Recover) -> Result<[u8; 32], ProgramError> {
    need(r.vault_id == v.vault_id && r.chain_tag == v.chain_tag, Refusal::NotThisVault)?;
    need(r.epoch == v.epoch, Refusal::WrongGeneration)?;
    need(
        r.next_rec_root != v.rec_root && r.next_op_root != v.rec_root,
        Refusal::NextRootUnusable,
    )?;
    let displaced = v.rec_root;
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
