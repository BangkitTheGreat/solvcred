import { PublicKey } from '@solana/web3.js';

/** Canonical base58 32-byte key that is not the all-zero default (the program rejects it). */
export function parsePublicKeyInput(text: string): PublicKey | null {
  const trimmed = text.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) return null;
  try {
    const key = new PublicKey(trimmed);
    return key.toBase58() === trimmed && !key.equals(PublicKey.default) ? key : null;
  } catch {
    return null;
  }
}

/** Issuer IDs are 32 bytes of lowercase hex; pasted uppercase is normalized. */
export function parseIssuerIdInput(text: string): string | null {
  const normalized = text.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}
