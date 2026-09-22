import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { serializeProof } from '../../core/src/index.js';
import {
  AccountDataError, checkPublishedBatch, createConnection, fetchIssuer, fetchIssuersByAuthority, fetchRegistry, issuerAddress,
  PLACEHOLDER_PROGRAM_ID, registryAddress, verifyCredential, ACCOUNTS, type ClusterConfig, type VerificationReport,
} from '../src/index.js';
import {
  authority, batchData, batchPda, config, connect, doc, encodeAccount, FakeRpc, issuerData, issuerPda, otherDoc, pdf, programId,
  proofJson, publishedWorld, revocationData, revocationPda, vector, type Fault,
} from './fixtures.js';

const checkedAt = '2026-01-02T03:04:05.000Z';

async function verify(
  rpc: FakeRpc,
  options: { readonly document?: Uint8Array; readonly proof?: string; readonly config?: Partial<ClusterConfig> } = {},
): Promise<VerificationReport> {
  const effective = { ...config, ...options.config };
  return verifyCredential(createConnection(effective, rpc.fetch), effective, options.document ?? pdf(), options.proof ?? proofJson, () => new Date(checkedAt));
}

function assertUnverifiable(report: VerificationReport, reason: VerificationReport['reason']): void {
  assert.equal(report.status, 'unverifiable');
  assert.equal(report.reason, reason);
  assert.equal(report.integrity, 'not-checked');
  assert.equal(report.issuer.state, 'unknown');
  assert.equal(report.issuer.account, null);
  assert.equal(report.batch.state, 'unknown');
  assert.equal(report.batch.account, null);
  // A failed or untrusted read is never reported as "not revoked".
  assert.equal(report.revocation.state, 'unknown');
  assert.equal(report.revocation.account, null);
}

test('verified: local integrity plus active issuer and no revocation, all from one finalized snapshot', async () => {
  const rpc = publishedWorld();
  const report = await verify(rpc);
  assert.equal(report.status, 'verified');
  assert.equal(report.reason, null);
  assert.equal(report.integrity, 'match');
  assert.equal(report.checkedAt, checkedAt);
  assert.equal(report.slot, rpc.slot);
  assert.deepEqual([report.issuer.state, report.issuer.address, report.issuer.account?.name], ['active', issuerPda.toBase58(), 'Universitas Contoh']);
  assert.deepEqual([report.batch.state, report.batch.address, report.batch.account?.root], ['found', batchPda.toBase58(), vector.commitment.root]);
  assert.deepEqual([report.revocation.state, report.revocation.account], ['not-revoked', null]);
  assert.deepEqual(rpc.methods(), ['getGenesisHash', 'getMultipleAccounts']);
  assert.deepEqual(rpc.requests[1]?.params, [
    [programId, issuerPda, batchPda, revocationPda].map((key) => key.toBase58()),
    { encoding: 'base64', commitment: 'finalized' },
  ]);
});

test('revoked: a revocation record wins over a matching document, even for an inactive issuer', async () => {
  const rpc = publishedWorld().set(revocationPda, { owner: programId, data: revocationData() });
  const report = await verify(rpc);
  assert.equal(report.status, 'revoked');
  assert.equal(report.integrity, 'match');
  assert.equal(report.revocation.state, 'revoked');
  assert.equal(report.revocation.account?.reasonCode, 2);
  assert.equal(report.revocation.account?.leafHash, doc.leafHash);

  rpc.set(issuerPda, { owner: programId, data: issuerData({ active: false }) });
  assert.equal((await verify(rpc)).status, 'revoked');
});

test('inactive issuer: integrity still matches but the credential is not verified', async () => {
  const rpc = publishedWorld().set(issuerPda, { owner: programId, data: issuerData({ active: false }) });
  const report = await verify(rpc);
  assert.equal(report.status, 'issuer-inactive');
  assert.equal(report.integrity, 'match');
  assert.equal(report.issuer.state, 'inactive');
  assert.equal(report.revocation.state, 'not-revoked');
});

test('issuer missing from the registry is untrusted; batch missing is reported separately', async () => {
  const noIssuer = publishedWorld();
  noIssuer.accounts.delete(issuerPda.toBase58());
  const untrusted = await verify(noIssuer);
  assert.equal(untrusted.status, 'issuer-untrusted');
  assert.equal(untrusted.issuer.state, 'not-found');
  assert.equal(untrusted.integrity, 'not-checked');

  const noBatch = publishedWorld();
  noBatch.accounts.delete(batchPda.toBase58());
  const missing = await verify(noBatch);
  assert.equal(missing.status, 'batch-not-found');
  assert.equal(missing.batch.state, 'not-found');
  assert.equal(missing.issuer.state, 'active');
  assert.equal(missing.slot, noBatch.slot);
});

test('tampered PDF, exchanged proof, and a root that differs on-chain are proof mismatches', async () => {
  const tampered = pdf();
  tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
  const changed = await verify(publishedWorld(), { document: tampered });
  assert.deepEqual([changed.status, changed.reason, changed.integrity], ['proof-mismatch', 'merkle-path', 'mismatch']);

  const exchanged = await verify(publishedWorld(), { proof: serializeProof(otherDoc.proof) });
  assert.deepEqual([exchanged.status, exchanged.reason], ['proof-mismatch', 'merkle-path']);

  // The trusted root is read from chain; a self-consistent proof for another root does not pass.
  const rpc = publishedWorld().set(batchPda, { owner: programId, data: batchData({ root: 'ab'.repeat(32) }) });
  const otherRoot = await verify(rpc);
  assert.deepEqual([otherRoot.status, otherRoot.reason, otherRoot.integrity], ['proof-mismatch', 'context', 'mismatch']);
});

test('input that cannot be checked is rejected locally without any RPC request', async () => {
  const cases: readonly [string, Parameters<typeof verify>[1], VerificationReport['status'], VerificationReport['reason']][] = [
    ['proof for another program', { config: { programId: PLACEHOLDER_PROGRAM_ID } }, 'unverifiable', 'program-mismatch'],
    ['unknown schema version', { proof: JSON.stringify({ ...doc.proof, schemaVersion: 2 }) }, 'unverifiable', 'unsupported-proof'],
    ['unsupported network', { proof: JSON.stringify({ ...doc.proof, network: 'solana-mainnet' }) }, 'unverifiable', 'unsupported-proof'],
    ['malformed proof JSON', { proof: '{"schemaVersion":1,' }, 'proof-mismatch', 'invalid-input'],
    ['document is not a PDF', { document: new TextEncoder().encode('<html>not a pdf</html>') }, 'proof-mismatch', 'invalid-input'],
  ];
  for (const [label, options, status, reason] of cases) {
    const rpc = publishedWorld();
    const report = await verify(rpc, options);
    assert.deepEqual([report.status, report.reason, report.slot], [status, reason, null], label);
    assert.equal(report.revocation.state, 'unknown', label);
    assert.deepEqual(rpc.requests, [], label);
  }
});

test('genesis hash of another cluster is wrong-network and no accounts are read', async () => {
  const rpc = publishedWorld();
  rpc.genesisHash = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY';
  const report = await verify(rpc);
  assertUnverifiable(report, 'wrong-network');
  assert.equal(report.issuer.address, issuerPda.toBase58());
  assert.deepEqual(rpc.methods(), ['getGenesisHash']);
});

test('HTTP 500 and JSON-RPC errors are rpc-error, never a status', async () => {
  for (const method of ['getGenesisHash', 'getMultipleAccounts']) {
    for (const fault of ['http-500', 'rpc-error'] satisfies Fault[]) {
      const rpc = publishedWorld();
      rpc.faults.set(method, fault);
      assertUnverifiable(await verify(rpc), 'rpc-error');
    }
  }
});

test('a hanging RPC that ignores abort is cut off within timeoutMs as rpc-timeout', async () => {
  for (const method of ['getGenesisHash', 'getMultipleAccounts']) {
    const rpc = publishedWorld();
    rpc.faults.set(method, 'hang');
    const started = performance.now();
    const report = await verify(rpc, { config: { timeoutMs: 50 } });
    const elapsed = performance.now() - started;
    assertUnverifiable(report, 'rpc-timeout');
    assert.ok(elapsed >= 45 && elapsed < 1_000, `took ${elapsed} ms`);
  }
});

test('accounts with a foreign owner, bad layout, or broken relations are invalid-account', async () => {
  const elsewhere = Keypair.generate().publicKey;
  const cases: readonly [string, (rpc: FakeRpc) => void][] = [
    ['issuer owned by another program', (rpc) => rpc.set(issuerPda, { owner: SystemProgram.programId, data: issuerData() })],
    ['batch with a wrong discriminator', (rpc) => {
      const data = batchData();
      data[0] = (data[0] ?? 0) ^ 1;
      rpc.set(batchPda, { owner: programId, data });
    }],
    ['revocation with a wrong size', (rpc) => rpc.set(revocationPda, { owner: programId, data: revocationData().subarray(0, 129) })],
    ['issuer with a non-boolean flag', (rpc) => {
      const data = issuerData();
      data[76] = 2;
      rpc.set(issuerPda, { owner: programId, data });
    }],
    ['issuer id differs from the PDA seed', (rpc) => rpc.set(issuerPda, { owner: programId, data: issuerData({ issuer_id: 'cd'.repeat(32) }) })],
    ['batch points at another issuer', (rpc) => rpc.set(batchPda, { owner: programId, data: batchData({ issuer: elsewhere }) })],
    ['batch id differs from the PDA seed', (rpc) => rpc.set(batchPda, { owner: programId, data: batchData({ batch_id: 'ef'.repeat(32) }) })],
    ['batch leaf count outside 1..100', (rpc) => rpc.set(batchPda, { owner: programId, data: batchData({ leaf_count: 101 }) })],
    ['revocation for a different leaf', (rpc) => rpc.set(revocationPda, { owner: programId, data: revocationData({ leaf_hash: otherDoc.leafHash }) })],
    ['revocation for another batch', (rpc) => rpc.set(revocationPda, { owner: programId, data: revocationData({ batch: elsewhere }) })],
  ];
  for (const [label, corrupt] of cases) {
    const rpc = publishedWorld();
    corrupt(rpc);
    const report = await verify(rpc);
    assert.equal(report.reason, 'invalid-account', label);
    assertUnverifiable(report, 'invalid-account');
    assert.equal(report.slot, rpc.slot, label);
  }
});

test('a batch recorded with another schema version is unsupported', async () => {
  const rpc = publishedWorld().set(batchPda, { owner: programId, data: batchData({ schema_version: 2 }) });
  assertUnverifiable(await verify(rpc), 'unsupported-proof');
});

test('missing, non-executable, or non-upgradeable program account is program-not-deployed', async () => {
  const cases: readonly [string, (rpc: FakeRpc) => void][] = [
    ['missing', (rpc) => { rpc.accounts.delete(programId.toBase58()); }],
    ['not executable', (rpc) => rpc.set(programId, { owner: new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'), data: new Uint8Array(36) })],
    ['other loader', (rpc) => rpc.set(programId, { owner: new PublicKey('BPFLoader2111111111111111111111111111111111'), data: new Uint8Array(36), executable: true })],
  ];
  for (const [label, change] of cases) {
    const rpc = publishedWorld();
    change(rpc);
    const report = await verify(rpc);
    assert.equal(report.reason, 'program-not-deployed', label);
    assertUnverifiable(report, 'program-not-deployed');
  }
});

test('checkPublishedBatch distinguishes missing, matching, conflicting, and unknown states from a finalized read', async () => {
  const commitment = vector.commitment;
  const empty = publishedWorld();
  empty.accounts.delete(batchPda.toBase58());
  assert.deepEqual(await checkPublishedBatch(connect(empty), config, commitment), { state: 'missing' });
  assert.deepEqual(empty.requests[1]?.params, [[programId.toBase58(), batchPda.toBase58()], { encoding: 'base64', commitment: 'finalized' }]);

  const matches = await checkPublishedBatch(connect(publishedWorld()), config, commitment);
  assert.equal(matches.state, 'matches');
  assert.equal(matches.state === 'matches' && matches.batch.root, commitment.root);

  for (const overrides of [{ root: 'ab'.repeat(32) }, { leaf_count: 4 }]) {
    const rpc = publishedWorld().set(batchPda, { owner: programId, data: batchData(overrides) });
    assert.equal((await checkPublishedBatch(connect(rpc), config, commitment)).state, 'conflict');
  }

  const unknown: readonly [string, (rpc: FakeRpc) => void, string][] = [
    ['http 500', (rpc) => { rpc.faults.set('getMultipleAccounts', 'http-500'); }, 'rpc-error'],
    ['hang', (rpc) => { rpc.faults.set('getMultipleAccounts', 'hang'); }, 'rpc-timeout'],
    ['other cluster', (rpc) => { rpc.genesisHash = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY'; }, 'wrong-network'],
    ['foreign owner', (rpc) => rpc.set(batchPda, { owner: SystemProgram.programId, data: batchData() }), 'invalid-account'],
    ['batch of another issuer', (rpc) => rpc.set(batchPda, { owner: programId, data: batchData({ issuer: Keypair.generate().publicKey }) }), 'invalid-account'],
    ['no program', (rpc) => { rpc.accounts.delete(programId.toBase58()); }, 'program-not-deployed'],
  ];
  for (const [label, change, reason] of unknown) {
    const rpc = publishedWorld();
    change(rpc);
    assert.deepEqual(await checkPublishedBatch(connect(rpc, { timeoutMs: 50 }), { ...config, timeoutMs: 50 }, commitment), { state: 'unknown', reason }, label);
  }

  const rpc = publishedWorld();
  assert.deepEqual(await checkPublishedBatch(connect(rpc), config, { ...commitment, programId: PLACEHOLDER_PROGRAM_ID }), { state: 'unknown', reason: 'program-mismatch' });
  assert.deepEqual(rpc.requests, []);
});

test('fetchRegistry and fetchIssuer decode finalized accounts and reject foreign owners', async () => {
  const admin = Keypair.generate().publicKey;
  const rpc = publishedWorld().set(registryAddress(programId), { owner: programId, data: encodeAccount(ACCOUNTS.registry, { admin, version: 1, bump: 250 }) });
  const registry = await fetchRegistry(connect(rpc), config);
  assert.ok(registry);
  assert.ok(registry.admin.equals(admin));
  assert.equal(registry.version, 1);

  const issuer = await fetchIssuer(connect(rpc), config, vector.commitment.issuerId);
  assert.deepEqual([issuer?.domain, issuer?.keyVersion, issuer?.active, issuer?.registeredSlot], ['contoh.ac.id', 1, true, 100n]);
  assert.equal(await fetchIssuer(connect(rpc), config, '00'.repeat(32)), null);
  assert.deepEqual(rpc.requests.map(({ params }) => (params[1] as { commitment: string }).commitment), ['finalized', 'finalized', 'finalized']);

  rpc.set(issuerPda, { owner: SystemProgram.programId, data: issuerData() });
  await assert.rejects(fetchIssuer(connect(rpc), config, vector.commitment.issuerId), AccountDataError);
});

test('fetchIssuersByAuthority filters by size and authority offset and re-checks what the RPC returns', async () => {
  const secondId = 'aa'.repeat(32);
  const secondPda = issuerAddress(programId, secondId);
  const rpc = publishedWorld()
    .set(secondPda, { owner: programId, data: issuerData({ issuer_id: secondId, name: 'Politeknik Contoh' }) })
    .set(issuerAddress(programId, 'bb'.repeat(32)), { owner: programId, data: issuerData({ issuer_id: 'bb'.repeat(32), authority: Keypair.generate().publicKey }) });
  const found = await fetchIssuersByAuthority(connect(rpc), config, authority);
  // Sorted by issuer id ('22…' before 'aa…'); the issuer of another authority is filtered out.
  assert.deepEqual(found.map(({ address, issuer }) => [address.toBase58(), issuer.issuerId]), [
    [issuerPda.toBase58(), vector.commitment.issuerId],
    [secondPda.toBase58(), secondId],
  ]);
  assert.deepEqual(rpc.requests[0]?.params, [programId.toBase58(), {
    commitment: 'finalized', encoding: 'base64',
    filters: [{ dataSize: 254 }, { memcmp: { offset: 40, bytes: authority.toBase58(), encoding: 'base58' } }],
  }]);

  // An issuer account that is not at its own PDA cannot come from the program.
  rpc.set(Keypair.generate().publicKey, { owner: programId, data: issuerData({ issuer_id: 'cc'.repeat(32) }) });
  await assert.rejects(fetchIssuersByAuthority(connect(rpc), config, authority), AccountDataError);
});

test('privacy: RPC requests carry only public addresses, never PDF bytes, nonce, siblings, or the proof', async () => {
  const rpc = publishedWorld().set(revocationPda, { owner: programId, data: revocationData() });
  await verify(rpc);
  const tampered = pdf();
  tampered[20] = (tampered[20] ?? 0) ^ 1;
  await verify(rpc, { document: tampered });
  await checkPublishedBatch(connect(rpc), config, vector.commitment);
  await fetchIssuer(connect(rpc), config, vector.commitment.issuerId);
  const traffic = rpc.bodies.join('\n');
  assert.equal(rpc.bodies.length, 7);
  const secrets = [
    ['pdf hex', doc.pdfHex], ['pdf base64', Buffer.from(doc.pdfHex, 'hex').toString('base64')], ['document hash', doc.documentHash],
    ['leaf hash', doc.leafHash], ['nonce', doc.proof.nonce], ['proof json', proofJson], ['proof json compact', JSON.stringify(doc.proof)],
    ...doc.proof.siblings.map((sibling, index) => [`sibling ${index}`, sibling] as const),
  ] as const;
  for (const [label, secret] of secrets) assert.equal(traffic.includes(secret), false, label);
  assert.deepEqual(new Set(rpc.methods()), new Set(['getGenesisHash', 'getMultipleAccounts', 'getAccountInfo']));
});

test('createConnection reads at finalized and rejects a non-positive timeout', () => {
  assert.equal(connect(new FakeRpc()).commitment, 'finalized');
  for (const timeoutMs of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => createConnection({ ...config, timeoutMs }), { name: 'ValidationError' });
  }
});
