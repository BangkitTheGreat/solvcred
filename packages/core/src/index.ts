import { buildTree, checkPath, hashLeaf, pathFor, randomId, sha256 } from './merkle.js';
import { count, parseProofJson, validateCommitment, validateContext, validatePdf } from './validation.js';
import { LIMITS, ValidationError, type BatchContext, type BatchCommitment, type CredentialProof, type IntegrityResult, type PreparedBatch } from './types.js';

export { LIMITS, ValidationError } from './types.js';
export type { BatchContext, BatchCommitment, CredentialProof, IntegrityResult, PreparedBatch } from './types.js';
export { parseProofJson, serializeProof } from './validation.js';
export { randomId } from './merkle.js';

export async function prepareBatch(context: BatchContext, documents: readonly Uint8Array[]): Promise<PreparedBatch> {
  const checkedContext = validateContext(context);
  if (!Array.isArray(documents)) throw new ValidationError('INVALID_INPUT', 'Documents must be an array');
  const leafCount = count(documents.length);
  let totalBytes = 0;
  for (const document of documents) {
    validatePdf(document);
    totalBytes += document.byteLength;
    if (totalBytes > LIMITS.batchBytes) throw new ValidationError('LIMIT_EXCEEDED', 'Batch exceeds the size limit');
  }
  // Snapshot caller-owned inputs before the first await to avoid mutation races.
  const snapshots = documents.map((document) => new Uint8Array(document));
  const nonces = snapshots.map(() => randomId());
  const leaves: string[] = [];
  const documentHashes = new Set<string>();
  for (const [index, document] of snapshots.entries()) {
    const documentHash = await sha256(document);
    if (documentHashes.has(documentHash)) throw new ValidationError('DUPLICATE_DOCUMENT', 'Duplicate PDF in batch');
    documentHashes.add(documentHash);
    const nonce = nonces[index];
    if (nonce === undefined) throw new Error('Missing nonce');
    leaves.push(await hashLeaf(checkedContext, leafCount, index, nonce, documentHash));
  }
  const levels = await buildTree(leaves);
  const root = levels.at(-1)?.[0];
  if (root === undefined) throw new Error('Missing Merkle root');
  const commitment: BatchCommitment = { ...checkedContext, leafCount, root };
  const proofs: CredentialProof[] = nonces.map((nonce, leafIndex) => ({
    ...commitment, schemaVersion: 1, leafIndex, nonce, siblings: pathFor(levels, leafIndex),
  }));
  return { state: 'draft', commitment, proofs };
}

/** Integrity only. expected MUST come from independently authenticated batch data. */
export async function verifyDocument(document: Uint8Array, proofJson: string, expected: BatchCommitment): Promise<IntegrityResult> {
  const proof = parseProofJson(proofJson);
  const trusted = validateCommitment(expected);
  validatePdf(document);
  const snapshot = new Uint8Array(document);
  if (proof.network !== trusted.network || proof.programId !== trusted.programId ||
      proof.issuerId !== trusted.issuerId || proof.batchId !== trusted.batchId ||
      proof.leafCount !== trusted.leafCount || proof.root !== trusted.root) {
    return { status: 'integrity-mismatch', reason: 'context' };
  }
  const leaf = await hashLeaf(proof, proof.leafCount, proof.leafIndex, proof.nonce, await sha256(snapshot));
  return await checkPath(leaf, proof.leafIndex, proof.leafCount, proof.siblings, trusted.root)
    ? { status: 'integrity-match' }
    : { status: 'integrity-mismatch', reason: 'merkle-path' };
}
