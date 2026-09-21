# SolVcred

Fondasi penerbitan dan verifikasi kredensial digital berbasis Solana. Dokumen berada di tangan pemilik; satu Merkle root mewakili satu batch. Penerima tidak membutuhkan wallet.

**Status saat ini: core lokal yang dapat diuji. Belum ada program Anchor, UI, adapter RPC, atau deployment Devnet.** Hasil `integrity-match` bukan bukti penerbit terpercaya maupun status pencabutan. Repo kanonis: [BangkitTheGreat/solvcred](https://github.com/BangkitTheGreat/solvcred).

## Mulai

Prasyarat: Node.js 22.23+ dan npm. Python 3.10+ hanya diperlukan untuk memeriksa ulang fixture independen.

```sh
npm ci --ignore-scripts
npm run check
python scripts/reference_vectors.py --check
npm run demo
npm run benchmark
```

`npm run demo` menghasilkan tiga PDF fiktif, proof JSON, dan manifest draft dalam `work/demo-<batch-id>/` yang diabaikan Git. Demo memakai program ID fixture yang **bukan deployment SolVcred**; tidak menghubungkan wallet atau mengirim transaksi. Tidak ada kunci privat maupun credential yang dibutuhkan.

`npm run benchmark` menguji 100 payload sintetis berheader PDF sebesar 1 MiB masing-masing. Ini benchmark hashing lokal, bukan validitas struktur PDF, performa browser, atau transaksi Solana.

## Yang tersedia

- Persiapan draft batch dengan SHA-256 dan nonce dari Web Crypto.
- Leaf mengikat network, program ID, issuer stabil, batch, count, index, nonce, dan hash PDF.
- Merkle proof deterministik dengan duplikasi node ganjil dan prefix hash berbeda.
- Parser proof, batas ukuran, penolakan duplikat dokumen dan pemeriksaan integritas terhadap commitment eksternal.
- Test vector dari Python independen, test manipulasi, demo lokal, benchmark, dan workflow CI.
- Tidak ada dependensi runtime pihak ketiga; TypeScript dan tipe Node hanya untuk development.

## Penggunaan core

Import API dari `packages/core/src/index.ts` dalam proyek TypeScript atau `dist/packages/core/src/index.js` setelah build.

| API | Fungsi |
| --- | --- |
| `randomId()` | Membuat ID 32 byte acak dalam lowercase hex |
| `prepareBatch(context, documents)` | Mengembalikan commitment dan proof berstatus `draft` |
| `parseProofJson(text)` | Memvalidasi JSON tidak tepercaya dan menghasilkan proof bertipe |
| `serializeProof(proof)` | Mengekspor proof yang tervalidasi |
| `verifyDocument(pdfBytes, proofJson, expectedCommitment)` | Memeriksa integritas terhadap commitment yang diberikan pemanggil |

`expectedCommitment` harus berasal dari batch on-chain yang telah diautentikasi oleh adapter mendatang. Jangan mengambilnya dari proof pengguna untuk menyatakan kredensial sah. Parser melempar `ValidationError` dengan kode stabil tanpa memasukkan isi dokumen ke pesan error. Pemanggil harus menangani error tersebut; jangan mengubahnya menjadi status valid.

Core memakai Web Crypto yang tersedia pada Node 22 dan browser dalam secure context. Kompatibilitas API tidak berarti pengujian browser sudah dilakukan; pengujian tahap ini dijalankan di Node.

## Dokumentasi

- [PRD terakhir dari pengguna](docs/PRD.md) — dipertahankan tanpa perubahan; nama repo lama tercatat di sumber.
- [Diagram arsitektur, alur, relasi akun dan lifecycle](docs/architecture.md).
- [Spesifikasi proof dan encoding v1](docs/proof-format-v1.md).
- [Model ancaman dan batas keamanan](docs/threat-model.md).
- [Kemajuan dan pekerjaan berikutnya](docs/roadmap.md).
- [Hasil validasi lokal](docs/validation.md).

## Struktur

```text
docs/                    PRD, diagram, spesifikasi, keputusan dan hasil pengujian
packages/core/src/       API, validasi, encoding dan Merkle
packages/core/test/      Pengujian integritas dan input tidak tepercaya
test-vectors/v1.json     Fixture deterministik untuk TypeScript dan Rust mendatang
scripts/                Referensi Python, demo dan benchmark
.github/workflows/      CI typecheck, test dan pemeriksaan fixture
```

## Batas jaminan

SolVcred tidak membuktikan kebenaran klaim akademik atau identitas orang yang membawa file. Hash dan nonce tidak menghilangkan seluruh risiko korelasi metadata. Root tidak dapat memulihkan PDF atau proof yang hilang. Pergantian byte PDF, termasuk ekspor ulang atau pemindaian, mengubah hasil hash. Admin registry, RPC, dan upgrade authority membutuhkan kebijakan kepercayaan yang eksplisit sebelum deployment.
