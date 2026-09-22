import { PublicKey } from '@solana/web3.js';
import { toHex } from '../../core/src/encoding.js';

/** Borsh field types used by the program accounts; `string` carries its maximum byte length. */
export type FieldType = 'pubkey' | 'bytes32' | 'bool' | 'u8' | 'u32' | 'u64' | 'i64' | { readonly string: number };

export interface AccountSpec {
  readonly name: string;
  readonly discriminator: readonly number[];
  /** Fixed allocation `8 + INIT_SPACE`; decoders reject any other length. */
  readonly size: number;
  readonly fields: readonly (readonly [name: string, type: FieldType])[];
}

/** Binary account contract from docs/program-interface.md; field names match the Anchor IDL. */
export const ACCOUNTS = {
  registry: {
    name: 'Registry',
    discriminator: [47, 174, 110, 246, 184, 182, 252, 218],
    size: 42,
    fields: [['admin', 'pubkey'], ['version', 'u8'], ['bump', 'u8']],
  },
  issuer: {
    name: 'Issuer',
    discriminator: [216, 19, 83, 230, 108, 53, 80, 14],
    size: 254,
    fields: [
      ['issuer_id', 'bytes32'], ['authority', 'pubkey'], ['key_version', 'u32'], ['active', 'bool'],
      ['registered_slot', 'u64'], ['bump', 'u8'], ['name', { string: 96 }], ['domain', { string: 64 }],
    ],
  },
  batch: {
    name: 'Batch',
    discriminator: [156, 194, 70, 44, 22, 88, 137, 44],
    size: 162,
    fields: [
      ['issuer', 'pubkey'], ['batch_id', 'bytes32'], ['root', 'bytes32'], ['leaf_count', 'u32'], ['schema_version', 'u8'],
      ['issuing_authority', 'pubkey'], ['key_version', 'u32'], ['recorded_slot', 'u64'], ['recorded_at', 'i64'], ['bump', 'u8'],
    ],
  },
  revocation: {
    name: 'Revocation',
    discriminator: [128, 117, 129, 229, 11, 159, 79, 234],
    size: 130,
    fields: [
      ['batch', 'pubkey'], ['leaf_hash', 'bytes32'], ['leaf_index', 'u32'], ['reason_code', 'u8'],
      ['revoking_authority', 'pubkey'], ['key_version', 'u32'], ['recorded_slot', 'u64'], ['recorded_at', 'i64'], ['bump', 'u8'],
    ],
  },
} as const satisfies Record<string, AccountSpec>;

/** Byte offset of `Issuer.authority`, used by the `memcmp` filter that lists a wallet's issuers. */
export const ISSUER_AUTHORITY_OFFSET = 40;

export interface RegistryAccount { readonly admin: PublicKey; readonly version: number; readonly bump: number }
export interface IssuerAccount {
  readonly issuerId: string; readonly authority: PublicKey; readonly keyVersion: number; readonly active: boolean;
  readonly registeredSlot: bigint; readonly bump: number; readonly name: string; readonly domain: string;
}
export interface BatchAccount {
  readonly issuer: PublicKey; readonly batchId: string; readonly root: string; readonly leafCount: number;
  readonly schemaVersion: number; readonly issuingAuthority: PublicKey; readonly keyVersion: number;
  readonly recordedSlot: bigint; readonly recordedAt: bigint; readonly bump: number;
}
export interface RevocationAccount {
  readonly batch: PublicKey; readonly leafHash: string; readonly leafIndex: number; readonly reasonCode: number;
  readonly revokingAuthority: PublicKey; readonly keyVersion: number; readonly recordedSlot: bigint;
  readonly recordedAt: bigint; readonly bump: number;
}

export class AccountDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountDataError';
  }
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

class Reader {
  private readonly view: DataView;
  private offset = 8;

  constructor(private readonly data: Uint8Array, private readonly spec: AccountSpec) {
    if (!(data instanceof Uint8Array) || data.length !== spec.size) {
      throw new AccountDataError(`${spec.name} account must be exactly ${spec.size} bytes`);
    }
    if (spec.discriminator.some((byte, index) => data[index] !== byte)) {
      throw new AccountDataError(`Unexpected ${spec.name} discriminator`);
    }
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  pubkey(): PublicKey { return new PublicKey(this.take(32)); }
  bytes32(): string { return toHex(this.take(32)); }
  u8(): number { return this.view.getUint8(this.advance(1)); }
  u32(): number { return this.view.getUint32(this.advance(4), true); }
  u64(): bigint { return this.view.getBigUint64(this.advance(8), true); }
  i64(): bigint { return this.view.getBigInt64(this.advance(8), true); }

  bool(): boolean {
    const value = this.u8();
    if (value > 1) throw new AccountDataError(`${this.spec.name} contains an invalid bool`);
    return value === 1;
  }

  string(maxBytes: number): string {
    const length = this.u32();
    if (length < 1 || length > maxBytes) throw new AccountDataError(`${this.spec.name} contains an out-of-bounds string`);
    try { return strictUtf8.decode(this.take(length)); }
    catch { throw new AccountDataError(`${this.spec.name} contains invalid UTF-8`); }
  }

  /** Space left after the Borsh payload must be zero, as allocated by the program. */
  end(): void {
    if (this.data.subarray(this.offset).some((byte) => byte !== 0)) {
      throw new AccountDataError(`${this.spec.name} has non-zero trailing bytes`);
    }
  }

  private take(length: number): Uint8Array {
    return this.data.subarray(this.advance(length), this.offset);
  }

  private advance(length: number): number {
    const start = this.offset;
    if (start + length > this.data.length) throw new AccountDataError(`${this.spec.name} account is truncated`);
    this.offset += length;
    return start;
  }
}

export function decodeRegistry(data: Uint8Array): RegistryAccount {
  const reader = new Reader(data, ACCOUNTS.registry);
  const account: RegistryAccount = { admin: reader.pubkey(), version: reader.u8(), bump: reader.u8() };
  reader.end();
  return account;
}

export function decodeIssuer(data: Uint8Array): IssuerAccount {
  const reader = new Reader(data, ACCOUNTS.issuer);
  const account: IssuerAccount = {
    issuerId: reader.bytes32(), authority: reader.pubkey(), keyVersion: reader.u32(), active: reader.bool(),
    registeredSlot: reader.u64(), bump: reader.u8(), name: reader.string(96), domain: reader.string(64),
  };
  reader.end();
  return account;
}

export function decodeBatch(data: Uint8Array): BatchAccount {
  const reader = new Reader(data, ACCOUNTS.batch);
  const account: BatchAccount = {
    issuer: reader.pubkey(), batchId: reader.bytes32(), root: reader.bytes32(), leafCount: reader.u32(),
    schemaVersion: reader.u8(), issuingAuthority: reader.pubkey(), keyVersion: reader.u32(),
    recordedSlot: reader.u64(), recordedAt: reader.i64(), bump: reader.u8(),
  };
  reader.end();
  return account;
}

export function decodeRevocation(data: Uint8Array): RevocationAccount {
  const reader = new Reader(data, ACCOUNTS.revocation);
  const account: RevocationAccount = {
    batch: reader.pubkey(), leafHash: reader.bytes32(), leafIndex: reader.u32(), reasonCode: reader.u8(),
    revokingAuthority: reader.pubkey(), keyVersion: reader.u32(), recordedSlot: reader.u64(),
    recordedAt: reader.i64(), bump: reader.u8(),
  };
  reader.end();
  return account;
}
