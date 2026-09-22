import { LIMITS } from '../../../../packages/core/src/index.js';
import { formatBytes } from './format.js';

/** Raised before any byte is read when a selected file cannot be accepted. Messages never echo content. */
export class FileInputError extends Error {
  override readonly name = 'FileInputError';
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function isJsonFile(file: File): boolean {
  return file.type === 'application/json' || /\.json$/i.test(file.name);
}

/** Reads a PDF locally after enforcing the core size limit; bytes never leave the browser. */
export async function readPdf(file: File): Promise<Uint8Array<ArrayBuffer>> {
  if (file.size > LIMITS.documentBytes) {
    throw new FileInputError(`${file.name} berukuran ${formatBytes(file.size)}; batas per PDF adalah ${formatBytes(LIMITS.documentBytes)}.`);
  }
  return new Uint8Array(await file.arrayBuffer());
}

/** Reads proof JSON as text only (never evaluated or rendered). */
export async function readProofText(file: File): Promise<string> {
  if (file.size > LIMITS.proofBytes) {
    throw new FileInputError(`File bukti berukuran ${formatBytes(file.size)}; batas file bukti adalah ${formatBytes(LIMITS.proofBytes)}.`);
  }
  return file.text();
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Hands locally built bytes to the browser's download manager; nothing is uploaded. */
export function downloadBytes(bytes: Uint8Array<ArrayBuffer>, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the download manager time to take the blob before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
