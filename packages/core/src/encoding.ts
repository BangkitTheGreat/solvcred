import { ValidationError } from './types.js';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function hex32(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new ValidationError('INVALID_INPUT', `${field} must be 32 bytes of lowercase hex`);
  }
  return value;
}

export function fromHex(value: string): Uint8Array<ArrayBuffer> {
  hex32(value, 'hash');
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

export function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function publicKeyBytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) {
    throw new ValidationError('INVALID_INPUT', 'programId must be a base58 public key');
  }
  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) throw new ValidationError('INVALID_INPUT', 'Invalid base58 public key');
    number = number * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.push(Number(number & 255n));
    number >>= 8n;
  }
  const leadingZeroes = value.match(/^1*/)?.[0].length ?? 0;
  if (leadingZeroes + bytes.length !== 32) {
    throw new ValidationError('INVALID_INPUT', 'programId must decode to exactly 32 bytes');
  }
  return Uint8Array.from([...new Array<number>(leadingZeroes).fill(0), ...bytes.reverse()]);
}

export function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function u32le(value: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new ValidationError('INVALID_INPUT', 'Expected an unsigned 32-bit integer');
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}
