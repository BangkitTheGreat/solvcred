import { arch, cpus, platform } from 'node:os';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { prepareBatch, randomId, serializeProof, verifyDocument, type BatchCommitment } from '../packages/core/src/index.js';

const fixture = JSON.parse(await readFile('test-vectors/v1.json', 'utf8')) as {
  cases: { commitment: BatchCommitment }[];
};
const vector = fixture.cases[0];
if (!vector) throw new Error('Fixture missing');
// Synthetic header-bearing byte payloads: tests hashing throughput, not PDF rendering.
const documents = Array.from({ length: 100 }, (_, index) => {
  const bytes = new Uint8Array(1024 * 1024).fill(32);
  bytes.set(new TextEncoder().encode(`%PDF-1.4\n% synthetic benchmark ${index}\n`));
  return bytes;
});
const start = performance.now();
const batch = await prepareBatch({ ...vector.commitment, batchId: randomId() }, documents);
const prepared = performance.now();
for (const [index, proof] of batch.proofs.entries()) {
  const document = documents[index];
  if (!document || (await verifyDocument(document, serializeProof(proof), batch.commitment)).status !== 'integrity-match') {
    throw new Error('Benchmark integrity check failed');
  }
}
console.log(JSON.stringify({
  scope: 'Synthetic byte hashing only; no browser, RPC or transaction benchmark',
  node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown',
  documents: documents.length, totalBytes: documents.reduce((sum, doc) => sum + doc.byteLength, 0),
  prepareMs: Math.round(prepared - start), verifyAllMs: Math.round(performance.now() - prepared),
}, null, 2));
