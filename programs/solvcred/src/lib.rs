//! SolVcred on-chain registry: issuers, batch Merkle roots and revocations.
//!
//! The binary contract (PDAs, account layouts, account order, arguments, error codes) is
//! `docs/program-interface.md`; `packages/solana` builds instructions and decodes accounts
//! from it, so any change here must be made there as well.

use anchor_lang::prelude::*;
use solvcred_proof::{verify_path, MAX_DEPTH, MAX_LEAVES, SCHEMA_VERSION};

declare_id!("CZtvDiPBJ4voLQ9XchqAaXk9fzzghgsB62uSjwLMxASo");

pub const REGISTRY_SEED: &[u8] = b"registry";
pub const ISSUER_SEED: &[u8] = b"issuer";
pub const BATCH_SEED: &[u8] = b"batch";
pub const REVOCATION_SEED: &[u8] = b"revoked";

pub const REGISTRY_VERSION: u8 = 1;
pub const INITIAL_KEY_VERSION: u32 = 1;
pub const MAX_NAME_LEN: usize = 96;
pub const MAX_DOMAIN_LEN: usize = 64;
pub const MIN_REASON_CODE: u8 = 1;
pub const MAX_REASON_CODE: u8 = 4;

/// Account sizes, discriminator included. Clients reject any other data length.
pub const REGISTRY_SPACE: usize = 8 + Registry::INIT_SPACE;
pub const ISSUER_SPACE: usize = 8 + Issuer::INIT_SPACE;
pub const BATCH_SPACE: usize = 8 + Batch::INIT_SPACE;
pub const REVOCATION_SPACE: usize = 8 + Revocation::INIT_SPACE;

const _: () = assert!(REGISTRY_SPACE == 42);
const _: () = assert!(ISSUER_SPACE == 254);
const _: () = assert!(BATCH_SPACE == 162);
const _: () = assert!(REVOCATION_SPACE == 130);

#[program]
pub mod solvcred {
    use super::*;

    /// One-time bootstrap by the program's current upgrade authority.
    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        let admin = ctx.accounts.admin.key();
        let bump = ctx.bumps.registry;
        ctx.accounts.registry.set_inner(Registry {
            admin,
            version: REGISTRY_VERSION,
            bump,
        });
        Ok(())
    }

    pub fn register_issuer(
        ctx: Context<RegisterIssuer>,
        issuer_id: [u8; 32],
        name: String,
        domain: String,
        authority: Pubkey,
    ) -> Result<()> {
        require!(is_valid_name(&name), SolvcredError::InvalidName);
        require!(is_valid_domain(&domain), SolvcredError::InvalidDomain);
        require_keys_neq!(authority, Pubkey::default(), SolvcredError::InvalidAuthority);
        let registered_slot = Clock::get()?.slot;
        let bump = ctx.bumps.issuer;
        ctx.accounts.issuer.set_inner(Issuer {
            issuer_id,
            authority,
            key_version: INITIAL_KEY_VERSION,
            active: true,
            registered_slot,
            bump,
            name,
            domain,
        });
        Ok(())
    }

    pub fn publish_batch(
        ctx: Context<PublishBatch>,
        batch_id: [u8; 32],
        root: [u8; 32],
        leaf_count: u32,
        schema_version: u8,
    ) -> Result<()> {
        require!(is_valid_leaf_count(leaf_count), SolvcredError::InvalidLeafCount);
        require!(schema_version == SCHEMA_VERSION, SolvcredError::UnsupportedSchemaVersion);
        require!(root != [0u8; 32], SolvcredError::InvalidRoot);
        let clock = Clock::get()?;
        let issuer = ctx.accounts.issuer.key();
        let key_version = ctx.accounts.issuer.key_version;
        let issuing_authority = ctx.accounts.authority.key();
        let bump = ctx.bumps.batch;
        ctx.accounts.batch.set_inner(Batch {
            issuer,
            batch_id,
            root,
            leaf_count,
            schema_version,
            issuing_authority,
            key_version,
            recorded_slot: clock.slot,
            recorded_at: clock.unix_timestamp,
            bump,
        });
        Ok(())
    }

    /// Permanent. Allowed for inactive issuers (PRD §8): only new publications are blocked.
    pub fn revoke_credential(
        ctx: Context<RevokeCredential>,
        leaf_hash: [u8; 32],
        leaf_index: u32,
        siblings: Vec<[u8; 32]>,
        reason_code: u8,
    ) -> Result<()> {
        require!(is_valid_reason_code(reason_code), SolvcredError::InvalidReasonCode);
        // Bound the hashing work first; verify_path also requires the exact depth.
        require!(siblings.len() <= MAX_DEPTH, SolvcredError::InvalidMerkleProof);
        let leaf_count = ctx.accounts.batch.leaf_count;
        let root = ctx.accounts.batch.root;
        require!(
            verify_path(&leaf_hash, leaf_index, leaf_count, &siblings, &root),
            SolvcredError::InvalidMerkleProof
        );
        let clock = Clock::get()?;
        let batch = ctx.accounts.batch.key();
        let revoking_authority = ctx.accounts.authority.key();
        let key_version = ctx.accounts.issuer.key_version;
        let bump = ctx.bumps.revocation;
        ctx.accounts.revocation.set_inner(Revocation {
            batch,
            leaf_hash,
            leaf_index,
            reason_code,
            revoking_authority,
            key_version,
            recorded_slot: clock.slot,
            recorded_at: clock.unix_timestamp,
            bump,
        });
        Ok(())
    }

    /// No reactivation instruction exists in the MVP.
    pub fn deactivate_issuer(ctx: Context<DeactivateIssuer>) -> Result<()> {
        ctx.accounts.issuer.active = false;
        Ok(())
    }

    /// Normal key rotation: both the current and the new authority sign.
    pub fn rotate_authority(ctx: Context<RotateAuthority>) -> Result<()> {
        let new_authority = ctx.accounts.new_authority.key();
        require_keys_neq!(new_authority, ctx.accounts.authority.key(), SolvcredError::SameAuthority);
        let issuer = &mut ctx.accounts.issuer;
        issuer.key_version = next_key_version(issuer.key_version)?;
        issuer.authority = new_authority;
        Ok(())
    }

    /// Administrative recovery of a lost or stolen issuer key; the new authority signs.
    pub fn recover_authority(ctx: Context<RecoverAuthority>) -> Result<()> {
        let new_authority = ctx.accounts.new_authority.key();
        let issuer = &mut ctx.accounts.issuer;
        require_keys_neq!(new_authority, issuer.authority, SolvcredError::SameAuthority);
        issuer.key_version = next_key_version(issuer.key_version)?;
        issuer.authority = new_authority;
        Ok(())
    }
}

/// Institution name: 1..=96 UTF-8 bytes without control characters.
pub fn is_valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= MAX_NAME_LEN && !name.chars().any(char::is_control)
}

/// Domain: 1..=64 bytes of `a-z 0-9 . -`, not starting or ending with `.` or `-`.
pub fn is_valid_domain(domain: &str) -> bool {
    let bytes = domain.as_bytes();
    let (first, last) = match (bytes.first(), bytes.last()) {
        (Some(first), Some(last)) => (*first, *last),
        _ => return false,
    };
    bytes.len() <= MAX_DOMAIN_LEN
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'.' || *byte == b'-')
        && !matches!(first, b'.' | b'-')
        && !matches!(last, b'.' | b'-')
}

pub fn is_valid_leaf_count(leaf_count: u32) -> bool {
    (1..=MAX_LEAVES).contains(&leaf_count)
}

pub fn is_valid_reason_code(reason_code: u8) -> bool {
    (MIN_REASON_CODE..=MAX_REASON_CODE).contains(&reason_code)
}

fn next_key_version(key_version: u32) -> Result<u32> {
    key_version
        .checked_add(1)
        .ok_or_else(|| error!(SolvcredError::KeyVersionOverflow))
}

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(
        init,
        payer = admin,
        space = REGISTRY_SPACE,
        seeds = [REGISTRY_SEED],
        bump,
    )]
    pub registry: Account<'info, Registry>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ SolvcredError::InvalidProgramData,
    )]
    pub program: Program<'info, crate::program::Solvcred>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(admin.key())
            @ SolvcredError::UnauthorizedBootstrap,
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(issuer_id: [u8; 32])]
pub struct RegisterIssuer<'info> {
    #[account(
        seeds = [REGISTRY_SEED],
        bump = registry.bump,
        has_one = admin @ SolvcredError::NotRegistryAdmin,
    )]
    pub registry: Account<'info, Registry>,
    #[account(
        init,
        payer = admin,
        space = ISSUER_SPACE,
        seeds = [ISSUER_SEED, issuer_id.as_ref()],
        bump,
    )]
    pub issuer: Account<'info, Issuer>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(batch_id: [u8; 32])]
pub struct PublishBatch<'info> {
    #[account(
        seeds = [ISSUER_SEED, issuer.issuer_id.as_ref()],
        bump = issuer.bump,
        has_one = authority @ SolvcredError::NotIssuerAuthority,
        constraint = issuer.active @ SolvcredError::IssuerInactive,
    )]
    pub issuer: Account<'info, Issuer>,
    #[account(
        init,
        payer = authority,
        space = BATCH_SPACE,
        seeds = [BATCH_SEED, issuer.key().as_ref(), batch_id.as_ref()],
        bump,
    )]
    pub batch: Account<'info, Batch>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(leaf_hash: [u8; 32])]
pub struct RevokeCredential<'info> {
    #[account(
        seeds = [ISSUER_SEED, issuer.issuer_id.as_ref()],
        bump = issuer.bump,
        has_one = authority @ SolvcredError::NotIssuerAuthority,
    )]
    pub issuer: Account<'info, Issuer>,
    // Seeds use the stored issuer so the PDA check authenticates the batch itself; the
    // relation to `issuer` is then reported as BatchIssuerMismatch.
    #[account(
        seeds = [BATCH_SEED, batch.issuer.as_ref(), batch.batch_id.as_ref()],
        bump = batch.bump,
        constraint = batch.issuer == issuer.key() @ SolvcredError::BatchIssuerMismatch,
    )]
    pub batch: Account<'info, Batch>,
    #[account(
        init,
        payer = authority,
        space = REVOCATION_SPACE,
        seeds = [REVOCATION_SEED, batch.key().as_ref(), leaf_hash.as_ref()],
        bump,
    )]
    pub revocation: Account<'info, Revocation>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DeactivateIssuer<'info> {
    #[account(
        seeds = [REGISTRY_SEED],
        bump = registry.bump,
        has_one = admin @ SolvcredError::NotRegistryAdmin,
    )]
    pub registry: Account<'info, Registry>,
    #[account(
        mut,
        seeds = [ISSUER_SEED, issuer.issuer_id.as_ref()],
        bump = issuer.bump,
        constraint = issuer.active @ SolvcredError::IssuerAlreadyInactive,
    )]
    pub issuer: Account<'info, Issuer>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct RotateAuthority<'info> {
    #[account(
        mut,
        seeds = [ISSUER_SEED, issuer.issuer_id.as_ref()],
        bump = issuer.bump,
        has_one = authority @ SolvcredError::NotIssuerAuthority,
    )]
    pub issuer: Account<'info, Issuer>,
    pub authority: Signer<'info>,
    pub new_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RecoverAuthority<'info> {
    #[account(
        seeds = [REGISTRY_SEED],
        bump = registry.bump,
        has_one = admin @ SolvcredError::NotRegistryAdmin,
    )]
    pub registry: Account<'info, Registry>,
    #[account(
        mut,
        seeds = [ISSUER_SEED, issuer.issuer_id.as_ref()],
        bump = issuer.bump,
    )]
    pub issuer: Account<'info, Issuer>,
    pub admin: Signer<'info>,
    pub new_authority: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Registry {
    pub admin: Pubkey,
    pub version: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Issuer {
    pub issuer_id: [u8; 32],
    pub authority: Pubkey,
    pub key_version: u32,
    pub active: bool,
    pub registered_slot: u64,
    pub bump: u8,
    #[max_len(96)]
    pub name: String,
    #[max_len(64)]
    pub domain: String,
}

#[account]
#[derive(InitSpace)]
pub struct Batch {
    pub issuer: Pubkey,
    pub batch_id: [u8; 32],
    pub root: [u8; 32],
    pub leaf_count: u32,
    pub schema_version: u8,
    pub issuing_authority: Pubkey,
    pub key_version: u32,
    pub recorded_slot: u64,
    pub recorded_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Revocation {
    pub batch: Pubkey,
    pub leaf_hash: [u8; 32],
    pub leaf_index: u32,
    pub reason_code: u8,
    pub revoking_authority: Pubkey,
    pub key_version: u32,
    pub recorded_slot: u64,
    pub recorded_at: i64,
    pub bump: u8,
}

/// Codes start at 6000; order is part of the client contract.
#[error_code]
pub enum SolvcredError {
    #[msg("Only the program upgrade authority can initialize the registry")]
    UnauthorizedBootstrap,
    #[msg("Program data account does not belong to this program")]
    InvalidProgramData,
    #[msg("Signer is not the registry admin")]
    NotRegistryAdmin,
    #[msg("Signer is not the issuer authority")]
    NotIssuerAuthority,
    #[msg("Issuer is inactive")]
    IssuerInactive,
    #[msg("Issuer is already inactive")]
    IssuerAlreadyInactive,
    #[msg("Name must be 1-96 bytes without control characters")]
    InvalidName,
    #[msg("Domain must be 1-64 bytes of a-z, 0-9, '.', '-' without a leading or trailing '.' or '-'")]
    InvalidDomain,
    #[msg("Authority must not be the default public key")]
    InvalidAuthority,
    #[msg("Leaf count must be between 1 and 100")]
    InvalidLeafCount,
    #[msg("Unsupported schema version")]
    UnsupportedSchemaVersion,
    #[msg("Root must not be all zero bytes")]
    InvalidRoot,
    #[msg("Reason code must be between 1 and 4")]
    InvalidReasonCode,
    #[msg("Merkle proof does not match the batch root")]
    InvalidMerkleProof,
    #[msg("Batch does not belong to the issuer")]
    BatchIssuerMismatch,
    #[msg("New authority must differ from the current authority")]
    SameAuthority,
    #[msg("Key version overflow")]
    KeyVersionOverflow,
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::Discriminator;

    #[test]
    fn names_follow_the_byte_and_control_character_rules() {
        assert!(is_valid_name("Universitas Contoh"));
        assert!(is_valid_name("Institut Teknologi – Kampus Ganesha"));
        assert!(is_valid_name(&"a".repeat(96)));
        // The limit is in bytes: 48 two-byte characters = 96 bytes, 49 = 98 bytes.
        assert!(is_valid_name(&"é".repeat(48)));
        assert!(!is_valid_name(&"é".repeat(49)));
        assert!(!is_valid_name(&"a".repeat(97)));
        assert!(!is_valid_name(""));
        for control in ["a\nb", "a\tb", "a\u{0}b", "a\u{7f}b", "a\u{85}b", "\r"] {
            assert!(!is_valid_name(control), "{control:?}");
        }
    }

    #[test]
    fn domains_follow_the_charset_and_edge_rules() {
        let longest = "a".repeat(64);
        for valid in ["kampus.ac.id", "a", "0", "a-b.c-d", "x1.example", longest.as_str()] {
            assert!(is_valid_domain(valid), "{valid}");
        }
        let too_long = "a".repeat(65);
        for invalid in [
            "",
            too_long.as_str(),
            "Kampus.ac.id",
            ".kampus.ac.id",
            "kampus.ac.id.",
            "-kampus.ac.id",
            "kampus.ac.id-",
            "kampus_ac.id",
            "kampus ac.id",
            "https://kampus.ac.id",
            "kampüs.id",
        ] {
            assert!(!is_valid_domain(invalid), "{invalid}");
        }
    }

    #[test]
    fn leaf_count_and_reason_code_bounds() {
        assert!(!is_valid_leaf_count(0));
        assert!(is_valid_leaf_count(1));
        assert!(is_valid_leaf_count(100));
        assert!(!is_valid_leaf_count(101));
        assert!(!is_valid_reason_code(0));
        assert!((1..=4).all(is_valid_reason_code));
        assert!(!is_valid_reason_code(5));
    }

    #[test]
    fn key_version_increment_is_checked() {
        assert_eq!(next_key_version(1).ok(), Some(2));
        assert!(next_key_version(u32::MAX).is_err());
    }

    #[test]
    fn discriminators_match_the_interface_document() {
        assert_eq!(Registry::DISCRIMINATOR, &[47, 174, 110, 246, 184, 182, 252, 218]);
        assert_eq!(Issuer::DISCRIMINATOR, &[216, 19, 83, 230, 108, 53, 80, 14]);
        assert_eq!(Batch::DISCRIMINATOR, &[156, 194, 70, 44, 22, 88, 137, 44]);
        assert_eq!(Revocation::DISCRIMINATOR, &[128, 117, 129, 229, 11, 159, 79, 234]);
        assert_eq!(crate::instruction::InitializeRegistry::DISCRIMINATOR, &[189, 181, 20, 17, 174, 57, 249, 59]);
        assert_eq!(crate::instruction::RegisterIssuer::DISCRIMINATOR, &[145, 117, 52, 59, 189, 27, 127, 18]);
        assert_eq!(crate::instruction::PublishBatch::DISCRIMINATOR, &[54, 109, 78, 161, 111, 240, 97, 38]);
        assert_eq!(crate::instruction::RevokeCredential::DISCRIMINATOR, &[38, 123, 95, 95, 223, 158, 169, 87]);
        assert_eq!(crate::instruction::DeactivateIssuer::DISCRIMINATOR, &[52, 10, 163, 187, 247, 22, 150, 37]);
        assert_eq!(crate::instruction::RotateAuthority::DISCRIMINATOR, &[248, 225, 151, 35, 28, 15, 85, 12]);
        assert_eq!(crate::instruction::RecoverAuthority::DISCRIMINATOR, &[63, 8, 20, 46, 33, 134, 155, 245]);
    }

    #[test]
    fn issuer_authority_sits_at_the_documented_memcmp_offset() {
        let authority = Pubkey::new_from_array([7u8; 32]);
        let issuer = Issuer {
            issuer_id: [1u8; 32],
            authority,
            key_version: INITIAL_KEY_VERSION,
            active: true,
            registered_slot: 9,
            bump: 255,
            name: "Universitas Contoh".to_string(),
            domain: "kampus.ac.id".to_string(),
        };
        let mut data = Vec::new();
        issuer.try_serialize(&mut data).expect("serializes");
        assert_eq!(&data[..8], Issuer::DISCRIMINATOR);
        assert_eq!(&data[40..72], authority.as_ref());
        assert!(data.len() <= ISSUER_SPACE);
    }

    #[test]
    fn error_codes_match_the_interface_document() {
        let expected = [
            (SolvcredError::UnauthorizedBootstrap, "UnauthorizedBootstrap"),
            (SolvcredError::InvalidProgramData, "InvalidProgramData"),
            (SolvcredError::NotRegistryAdmin, "NotRegistryAdmin"),
            (SolvcredError::NotIssuerAuthority, "NotIssuerAuthority"),
            (SolvcredError::IssuerInactive, "IssuerInactive"),
            (SolvcredError::IssuerAlreadyInactive, "IssuerAlreadyInactive"),
            (SolvcredError::InvalidName, "InvalidName"),
            (SolvcredError::InvalidDomain, "InvalidDomain"),
            (SolvcredError::InvalidAuthority, "InvalidAuthority"),
            (SolvcredError::InvalidLeafCount, "InvalidLeafCount"),
            (SolvcredError::UnsupportedSchemaVersion, "UnsupportedSchemaVersion"),
            (SolvcredError::InvalidRoot, "InvalidRoot"),
            (SolvcredError::InvalidReasonCode, "InvalidReasonCode"),
            (SolvcredError::InvalidMerkleProof, "InvalidMerkleProof"),
            (SolvcredError::BatchIssuerMismatch, "BatchIssuerMismatch"),
            (SolvcredError::SameAuthority, "SameAuthority"),
            (SolvcredError::KeyVersionOverflow, "KeyVersionOverflow"),
        ];
        for (offset, (error, name)) in (0u32..).zip(expected) {
            assert_eq!(error.name(), name);
            assert_eq!(u32::from(error), 6000 + offset, "{name}");
        }
    }
}
