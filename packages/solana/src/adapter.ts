import { PublicKey, type AccountInfo, type Connection, type RpcResponseAndContext } from '@solana/web3.js';
import { documentLeafHash, parseProofJson, ValidationError, verifyDocument, type BatchCommitment, type CredentialProof } from '../../core/src/index.js';
import { validateCommitment, validatePdf } from '../../core/src/validation.js';
import { RpcTimeoutError, type ClusterConfig } from './config.js';
import {
  ACCOUNTS, AccountDataError, decodeBatch, decodeIssuer, decodeRegistry, decodeRevocation, ISSUER_AUTHORITY_OFFSET,
  type BatchAccount, type IssuerAccount, type RegistryAccount, type RevocationAccount,
} from './layout.js';
import { batchAddress, BPF_LOADER_UPGRADEABLE_PROGRAM_ID, issuerAddress, registryAddress, revocationAddress } from './pda.js';

export type UnverifiableReason =
  | 'rpc-error' | 'rpc-timeout' | 'wrong-network' | 'unsupported-proof' | 'program-mismatch' | 'program-not-deployed' | 'invalid-account';

export type PublishCheck =
  | { readonly state: 'missing' }
  | { readonly state: 'matches'; readonly batch: BatchAccount }
  | { readonly state: 'conflict'; readonly batch: BatchAccount }
  | { readonly state: 'unknown'; readonly reason: UnverifiableReason };

export type OverallStatus =
  | 'verified' | 'revoked' | 'proof-mismatch' | 'issuer-untrusted' | 'issuer-inactive' | 'batch-not-found' | 'unverifiable';

export interface VerificationReport {
  readonly status: OverallStatus;
  readonly checkedAt: string;
  /** Slot of the single finalized snapshot all account checks came from; null when no snapshot was read. */
  readonly slot: number | null;
  readonly reason: UnverifiableReason | 'invalid-input' | 'context' | 'merkle-path' | null;
  readonly integrity: 'match' | 'mismatch' | 'not-checked';
  readonly issuer: { readonly state: 'active' | 'inactive' | 'not-found' | 'unknown'; readonly address: string | null; readonly account: IssuerAccount | null };
  readonly batch: { readonly state: 'found' | 'not-found' | 'unknown'; readonly address: string | null; readonly account: BatchAccount | null };
  readonly revocation: { readonly state: 'revoked' | 'not-revoked' | 'unknown'; readonly account: RevocationAccount | null };
}

type AccountSnapshot = RpcResponseAndContext<readonly (AccountInfo<Uint8Array> | null)[]>;

function rpcFailure(error: unknown): 'rpc-timeout' | 'rpc-error' {
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : undefined;
  return error instanceof RpcTimeoutError || name === 'TimeoutError' || name === 'AbortError' ? 'rpc-timeout' : 'rpc-error';
}

function isDeployedProgram(info: AccountInfo<Uint8Array> | null | undefined): boolean {
  return info !== null && info !== undefined && info.executable && info.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID);
}

function decodeOwned<T>(info: AccountInfo<Uint8Array>, programId: PublicKey, decode: (data: Uint8Array) => T): T {
  if (!info.owner.equals(programId)) throw new AccountDataError('Account is not owned by the configured program');
  return decode(info.data);
}

export async function fetchRegistry(connection: Connection, config: ClusterConfig): Promise<RegistryAccount | null> {
  const programId = new PublicKey(config.programId);
  const info = await connection.getAccountInfo(registryAddress(programId), { commitment: 'finalized' });
  return info === null ? null : decodeOwned(info, programId, decodeRegistry);
}

export async function fetchIssuer(connection: Connection, config: ClusterConfig, issuerId: string): Promise<IssuerAccount | null> {
  const programId = new PublicKey(config.programId);
  const info = await connection.getAccountInfo(issuerAddress(programId, issuerId), { commitment: 'finalized' });
  if (info === null) return null;
  const issuer = decodeOwned(info, programId, decodeIssuer);
  if (issuer.issuerId !== issuerId) throw new AccountDataError('Issuer account does not match its address');
  return issuer;
}

export async function fetchIssuersByAuthority(
  connection: Connection,
  config: ClusterConfig,
  authority: PublicKey,
): Promise<readonly { readonly address: PublicKey; readonly issuer: IssuerAccount }[]> {
  const programId = new PublicKey(config.programId);
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: 'finalized',
    filters: [{ dataSize: ACCOUNTS.issuer.size }, { memcmp: { offset: ISSUER_AUTHORITY_OFFSET, bytes: authority.toBase58() } }],
  });
  return accounts
    .map(({ pubkey, account }) => {
      const issuer = decodeOwned(account, programId, decodeIssuer);
      // The RPC filter is untrusted: re-check the authority and that the account sits at its issuer PDA.
      if (!issuer.authority.equals(authority) || !pubkey.equals(issuerAddress(programId, issuer.issuerId))) {
        throw new AccountDataError('RPC returned an issuer that does not match the requested authority');
      }
      return { address: pubkey, issuer };
    })
    .sort((left, right) => (left.issuer.issuerId < right.issuer.issuerId ? -1 : 1));
}

/** FR-10: finalized read of the batch PDA before any publish retry. */
export async function checkPublishedBatch(connection: Connection, config: ClusterConfig, commitment: BatchCommitment): Promise<PublishCheck> {
  const trusted = validateCommitment(commitment);
  if (trusted.programId !== config.programId || trusted.network !== config.network) return { state: 'unknown', reason: 'program-mismatch' };
  const programId = new PublicKey(config.programId);
  const issuer = issuerAddress(programId, trusted.issuerId);
  const batchPda = batchAddress(programId, issuer, trusted.batchId);
  let snapshot: AccountSnapshot;
  try {
    if (await connection.getGenesisHash() !== config.expectedGenesisHash) return { state: 'unknown', reason: 'wrong-network' };
    snapshot = await connection.getMultipleAccountsInfoAndContext([programId, batchPda], { commitment: 'finalized' });
  } catch (error) {
    return { state: 'unknown', reason: rpcFailure(error) };
  }
  if (snapshot.value.length !== 2) return { state: 'unknown', reason: 'rpc-error' };
  const [program, info] = snapshot.value;
  if (!isDeployedProgram(program)) return { state: 'unknown', reason: 'program-not-deployed' };
  if (!info) return { state: 'missing' };
  let batch: BatchAccount;
  try { batch = decodeOwned(info, programId, decodeBatch); }
  catch (error) {
    if (error instanceof AccountDataError) return { state: 'unknown', reason: 'invalid-account' };
    throw error;
  }
  if (!batch.issuer.equals(issuer) || batch.batchId !== trusted.batchId) return { state: 'unknown', reason: 'invalid-account' };
  if (batch.schemaVersion !== 1) return { state: 'unknown', reason: 'unsupported-proof' };
  return batch.root === trusted.root && batch.leafCount === trusted.leafCount ? { state: 'matches', batch } : { state: 'conflict', batch };
}

type ReportParts = Pick<VerificationReport, 'integrity' | 'issuer' | 'batch' | 'revocation'>;

/**
 * Full credential check against one finalized snapshot. The RPC only receives account addresses:
 * never PDF bytes, the nonce, sibling hashes or the proof JSON.
 */
export async function verifyCredential(
  connection: Connection,
  config: ClusterConfig,
  document: Uint8Array,
  proofJson: string,
  now: () => Date = () => new Date(),
): Promise<VerificationReport> {
  let slot: number | null = null;
  let addresses: { readonly issuer: string; readonly batch: string } | null = null;
  const finish = (status: OverallStatus, reason: VerificationReport['reason'], parts?: ReportParts): VerificationReport => ({
    status, checkedAt: now().toISOString(), slot, reason,
    ...(parts ?? {
      integrity: 'not-checked',
      issuer: { state: 'unknown', address: addresses?.issuer ?? null, account: null },
      batch: { state: 'unknown', address: addresses?.batch ?? null, account: null },
      revocation: { state: 'unknown', account: null },
    }),
  });

  let proof: CredentialProof;
  try { proof = parseProofJson(proofJson); }
  catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return error.code === 'UNSUPPORTED_VERSION' || error.code === 'UNSUPPORTED_NETWORK'
      ? finish('unverifiable', 'unsupported-proof')
      : finish('proof-mismatch', 'invalid-input');
  }
  if (proof.programId !== config.programId || proof.network !== config.network) return finish('unverifiable', 'program-mismatch');

  // One private copy keeps the leaf hash and the integrity check on identical bytes.
  let pdf: Uint8Array;
  let leafHash: string;
  try {
    validatePdf(document);
    pdf = new Uint8Array(document);
    leafHash = await documentLeafHash(pdf, proof);
  } catch (error) {
    if (error instanceof ValidationError) return finish('proof-mismatch', 'invalid-input');
    throw error;
  }

  const programId = new PublicKey(config.programId);
  const issuerPda = issuerAddress(programId, proof.issuerId);
  const batchPda = batchAddress(programId, issuerPda, proof.batchId);
  addresses = { issuer: issuerPda.toBase58(), batch: batchPda.toBase58() };

  let snapshot: AccountSnapshot;
  try {
    if (await connection.getGenesisHash() !== config.expectedGenesisHash) return finish('unverifiable', 'wrong-network');
    snapshot = await connection.getMultipleAccountsInfoAndContext(
      [programId, issuerPda, batchPda, revocationAddress(programId, batchPda, leafHash)],
      { commitment: 'finalized' },
    );
  } catch (error) {
    // A failed read is never evidence that a revocation is absent.
    return finish('unverifiable', rpcFailure(error));
  }
  slot = snapshot.context.slot;
  if (snapshot.value.length !== 4) return finish('unverifiable', 'rpc-error');
  const [programInfo, issuerInfo, batchInfo, revocationInfo] = snapshot.value;
  if (!isDeployedProgram(programInfo)) return finish('unverifiable', 'program-not-deployed');

  let issuer: IssuerAccount | null;
  let batch: BatchAccount | null;
  let revocation: RevocationAccount | null;
  try {
    issuer = issuerInfo ? decodeOwned(issuerInfo, programId, decodeIssuer) : null;
    batch = batchInfo ? decodeOwned(batchInfo, programId, decodeBatch) : null;
    revocation = revocationInfo ? decodeOwned(revocationInfo, programId, decodeRevocation) : null;
  } catch (error) {
    if (error instanceof AccountDataError) return finish('unverifiable', 'invalid-account');
    throw error;
  }
  if ((issuer && issuer.issuerId !== proof.issuerId) ||
      (batch && (!batch.issuer.equals(issuerPda) || batch.batchId !== proof.batchId || batch.leafCount < 1 || batch.leafCount > 100)) ||
      (revocation && (!revocation.batch.equals(batchPda) || revocation.leafHash !== leafHash))) {
    return finish('unverifiable', 'invalid-account');
  }
  if (batch && batch.schemaVersion !== 1) return finish('unverifiable', 'unsupported-proof');

  const observed: ReportParts = {
    integrity: 'not-checked',
    issuer: { state: issuer ? (issuer.active ? 'active' : 'inactive') : 'not-found', address: addresses.issuer, account: issuer },
    batch: { state: batch ? 'found' : 'not-found', address: addresses.batch, account: batch },
    revocation: { state: revocation ? 'revoked' : 'not-revoked', account: revocation },
  };
  if (!issuer) return finish('issuer-untrusted', null, observed);
  if (!batch) return finish('batch-not-found', null, observed);

  // The trusted commitment comes only from configuration and on-chain data, never from the proof file.
  const integrity = await verifyDocument(pdf, proofJson, {
    network: config.network, programId: config.programId, issuerId: issuer.issuerId,
    batchId: batch.batchId, leafCount: batch.leafCount, root: batch.root,
  });
  if (integrity.status === 'integrity-mismatch') return finish('proof-mismatch', integrity.reason, { ...observed, integrity: 'mismatch' });
  const matched: ReportParts = { ...observed, integrity: 'match' };
  if (revocation) return finish('revoked', null, matched);
  if (!issuer.active) return finish('issuer-inactive', null, matched);
  return finish('verified', null, matched);
}
