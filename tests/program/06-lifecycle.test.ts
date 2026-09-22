import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomId, serializeProof } from '../../packages/core/src/index.js';
import {
  checkPublishedBatch, createConnection, deactivateIssuerInstruction, DEVNET_GENESIS_HASH, fetchIssuer, fetchIssuersByAuthority, fetchRegistry,
  PLACEHOLDER_PROGRAM_ID, publishBatchInstruction, verifyCredential, type ClusterConfig, type VerificationReport,
} from '../../packages/solana/src/index.js';
import { adapterConfig, ensureRegistry, prepare, programId, registerIssuer, revokeInstruction, send, settle, wallet, type TestBatch } from './helpers.js';

before(ensureRegistry);

async function verify(config: ClusterConfig, batch: TestBatch, index: number, document?: Uint8Array): Promise<VerificationReport> {
  const proof = batch.proofs[index];
  const original = batch.documents[index];
  assert.ok(proof && original);
  return verifyCredential(createConnection(config), config, document ?? original, serializeProof(proof));
}

test('lifecycle through the adapter: publish, verify, revoke, deactivate, all read at finalized', async () => {
  const config = await adapterConfig();
  const connection = createConnection(config);
  const issuer = await registerIssuer('Universitas Siklus', 'siklus.ac.id');
  const batch = await prepare(issuer.issuerId, 3);

  // FR-10: the batch PDA is read before (re)sending a publication.
  await settle();
  assert.deepEqual(await checkPublishedBatch(connection, config, batch.commitment), { state: 'missing' });
  assert.equal((await verify(config, batch, 0)).status, 'batch-not-found');

  await send(publishBatchInstruction(programId, { authority: issuer.authority.publicKey, commitment: batch.commitment }), [issuer.authority]);
  await settle();
  const published = await checkPublishedBatch(connection, config, batch.commitment);
  assert.equal(published.state, 'matches');
  const conflicting = await prepare(issuer.issuerId, 2, batch.commitment.batchId);
  assert.equal((await checkPublishedBatch(connection, config, conflicting.commitment)).state, 'conflict');

  const verified = await verify(config, batch, 0);
  assert.equal(verified.status, 'verified');
  assert.equal(verified.integrity, 'match');
  assert.ok(verified.slot !== null && verified.slot > 0);
  assert.equal(verified.batch.account?.issuingAuthority.toBase58(), issuer.authority.publicKey.toBase58());
  assert.equal(verified.issuer.account?.name, 'Universitas Siklus');

  const tampered = Uint8Array.from(batch.documents[0] ?? []);
  tampered[tampered.length - 2] = (tampered.at(-2) ?? 0) ^ 1;
  assert.deepEqual([(await verify(config, batch, 0, tampered)).status, (await verify(config, batch, 1, batch.documents[0])).status], ['proof-mismatch', 'proof-mismatch']);

  await send(revokeInstruction(issuer.authority.publicKey, batch, 0, 1), [issuer.authority]);
  await settle();
  const revoked = await verify(config, batch, 0);
  assert.deepEqual([revoked.status, revoked.revocation.account?.reasonCode], ['revoked', 1]);
  assert.equal((await verify(config, batch, 1)).status, 'verified');

  await send(deactivateIssuerInstruction(programId, { admin: wallet.publicKey, issuerId: issuer.issuerId }), [wallet]);
  await settle();
  const inactive = await verify(config, batch, 1);
  assert.deepEqual([inactive.status, inactive.integrity, inactive.issuer.state], ['issuer-inactive', 'match', 'inactive']);
  assert.equal((await verify(config, batch, 0)).status, 'revoked');

  assert.ok((await fetchRegistry(connection, config))?.admin.equals(wallet.publicKey));
  assert.equal((await fetchIssuer(connection, config, issuer.issuerId))?.active, false);
  const owned = await fetchIssuersByAuthority(connection, config, issuer.authority.publicKey);
  assert.deepEqual(owned.map(({ issuer: account }) => account.issuerId), [issuer.issuerId]);
});

test('adapter: unregistered issuers, other clusters, and other programs never verify', async () => {
  const config = await adapterConfig();
  const unregistered = await prepare(randomId(), 1);
  await settle();
  assert.equal((await verify(config, unregistered, 0)).status, 'issuer-untrusted');

  const otherCluster = await verify({ ...config, expectedGenesisHash: DEVNET_GENESIS_HASH }, unregistered, 0);
  assert.deepEqual([otherCluster.status, otherCluster.reason], ['unverifiable', 'wrong-network']);

  const otherProgram = await verify({ ...config, programId: PLACEHOLDER_PROGRAM_ID }, unregistered, 0);
  assert.deepEqual([otherProgram.status, otherProgram.reason], ['unverifiable', 'program-mismatch']);
});
