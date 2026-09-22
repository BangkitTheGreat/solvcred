import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { decodeBatch, deactivateIssuerInstruction, PROGRAM_ERRORS, publishBatchInstruction } from '../../packages/solana/src/index.js';
import { connection, ensureRegistry, funded, prepare, programId, publish, readAccount, registerIssuer, rejects, send, wallet } from './helpers.js';

before(ensureRegistry);

// publish_batch data: discriminator(8) | batch_id(32) | root(32) | leaf_count u32 @72 | schema_version u8 @76
const ROOT_OFFSET = 40;
const LEAF_COUNT_OFFSET = 72;
const SCHEMA_OFFSET = 76;

test('publish_batch: the issuer authority publishes; the batch records authority, key version, slot, and time', async () => {
  const issuer = await registerIssuer();
  const batch = await publish(issuer, 5);
  const recorded = await readAccount(batch.address, decodeBatch);
  assert.deepEqual(
    [recorded.batchId, recorded.root, recorded.leafCount, recorded.schemaVersion, recorded.issuingAuthority.toBase58(), recorded.keyVersion],
    [batch.commitment.batchId, batch.commitment.root, 5, 1, issuer.authority.publicKey.toBase58(), 1],
  );
  assert.ok(recorded.recordedSlot > 0n && recorded.recordedAt > 0n);
});

test('publish_batch: an unregistered wallet and another issuer\'s authority are rejected', async () => {
  const issuerA = await registerIssuer('Universitas A', 'a.ac.id');
  const issuerB = await registerIssuer('Universitas B', 'b.ac.id');
  const stranger = await funded();
  const underA = await prepare(issuerA.issuerId);
  await rejects(send(publishBatchInstruction(programId, { authority: stranger.publicKey, commitment: underA.commitment }), [stranger]), PROGRAM_ERRORS.NotIssuerAuthority, 'stranger');
  await rejects(
    send(publishBatchInstruction(programId, { authority: issuerB.authority.publicKey, commitment: underA.commitment }), [issuerB.authority]),
    PROGRAM_ERRORS.NotIssuerAuthority, 'issuer B authority under issuer A',
  );
  await rejects(
    send(publishBatchInstruction(programId, { authority: wallet.publicKey, commitment: underA.commitment }), [wallet]),
    PROGRAM_ERRORS.NotIssuerAuthority, 'registry admin is not an issuer authority',
  );
  assert.equal(await connection.getAccountInfo(underA.address, 'confirmed'), null);
});

test('publish_batch: a batch id cannot be republished and its root cannot be overwritten', async () => {
  const issuer = await registerIssuer();
  const original = await publish(issuer);
  const replacement = await prepare(issuer.issuerId, 4, original.commitment.batchId);
  assert.notEqual(replacement.commitment.root, original.commitment.root);
  await rejects(
    send(publishBatchInstruction(programId, { authority: issuer.authority.publicKey, commitment: replacement.commitment }), [issuer.authority]),
    'already-in-use', 'republish',
  );
  const recorded = await readAccount(original.address, decodeBatch);
  assert.deepEqual([recorded.root, recorded.leafCount], [original.commitment.root, 3]);
});

test('publish_batch: leaf count 0 or 101, schema version 2, and an all-zero root are rejected', async () => {
  const issuer = await registerIssuer();
  const cases: readonly [string, (data: Buffer) => void, number][] = [
    ['leaf count 0', (data) => { data.writeUInt32LE(0, LEAF_COUNT_OFFSET); }, PROGRAM_ERRORS.InvalidLeafCount],
    ['leaf count 101', (data) => { data.writeUInt32LE(101, LEAF_COUNT_OFFSET); }, PROGRAM_ERRORS.InvalidLeafCount],
    ['schema version 2', (data) => { data.writeUInt8(2, SCHEMA_OFFSET); }, PROGRAM_ERRORS.UnsupportedSchemaVersion],
    ['zero root', (data) => { data.fill(0, ROOT_OFFSET, ROOT_OFFSET + 32); }, PROGRAM_ERRORS.InvalidRoot],
  ];
  for (const [label, patch, code] of cases) {
    const batch = await prepare(issuer.issuerId);
    const instruction = publishBatchInstruction(programId, { authority: issuer.authority.publicKey, commitment: batch.commitment });
    patch(instruction.data);
    await rejects(send(instruction, [issuer.authority]), code, label);
    assert.equal(await connection.getAccountInfo(batch.address, 'confirmed'), null, label);
  }
});

test('publish_batch: an inactive issuer cannot publish', async () => {
  const issuer = await registerIssuer();
  await send(deactivateIssuerInstruction(programId, { admin: wallet.publicKey, issuerId: issuer.issuerId }), [wallet]);
  const batch = await prepare(issuer.issuerId);
  await rejects(
    send(publishBatchInstruction(programId, { authority: issuer.authority.publicKey, commitment: batch.commitment }), [issuer.authority]),
    PROGRAM_ERRORS.IssuerInactive, 'inactive issuer',
  );
});
