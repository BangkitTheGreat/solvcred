# SolVcred

Fondasi penerbitan dan verifikasi kredensial digital berbasis Solana. Dokumen berada di tangan pemilik; satu Merkle root mewakili satu batch. Penerima dan verifikator tidak membutuhkan wallet.

**Status saat ini: kode MVP ditulis untuk lima kelompok kerja (Rust proof, program Anchor, pengujian on-chain, adapter RPC, UI). Program belum di-deploy ke Devnet.** Program ID di source adalah placeholder tanpa private key. `cargo test --workspace` sudah lulus di CI, tetapi build SBF Anchor dan test on-chain belum pernah dijalankan. Lihat [hasil validasi](docs/validation.md). Repo kanonis: [BangkitTheGreat/solvcred](https://github.com/BangkitTheGreat/solvcred).

## Mulai

Prasyarat TypeScript: Node.js 22.23+ dan npm. Python 3.10+ hanya untuk memeriksa ulang fixture independen.

```sh
npm ci --ignore-scripts
npm run check                          # typecheck (root + web) dan unit test core/klien
python scripts/reference_vectors.py --check
npm run web:dev                        # UI lokal di http://localhost:5173
npm run web:build                      # bundle statis ke dist/web
npm run demo
npm run benchmark
```

Prasyarat Rust/Anchor (Linux atau WSL2): Rust 1.89, Solana CLI/Agave 2.3.x, Anchor CLI 0.32.1.

```sh
cargo test --workspace                 # crate solvcred-proof (test vector v1) dan unit test program
solana-keygen new --no-bip39-passphrase  # wallet provider lokal jika belum ada
anchor build && anchor keys sync       # ganti placeholder dengan program ID dari keypair lokal
anchor test                            # validator lokal, deploy upgradeable, lalu npm run test:program
```

`anchor keys sync` mengubah `declare_id!` dan `Anchor.toml`. Jangan commit program ID lokal sebagai program ID produksi. Workflow `.github/workflows/ci.yml` menjalankan langkah yang sama di `ubuntu-latest`.

`npm run demo` menghasilkan tiga PDF fiktif, proof JSON, dan manifest draft di `work/demo-<batch-id>/`. Demo tidak menghubungkan wallet atau mengirim transaksi.

## Konfigurasi UI

Salin `apps/web/.env.example` menjadi `apps/web/.env`.

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `VITE_SOLVCRED_PROGRAM_ID` | placeholder | Program ID hasil deploy. UI menampilkan peringatan selama nilainya placeholder |
| `VITE_SOLVCRED_RPC_URL` | `https://api.devnet.solana.com` | Endpoint RPC tetap. Proof tidak pernah memilih endpoint |
| `VITE_SOLVCRED_GENESIS_HASH` | genesis Devnet | Dipakai untuk mendeteksi RPC yang terhubung ke jaringan lain |

## Yang tersedia

| Kelompok | Lokasi | Isi |
| --- | --- | --- |
| Core TS | `packages/core` | Draft batch, nonce Web Crypto, leaf/Merkle v1, parser proof, pemeriksaan integritas, `documentLeafHash` |
| 1. Rust proof | `crates/solvcred-proof` | Encoding leaf, Merkle tree/path, `verify_path` identik dengan core; diuji terhadap `test-vectors/v1.json` |
| 2. Program Anchor | `programs/solvcred` | Registry dengan bootstrap oleh upgrade authority, register issuer, publish batch, revoke dengan verifikasi Merkle on-chain, deactivate, rotate, recover |
| 3. Uji on-chain | `tests/program` | Otorisasi, relasi akun, immutability batch, lifecycle kunci, drift IDL terhadap klien |
| 4. Adapter RPC | `packages/solana` | Builder instruksi, decoder akun ketat, PDA, `verifyCredential` dengan satu snapshot finalized, `checkPublishedBatch` (FR-10) |
| 5. UI | `apps/web` | Verifikasi tanpa wallet; alur penerbit (draft backup → publish → paket final, revoke, rotasi); alur admin |

Kontrak biner program ↔ klien ada di [docs/program-interface.md](docs/program-interface.md).

## Status verifikasi

`verifyCredential` hanya menghasilkan **Terverifikasi** jika semua kondisi berikut terpenuhi:

- RPC berada di jaringan yang dikonfigurasi (genesis hash cocok).
- Program ter-deploy.
- Akun issuer, batch, dan revocation lolos validasi owner, ukuran, discriminator, dan relasi.
- Integritas dokumen cocok dengan root on-chain.
- Tidak ada catatan pencabutan.
- Issuer aktif.

Kegagalan atau timeout RPC selalu menjadi **Belum dapat diverifikasi**. Kegagalan itu tidak pernah dianggap sebagai bukti bahwa kredensial belum dicabut. RPC hanya menerima alamat akun; PDF, nonce, sibling, dan proof JSON tidak dikirim.

## Dokumentasi

- [PRD terakhir dari pengguna](docs/PRD.md): dipertahankan tanpa perubahan.
- [Antarmuka program v1](docs/program-interface.md): PDA, layout akun, instruksi, error.
- [Diagram arsitektur, alur, relasi akun dan lifecycle](docs/architecture.md).
- [Spesifikasi proof dan encoding v1](docs/proof-format-v1.md).
- [Model ancaman dan batas keamanan](docs/threat-model.md).
- [Kemajuan dan pekerjaan berikutnya](docs/roadmap.md).
- [Hasil validasi](docs/validation.md).

## Struktur

```text
apps/web/                React + Vite: verifikasi, penerbit, admin
crates/solvcred-proof/   Implementasi Rust format proof v1
programs/solvcred/       Program Anchor
packages/core/           Core TypeScript tanpa dependensi runtime
packages/solana/         Klien program dan adapter RPC (@solana/web3.js)
tests/program/           Uji on-chain, dijalankan oleh `anchor test`
test-vectors/v1.json     Fixture deterministik untuk TypeScript dan Rust
scripts/                 Referensi Python, demo dan benchmark
.github/workflows/       CI TypeScript, Rust, dan Anchor localnet
```

## Batas jaminan

SolVcred tidak membuktikan kebenaran klaim akademik atau identitas orang yang membawa file. Hash dan nonce tidak menghilangkan seluruh risiko korelasi metadata. Root tidak dapat memulihkan PDF atau proof yang hilang. Pergantian byte PDF, termasuk ekspor ulang atau pemindaian, mengubah hasil hash. Admin registry, RPC, dan upgrade authority adalah pihak yang dipercaya. Selama program masih dapat di-upgrade, jaminan immutability batch juga bergantung pada pengelolaan upgrade authority.
