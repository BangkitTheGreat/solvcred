import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { ValidationError, type BatchCommitment, type CredentialProof } from '../../core/src/index.js';
import { concat, fromHex, hex32, u32le } from '../../core/src/encoding.js';
import { validateCommitment, validateProof } from '../../core/src/validation.js';
import { batchAddress, issuerAddress, programDataAddress, registryAddress, revocationAddress } from './pda.js';

/** Borsh argument types; names and order match the Anchor IDL. */
export type ArgType = 'bytes32' | 'string' | 'pubkey' | 'u8' | 'u32' | 'vec<bytes32>';

export interface AccountMetaSpec { readonly name: string; readonly writable: boolean; readonly signer: boolean }

export interface InstructionSpec {
  readonly name: string;
  readonly discriminator: readonly number[];
  readonly args: readonly (readonly [name: string, type: ArgType])[];
  /** `AccountMeta` order expected by the program. */
  readonly accounts: readonly AccountMetaSpec[];
}

const readOnly = <const Name extends string>(name: Name) => ({ name, writable: false, signer: false }) as const;
const writable = <const Name extends string>(name: Name) => ({ name, writable: true, signer: false }) as const;
const signer = <const Name extends string>(name: Name) => ({ name, writable: false, signer: true }) as const;
const writableSigner = <const Name extends string>(name: Name) => ({ name, writable: true, signer: true }) as const;

/** Instruction contract from docs/program-interface.md. */
export const INSTRUCTIONS = {
  initializeRegistry: {
    name: 'initialize_registry',
    discriminator: [189, 181, 20, 17, 174, 57, 249, 59],
    args: [],
    accounts: [writable('registry'), writableSigner('admin'), readOnly('program'), readOnly('program_data'), readOnly('system_program')],
  },
  registerIssuer: {
    name: 'register_issuer',
    discriminator: [145, 117, 52, 59, 189, 27, 127, 18],
    args: [['issuer_id', 'bytes32'], ['name', 'string'], ['domain', 'string'], ['authority', 'pubkey']],
    accounts: [readOnly('registry'), writable('issuer'), writableSigner('admin'), readOnly('system_program')],
  },
  publishBatch: {
    name: 'publish_batch',
    discriminator: [54, 109, 78, 161, 111, 240, 97, 38],
    args: [['batch_id', 'bytes32'], ['root', 'bytes32'], ['leaf_count', 'u32'], ['schema_version', 'u8']],
    accounts: [readOnly('issuer'), writable('batch'), writableSigner('authority'), readOnly('system_program')],
  },
  revokeCredential: {
    name: 'revoke_credential',
    discriminator: [38, 123, 95, 95, 223, 158, 169, 87],
    args: [['leaf_hash', 'bytes32'], ['leaf_index', 'u32'], ['siblings', 'vec<bytes32>'], ['reason_code', 'u8']],
    accounts: [readOnly('issuer'), readOnly('batch'), writable('revocation'), writableSigner('authority'), readOnly('system_program')],
  },
  deactivateIssuer: {
    name: 'deactivate_issuer',
    discriminator: [52, 10, 163, 187, 247, 22, 150, 37],
    args: [],
    accounts: [readOnly('registry'), writable('issuer'), signer('admin')],
  },
  rotateAuthority: {
    name: 'rotate_authority',
    discriminator: [248, 225, 151, 35, 28, 15, 85, 12],
    args: [],
    accounts: [writable('issuer'), signer('authority'), signer('new_authority')],
  },
  recoverAuthority: {
    name: 'recover_authority',
    discriminator: [63, 8, 20, 46, 33, 134, 155, 245],
    args: [],
    accounts: [readOnly('registry'), writable('issuer'), signer('admin'), signer('new_authority')],
  },
} as const satisfies Record<string, InstructionSpec>;

/** `#[error_code]` values of the program (Anchor offset 6000). */
export const PROGRAM_ERRORS = {
  UnauthorizedBootstrap: 6000,
  InvalidProgramData: 6001,
  NotRegistryAdmin: 6002,
  NotIssuerAuthority: 6003,
  IssuerInactive: 6004,
  IssuerAlreadyInactive: 6005,
  InvalidName: 6006,
  InvalidDomain: 6007,
  InvalidAuthority: 6008,
  InvalidLeafCount: 6009,
  UnsupportedSchemaVersion: 6010,
  InvalidRoot: 6011,
  InvalidReasonCode: 6012,
  InvalidMerkleProof: 6013,
  BatchIssuerMismatch: 6014,
  SameAuthority: 6015,
  KeyVersionOverflow: 6016,
} as const;

export type RevocationReasonCode = 1 | 2 | 3 | 4;

export const REVOCATION_REASONS: readonly { readonly code: RevocationReasonCode; readonly label: string }[] = Object.freeze([
  { code: 1, label: 'Kesalahan data pada dokumen' },
  { code: 2, label: 'Digantikan kredensial baru' },
  { code: 3, label: 'Penerbitan tidak sah (misalnya kunci disalahgunakan)' },
  { code: 4, label: 'Keputusan institusi lainnya' },
]);

const MAX_NAME_BYTES = 96;
const MAX_DOMAIN_BYTES = 64;
const utf8 = new TextEncoder();

/** Program rule: 1–96 UTF-8 bytes without Rust `char::is_control()` characters. */
export function isValidIssuerName(name: string): boolean {
  if (typeof name !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(name)) return false;
  const bytes = utf8.encode(name);
  // Lone surrogates would be silently replaced by U+FFFD during encoding.
  return bytes.length >= 1 && bytes.length <= MAX_NAME_BYTES && new TextDecoder().decode(bytes) === name;
}

/** Program rule: 1–64 bytes of `a-z 0-9 . -`, not starting or ending with `.` or `-`. */
export function isValidIssuerDomain(domain: string): boolean {
  return typeof domain === 'string' && domain.length <= MAX_DOMAIN_BYTES && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain);
}

type AccountsOf<Spec extends InstructionSpec> = { readonly [Name in Spec['accounts'][number]['name']]: PublicKey };

function build<Spec extends InstructionSpec>(programId: PublicKey, spec: Spec, accounts: AccountsOf<Spec>, ...args: Uint8Array[]): TransactionInstruction {
  const addresses: Readonly<Record<string, PublicKey>> = accounts;
  const keys = spec.accounts.map(({ name, writable: isWritable, signer: isSigner }) => {
    const pubkey = addresses[name];
    if (pubkey === undefined) throw new Error(`Missing account ${name}`);
    return { pubkey, isSigner, isWritable };
  });
  return new TransactionInstruction({ programId, keys, data: Buffer.from(concat(Uint8Array.from(spec.discriminator), ...args)) });
}

function borshString(value: string): Uint8Array {
  const bytes = utf8.encode(value);
  return concat(u32le(bytes.length), bytes);
}

function requireProgram(boundProgramId: string, programId: PublicKey, what: string): void {
  if (boundProgramId !== programId.toBase58()) throw new ValidationError('INVALID_INPUT', `${what} is bound to a different program`);
}

export function initializeRegistryInstruction(programId: PublicKey, admin: PublicKey): TransactionInstruction {
  return build(programId, INSTRUCTIONS.initializeRegistry, {
    registry: registryAddress(programId), admin, program: programId,
    program_data: programDataAddress(programId), system_program: SystemProgram.programId,
  });
}

export function registerIssuerInstruction(
  programId: PublicKey,
  args: { readonly admin: PublicKey; readonly issuerId: string; readonly name: string; readonly domain: string; readonly authority: PublicKey },
): TransactionInstruction {
  const issuerId = hex32(args.issuerId, 'issuerId');
  if (!isValidIssuerName(args.name)) throw new ValidationError('INVALID_INPUT', 'Issuer name must be 1-96 UTF-8 bytes without control characters');
  if (!isValidIssuerDomain(args.domain)) throw new ValidationError('INVALID_INPUT', 'Issuer domain must be 1-64 characters of a-z, 0-9, dot and hyphen');
  if (args.authority.equals(PublicKey.default)) throw new ValidationError('INVALID_INPUT', 'Issuer authority must not be the default public key');
  return build(programId, INSTRUCTIONS.registerIssuer, {
    registry: registryAddress(programId), issuer: issuerAddress(programId, issuerId),
    admin: args.admin, system_program: SystemProgram.programId,
  }, fromHex(issuerId), borshString(args.name), borshString(args.domain), args.authority.toBytes());
}

export function publishBatchInstruction(
  programId: PublicKey,
  args: { readonly authority: PublicKey; readonly commitment: BatchCommitment },
): TransactionInstruction {
  const commitment = validateCommitment(args.commitment);
  requireProgram(commitment.programId, programId, 'Batch commitment');
  const issuer = issuerAddress(programId, commitment.issuerId);
  return build(programId, INSTRUCTIONS.publishBatch, {
    issuer, batch: batchAddress(programId, issuer, commitment.batchId),
    authority: args.authority, system_program: SystemProgram.programId,
  }, fromHex(commitment.batchId), fromHex(commitment.root), u32le(commitment.leafCount), Uint8Array.of(1));
}

/** Sends only the leaf hash, its index and sibling hashes; never the PDF, nonce or proof JSON. */
export function revokeCredentialInstruction(
  programId: PublicKey,
  args: { readonly authority: PublicKey; readonly proof: CredentialProof; readonly leafHash: string; readonly reasonCode: RevocationReasonCode },
): TransactionInstruction {
  const proof = validateProof(args.proof);
  requireProgram(proof.programId, programId, 'Proof');
  const leafHash = hex32(args.leafHash, 'leafHash');
  if (!REVOCATION_REASONS.some(({ code }) => code === args.reasonCode)) {
    throw new ValidationError('INVALID_INPUT', 'Unknown revocation reason code');
  }
  const issuer = issuerAddress(programId, proof.issuerId);
  const batch = batchAddress(programId, issuer, proof.batchId);
  return build(programId, INSTRUCTIONS.revokeCredential, {
    issuer, batch, revocation: revocationAddress(programId, batch, leafHash),
    authority: args.authority, system_program: SystemProgram.programId,
  }, fromHex(leafHash), u32le(proof.leafIndex), u32le(proof.siblings.length), ...proof.siblings.map((sibling) => fromHex(sibling)),
  Uint8Array.of(args.reasonCode));
}

export function deactivateIssuerInstruction(programId: PublicKey, args: { readonly admin: PublicKey; readonly issuerId: string }): TransactionInstruction {
  return build(programId, INSTRUCTIONS.deactivateIssuer, {
    registry: registryAddress(programId), issuer: issuerAddress(programId, args.issuerId), admin: args.admin,
  });
}

/** Normal rotation: both the current and the new authority must sign. */
export function rotateAuthorityInstruction(
  programId: PublicKey,
  args: { readonly issuerId: string; readonly authority: PublicKey; readonly newAuthority: PublicKey },
): TransactionInstruction {
  if (args.newAuthority.equals(args.authority)) throw new ValidationError('INVALID_INPUT', 'New authority must differ from the current one');
  return build(programId, INSTRUCTIONS.rotateAuthority, {
    issuer: issuerAddress(programId, args.issuerId), authority: args.authority, new_authority: args.newAuthority,
  });
}

/** Administrative recovery for a lost or stolen key; the new authority must also sign. */
export function recoverAuthorityInstruction(
  programId: PublicKey,
  args: { readonly admin: PublicKey; readonly issuerId: string; readonly newAuthority: PublicKey },
): TransactionInstruction {
  return build(programId, INSTRUCTIONS.recoverAuthority, {
    registry: registryAddress(programId), issuer: issuerAddress(programId, args.issuerId),
    admin: args.admin, new_authority: args.newAuthority,
  });
}
