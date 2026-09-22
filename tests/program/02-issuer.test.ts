import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Keypair, PublicKey } from '@solana/web3.js';
import { randomId } from '../../packages/core/src/index.js';
import {
  deactivateIssuerInstruction, INSTRUCTIONS, issuerAddress, PROGRAM_ERRORS, registerIssuerInstruction,
} from '../../packages/solana/src/index.js';
import { connection, ensureRegistry, funded, programId, readIssuer, registerIssuer, rejects, send, u32le, wallet } from './helpers.js';

before(ensureRegistry);

const borshString = (value: string): Buffer => {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([u32le(bytes.length), bytes]);
};

/** Bypasses the client-side checks so the program's own validation is exercised. */
function rawRegister(issuerId: string, name: string, domain: string, authority: PublicKey) {
  const instruction = registerIssuerInstruction(programId, { admin: wallet.publicKey, issuerId, name: 'Valid', domain: 'valid.id', authority: Keypair.generate().publicKey });
  instruction.data = Buffer.concat([
    Buffer.from(INSTRUCTIONS.registerIssuer.discriminator), Buffer.from(issuerId, 'hex'), borshString(name), borshString(domain), authority.toBuffer(),
  ]);
  return instruction;
}

test('register_issuer: only the registry admin registers; issuers start active at key version 1', async () => {
  const stranger = await funded();
  const authority = Keypair.generate().publicKey;
  const issuerId = randomId();
  const args = { issuerId, name: 'Universitas Uji', domain: 'uji.ac.id', authority };
  await rejects(send(registerIssuerInstruction(programId, { ...args, admin: stranger.publicKey }), [stranger]), PROGRAM_ERRORS.NotRegistryAdmin, 'stranger');
  assert.equal(await connection.getAccountInfo(issuerAddress(programId, issuerId), 'confirmed'), null);

  await send(registerIssuerInstruction(programId, { ...args, admin: wallet.publicKey }), [wallet]);
  const issuer = await readIssuer(issuerId);
  assert.deepEqual(
    [issuer.issuerId, issuer.authority.toBase58(), issuer.keyVersion, issuer.active, issuer.name, issuer.domain],
    [issuerId, authority.toBase58(), 1, true, 'Universitas Uji', 'uji.ac.id'],
  );
  assert.ok(issuer.registeredSlot > 0n);

  await rejects(
    send(registerIssuerInstruction(programId, { ...args, name: 'Penyusup', admin: wallet.publicKey, authority: stranger.publicKey }), [wallet]),
    'already-in-use', 'duplicate issuer id',
  );
  assert.ok((await readIssuer(issuerId)).authority.equals(authority), 'existing issuer untouched');
});

test('register_issuer: the program rejects invalid names, domains, and the default authority', async () => {
  const authority = Keypair.generate().publicKey;
  const cases: readonly [string, string, string, PublicKey, number][] = [
    ['empty name', '', 'uji.ac.id', authority, PROGRAM_ERRORS.InvalidName],
    ['97-byte name', 'a'.repeat(97), 'uji.ac.id', authority, PROGRAM_ERRORS.InvalidName],
    ['name with a newline', 'Universitas\nUji', 'uji.ac.id', authority, PROGRAM_ERRORS.InvalidName],
    ['name with a C1 control', 'Universitas\u0085Uji', 'uji.ac.id', authority, PROGRAM_ERRORS.InvalidName],
    ['empty domain', 'Universitas Uji', '', authority, PROGRAM_ERRORS.InvalidDomain],
    ['uppercase domain', 'Universitas Uji', 'Uji.ac.id', authority, PROGRAM_ERRORS.InvalidDomain],
    ['leading dot', 'Universitas Uji', '.uji.ac.id', authority, PROGRAM_ERRORS.InvalidDomain],
    ['trailing hyphen', 'Universitas Uji', 'uji.ac.id-', authority, PROGRAM_ERRORS.InvalidDomain],
    ['underscore', 'Universitas Uji', 'uji_ac.id', authority, PROGRAM_ERRORS.InvalidDomain],
    ['65-byte domain', 'Universitas Uji', 'a'.repeat(65), authority, PROGRAM_ERRORS.InvalidDomain],
    ['default authority', 'Universitas Uji', 'uji.ac.id', PublicKey.default, PROGRAM_ERRORS.InvalidAuthority],
  ];
  for (const [label, name, domain, key, code] of cases) {
    const issuerId = randomId();
    await rejects(send(rawRegister(issuerId, name, domain, key), [wallet]), code, label);
    assert.equal(await connection.getAccountInfo(issuerAddress(programId, issuerId), 'confirmed'), null, label);
  }

  const issuerId = randomId();
  await send(rawRegister(issuerId, 'é'.repeat(48), `${'a'.repeat(30)}..${'b'.repeat(32)}`, authority), [wallet]);
  const boundary = await readIssuer(issuerId);
  assert.deepEqual([Buffer.byteLength(boundary.name), boundary.domain.length], [96, 64]);
});

test('deactivate_issuer: registry admin only, and only while active', async () => {
  const issuer = await registerIssuer();
  const stranger = await funded();
  await rejects(send(deactivateIssuerInstruction(programId, { admin: stranger.publicKey, issuerId: issuer.issuerId }), [stranger]), PROGRAM_ERRORS.NotRegistryAdmin, 'stranger');
  await rejects(
    send(deactivateIssuerInstruction(programId, { admin: issuer.authority.publicKey, issuerId: issuer.issuerId }), [issuer.authority]),
    PROGRAM_ERRORS.NotRegistryAdmin, 'issuer authority',
  );
  assert.equal((await readIssuer(issuer.issuerId)).active, true);

  await send(deactivateIssuerInstruction(programId, { admin: wallet.publicKey, issuerId: issuer.issuerId }), [wallet]);
  const deactivated = await readIssuer(issuer.issuerId);
  assert.deepEqual([deactivated.active, deactivated.keyVersion], [false, 1]);
  await rejects(send(deactivateIssuerInstruction(programId, { admin: wallet.publicKey, issuerId: issuer.issuerId }), [wallet]), PROGRAM_ERRORS.IssuerAlreadyInactive, 'twice');
});
