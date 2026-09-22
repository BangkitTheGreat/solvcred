import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped, type Zippable } from 'fflate';
import {
  LIMITS,
  parseProofJson,
  serializeProof,
  ValidationError,
  verifyDocument,
  type BatchCommitment,
  type CredentialProof,
  type IntegrityResult,
  type PreparedBatch,
} from '../../../../packages/core/src/index.js';
import type { BatchAccount, ClusterConfig } from '../../../../packages/solana/src/index.js';
import { sha256Hex } from './files.js';

export const DRAFT_MANIFEST_NAME = 'draft-manifest.json';
export const FINAL_MANIFEST_NAME = 'manifest.json';
const MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
/** Stored (level 0) PDFs plus proofs and manifest; anything larger cannot be a valid draft. */
export const MAX_DRAFT_ZIP_BYTES = LIMITS.batchBytes + 16 * 1024 * 1024;

export interface PackageDocument {
  /** Unique, sanitized entry name of the PDF inside every package. */
  readonly fileName: string;
  readonly proofFileName: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly sha256: string;
}

export interface DraftBatch {
  readonly prepared: PreparedBatch;
  /** `documents[i]` belongs to `prepared.proofs[i]`, whose leafIndex is `i`. */
  readonly documents: readonly PackageDocument[];
  readonly createdAt: string;
}

export interface FinalRecord {
  readonly signature: string | null;
  readonly issuer: { readonly address: string; readonly name: string; readonly domain: string };
  readonly batchAddress: string;
  /** Batch account read at `finalized` whose root and leaf count match the draft commitment. */
  readonly batch: BatchAccount;
  readonly leafHashes: readonly string[];
  readonly finalizedAt: string;
}

/** Messages are user-facing (Indonesian) and never contain file content. */
export class PackageError extends Error {
  override readonly name = 'PackageError';
}

/** Turns user file names into unique, path-free zip entry names for each PDF/proof pair. */
export function packageNames(originalNames: readonly string[]): readonly { readonly fileName: string; readonly proofFileName: string }[] {
  const used = new Set<string>();
  return originalNames.map((original, index) => {
    const last = original.split(/[\\/]/).pop() ?? '';
    const stem = last
      .replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\.pdf$/i, '')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 100)
      .trim();
    const base = stem === '' ? `dokumen-${index + 1}` : stem;
    let candidate = base;
    for (let suffix = 2; used.has(candidate.toLowerCase()); suffix += 1) candidate = `${base}-${suffix}`;
    used.add(candidate.toLowerCase());
    return { fileName: `${candidate}.pdf`, proofFileName: `${candidate}.proof.json` };
  });
}

function addPairs(files: Zippable, documents: readonly PackageDocument[], proofs: readonly CredentialProof[]): void {
  documents.forEach((document, index) => {
    const proof = proofs[index];
    if (proof === undefined) throw new Error('Draft proof missing for document');
    // PDFs are already compressed; storing them keeps zipping fast for 100 MiB batches.
    files[document.fileName] = [document.bytes, { level: 0 }];
    files[document.proofFileName] = strToU8(serializeProof(proof));
  });
}

export function buildDraftZip(draft: DraftBatch): Uint8Array<ArrayBuffer> {
  const { commitment, proofs } = draft.prepared;
  const manifest = {
    format: 'solvcred-draft',
    formatVersion: 1,
    state: 'draft',
    notice: 'Draft BELUM diterbitkan. Simpan arsip ini utuh: root saja tidak dapat memulihkan PDF, nonce, atau proof. '
      + 'Gunakan "Lanjutkan dari cadangan draft" untuk memeriksa status atau mengirim ulang dengan batch ID, nonce, dan root yang sama.',
    createdAt: draft.createdAt,
    commitment,
    documents: draft.documents.map((document, leafIndex) => ({
      leafIndex,
      fileName: document.fileName,
      proofFileName: document.proofFileName,
      sha256: document.sha256,
      size: document.bytes.byteLength,
    })),
    proofs,
  };
  const files: Zippable = { [DRAFT_MANIFEST_NAME]: strToU8(JSON.stringify(manifest, null, 2)) };
  addPairs(files, draft.documents, proofs);
  return zipSync(files, { level: 6 });
}

export function buildFinalZip(draft: DraftBatch, record: FinalRecord): Uint8Array<ArrayBuffer> {
  const { commitment, proofs } = draft.prepared;
  const { batch } = record;
  const manifest = {
    format: 'solvcred-package',
    formatVersion: 1,
    state: 'final',
    network: commitment.network,
    programId: commitment.programId,
    signature: record.signature,
    slot: Number(batch.recordedSlot),
    issuer: { issuerId: commitment.issuerId, ...record.issuer },
    batch: {
      address: record.batchAddress,
      batchId: batch.batchId,
      root: batch.root,
      leafCount: batch.leafCount,
      schemaVersion: batch.schemaVersion,
      issuingAuthority: batch.issuingAuthority.toBase58(),
      keyVersion: batch.keyVersion,
      recordedSlot: Number(batch.recordedSlot),
      recordedAt: new Date(Number(batch.recordedAt) * 1000).toISOString(),
    },
    commitment,
    documents: draft.documents.map((document, leafIndex) => ({
      leafIndex,
      fileName: document.fileName,
      proofFileName: document.proofFileName,
      sha256: document.sha256,
      leafHash: record.leafHashes[leafIndex],
    })),
    createdAt: record.finalizedAt,
  };
  const files: Zippable = { [FINAL_MANIFEST_NAME]: strToU8(JSON.stringify(manifest, null, 2)) };
  addPairs(files, draft.documents, proofs);
  return zipSync(files, { level: 6 });
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new PackageError(`${what} tidak berformat objek.`);
  return value as Record<string, unknown>;
}

function unzipDraft(bytes: Uint8Array): Unzipped {
  let entries = 0;
  let declaredBytes = 0;
  try {
    return unzipSync(bytes, {
      filter: (file) => {
        const isManifest = file.name === DRAFT_MANIFEST_NAME;
        // Proof files are re-derived from the manifest; only PDFs and the manifest are expanded.
        if (!isManifest && (!/\.pdf$/i.test(file.name) || file.name.includes('/'))) return false;
        entries += 1;
        declaredBytes += file.originalSize;
        if (file.originalSize > (isManifest ? MANIFEST_MAX_BYTES : LIMITS.documentBytes)
          || entries > LIMITS.documents + 1
          || declaredBytes > LIMITS.batchBytes + MANIFEST_MAX_BYTES) {
          throw new PackageError('Isi arsip melebihi batas draft (100 PDF, 10 MiB per PDF, 100 MiB total).');
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof PackageError) throw error;
    throw new PackageError('Arsip ZIP rusak atau bukan cadangan draft SolVcred.');
  }
}

/**
 * Restores a draft backup and proves it is self-consistent: every PDF must hash to its recorded
 * SHA-256 and verify against its proof and the shared commitment. Only then may FR-10 checks or a
 * retry reuse the same batch ID, nonces and root.
 */
export async function parseDraftZip(bytes: Uint8Array, cluster: ClusterConfig): Promise<DraftBatch> {
  if (bytes.byteLength > MAX_DRAFT_ZIP_BYTES) throw new PackageError('Arsip terlalu besar untuk sebuah cadangan draft.');
  const entries = unzipDraft(bytes);
  const manifestBytes = entries[DRAFT_MANIFEST_NAME];
  if (manifestBytes === undefined) throw new PackageError(`${DRAFT_MANIFEST_NAME} tidak ditemukan di dalam arsip.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new PackageError(`${DRAFT_MANIFEST_NAME} bukan JSON yang valid.`);
  }
  const manifest = record(parsed, DRAFT_MANIFEST_NAME);
  if (manifest['format'] !== 'solvcred-draft' || manifest['formatVersion'] !== 1 || manifest['state'] !== 'draft') {
    throw new PackageError('Arsip ini bukan cadangan draft SolVcred versi 1.');
  }
  const rawProofs = manifest['proofs'];
  const rawDocuments = manifest['documents'];
  if (!Array.isArray(rawProofs) || !Array.isArray(rawDocuments) || rawProofs.length !== rawDocuments.length
    || rawProofs.length < 1 || rawProofs.length > LIMITS.documents) {
    throw new PackageError('Daftar dokumen dan proof di manifest tidak lengkap.');
  }
  let proofs: CredentialProof[];
  try {
    proofs = rawProofs.map((proof: unknown) => parseProofJson(JSON.stringify(proof)));
  } catch (error) {
    if (error instanceof ValidationError) throw new PackageError('Proof di dalam manifest tidak valid.');
    throw error;
  }
  const first = proofs[0];
  if (first === undefined) throw new PackageError('Manifest tidak memuat proof.');
  const commitment: BatchCommitment = {
    network: first.network, programId: first.programId, issuerId: first.issuerId,
    batchId: first.batchId, leafCount: first.leafCount, root: first.root,
  };
  const declared = record(manifest['commitment'], 'commitment');
  const keys = ['network', 'programId', 'issuerId', 'batchId', 'leafCount', 'root'] as const;
  const sameCommitment = (candidate: Record<string, unknown>) => keys.every((key) => candidate[key] === commitment[key]);
  if (commitment.leafCount !== proofs.length || !sameCommitment(declared)
    || proofs.some((proof, index) => proof.leafIndex !== index || !sameCommitment({ ...proof }))) {
    throw new PackageError('Commitment dan proof di manifest tidak konsisten.');
  }
  if (commitment.programId !== cluster.programId || commitment.network !== cluster.network) {
    throw new PackageError('Cadangan ini dibuat untuk program atau jaringan lain dari konfigurasi aplikasi.');
  }
  const seen = new Set<string>();
  const documents: PackageDocument[] = [];
  for (const [index, rawDocument] of rawDocuments.entries()) {
    const document = record(rawDocument, `Dokumen #${index + 1}`);
    const fileName = document['fileName'];
    const proofFileName = document['proofFileName'];
    const sha256 = document['sha256'];
    if (document['leafIndex'] !== index || typeof fileName !== 'string' || typeof proofFileName !== 'string'
      || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256) || seen.has(fileName.toLowerCase())) {
      throw new PackageError(`Data dokumen #${index + 1} di manifest tidak valid.`);
    }
    seen.add(fileName.toLowerCase());
    const bytes = entries[fileName];
    const proof = proofs[index];
    if (bytes === undefined || proof === undefined) throw new PackageError(`${fileName} tidak ditemukan di dalam arsip.`);
    if (await sha256Hex(bytes) !== sha256) {
      throw new PackageError(`${fileName} berbeda dari PDF saat draft dibuat (hash SHA-256 tidak sama).`);
    }
    let integrity: IntegrityResult;
    try {
      integrity = await verifyDocument(bytes, serializeProof(proof), commitment);
    } catch (error) {
      if (error instanceof ValidationError) throw new PackageError(`${fileName} bukan PDF yang dapat diproses.`);
      throw error;
    }
    if (integrity.status !== 'integrity-match') throw new PackageError(`${fileName} tidak cocok dengan proof-nya.`);
    documents.push({ fileName, proofFileName, bytes, sha256 });
  }
  const createdAt = typeof manifest['createdAt'] === 'string' ? manifest['createdAt'] : new Date(0).toISOString();
  return { prepared: { state: 'draft', commitment, proofs }, documents, createdAt };
}
