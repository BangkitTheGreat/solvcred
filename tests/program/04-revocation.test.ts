import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import type { TransactionInstruction } from '@solana/web3.js';
import { randomId } from '../../packages/core/src/index.js';
import {
  deactivateIssuerInstruction, decodeRevocation, issuerAddress, PROGRAM_ERRORS, revocationAddress, revokeCredentialInstruction,
} from '../../packages/solana/src/index.js';
import {
  connection, ensureRegistry, funded, programId, publish, readAccount, registerIssuer, rejects, revokeInstruction, send, u32le, wallet,
  type TestBatch,
} from './helpers.js';

before(ensureRegistry);

// revoke_credential data: discriminator(8) | leaf_hash(32) | leaf_index u32 @40 | siblings len u32 @44 | siblings @48 | reason_code u8 (last)
const LEAF_INDEX_OFFSET = 40;
const SIBLINGS_OFFSET = 48;

function withSiblings(instruction: TransactionInstruction, siblings: readonly Buffer[]): TransactionInstruction {
  const { data } = instruction;
  instruction.data = Buffer.concat([data.subarray(0, 44), u32le(siblings.length), ...siblings, data.subarray(data.length - 1)]);
  return instruction;
}

const revocationOf = (batch: TestBatch, index: number) => revocationAddress(programId, batch.address, batch.leafHashes[index] ?? '');

test('revoke_credential: strangers and the authority of another issuer are rejected', async () => {
  const issuerA = await registerIssuer('Universitas A', 'a.ac.id');
  const issuerB = await registerIssuer('Universitas B', 'b.ac.id');
  const batchA = await publish(issuerA);
  const stranger = await funded();

  await rejects(send(revokeInstruction(stranger.publicKey, batchA, 0), [stranger]), PROGRAM_ERRORS.NotIssuerAuthority, 'stranger');
  await rejects(send(revokeInstruction(issuerB.authority.publicKey, batchA, 0), [issuerB.authority]), PROGRAM_ERRORS.NotIssuerAuthority, 'B authority on issuer A');

  // Issuer B's own account and authority, pointed at a batch of issuer A.
  const crossIssuer = revokeInstruction(issuerB.authority.publicKey, batchA, 0);
  const issuerMeta = crossIssuer.keys[0];
  assert.ok(issuerMeta);
  issuerMeta.pubkey = issuerAddress(programId, issuerB.issuerId);
  await rejects(send(crossIssuer, [issuerB.authority]), PROGRAM_ERRORS.BatchIssuerMismatch, 'cross-issuer batch');

  assert.equal(await connection.getAccountInfo(revocationOf(batchA, 0), 'confirmed'), null);
});

test('revoke_credential: foreign leaves, wrong paths or indices, oversized paths, and unknown reasons are rejected', async () => {
  const issuer = await registerIssuer();
  const batch = await publish(issuer);
  const otherBatch = await publish(issuer);
  const { authority } = issuer;
  const proof = batch.proofs[0];
  const siblings = proof?.siblings.map((sibling) => Buffer.from(sibling, 'hex')) ?? [];
  assert.ok(proof && siblings.length === 2);

  const cases: readonly [string, () => TransactionInstruction, number][] = [
    ['leaf of another batch', () => revokeCredentialInstruction(programId, { authority: authority.publicKey, proof, leafHash: otherBatch.leafHashes[0] ?? '', reasonCode: 1 }), PROGRAM_ERRORS.InvalidMerkleProof],
    ['random leaf', () => revokeCredentialInstruction(programId, { authority: authority.publicKey, proof, leafHash: randomId(), reasonCode: 1 }), PROGRAM_ERRORS.InvalidMerkleProof],
    ['altered sibling', () => {
      const instruction = revokeInstruction(authority.publicKey, batch, 0);
      instruction.data[SIBLINGS_OFFSET] = (instruction.data[SIBLINGS_OFFSET] ?? 0) ^ 1;
      return instruction;
    }, PROGRAM_ERRORS.InvalidMerkleProof],
    ['wrong index', () => {
      const instruction = revokeInstruction(authority.publicKey, batch, 0);
      instruction.data.writeUInt32LE(1, LEAF_INDEX_OFFSET);
      return instruction;
    }, PROGRAM_ERRORS.InvalidMerkleProof],
    ['index equal to leaf count', () => {
      const instruction = revokeInstruction(authority.publicKey, batch, 2);
      instruction.data.writeUInt32LE(3, LEAF_INDEX_OFFSET);
      return instruction;
    }, PROGRAM_ERRORS.InvalidMerkleProof],
    ['truncated path', () => withSiblings(revokeInstruction(authority.publicKey, batch, 0), siblings.slice(0, 1)), PROGRAM_ERRORS.InvalidMerkleProof],
    ['path of 8 hashes', () => withSiblings(revokeInstruction(authority.publicKey, batch, 0), Array.from({ length: 8 }, (_, index) => siblings[index % 2] ?? Buffer.alloc(32))), PROGRAM_ERRORS.InvalidMerkleProof],
    ['reason code 0', () => {
      const instruction = revokeInstruction(authority.publicKey, batch, 0);
      instruction.data[instruction.data.length - 1] = 0;
      return instruction;
    }, PROGRAM_ERRORS.InvalidReasonCode],
    ['reason code 5', () => {
      const instruction = revokeInstruction(authority.publicKey, batch, 0);
      instruction.data[instruction.data.length - 1] = 5;
      return instruction;
    }, PROGRAM_ERRORS.InvalidReasonCode],
  ];
  for (const [label, build, code] of cases) await rejects(send(build(), [authority]), code, label);
  for (const index of [0, 1, 2]) assert.equal(await connection.getAccountInfo(revocationOf(batch, index), 'confirmed'), null);
});

test('revoke_credential: a valid revocation is recorded permanently and cannot be repeated', async () => {
  const issuer = await registerIssuer();
  // Five leaves: index 4 is the odd node that is duplicated on its level.
  const batch = await publish(issuer, 5);
  for (const [index, reasonCode] of [[1, 2], [4, 4]] as const) {
    await send(revokeInstruction(issuer.authority.publicKey, batch, index, reasonCode), [issuer.authority]);
    const revocation = await readAccount(revocationOf(batch, index), decodeRevocation);
    assert.deepEqual(
      [revocation.batch.toBase58(), revocation.leafHash, revocation.leafIndex, revocation.reasonCode, revocation.revokingAuthority.toBase58(), revocation.keyVersion],
      [batch.address.toBase58(), batch.leafHashes[index], index, reasonCode, issuer.authority.publicKey.toBase58(), 1],
    );
    assert.ok(revocation.recordedSlot > 0n && revocation.recordedAt > 0n);
  }
  await rejects(send(revokeInstruction(issuer.authority.publicKey, batch, 1, 3), [issuer.authority]), 'already-in-use', 'second revocation');
  assert.equal((await readAccount(revocationOf(batch, 1), decodeRevocation)).reasonCode, 2, 'reason unchanged');
  assert.equal(await connection.getAccountInfo(revocationOf(batch, 0), 'confirmed'), null, 'other credentials unaffected');
});

test('revoke_credential: an inactive issuer can still revoke its credentials', async () => {
  const issuer = await registerIssuer();
  const batch = await publish(issuer);
  await send(deactivateIssuerInstruction(programId, { admin: wallet.publicKey, issuerId: issuer.issuerId }), [wallet]);
  await send(revokeInstruction(issuer.authority.publicKey, batch, 0, 3), [issuer.authority]);
  assert.equal((await readAccount(revocationOf(batch, 0), decodeRevocation)).reasonCode, 3);
});
