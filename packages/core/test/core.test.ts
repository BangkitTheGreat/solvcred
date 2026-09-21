import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LIMITS, ValidationError, parseProofJson, prepareBatch, randomId, serializeProof, verifyDocument, type BatchCommitment, type CredentialProof } from '../src/index.js';
import { publicKeyBytes, toHex } from '../src/encoding.js';
import { buildTree, hashLeaf, hashNode, pathFor, sha256 } from '../src/merkle.js';

interface VectorDocument { pdfHex: string; documentHash: string; leafPreimage: string; leafHash: string; proof: CredentialProof }
interface VectorCase { commitment: BatchCommitment; documents: VectorDocument[] }
// The checked-in fixture is also independently regenerated and compared in CI.
const vectors = JSON.parse(readFileSync('test-vectors/v1.json', 'utf8')) as { cases: VectorCase[] };
const single = vectors.cases[0];
const odd = vectors.cases[1];
assert.ok(single && odd);
const first = odd.documents[0];
assert.ok(first);
const pdf = (): Uint8Array => Uint8Array.from(Buffer.from(first.pdfHex, 'hex'));
const context = odd.commitment;
const proofText = (): string => serializeProof(first.proof);
const isCode = (code: ValidationError['code']) => (error: unknown): boolean => error instanceof ValidationError && error.code === code;

for (const vector of vectors.cases) {
  test(`independent reference: ${vector.commitment.leafCount} leaves, every document and path`, async () => {
    const tree = await buildTree(vector.documents.map((item) => item.leafHash));
    assert.equal(tree.at(-1)?.[0], vector.commitment.root);
    for (const item of vector.documents) {
      assert.deepEqual(pathFor(tree, item.proof.leafIndex), item.proof.siblings);
      const bytes = Uint8Array.from(Buffer.from(item.pdfHex, 'hex'));
      assert.equal(await sha256(bytes), item.documentHash);
      assert.equal(await sha256(Buffer.from(item.leafPreimage, 'hex')), item.leafHash);
      assert.equal(await hashLeaf(item.proof, item.proof.leafCount, item.proof.leafIndex, item.proof.nonce, item.documentHash), item.leafHash);
      assert.deepEqual(await verifyDocument(bytes, serializeProof(item.proof), vector.commitment), { status: 'integrity-match' });
    }
  });
}

test('single-leaf path is empty and root equals leaf', () => {
  assert.deepEqual(single.documents[0]?.proof.siblings, []);
  assert.equal(single.commitment.root, single.documents[0]?.leafHash);
});

test('prepares a draft of 100 documents with unique nonces and independently verifiable paths', async () => {
  const documents = Array.from({ length: 100 }, (_, i) => new TextEncoder().encode(`%PDF-1.4\nfixture ${i}\n%%EOF`));
  const result = await prepareBatch(context, documents);
  assert.equal(result.state, 'draft');
  assert.equal(result.proofs.length, 100);
  assert.equal(new Set(result.proofs.map((proof) => proof.nonce)).size, 100);
  for (const [index, proof] of result.proofs.entries()) {
    const document = documents[index];
    assert.ok(document);
    assert.deepEqual(await verifyDocument(document, serializeProof(proof), result.commitment), { status: 'integrity-match' });
  }
});

test('detects a changed PDF byte', async () => {
  const changed = pdf();
  changed[20] = (changed[20] ?? 0) ^ 1;
  assert.equal((await verifyDocument(changed, proofText(), context)).status, 'integrity-mismatch');
});

test('detects a proof exchanged between documents', async () => {
  const other = odd.documents[1];
  assert.ok(other);
  assert.equal((await verifyDocument(pdf(), serializeProof(other.proof), context)).status, 'integrity-mismatch');
});

for (const field of ['issuerId', 'batchId', 'root', 'nonce'] as const) {
  test(`rejects tampering with ${field}`, async () => {
    const changed = { ...first.proof, [field]: 'ff'.repeat(32) };
    assert.equal((await verifyDocument(pdf(), serializeProof(changed), context)).status, 'integrity-mismatch');
  });
}

test('rejects another program and a different trusted root', async () => {
  const changed = { ...first.proof, programId: '11111111111111111111111111111111' };
  assert.equal((await verifyDocument(pdf(), serializeProof(changed), context)).status, 'integrity-mismatch');
  assert.equal((await verifyDocument(pdf(), proofText(), { ...context, root: 'ff'.repeat(32) })).status, 'integrity-mismatch');
});

test('rejects index changes, out-of-range indices and altered leaf counts', async () => {
  assert.equal((await verifyDocument(pdf(), serializeProof({ ...first.proof, leafIndex: 1 }), context)).status, 'integrity-mismatch');
  for (const leafIndex of [-1, 3, 0.5, '0']) {
    assert.throws(() => parseProofJson(JSON.stringify({ ...first.proof, leafIndex })), isCode('INVALID_INPUT'));
  }
  assert.equal((await verifyDocument(pdf(), serializeProof({ ...first.proof, leafCount: 4 }), context)).status, 'integrity-mismatch');
});

test('rejects sibling changes and unexpected path depth', async () => {
  assert.equal((await verifyDocument(pdf(), serializeProof({ ...first.proof, siblings: ['ff'.repeat(32), ...first.proof.siblings.slice(1)] }), context)).status, 'integrity-mismatch');
  for (const siblings of [[], [...first.proof.siblings, 'ff'.repeat(32)]]) {
    assert.throws(() => parseProofJson(JSON.stringify({ ...first.proof, siblings })), isCode('INVALID_INPUT'));
  }
});

test('rejects a nonduplicated odd node even when supplied root matches the forged path', async () => {
  const last = odd.documents[2];
  assert.ok(last);
  const left = last.proof.siblings[1];
  assert.ok(left);
  const fakeSibling = 'ff'.repeat(32);
  const fakeRoot = await hashNode(left, await hashNode(last.leafHash, fakeSibling));
  const forged = { ...last.proof, root: fakeRoot, siblings: [fakeSibling, left] };
  const result = await verifyDocument(Buffer.from(last.pdfHex, 'hex'), serializeProof(forged), { ...context, root: fakeRoot });
  assert.equal(result.status, 'integrity-mismatch');
});

test('validates malformed and unexpected JSON fields without echoing sensitive input', () => {
  for (const text of ['{', 'null', '[]', '"private data"', '{}']) {
    assert.throws(() => parseProofJson(text), isCode('INVALID_INPUT'));
  }
  assert.throws(() => parseProofJson(JSON.stringify({ ...first.proof, rpcUrl: 'https://attacker.invalid' })), isCode('INVALID_INPUT'));
  assert.throws(() => parseProofJson(' '.repeat(LIMITS.proofBytes + 1)), isCode('LIMIT_EXCEEDED'));
  assert.throws(() => parseProofJson(JSON.stringify({ ...first.proof, nonce: 'FF'.repeat(32) })), isCode('INVALID_INPUT'));
});

test('unknown version and unsupported network are errors, never successful checks', () => {
  assert.throws(() => parseProofJson(JSON.stringify({ ...first.proof, schemaVersion: 2 })), isCode('UNSUPPORTED_VERSION'));
  assert.throws(() => parseProofJson(JSON.stringify({ ...first.proof, network: 'solana-mainnet' })), isCode('UNSUPPORTED_NETWORK'));
});

test('base58 validation accepts exact 32-byte encodings and rejects ambiguous/wrong sizes', () => {
  assert.equal(toHex(publicKeyBytes(context.programId)), '11'.repeat(32));
  assert.equal(toHex(publicKeyBytes('1'.repeat(32))), '00'.repeat(32));
  for (const value of ['1'.repeat(31), '1'.repeat(33), '0'.repeat(32), 'z'.repeat(44), `1${context.programId}`]) {
    assert.throws(() => publicKeyBytes(value), isCode('INVALID_INPUT'));
  }
});

test('rejects empty, oversized, non-PDF and duplicate batches', async () => {
  await assert.rejects(prepareBatch(context, []), isCode('LIMIT_EXCEEDED'));
  await assert.rejects(prepareBatch(context, Array.from({ length: 101 }, pdf)), isCode('LIMIT_EXCEEDED'));
  await assert.rejects(prepareBatch(context, [new Uint8Array(LIMITS.documentBytes + 1)]), isCode('LIMIT_EXCEEDED'));
  await assert.rejects(prepareBatch(context, [new TextEncoder().encode('<html>private</html>')]), isCode('INVALID_INPUT'));
  await assert.rejects(prepareBatch(context, [pdf(), pdf()]), isCode('DUPLICATE_DOCUMENT'));
  const large = new Uint8Array(LIMITS.documentBytes);
  large.set(new TextEncoder().encode('%PDF-1.4'));
  await assert.rejects(prepareBatch(context, Array.from({ length: 11 }, () => large)), isCode('LIMIT_EXCEEDED'));
});

test('snapshots document and context before async hashing', async () => {
  const input = pdf();
  const mutableContext = { ...context };
  const promise = prepareBatch(mutableContext, [input]);
  input.fill(0);
  mutableContext.issuerId = 'ff'.repeat(32);
  const result = await promise;
  assert.equal(result.commitment.issuerId, context.issuerId);
  const proof = result.proofs[0];
  assert.ok(proof);
  assert.equal((await verifyDocument(pdf(), serializeProof(proof), result.commitment)).status, 'integrity-match');
});

test('verification snapshots caller-owned bytes before awaiting', async () => {
  const input = pdf();
  const result = verifyDocument(input, proofText(), context);
  input.fill(0);
  assert.equal((await result).status, 'integrity-match');
});

test('rejects shared buffers that another worker can mutate while being copied', async () => {
  const shared = new Uint8Array(new SharedArrayBuffer(pdf().length));
  shared.set(pdf());
  await assert.rejects(prepareBatch(context, [shared]), isCode('INVALID_INPUT'));
  await assert.rejects(verifyDocument(shared, proofText(), context), isCode('INVALID_INPUT'));
});

test('random IDs are 32-byte lowercase hex and each preparation uses new nonce material', async () => {
  assert.match(randomId(), /^[0-9a-f]{64}$/);
  const firstDraft = await prepareBatch(context, [pdf()]);
  const secondDraft = await prepareBatch(context, [pdf()]);
  assert.notEqual(firstDraft.commitment.root, secondDraft.commitment.root);
  assert.notEqual(firstDraft.proofs[0]?.nonce, secondDraft.proofs[0]?.nonce);
});

test('local checks perform no fetch and never claim on-chain verification', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Network access forbidden in core'); };
  try {
    const result = await verifyDocument(pdf(), proofText(), context);
    assert.deepEqual(result, { status: 'integrity-match' });
    assert.equal('verified' in result, false);
  } finally { globalThis.fetch = original; }
});

test('JSON whitespace and field order do not affect binary hashing', async () => {
  const reordered = Object.fromEntries(Object.entries(first.proof).reverse());
  assert.equal((await verifyDocument(pdf(), JSON.stringify(reordered), context)).status, 'integrity-match');
});
