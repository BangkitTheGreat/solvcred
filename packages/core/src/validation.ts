import { hex32, publicKeyBytes } from './encoding.js';
import { LIMITS, ValidationError, type BatchCommitment, type BatchContext, type CredentialProof } from './types.js';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('INVALID_INPUT', 'Expected an object');
  }
  return value as Record<string, unknown>;
}

export function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > LIMITS.documents) {
    throw new ValidationError('LIMIT_EXCEEDED', `leafCount must be between 1 and ${LIMITS.documents}`);
  }
  return value;
}

export function validateContext(value: unknown): BatchContext {
  const input = record(value);
  if (input['network'] !== 'solana-devnet') {
    throw new ValidationError('UNSUPPORTED_NETWORK', 'Only solana-devnet is supported');
  }
  const programId = input['programId'];
  publicKeyBytes(programId);
  if (typeof programId !== 'string') throw new ValidationError('INVALID_INPUT', 'Invalid programId');
  return {
    network: 'solana-devnet', programId,
    issuerId: hex32(input['issuerId'], 'issuerId'),
    batchId: hex32(input['batchId'], 'batchId'),
  };
}

export function validateCommitment(value: unknown): BatchCommitment {
  const input = record(value);
  return { ...validateContext(input), leafCount: count(input['leafCount']), root: hex32(input['root'], 'root') };
}

export function proofDepth(leafCount: number): number {
  return Math.ceil(Math.log2(leafCount));
}

export function validateProof(value: unknown): CredentialProof {
  const input = record(value);
  // Version first: a future schema with other fields must surface as unsupported, not malformed.
  if (Object.hasOwn(input, 'schemaVersion') && input['schemaVersion'] !== 1) {
    throw new ValidationError('UNSUPPORTED_VERSION', 'Unsupported proof schema version');
  }
  const allowed = ['schemaVersion', 'network', 'programId', 'issuerId', 'batchId', 'leafCount', 'root', 'leafIndex', 'nonce', 'siblings'];
  if (Object.keys(input).length !== allowed.length || Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new ValidationError('INVALID_INPUT', 'Unexpected or missing proof fields');
  }
  const commitment = validateCommitment(input);
  const leafIndex = input['leafIndex'];
  if (typeof leafIndex !== 'number' || !Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= commitment.leafCount) {
    throw new ValidationError('INVALID_INPUT', 'leafIndex is outside the batch');
  }
  const siblings: unknown = input['siblings'];
  if (!Array.isArray(siblings) || siblings.length !== proofDepth(commitment.leafCount)) {
    throw new ValidationError('INVALID_INPUT', 'Incorrect Merkle path length');
  }
  return {
    ...commitment, schemaVersion: 1, leafIndex,
    nonce: hex32(input['nonce'], 'nonce'),
    siblings: siblings.map((sibling: unknown) => hex32(sibling, 'sibling')),
  };
}

export function parseProofJson(text: string): CredentialProof {
  if (typeof text !== 'string') throw new ValidationError('INVALID_INPUT', 'Proof must be JSON text');
  if (text.length > LIMITS.proofBytes || new TextEncoder().encode(text).length > LIMITS.proofBytes) {
    throw new ValidationError('LIMIT_EXCEEDED', 'Proof exceeds the size limit');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; }
  catch { throw new ValidationError('INVALID_INPUT', 'Malformed proof JSON'); }
  return validateProof(parsed);
}

export function serializeProof(proof: CredentialProof): string {
  return JSON.stringify(validateProof(proof), null, 2);
}

export function validatePdf(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array)) throw new ValidationError('INVALID_INPUT', 'PDF must be bytes');
  if (typeof SharedArrayBuffer !== 'undefined' && bytes.buffer instanceof SharedArrayBuffer) {
    throw new ValidationError('INVALID_INPUT', 'Shared PDF buffers are not supported');
  }
  if (bytes.byteLength > LIMITS.documentBytes) throw new ValidationError('LIMIT_EXCEEDED', 'PDF exceeds the size limit');
  if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new ValidationError('INVALID_INPUT', 'Expected a PDF header');
  }
}
