import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Keypair, PublicKey, SystemProgram, type TransactionInstruction } from '@solana/web3.js';
import { ValidationError, type CredentialProof } from '../../core/src/index.js';
import {
  ACCOUNTS, deactivateIssuerInstruction, initializeRegistryInstruction, INSTRUCTIONS, PLACEHOLDER_PROGRAM_ID, publishBatchInstruction,
  recoverAuthorityInstruction, registerIssuerInstruction, revokeCredentialInstruction, rotateAuthorityInstruction,
  type RevocationReasonCode,
} from '../src/index.js';
import { doc, otherDoc, programId, vector } from './fixtures.js';

const sha256Prefix = (label: string): number[] => [...createHash('sha256').update(label).digest().subarray(0, 8)];
const pda = (seeds: Buffer[], owner: PublicKey = programId): PublicKey => PublicKey.findProgramAddressSync(seeds, owner)[0];
const u32 = (value: number): Buffer => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
const hex = (value: string): Buffer => Buffer.from(value, 'hex');

const admin = Keypair.generate().publicKey;
const authority = Keypair.generate().publicKey;
const newAuthority = Keypair.generate().publicKey;
const { issuerId, batchId } = vector.commitment;
const registry = pda([Buffer.from('registry')]);
const issuer = pda([Buffer.from('issuer'), hex(issuerId)]);
const batch = pda([Buffer.from('batch'), issuer.toBuffer(), hex(batchId)]);
const system = SystemProgram.programId;
const isInvalidInput = (error: unknown): boolean => error instanceof ValidationError && error.code === 'INVALID_INPUT';

type Meta = readonly [pubkey: PublicKey, flags: '' | 'w' | 's' | 'ws'];

function assertInstruction(instruction: TransactionInstruction, data: readonly Buffer[], metas: readonly Meta[]): void {
  assert.ok(instruction.programId.equals(programId));
  assert.equal(Buffer.from(instruction.data).toString('hex'), Buffer.concat(data).toString('hex'));
  assert.deepEqual(
    instruction.keys.map(({ pubkey, isSigner, isWritable }) => [pubkey.toBase58(), isSigner, isWritable]),
    metas.map(([pubkey, flags]) => [pubkey.toBase58(), flags.includes('s'), flags.includes('w')]),
  );
}

const disc = (spec: { readonly discriminator: readonly number[] }): Buffer => Buffer.from(spec.discriminator);

test('instruction and account discriminators are the Anchor sha256 prefixes', () => {
  for (const spec of Object.values(INSTRUCTIONS)) assert.deepEqual([...spec.discriminator], sha256Prefix(`global:${spec.name}`), spec.name);
  for (const spec of Object.values(ACCOUNTS)) assert.deepEqual([...spec.discriminator], sha256Prefix(`account:${spec.name}`), spec.name);
});

test('initialize_registry binds the program and its ProgramData account', () => {
  const programData = pda([programId.toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'));
  assertInstruction(initializeRegistryInstruction(programId, admin), [disc(INSTRUCTIONS.initializeRegistry)], [
    [registry, 'w'], [admin, 'ws'], [programId, ''], [programData, ''], [system, ''],
  ]);
});

test('register_issuer encodes byte-length-prefixed UTF-8 strings and the authority', () => {
  const name = 'Universitas Ümit';
  assertInstruction(registerIssuerInstruction(programId, { admin, issuerId, name, domain: 'umit.ac.id', authority }), [
    disc(INSTRUCTIONS.registerIssuer), hex(issuerId), u32(17), Buffer.from(name), u32(10), Buffer.from('umit.ac.id'), authority.toBuffer(),
  ], [[registry, ''], [issuer, 'w'], [admin, 'ws'], [system, '']]);
});

test('register_issuer enforces the program name, domain, and authority rules before signing', () => {
  const base = { admin, issuerId, name: 'Kampus', domain: 'kampus.ac.id', authority };
  for (const name of ['é'.repeat(48), 'Kampus Ünggul (Kampus 2)']) assert.doesNotThrow(() => registerIssuerInstruction(programId, { ...base, name }));
  for (const domain of ['a'.repeat(64), 'a..b', 'x', '1-2.id']) assert.doesNotThrow(() => registerIssuerInstruction(programId, { ...base, domain }));
  const invalid = [
    ...['', 'a'.repeat(97), 'é'.repeat(49), 'Kampus\nBaru', 'Kampus\u0085', 'Kampus\u007f', '\ud800'].map((name) => ({ ...base, name })),
    ...['', 'Kampus.ac.id', '.kampus.id', 'kampus.id-', '-kampus.id', 'kampus.id.', 'kampus_id', 'a'.repeat(65)].map((domain) => ({ ...base, domain })),
    { ...base, authority: PublicKey.default },
    { ...base, issuerId: 'AB'.repeat(32) },
  ];
  for (const args of invalid) assert.throws(() => registerIssuerInstruction(programId, args), isInvalidInput, JSON.stringify(args.name + args.domain));
});

test('publish_batch sends only batch id, root, leaf count, and schema version 1', () => {
  assertInstruction(publishBatchInstruction(programId, { authority, commitment: vector.commitment }), [
    disc(INSTRUCTIONS.publishBatch), hex(batchId), hex(vector.commitment.root), u32(3), Buffer.of(1),
  ], [[issuer, ''], [batch, 'w'], [authority, 'ws'], [system, '']]);

  assert.throws(() => publishBatchInstruction(programId, { authority, commitment: { ...vector.commitment, programId: PLACEHOLDER_PROGRAM_ID } }), isInvalidInput);
  assert.throws(() => publishBatchInstruction(programId, { authority, commitment: { ...vector.commitment, root: 'AB'.repeat(32) } }), isInvalidInput);
  for (const leafCount of [0, 101]) {
    assert.throws(() => publishBatchInstruction(programId, { authority, commitment: { ...vector.commitment, leafCount } }), ValidationError);
  }
});

test('revoke_credential sends leaf hash, index, siblings, and reason; derives the revocation PDA from the leaf', () => {
  const revocation = pda([Buffer.from('revoked'), batch.toBuffer(), hex(otherDoc.leafHash)]);
  assertInstruction(revokeCredentialInstruction(programId, { authority, proof: otherDoc.proof, leafHash: otherDoc.leafHash, reasonCode: 3 }), [
    disc(INSTRUCTIONS.revokeCredential), hex(otherDoc.leafHash), u32(1), u32(2), ...otherDoc.proof.siblings.map(hex), Buffer.of(3),
  ], [[issuer, ''], [batch, ''], [revocation, 'w'], [authority, 'ws'], [system, '']]);

  const valid = { authority, proof: doc.proof, leafHash: doc.leafHash, reasonCode: 1 as RevocationReasonCode };
  for (const reasonCode of [0, 5]) {
    assert.throws(() => revokeCredentialInstruction(programId, { ...valid, reasonCode: reasonCode as RevocationReasonCode }), isInvalidInput);
  }
  const foreign: CredentialProof = { ...doc.proof, programId: PLACEHOLDER_PROGRAM_ID };
  assert.throws(() => revokeCredentialInstruction(programId, { ...valid, proof: foreign }), isInvalidInput);
  assert.throws(() => revokeCredentialInstruction(programId, { ...valid, leafHash: 'zz'.repeat(32) }), isInvalidInput);
});

test('deactivate, rotate, and recover carry no arguments and require the documented signers', () => {
  assertInstruction(deactivateIssuerInstruction(programId, { admin, issuerId }), [disc(INSTRUCTIONS.deactivateIssuer)], [
    [registry, ''], [issuer, 'w'], [admin, 's'],
  ]);
  assertInstruction(rotateAuthorityInstruction(programId, { issuerId, authority, newAuthority }), [disc(INSTRUCTIONS.rotateAuthority)], [
    [issuer, 'w'], [authority, 's'], [newAuthority, 's'],
  ]);
  assertInstruction(recoverAuthorityInstruction(programId, { admin, issuerId, newAuthority }), [disc(INSTRUCTIONS.recoverAuthority)], [
    [registry, ''], [issuer, 'w'], [admin, 's'], [newAuthority, 's'],
  ]);
  assert.throws(() => rotateAuthorityInstruction(programId, { issuerId, authority, newAuthority: authority }), isInvalidInput);
});
