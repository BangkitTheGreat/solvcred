import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeRegistry, initializeRegistryInstruction, PROGRAM_ERRORS, registryAddress } from '../../packages/solana/src/index.js';
import { connection, funded, programId, readAccount, rejects, send, wallet } from './helpers.js';

test('bootstrap: only the current upgrade authority initializes the registry, and only once', async () => {
  assert.equal(await connection.getAccountInfo(registryAddress(programId), 'confirmed'), null, 'requires a fresh validator from `anchor test`');

  const stranger = await funded();
  await rejects(send(initializeRegistryInstruction(programId, stranger.publicKey), [stranger]), PROGRAM_ERRORS.UnauthorizedBootstrap, 'stranger');
  assert.equal(await connection.getAccountInfo(registryAddress(programId), 'confirmed'), null, 'failed bootstrap leaves no registry');

  await send(initializeRegistryInstruction(programId, wallet.publicKey), [wallet]);
  const registry = await readAccount(registryAddress(programId), decodeRegistry);
  assert.ok(registry.admin.equals(wallet.publicKey));
  assert.equal(registry.version, 1);

  await rejects(send(initializeRegistryInstruction(programId, wallet.publicKey), [wallet]), 'already-in-use', 'second init');
  await rejects(send(initializeRegistryInstruction(programId, stranger.publicKey), [stranger]), 'already-in-use', 'late stranger');
  assert.ok((await readAccount(registryAddress(programId), decodeRegistry)).admin.equals(wallet.publicKey), 'admin unchanged');
});
