import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SendTransactionError, Transaction, sendAndConfirmTransaction,
  type Signer, type TransactionInstruction,
} from '@solana/web3.js';
import { documentLeafHash, prepareBatch, randomId, type BatchCommitment, type CredentialProof } from '../../packages/core/src/index.js';
import {
  batchAddress, decodeIssuer, initializeRegistryInstruction, issuerAddress, publishBatchInstruction, registerIssuerInstruction,
  registryAddress, revokeCredentialInstruction, type ClusterConfig, type IssuerAccount, type RevocationReasonCode,
} from '../../packages/solana/src/index.js';

// These tests run only under `anchor test`, which starts a fresh local validator with the program
// deployed as upgradeable and the provider wallet as its upgrade authority.
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run these tests through \`anchor test\``);
  return value;
}

const loadKeypair = (path: string): Keypair => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')) as number[]));

export const rpcUrl = requiredEnv('ANCHOR_PROVIDER_URL');
/** Upgrade authority of the deployed program and therefore the registry admin. */
export const wallet = loadKeypair(requiredEnv('ANCHOR_WALLET'));
export const programId = loadKeypair('target/deploy/solvcred-keypair.json').publicKey;
/** Transactions confirm at `confirmed` for speed; adapter checks wait for `finalized` via `settle()`. */
export const connection = new Connection(rpcUrl, 'confirmed');

export async function funded(sol = 5): Promise<Keypair> {
  const keypair = Keypair.generate();
  const signature = await connection.requestAirdrop(keypair.publicKey, sol * LAMPORTS_PER_SOL);
  const latest = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  return keypair;
}

/** The first signer pays the fee. */
export async function send(instructions: TransactionInstruction | readonly TransactionInstruction[], signers: readonly Signer[]): Promise<string> {
  const transaction = new Transaction().add(...[instructions].flat());
  return sendAndConfirmTransaction(connection, transaction, [...signers], { commitment: 'confirmed' });
}

function failureText(error: unknown): string {
  const logs = error instanceof SendTransactionError ? error.logs ?? [] : [];
  return [error instanceof Error ? error.message : String(error), ...logs].join('\n');
}

/** Anchor error number from the program logs, or the raw custom program error code. */
export function errorCode(error: unknown): number | null {
  const text = failureText(error);
  const anchor = /Error Number: (\d+)\./.exec(text)?.[1];
  if (anchor !== undefined) return Number(anchor);
  const custom = /custom program error: 0x([0-9a-f]+)/i.exec(text)?.[1];
  return custom === undefined ? null : Number.parseInt(custom, 16);
}

/** Asserts a rejected transaction: an error number, or `already-in-use` when an `init` target exists. */
export async function rejects(action: Promise<unknown>, expected: number | 'already-in-use', label = ''): Promise<void> {
  let failure: { readonly error: unknown } | undefined;
  try { await action; } catch (error) { failure = { error }; }
  assert.ok(failure, `${label}: transaction unexpectedly succeeded`);
  const text = failureText(failure.error);
  if (expected === 'already-in-use') assert.match(text, /already in use/, `${label}: ${text}`);
  else assert.equal(errorCode(failure.error), expected, `${label}: ${text}`);
}

export async function readAccount<T>(address: PublicKey, decode: (data: Uint8Array) => T): Promise<T> {
  const info = await connection.getAccountInfo(address, 'confirmed');
  assert.ok(info, `account ${address.toBase58()} does not exist`);
  assert.ok(info.owner.equals(programId), `account ${address.toBase58()} is not owned by the program`);
  return decode(info.data);
}

export const readIssuer = (issuerId: string): Promise<IssuerAccount> => readAccount(issuerAddress(programId, issuerId), decodeIssuer);

/** Idempotent for files after the bootstrap test; the admin is the provider wallet. */
export async function ensureRegistry(): Promise<void> {
  if (await connection.getAccountInfo(registryAddress(programId), 'confirmed')) return;
  await send(initializeRegistryInstruction(programId, wallet.publicKey), [wallet]);
}

export interface TestIssuer { readonly issuerId: string; readonly authority: Keypair }

export async function registerIssuer(name = 'Universitas Uji', domain = 'uji.ac.id'): Promise<TestIssuer> {
  const authority = await funded();
  const issuerId = randomId();
  await send(registerIssuerInstruction(programId, { admin: wallet.publicKey, issuerId, name, domain, authority: authority.publicKey }), [wallet]);
  return { issuerId, authority };
}

export const pdfBytes = (label: string): Uint8Array => new TextEncoder().encode(`%PDF-1.4\n% ${label} ${randomId()}\n%%EOF\n`);

export interface TestBatch {
  readonly commitment: BatchCommitment;
  readonly proofs: readonly CredentialProof[];
  readonly documents: readonly Uint8Array[];
  readonly leafHashes: readonly string[];
  readonly address: PublicKey;
}

export async function prepare(issuerId: string, count = 3, batchId = randomId()): Promise<TestBatch> {
  const documents = Array.from({ length: count }, (_, index) => pdfBytes(`dokumen ${index}`));
  const { commitment, proofs } = await prepareBatch({ network: 'solana-devnet', programId: programId.toBase58(), issuerId, batchId }, documents);
  const leafHashes = await Promise.all(proofs.map((proof, index) => documentLeafHash(documents[index] ?? new Uint8Array(), proof)));
  return { commitment, proofs, documents, leafHashes, address: batchAddress(programId, issuerAddress(programId, issuerId), batchId) };
}

export async function publish(issuer: TestIssuer, count = 3, signer: Keypair = issuer.authority): Promise<TestBatch> {
  const batch = await prepare(issuer.issuerId, count);
  await send(publishBatchInstruction(programId, { authority: signer.publicKey, commitment: batch.commitment }), [signer]);
  return batch;
}

export function revokeInstruction(authority: PublicKey, batch: TestBatch, index: number, reasonCode: RevocationReasonCode = 1): TransactionInstruction {
  const proof = batch.proofs[index];
  const leafHash = batch.leafHashes[index];
  assert.ok(proof && leafHash, `no credential ${index} in batch`);
  return revokeCredentialInstruction(programId, { authority, proof, leafHash, reasonCode });
}

/** Waits until everything confirmed so far is finalized, so `finalized` adapter reads observe it. */
export async function settle(timeoutMs = 120_000): Promise<void> {
  const target = await connection.getSlot('confirmed');
  const deadline = Date.now() + timeoutMs;
  while (await connection.getSlot('finalized') < target) {
    if (Date.now() > deadline) throw new Error(`slot ${target} was not finalized within ${timeoutMs} ms`);
    await sleep(400);
  }
}

export async function adapterConfig(): Promise<ClusterConfig> {
  return {
    network: 'solana-devnet', programId: programId.toBase58(), rpcUrl,
    expectedGenesisHash: await connection.getGenesisHash(), timeoutMs: 15_000,
  };
}

export const u32le = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
};
