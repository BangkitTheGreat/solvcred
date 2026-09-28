# Keterlacakan kebutuhan

> Menghubungkan setiap kebutuhan di [PRD](PRD.md) dengan kode yang mengimplementasikannya, test yang membuktikannya, dan
> status buktinya saat ini. PRD sendiri tidak diubah; status implementasi dicatat di sini.

**Acuan bukti:** commit `e529885`. CI run [`36417904485`](https://github.com/BangkitTheGreat/solvcred/actions/runs/36417904485)
lulus di ketiga job: `typescript`, `rust`, dan `anchor` (build SBF + 22 test on-chain di validator lokal). Pemeriksaan lokal
28 September 2026: 52 unit test TypeScript, 25 test Rust (`cargo test --workspace`), dan referensi Python lulus.

## Legenda

| Tanda | Arti |
| --- | --- |
| ✅ | Diimplementasikan dan dibuktikan test otomatis yang lulus |
| 🟡 | Diimplementasikan; bukti hanya berupa smoke test manual, typecheck, atau pengukuran parsial |
| ⛔ | Belum dikerjakan atau belum dapat dibuktikan (misalnya butuh deployment Devnet) |

Singkatan lokasi test: **core** = `packages/core/test/core.test.ts`, **adapter** = `packages/solana/test/adapter.test.ts`,
**ix** = `packages/solana/test/instructions.test.ts`, **layout** = `packages/solana/test/layout.test.ts`,
**vectors** = `crates/solvcred-proof/tests/vectors.rs`, **onchain/NN** = `tests/program/NN-*.test.ts`.

## 1. Kebutuhan fungsional (PRD §7)

| ID | Kebutuhan | Implementasi | Bukti | Status |
| --- | --- | --- | --- | --- |
| FR-01 | Otorisasi: mutasi tanpa hak ditolak walau UI dilewati | `programs/solvcred/src/lib.rs`: `has_one`, `Signer`, seeds + bump tersimpan pada setiap `#[derive(Accounts)]` | onchain/01 (bootstrap), onchain/02 (register oleh non-admin), onchain/03 (wallet asing, authority issuer lain), onchain/04 (pencabut asing), onchain/05 (rotasi/pemulihan tanpa hak) | ✅ |
| FR-02 | Identitas issuer tetap saat kunci berubah | Seeds issuer `["issuer", issuer_id]`; `rotate_authority` / `recover_authority` hanya mengubah `authority` dan `key_version` | onchain/05: issuer ID dan batch lama tetap setelah rotasi dan pemulihan | ✅ |
| FR-03 | Hanya issuer aktif menerbitkan; root tidak dapat ditimpa | `PublishBatch`: `constraint = issuer.active`, batch dengan `init`; tidak ada instruksi update/close | onchain/03: republish batch ID ditolak, root tetap, issuer nonaktif ditolak, batas leaf/skema/root | ✅ |
| FR-04 | Setiap dokumen punya proof yang dapat diverifikasi terpisah | `prepareBatch` (core), `buildFinalZip` (`apps/web/src/lib/package.ts`) | core: 100 dokumen dengan path independen; vectors: setiap dokumen fixture. Ekspor ZIP di UI hanya smoke test lokal | ✅ / 🟡 UI |
| FR-05 | Perubahan byte PDF atau manipulasi proof tidak lolos | `hashLeaf`, `checkPath` (core), `verify_path` (Rust) | core: byte berubah, proof tertukar, manipulasi setiap field, node ganjil palsu; vectors: kasus yang sama; adapter: `proof-mismatch` | ✅ |
| FR-06 | Sukses membutuhkan pembacaan status on-chain yang berhasil | `verifyCredential`: genesis, satu snapshot `finalized`, validasi akun, fail-closed | adapter: HTTP 500, JSON-RPC error, RPC menggantung, genesis salah, program tidak ada, akun palsu; onchain/06 | ✅ |
| FR-07 | Hanya issuer terkait mencabut; batch dan proof diperiksa program | `RevokeCredential`: `has_one = authority`, `batch.issuer == issuer`, `verify_path`, revocation dengan `init` | onchain/04: pencabut asing dan lintas issuer ditolak, leaf asing/path/indeks salah/path kepanjangan/alasan tak dikenal ditolak, pencabutan permanen | ✅ |
| FR-08 | Issuer nonaktif tidak menerbitkan batch baru | `deactivate_issuer`; constraint `issuer.active` di `PublishBatch` | onchain/02 (deactivate hanya admin, sekali), onchain/03 (issuer nonaktif tidak publish), onchain/04 (masih boleh mencabut) | ✅ |
| FR-09 | Kunci lama kehilangan hak setelah rotasi; batch lama tetap dapat diperiksa | `rotate_authority` (dua tanda tangan), `recover_authority` (admin + kunci baru), `key_version` di batch/revocation | onchain/05: kunci lama ditolak publish/revoke, batch lama menyimpan signer dan tetap terverifikasi | ✅ |
| FR-10 | Setelah respons tidak jelas, cek batch sebelum retry | `checkPublishedBatch` (adapter), `PublishPanel` (`settle`, `onResume`), cadangan draft wajib | adapter: `missing` / `matches` / `conflict` / `unknown`; smoke test browser dengan wallet palsu (penolakan, respons ambigu, retry draft sama) | ✅ adapter / 🟡 UI |
| FR-11 | Proof cukup menemukan batch tanpa database aplikasi | PDA diturunkan dari program ID, issuer ID, batch ID, dan leaf hash (`packages/solana/src/pda.ts`) | onchain/06: verifikasi lewat adapter hanya dari PDF + proof + konfigurasi | ✅ |

## 2. Kriteria keberhasilan (PRD §4)

| Kriteria | Bukti | Status |
| --- | --- | --- |
| Dokumen yang diubah gagal pemeriksaan integritas | core, vectors, adapter | ✅ |
| Kredensial yang dicabut tidak tampil terverifikasi | adapter (`revoked` menang atas dokumen cocok, termasuk issuer nonaktif), onchain/06 | ✅ |
| Kegagalan RPC tidak menghasilkan status valid | adapter: timeout, HTTP 500, JSON-RPC error selalu `unverifiable` | ✅ |
| Pengguna tanpa hak tidak dapat menerbitkan atau mencabut | onchain/03, onchain/04 | ✅ |
| Pergantian kunci tidak merusak bukti batch lama | onchain/05 | ✅ |
| Isi PDF dan proof tidak dikirim ke server, RPC, atau analytics | adapter (body request hanya alamat); smoke test browser; tidak ada analytics di kode | ✅ |
| 100 PDF dalam satu batch; jumlah, ukuran, perangkat, waktu dicatat | `npm run benchmark` di Node (100 × 1 MiB: 244 ms siapkan, 269 ms verifikasi). Benchmark browser belum ada | 🟡 |

## 3. Daftar pengujian wajib (PRD §13)

| Skenario | Bukti | Status |
| --- | --- | --- |
| PDF asli, PDF berubah, proof tertukar | core, vectors, adapter | ✅ |
| Batch satu leaf dan jumlah leaf ganjil | Fixture 1, 3, dan 5 leaf di `test-vectors/v1.json`; core, vectors | ✅ |
| Nonce, indeks, issuer, atau batch dimanipulasi | core (`rejects tampering with …`), vectors (`rejects_tampered_context_nonce_and_root`) | ✅ |
| Publikasi dan pencabutan tanpa otorisasi | onchain/03, onchain/04 | ✅ |
| Pencabutan lintas issuer | onchain/04 | ✅ |
| Rotasi kunci dan penggunaan kembali kunci lama | onchain/05 | ✅ |
| Issuer nonaktif dan batch lama | adapter (`issuer-inactive`), onchain/04, onchain/06 | ✅ |
| RPC timeout, batch tidak ada, jaringan salah | adapter | ✅ |
| Transaksi ditolak wallet atau respons publikasi terputus | Smoke test browser dengan wallet Wallet Standard palsu. `apps/web/src/lib/tx.ts` (`describeTxError`, `waitForFinalized`) belum punya unit test | 🟡 |
| Tidak ada pengiriman isi dokumen/proof melalui jaringan | adapter (privasi body request), smoke test browser | ✅ |

## 4. Kebutuhan UI (PRD §10)

| Kebutuhan | Implementasi | Status |
| --- | --- | --- |
| Pisahkan integritas, kepercayaan penerbit, dan pencabutan | `components/Report.tsx`, `integrityCopy` / `issuerCopy` / `revocationCopy` di `lib/status.ts` | 🟡 smoke test |
| Tampilkan waktu pemeriksaan | `report.checkedAt` dan slot snapshot di `Report.tsx` | 🟡 smoke test |
| Teks dan ikon, bukan warna saja | Setiap status punya label, ikon, dan tone | 🟡 belum diaudit pembaca layar |
| Label **"Pilih dokumen dan bukti"** | `views/VerifyView.tsx` | ✅ |
| Label Devnet dan data simulasi | Badge header dan footer `App.tsx` | ✅ |
| Jangan samakan kepemilikan file dengan identitas | Bagian batas di `VerifyView.tsx` | ✅ |
| PDF dipindai/diekspor ulang dijelaskan sebagai file berbeda | `VerifyView.tsx` dan penjelasan `merkle-path` | ✅ |

## 5. Persyaratan keamanan (PRD §11)

| Persyaratan | Implementasi | Status |
| --- | --- | --- |
| Network, program ID, RPC dari konfigurasi, bukan proof | `lib/config.ts`, `ClusterConfig`, cek `program-mismatch` | ✅ adapter |
| Validasi owner, PDA, relasi, signer, status | Program (constraint) + adapter (decoder dan relasi) | ✅ |
| Batasi ukuran file, jumlah file, panjang proof, ukuran JSON | `LIMITS` di core, `lib/files.ts`, `unzipDraft` | ✅ core |
| Jangan render PDF/HTML input sebagai konten aktif | File hanya dibaca sebagai byte/teks; CSP di `index.html` | ✅ desain / 🟡 audit |
| Tidak mencatat isi dokumen/proof di log atau analytics | Tidak ada logging input atau analytics | ✅ |
| Tidak menyimpan private key | Penandatanganan hanya lewat wallet adapter | ✅ |
| Data on-chain konsisten dengan commitment `finalized` | Satu snapshot `getMultipleAccountsInfoAndContext` | ✅ adapter |
| Jelaskan bahwa hasil bergantung pada RPC | Footer dan bagian batas di `VerifyView.tsx` | ✅ |

## 6. Definition of Done (PRD §13)

| Syarat | Status | Catatan |
| --- | --- | --- |
| Alur end-to-end berjalan di Devnet | ⛔ | Program belum di-deploy. `scripts/deploy-devnet.sh` sudah digladi di validator lokal ([deploy-devnet.md](deploy-devnet.md)); checklist uji penerimaan di [deployment.md §4](deployment.md#4-uji-penerimaan-devnet) |
| Seluruh pengujian kritis lulus | 🟡 | Otomatis lulus di CI (localnet). Wallet sungguhan dan Devnet belum diuji |
| Paket hasil dapat diverifikasi ulang tanpa database aplikasi | 🟡 | Terbukti di localnet (onchain/06); belum di Devnet |
| Repo memuat petunjuk, spesifikasi format, keputusan arsitektur, batas kepercayaan dan privasi | ✅ | [README](../README.md), [proof-format-v1](proof-format-v1.md), [decisions](decisions.md), [threat-model](threat-model.md), [system-design](system-design.md) |

## 7. Celah yang tercatat

1. **Deployment dan E2E Devnet.** Ini satu-satunya penghalang DoD yang bersifat ⛔.
2. **Unit test untuk `apps/web/src/lib/tx.ts` dan `lib/package.ts`.** Logika klasifikasi galat, polling finalitas, dan parser ZIP draft hanya diuji lewat smoke test.
3. **Benchmark browser** untuk 100 PDF (PRD §4) dengan perangkat, ukuran total, dan waktu tercatat.
4. **Audit aksesibilitas** dengan pembaca layar.
5. **UI admin** (register, deactivate, recover) belum dicoba di browser dengan wallet. Instruksinya sudah lulus test on-chain.
6. **Pencabutan batch dari kunci curian (PRD §8) tidak tercapai sesuai rumusan.** PRD meminta batch terdampak "ditinjau dan kredensialnya dicabut". Pencabutan membutuhkan leaf hash dan path yang hanya dapat dihitung dari PDF + proof, dan untuk batch penyerang file itu dipegang penyerang. Institusi hanya dapat mencabut salinan yang berhasil diperolehnya, atau menonaktifkan issuer secara permanen. Opsi desain ada di [system-design.md §16.2](system-design.md#162-pertanyaan-terbuka).
7. **Teks UI pemulihan kunci** (`apps/web/src/views/AdminView.tsx`, `RecoverPanel`) menyarankan "tinjau batch terdampak dan cabut kredensialnya". Teks ini perlu diselaraskan dengan batas di poin 6.
