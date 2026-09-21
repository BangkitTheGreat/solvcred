import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { prepareBatch, randomId, serializeProof, verifyDocument, type BatchCommitment } from '../packages/core/src/index.js';

const fixture = JSON.parse(await readFile('test-vectors/v1.json', 'utf8')) as {
  cases: { commitment: BatchCommitment; documents: { pdfHex: string }[] }[];
};
const vector = fixture.cases[1];
if (!vector) throw new Error('Demo fixture missing');
const documents = vector.documents.map((item) => Uint8Array.from(Buffer.from(item.pdfHex, 'hex')));
const batch = await prepareBatch({ ...vector.commitment, batchId: randomId() }, documents);
const folder = `work/demo-${batch.commitment.batchId}`;
await mkdir(folder, { recursive: true });
await writeFile(`${folder}/draft-manifest.json`, JSON.stringify(batch, null, 2));
for (const [index, proof] of batch.proofs.entries()) {
  const document = documents[index];
  if (!document) throw new Error('Missing demo document');
  await writeFile(`${folder}/fictional-${index + 1}.pdf`, document);
  await writeFile(`${folder}/fictional-${index + 1}.proof.json`, serializeProof(proof));
  const result = await verifyDocument(document, serializeProof(proof), batch.commitment);
  console.log(`Fictional document ${index + 1}: ${result.status}`);
}
console.log(`Draft exported to ${folder}`);
console.log('LOCAL DEMO ONLY: root comes from this local draft; issuer trust, publication and revocation are NOT checked.');
