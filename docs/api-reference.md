# Referensi API TypeScript

> API publik `packages/core` dan `packages/solana`: fungsi, tipe, galat, dan contoh pemakaian. Layout biner dan aturan program
> ada di [program-interface.md](program-interface.md); encoding hash di [proof-format-v1.md](proof-format-v1.md).

Kedua paket tidak dipublikasikan ke npm. Impor langsung dari source, seperti yang dilakukan `apps/web`:

```ts
import { prepareBatch, verifyDocument } from '../../packages/core/src/index.js';
import { createConnection, verifyCredential } from '../../packages/solana/src/index.js';
```

Semua hash dan ID 32 byte direpresentasikan sebagai **64 karakter hex huruf kecil**. Public key memakai `PublicKey` dari
`@solana/web3.js` (di `packages/solana`) atau string base58 (di `packages/core`).

## Daftar isi

- [`packages/core`](#packagescore)
  - [Tipe](#tipe) · [Batas](#batas) · [Fungsi](#fungsi) · [Galat](#galat)
- [`packages/solana`](#packagessolana)
  - [Konfigurasi dan koneksi](#konfigurasi-dan-koneksi) · [Verifikasi dan pembacaan](#verifikasi-dan-pembacaan) · [Builder instruksi](#builder-instruksi) · [PDA](#pda) · [Layout akun](#layout-akun)
- [Contoh end-to-end](#contoh-end-to-end)

---

## `packages/core`

Tanpa dependensi runtime. Memakai `globalThis.crypto` (Web Crypto), jadi berjalan di browser dan Node ≥ 22. **Tidak pernah
melakukan request jaringan.**

### Tipe

```ts
interface BatchContext {
  readonly network: 'solana-devnet';
  readonly programId: string;   // base58
  readonly issuerId: string;    // hex 32 byte
  readonly batchId: string;     // hex 32 byte
}

interface BatchCommitment extends BatchContext {
  readonly leafCount: number;   // 1–100
  readonly root: string;        // hex 32 byte
}

interface CredentialProof extends BatchCommitment {
  readonly schemaVersion: 1;
  readonly leafIndex: number;
  readonly nonce: string;
  readonly siblings: readonly string[];  // panjang tepat ceil(log2(leafCount))
}

interface PreparedBatch {
  readonly state: 'draft';      // selalu draft: belum diterbitkan
  readonly commitment: BatchCommitment;
  readonly proofs: readonly CredentialProof[];  // proofs[i].leafIndex === i
}

type IntegrityResult =
  | { readonly status: 'integrity-match' }
  | { readonly status: 'integrity-mismatch'; readonly reason: 'context' | 'merkle-path' };
```

### Batas

```ts
export const LIMITS = Object.freeze({
  documents: 100,
  documentBytes: 10 * 1024 * 1024,   // 10 MiB per PDF
  batchBytes: 100 * 1024 * 1024,     // 100 MiB per batch
  proofBytes: 16 * 1024,             // 16 KiB proof JSON
});
```

### Fungsi

| Fungsi | Hasil | Keterangan |
| --- | --- | --- |
| `prepareBatch(context, documents)` | `Promise<PreparedBatch>` | Validasi konteks dan setiap PDF, salin byte sebelum `await`, buat nonce acak, hitung leaf dan tree. PDF identik dalam satu batch → `DUPLICATE_DOCUMENT` |
| `verifyDocument(pdf, proofJson, expected)` | `Promise<IntegrityResult>` | **Integritas saja.** `expected` wajib berasal dari data tepercaya (on-chain), bukan dari proof |
| `documentLeafHash(pdf, proof)` | `Promise<string>` | Leaf hash untuk alamat Revocation dan argumen `revoke_credential` |
| `parseProofJson(text)` | `CredentialProof` | Parser ketat: ukuran ≤ 16 KiB, versi dicek lebih dulu, field tambahan ditolak, path harus tepat panjangnya |
| `serializeProof(proof)` | `string` | Validasi ulang lalu JSON dengan indentasi 2 |
| `randomId()` | `string` | 32 byte acak (hex) untuk batch ID atau issuer ID |

### Galat

Semua kegagalan input melempar `ValidationError` dengan `code`:

| `code` | Arti |
| --- | --- |
| `INVALID_INPUT` | Struktur, hex, base58, header PDF, indeks, atau panjang path tidak valid |
| `UNSUPPORTED_VERSION` | `schemaVersion` selain 1 |
| `UNSUPPORTED_NETWORK` | `network` selain `solana-devnet` |
| `LIMIT_EXCEEDED` | Melebihi `LIMITS` atau `leafCount` di luar 1–100 |
| `DUPLICATE_DOCUMENT` | PDF identik dalam satu batch |

Pesan galat tidak pernah memuat isi input.

---

## `packages/solana`

Bergantung pada `@solana/web3.js` 1.99 dan `packages/core`.

### Konfigurasi dan koneksi

```ts
interface ClusterConfig {
  readonly network: 'solana-devnet';
  readonly programId: string;
  readonly rpcUrl: string;
  readonly expectedGenesisHash: string;
  readonly timeoutMs: number;
}
```

| Ekspor | Keterangan |
| --- | --- |
| `createConnection(config, fetchImpl?)` | `Connection` dengan commitment `finalized`, timeout keras per HTTP exchange (termasuk pembacaan body), dan tanpa retry 429 otomatis. `timeoutMs` harus integer positif |
| `RpcTimeoutError` | Dilempar saat exchange melebihi `timeoutMs` |
| `DEVNET_GENESIS_HASH` | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| `PLACEHOLDER_PROGRAM_ID` | Program ID source tanpa private key; tidak dapat di-deploy |

**Aturan:** konfigurasi menentukan RPC, jaringan, dan program. Proof tidak pernah memilih ketiganya.

### Verifikasi dan pembacaan

#### `verifyCredential(connection, config, pdf, proofJson, now?)`

Pemeriksaan lengkap terhadap satu snapshot `finalized`. Kegagalan RPC, input yang tidak valid, dan akun yang gagal validasi
menjadi status, bukan exception. Galat tak terduga lainnya tetap dilempar. Urutan pemeriksaan: [system-design.md §8.3](system-design.md#83-verifikasi).

```ts
type OverallStatus =
  | 'verified' | 'revoked' | 'proof-mismatch' | 'issuer-untrusted'
  | 'issuer-inactive' | 'batch-not-found' | 'unverifiable';

type UnverifiableReason =
  | 'rpc-error' | 'rpc-timeout' | 'wrong-network' | 'unsupported-proof'
  | 'program-mismatch' | 'program-not-deployed' | 'invalid-account';

interface VerificationReport {
  readonly status: OverallStatus;
  readonly checkedAt: string;              // ISO 8601
  readonly slot: number | null;            // slot snapshot; null jika tidak ada snapshot
  readonly reason: UnverifiableReason | 'invalid-input' | 'context' | 'merkle-path' | null;
  readonly integrity: 'match' | 'mismatch' | 'not-checked';
  readonly issuer: { state: 'active' | 'inactive' | 'not-found' | 'unknown'; address: string | null; account: IssuerAccount | null };
  readonly batch: { state: 'found' | 'not-found' | 'unknown'; address: string | null; account: BatchAccount | null };
  readonly revocation: { state: 'revoked' | 'not-revoked' | 'unknown'; account: RevocationAccount | null };
}
```

Hanya `status === 'verified'` yang boleh ditampilkan sebagai sukses. `unverifiable` tidak menyatakan sah maupun tidak sah.

#### `checkPublishedBatch(connection, config, commitment)` — FR-10

Membaca program dan PDA batch pada `finalized`.

```ts
type PublishCheck =
  | { state: 'missing' }                                  // aman mengirim draft yang sama
  | { state: 'matches'; batch: BatchAccount }             // root dan leaf count sama: selesai
  | { state: 'conflict'; batch: BatchAccount }            // batch ID ada dengan root lain: berhenti
  | { state: 'unknown'; reason: UnverifiableReason };     // jangan kirim; periksa ulang
```

#### Pembacaan akun

| Fungsi | Hasil | Keterangan |
| --- | --- | --- |
| `fetchRegistry(connection, config)` | `RegistryAccount \| null` | Owner dan layout divalidasi |
| `fetchIssuer(connection, config, issuerId)` | `IssuerAccount \| null` | Issuer ID di akun harus sama dengan alamatnya |
| `fetchIssuersByAuthority(connection, config, authority)` | `{ address, issuer }[]` | `getProgramAccounts` dengan filter ukuran + `memcmp` offset 40. Setiap hasil dicek ulang (authority dan PDA) |

Akun yang gagal validasi melempar `AccountDataError`.

### Builder instruksi

Semua builder mengembalikan `TransactionInstruction` dengan urutan akun sesuai [program-interface.md](program-interface.md#instruksi),
dan memvalidasi argumen **sebelum** wallet diminta tanda tangan.

| Builder | Argumen | Validasi di klien |
| --- | --- | --- |
| `initializeRegistryInstruction(programId, admin)` | – | Menurunkan akun ProgramData |
| `registerIssuerInstruction(programId, { admin, issuerId, name, domain, authority })` | | Nama 1–96 byte tanpa karakter kontrol, domain `a-z 0-9 . -`, authority bukan default |
| `publishBatchInstruction(programId, { authority, commitment })` | | Commitment valid dan terikat ke `programId` yang sama |
| `revokeCredentialInstruction(programId, { authority, proof, leafHash, reasonCode })` | `reasonCode: 1 \| 2 \| 3 \| 4` | Proof valid dan terikat ke program; kode alasan dikenal |
| `deactivateIssuerInstruction(programId, { admin, issuerId })` | | – |
| `rotateAuthorityInstruction(programId, { issuerId, authority, newAuthority })` | | Kunci baru ≠ kunci lama |
| `recoverAuthorityInstruction(programId, { admin, issuerId, newAuthority })` | | – |

Pendukung: `INSTRUCTIONS` (spesifikasi discriminator, argumen, akun), `PROGRAM_ERRORS` (kode 6000–6016), `REVOCATION_REASONS`
(kode + label Indonesia), `isValidIssuerName`, `isValidIssuerDomain`.

### PDA

| Fungsi | Seeds |
| --- | --- |
| `registryAddress(programId)` | `"registry"` |
| `issuerAddress(programId, issuerIdHex)` | `"issuer"`, issuer ID |
| `batchAddress(programId, issuerAccount, batchIdHex)` | `"batch"`, **alamat akun issuer**, batch ID |
| `revocationAddress(programId, batchAccount, leafHashHex)` | `"revoked"`, alamat batch, leaf hash |
| `programDataAddress(programId)` | Diturunkan dari BPF Upgradeable Loader |

### Layout akun

`ACCOUNTS` memuat spesifikasi (discriminator, ukuran, field). Decoder `decodeRegistry`, `decodeIssuer`, `decodeBatch`,
`decodeRevocation` menolak panjang yang salah, discriminator lain, `bool` selain 0/1, string melewati batas, padding bukan nol,
dan UTF-8 tidak valid. Field `u64`/`i64` (slot, timestamp) dikembalikan sebagai `bigint`.

---

## Contoh end-to-end

### Menyiapkan draft batch (lokal)

```ts
import { prepareBatch, randomId, serializeProof } from '../../packages/core/src/index.js';

const draft = await prepareBatch(
  { network: 'solana-devnet', programId, issuerId, batchId: randomId() },
  pdfByteArrays,                       // Uint8Array[] berisi PDF final
);
// Simpan draft.commitment, setiap serializeProof(draft.proofs[i]), dan PDF-nya SEBELUM mengirim transaksi.
```

### Menerbitkan dengan pemulihan FR-10

```ts
import { checkPublishedBatch, publishBatchInstruction } from '../../packages/solana/src/index.js';

const before = await checkPublishedBatch(connection, config, draft.commitment);
if (before.state === 'missing') {
  const ix = publishBatchInstruction(new PublicKey(config.programId), { authority, commitment: draft.commitment });
  // tandatangani dan kirim lewat wallet, tunggu finalized
}
const after = await checkPublishedBatch(connection, config, draft.commitment);
// Hanya after.state === 'matches' yang berarti batch terbit dengan root ini.
```

### Memverifikasi kredensial

```ts
import { createConnection, verifyCredential } from '../../packages/solana/src/index.js';

const connection = createConnection(config);          // finalized + timeout
const report = await verifyCredential(connection, config, pdfBytes, proofJsonText);
if (report.status === 'verified') {
  // Integritas cocok, issuer aktif, tidak ada Revocation, pada report.slot
}
```
