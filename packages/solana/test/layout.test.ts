import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@solana/web3.js';
import {
  AccountDataError, ACCOUNTS, decodeBatch, decodeIssuer, decodeRegistry, decodeRevocation, ISSUER_AUTHORITY_OFFSET, type FieldType,
} from '../src/index.js';
import { authority, batchData, batchPda, doc, encodeAccount, issuerData, issuerPda, revocationData, vector } from './fixtures.js';

const fieldSize = (type: FieldType): number => {
  if (typeof type === 'object') return 4 + type.string;
  return { pubkey: 32, bytes32: 32, bool: 1, u8: 1, u32: 4, u64: 8, i64: 8 }[type];
};

test('fixed account sizes are 8 + INIT_SPACE of the documented fields', () => {
  for (const spec of Object.values(ACCOUNTS)) {
    assert.equal(spec.size, 8 + spec.fields.reduce((total, [, type]) => total + fieldSize(type), 0), spec.name);
  }
});

test('decoders read every field of well-formed accounts, including full-length strings', () => {
  const admin = Keypair.generate().publicKey;
  const registry = decodeRegistry(encodeAccount(ACCOUNTS.registry, { admin, version: 1, bump: 254 }));
  assert.ok(registry.admin.equals(admin));
  assert.deepEqual([registry.version, registry.bump], [1, 254]);

  const name = 'é'.repeat(48);
  const domain = 'd'.repeat(64);
  const issuerBytes = issuerData({ name, domain, key_version: 7, active: false, registered_slot: 2n ** 63n + 5n });
  assert.deepEqual([...issuerBytes.subarray(ISSUER_AUTHORITY_OFFSET, ISSUER_AUTHORITY_OFFSET + 32)], [...authority.toBytes()]);
  const issuer = decodeIssuer(issuerBytes);
  assert.deepEqual(
    [issuer.issuerId, issuer.authority.toBase58(), issuer.keyVersion, issuer.active, issuer.registeredSlot, issuer.bump, issuer.name, issuer.domain],
    [vector.commitment.issuerId, authority.toBase58(), 7, false, 2n ** 63n + 5n, 255, name, domain],
  );

  const batch = decodeBatch(batchData({ recorded_at: -5n }));
  assert.deepEqual(
    [batch.issuer.toBase58(), batch.batchId, batch.root, batch.leafCount, batch.schemaVersion, batch.issuingAuthority.toBase58(), batch.keyVersion, batch.recordedSlot, batch.recordedAt, batch.bump],
    [issuerPda.toBase58(), vector.commitment.batchId, vector.commitment.root, 3, 1, authority.toBase58(), 1, 200n, -5n, 254],
  );

  const revocation = decodeRevocation(revocationData({ leaf_index: 2, reason_code: 4 }));
  assert.deepEqual(
    [revocation.batch.toBase58(), revocation.leafHash, revocation.leafIndex, revocation.reasonCode, revocation.revokingAuthority.toBase58(), revocation.keyVersion, revocation.recordedSlot, revocation.recordedAt, revocation.bump],
    [batchPda.toBase58(), doc.leafHash, 2, 4, authority.toBase58(), 1, 300n, 1_700_000_100n, 253],
  );
});

test('decoders reject wrong length, discriminator, bool values, string bounds, padding, and UTF-8', () => {
  const nameOffset = 8 + 32 + 32 + 4 + 1 + 8 + 1;
  const patched = (patch: (data: Uint8Array) => void): Uint8Array => {
    const data = issuerData({ name: 'Kampus', domain: 'kampus.id' });
    patch(data);
    return data;
  };
  const view = (data: Uint8Array): DataView => new DataView(data.buffer, data.byteOffset, data.byteLength);
  const invalid: readonly [string, Uint8Array][] = [
    ['short', issuerData().subarray(0, 253)],
    ['long', Uint8Array.from([...issuerData(), 0])],
    ['discriminator', patched((data) => { data[7] = (data[7] ?? 0) ^ 0xff; })],
    ['batch discriminator on issuer data', patched((data) => { data.set(ACCOUNTS.batch.discriminator); })],
    ['bool 2', patched((data) => { data[76] = 2; })],
    ['oversized name length', patched((data) => { view(data).setUint32(nameOffset, 97, true); })],
    ['empty name', patched((data) => { view(data).setUint32(nameOffset, 0, true); })],
    ['length past the end', patched((data) => { view(data).setUint32(nameOffset + 4 + 6, 0xffffffff, true); })],
    ['non-zero padding', patched((data) => { data[253] = 1; })],
    ['invalid UTF-8', patched((data) => { data[nameOffset + 4] = 0xff; })],
  ];
  for (const [label, data] of invalid) assert.throws(() => decodeIssuer(data), AccountDataError, label);

  assert.throws(() => decodeRegistry(new Uint8Array(41)), AccountDataError);
  assert.throws(() => decodeBatch(revocationData()), AccountDataError);
  assert.throws(() => decodeRevocation(batchData().subarray(0, 130)), AccountDataError);
});
