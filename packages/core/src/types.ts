export const LIMITS = Object.freeze({
  documents: 100,
  documentBytes: 10 * 1024 * 1024,
  batchBytes: 100 * 1024 * 1024,
  proofBytes: 16 * 1024,
});

export interface BatchContext {
  readonly network: 'solana-devnet';
  readonly programId: string;
  readonly issuerId: string;
  readonly batchId: string;
}

export interface BatchCommitment extends BatchContext {
  readonly leafCount: number;
  readonly root: string;
}

export interface CredentialProof extends BatchCommitment {
  readonly schemaVersion: 1;
  readonly leafIndex: number;
  readonly nonce: string;
  readonly siblings: readonly string[];
}

export interface PreparedBatch {
  readonly state: 'draft';
  readonly commitment: BatchCommitment;
  readonly proofs: readonly CredentialProof[];
}

export type IntegrityResult =
  | { readonly status: 'integrity-match' }
  | { readonly status: 'integrity-mismatch'; readonly reason: 'context' | 'merkle-path' };

export type ValidationCode = 'INVALID_INPUT' | 'UNSUPPORTED_VERSION' | 'UNSUPPORTED_NETWORK' | 'LIMIT_EXCEEDED' | 'DUPLICATE_DOCUMENT';

export class ValidationError extends Error {
  constructor(readonly code: ValidationCode, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
