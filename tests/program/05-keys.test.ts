import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Keypair, TransactionInstruction } from '@solana/web3.js';
import { serializeProof } from '../../packages/core/src/index.js';
import {
  createConnection, decodeBatch, decodeRevocation, INSTRUCTIONS, issuerAddress, PROGRAM_ERRORS, publishBatchInstruction,
  recoverAuthorityInstruction, revocationAddress, rotateAuthorityInstruction, verifyCredential,
} from '../../packages/solana/src/index.js';
import {
  adapterConfig, ensureRegistry, funded, prepare, programId, publish, readAccount, readIssuer, registerIssuer, rejects, revokeInstruction,
  send, settle, wallet, type TestBatch, type TestIssuer,
} from './helpers.js';

before(ensureRegistry);

const NOT_SIGNER = 3010; // Anchor ErrorCode::AccountNotSigner

function withoutSignature(instruction: TransactionInstruction, index: number): TransactionInstruction {
  const meta = instruction.keys[index];
  assert.ok(meta);
  meta.isSigner = false;
  return instruction;
}

async function assertKeyRejected(issuer: TestIssuer, key: Keypair, batch: TestBatch): Promise<void> {
  const next = await prepare(issuer.issuerId);
  await rejects(send(publishBatchInstruction(programId, { authority: key.publicKey, commitment: next.commitment }), [key]), PROGRAM_ERRORS.NotIssuerAuthority, 'old key publishes');
  await rejects(send(revokeInstruction(key.publicKey, batch, 0), [key]), PROGRAM_ERRORS.NotIssuerAuthority, 'old key revokes');
}

test('rotate_authority: both keys sign, the new key differs, and only the current authority rotates', async () => {
  const issuer = await registerIssuer();
  const next = await funded();
  const stranger = await funded();
  const rotate = (authority: Keypair) => rotateAuthorityInstruction(programId, { issuerId: issuer.issuerId, authority: authority.publicKey, newAuthority: next.publicKey });

  await rejects(send(withoutSignature(rotate(issuer.authority), 2), [issuer.authority]), NOT_SIGNER, 'new key did not sign');
  await rejects(send(withoutSignature(rotate(issuer.authority), 1), [next]), NOT_SIGNER, 'current key did not sign');
  await rejects(send(rotate(stranger), [stranger, next]), PROGRAM_ERRORS.NotIssuerAuthority, 'stranger rotates');
  const sameKey = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: issuerAddress(programId, issuer.issuerId), isSigner: false, isWritable: true },
      { pubkey: issuer.authority.publicKey, isSigner: true, isWritable: false },
      { pubkey: issuer.authority.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(INSTRUCTIONS.rotateAuthority.discriminator),
  });
  await rejects(send(sameKey, [issuer.authority]), PROGRAM_ERRORS.SameAuthority, 'rotate to the same key');

  const unchanged = await readIssuer(issuer.issuerId);
  assert.deepEqual([unchanged.authority.toBase58(), unchanged.keyVersion], [issuer.authority.publicKey.toBase58(), 1]);
});

test('rotate_authority: the old key loses publish and revoke rights; old batches keep their signer and still verify', async () => {
  const issuer = await registerIssuer();
  const oldBatch = await publish(issuer);
  const next = await funded();
  await send(rotateAuthorityInstruction(programId, { issuerId: issuer.issuerId, authority: issuer.authority.publicKey, newAuthority: next.publicKey }), [issuer.authority, next]);
  const rotated = await readIssuer(issuer.issuerId);
  assert.deepEqual([rotated.authority.toBase58(), rotated.keyVersion, rotated.active], [next.publicKey.toBase58(), 2, true]);

  await assertKeyRejected(issuer, issuer.authority, oldBatch);

  const newBatch = await publish(issuer, 3, next);
  const recordedNew = await readAccount(newBatch.address, decodeBatch);
  assert.deepEqual([recordedNew.issuingAuthority.toBase58(), recordedNew.keyVersion], [next.publicKey.toBase58(), 2]);
  const recordedOld = await readAccount(oldBatch.address, decodeBatch);
  assert.deepEqual([recordedOld.issuingAuthority.toBase58(), recordedOld.keyVersion, recordedOld.root], [issuer.authority.publicKey.toBase58(), 1, oldBatch.commitment.root]);

  await send(revokeInstruction(next.publicKey, oldBatch, 1, 2), [next]);
  const revocation = await readAccount(revocationAddress(programId, oldBatch.address, oldBatch.leafHashes[1] ?? ''), decodeRevocation);
  assert.deepEqual([revocation.revokingAuthority.toBase58(), revocation.keyVersion], [next.publicKey.toBase58(), 2]);

  // Old credentials stay verifiable against the same issuer after rotation.
  await settle();
  const config = await adapterConfig();
  const connection = createConnection(config);
  const [document, proof] = [oldBatch.documents[0], oldBatch.proofs[0]];
  assert.ok(document && proof);
  const report = await verifyCredential(connection, config, document, serializeProof(proof));
  assert.equal(report.status, 'verified');
  assert.equal(report.batch.account?.issuingAuthority.toBase58(), issuer.authority.publicKey.toBase58());
  assert.equal(report.batch.account?.keyVersion, 1);
  assert.equal(report.issuer.account?.keyVersion, 2);
  const [revokedDocument, revokedProof] = [oldBatch.documents[1], oldBatch.proofs[1]];
  assert.ok(revokedDocument && revokedProof);
  assert.equal((await verifyCredential(connection, config, revokedDocument, serializeProof(revokedProof))).status, 'revoked');
});

test('recover_authority: registry admin only, with the new key signing; the replaced key loses its rights', async () => {
  const issuer = await registerIssuer();
  const batch = await publish(issuer);
  const replacement = await funded();
  const stranger = await funded();
  const recover = (admin: Keypair, newAuthority: Keypair) => recoverAuthorityInstruction(programId, { admin: admin.publicKey, issuerId: issuer.issuerId, newAuthority: newAuthority.publicKey });

  await rejects(send(recover(stranger, replacement), [stranger, replacement]), PROGRAM_ERRORS.NotRegistryAdmin, 'stranger recovers');
  await rejects(send(recover(issuer.authority, replacement), [issuer.authority, replacement]), PROGRAM_ERRORS.NotRegistryAdmin, 'issuer recovers itself');
  await rejects(send(withoutSignature(recover(wallet, replacement), 3), [wallet]), NOT_SIGNER, 'replacement did not sign');
  await rejects(send(recover(wallet, issuer.authority), [wallet, issuer.authority]), PROGRAM_ERRORS.SameAuthority, 'recover to the current key');
  assert.equal((await readIssuer(issuer.issuerId)).keyVersion, 1);

  await send(recover(wallet, replacement), [wallet, replacement]);
  const recovered = await readIssuer(issuer.issuerId);
  assert.deepEqual([recovered.authority.toBase58(), recovered.keyVersion], [replacement.publicKey.toBase58(), 2]);

  await assertKeyRejected(issuer, issuer.authority, batch);
  const newBatch = await publish(issuer, 3, replacement);
  assert.equal((await readAccount(newBatch.address, decodeBatch)).keyVersion, 2);
  await send(revokeInstruction(replacement.publicKey, batch, 0, 3), [replacement]);
});
