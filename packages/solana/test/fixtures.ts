import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Keypair, PublicKey } from '@solana/web3.js';
import { serializeProof, type BatchCommitment, type CredentialProof } from '../../core/src/index.js';
import {
  ACCOUNTS, batchAddress, BPF_LOADER_UPGRADEABLE_PROGRAM_ID, createConnection, DEVNET_GENESIS_HASH, issuerAddress, revocationAddress,
  type AccountSpec, type ClusterConfig,
} from '../src/index.js';

interface VectorDocument { readonly pdfHex: string; readonly documentHash: string; readonly leafHash: string; readonly proof: CredentialProof }
interface VectorCase { readonly commitment: BatchCommitment; readonly documents: readonly VectorDocument[] }

const vectors = JSON.parse(readFileSync('test-vectors/v1.json', 'utf8')) as { cases: VectorCase[] };
const oddCase = vectors.cases[1];
assert.ok(oddCase && oddCase.commitment.leafCount === 3);
/** Three-leaf batch from the independent Python fixture. */
export const vector: VectorCase = oddCase;
const firstDocument = vector.documents[0];
const secondDocument = vector.documents[1];
assert.ok(firstDocument && secondDocument);
export const doc: VectorDocument = firstDocument;
export const otherDoc: VectorDocument = secondDocument;

export const programId = new PublicKey(vector.commitment.programId);
export const config: ClusterConfig = {
  network: 'solana-devnet', programId: vector.commitment.programId, rpcUrl: 'http://rpc.test',
  expectedGenesisHash: DEVNET_GENESIS_HASH, timeoutMs: 2_000,
};
export const pdf = (): Uint8Array => Uint8Array.from(Buffer.from(doc.pdfHex, 'hex'));
export const proofJson = serializeProof(doc.proof);
export const authority = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey;
export const issuerPda = issuerAddress(programId, vector.commitment.issuerId);
export const batchPda = batchAddress(programId, issuerPda, vector.commitment.batchId);
export const revocationPda = revocationAddress(programId, batchPda, doc.leafHash);

export type FieldValue = PublicKey | string | number | bigint | boolean;

/** Test-only Borsh encoder driven by the same field specs as the client decoders. */
export function encodeAccount(spec: AccountSpec, values: Readonly<Record<string, FieldValue>>): Uint8Array {
  const data = Buffer.alloc(spec.size);
  data.set(spec.discriminator);
  let offset = 8;
  for (const [name, type] of spec.fields) {
    const value = values[name];
    if (value === undefined) throw new Error(`Missing field ${name}`);
    if (type === 'pubkey') { data.set((value as PublicKey).toBytes(), offset); offset += 32; }
    else if (type === 'bytes32') { data.write(value as string, offset, 'hex'); offset += 32; }
    else if (type === 'bool') { offset = data.writeUInt8(value ? 1 : 0, offset); }
    else if (type === 'u8') { offset = data.writeUInt8(value as number, offset); }
    else if (type === 'u32') { offset = data.writeUInt32LE(value as number, offset); }
    else if (type === 'u64') { offset = data.writeBigUInt64LE(value as bigint, offset); }
    else if (type === 'i64') { offset = data.writeBigInt64LE(value as bigint, offset); }
    else {
      const bytes = Buffer.from(value as string, 'utf8');
      offset = data.writeUInt32LE(bytes.length, offset);
      data.set(bytes, offset);
      offset += bytes.length;
    }
  }
  return Uint8Array.from(data);
}

export const issuerData = (overrides: Readonly<Record<string, FieldValue>> = {}): Uint8Array => encodeAccount(ACCOUNTS.issuer, {
  issuer_id: vector.commitment.issuerId, authority, key_version: 1, active: true, registered_slot: 100n, bump: 255,
  name: 'Universitas Contoh', domain: 'contoh.ac.id', ...overrides,
});

export const batchData = (overrides: Readonly<Record<string, FieldValue>> = {}): Uint8Array => encodeAccount(ACCOUNTS.batch, {
  issuer: issuerPda, batch_id: vector.commitment.batchId, root: vector.commitment.root, leaf_count: vector.commitment.leafCount,
  schema_version: 1, issuing_authority: authority, key_version: 1, recorded_slot: 200n, recorded_at: 1_700_000_000n, bump: 254,
  ...overrides,
});

export const revocationData = (overrides: Readonly<Record<string, FieldValue>> = {}): Uint8Array => encodeAccount(ACCOUNTS.revocation, {
  batch: batchPda, leaf_hash: doc.leafHash, leaf_index: doc.proof.leafIndex, reason_code: 2, revoking_authority: authority,
  key_version: 1, recorded_slot: 300n, recorded_at: 1_700_000_100n, bump: 253, ...overrides,
});

export type Fault = 'http-500' | 'rpc-error' | 'hang';
export interface FakeAccount { readonly owner: PublicKey; readonly data: Uint8Array; readonly executable?: boolean }
export interface RpcRequest { readonly id: string; readonly method: string; readonly params: readonly unknown[] }
interface ProgramAccountsOptions { readonly filters?: readonly ({ dataSize: number } | { memcmp: { offset: number; bytes: string } })[] }

/** JSON-RPC server behind an injected `fetch`, so tests exercise the real web3.js `Connection`. */
export class FakeRpc {
  readonly accounts = new Map<string, FakeAccount>();
  readonly faults = new Map<string, Fault>();
  readonly bodies: string[] = [];
  readonly requests: RpcRequest[] = [];
  genesisHash = DEVNET_GENESIS_HASH;
  slot = 4242;

  readonly fetch: typeof fetch = async (_input, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    this.bodies.push(body);
    const request = JSON.parse(body) as RpcRequest;
    this.requests.push(request);
    const fault = this.faults.get(request.method);
    // A hung server that also ignores the abort signal.
    if (fault === 'hang') return new Promise<Response>(() => {});
    if (fault === 'http-500') return new Response('internal error', { status: 500, statusText: 'Internal Server Error' });
    if (fault === 'rpc-error') return Response.json({ jsonrpc: '2.0', id: request.id, error: { code: -32005, message: 'Node is unhealthy' } });
    return Response.json({ jsonrpc: '2.0', id: request.id, result: this.answer(request) });
  };

  set(address: PublicKey, account: FakeAccount): this {
    this.accounts.set(address.toBase58(), account);
    return this;
  }

  methods(): string[] {
    return this.requests.map(({ method }) => method);
  }

  private answer({ method, params }: RpcRequest): unknown {
    const context = { slot: this.slot, apiVersion: '2.3.0' };
    if (method === 'getGenesisHash') return this.genesisHash;
    if (method === 'getAccountInfo') return { context, value: this.json(params[0] as string) };
    if (method === 'getMultipleAccounts') return { context, value: (params[0] as string[]).map((address) => this.json(address)) };
    if (method === 'getProgramAccounts') {
      const owner = params[0] as string;
      const { filters = [] } = params[1] as ProgramAccountsOptions;
      return [...this.accounts]
        .filter(([, account]) => account.owner.toBase58() === owner && filters.every((filter) => 'dataSize' in filter
          ? account.data.length === filter.dataSize
          : Buffer.from(account.data).subarray(filter.memcmp.offset, filter.memcmp.offset + 32)
            .equals(new PublicKey(filter.memcmp.bytes).toBuffer())))
        .map(([pubkey]) => ({ pubkey, account: this.json(pubkey) }));
    }
    throw new Error(`Unexpected RPC method ${method}`);
  }

  private json(address: string): unknown {
    const account = this.accounts.get(address);
    return account === undefined ? null : {
      data: [Buffer.from(account.data).toString('base64'), 'base64'], executable: account.executable ?? false,
      lamports: 1_000_000, owner: account.owner.toBase58(), rentEpoch: 0, space: account.data.length,
    };
  }
}

/** Deployed program with a registered, active issuer and a published batch; no revocation. */
export function publishedWorld(): FakeRpc {
  return new FakeRpc()
    .set(programId, { owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID, data: new Uint8Array(36), executable: true })
    .set(issuerPda, { owner: programId, data: issuerData() })
    .set(batchPda, { owner: programId, data: batchData() });
}

export const connect = (rpc: FakeRpc, overrides: Partial<ClusterConfig> = {}) => createConnection({ ...config, ...overrides }, rpc.fetch);
