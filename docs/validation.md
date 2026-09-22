# Validasi

Lingkungan lokal: Windows x64, Node v22.23.2, Python 3.11, Intel Core i7-13620H. Rust, Solana CLI, dan Anchor **tidak terpasang** di mesin ini.

## GitHub Actions

| Job | Hasil |
| --- | --- |
| `rust`: `cargo test --workspace` (Rust 1.89, host) | Lulus pada run pertama (commit `744c2a0`): crate proof terhadap `test-vectors/v1.json` dan unit test program |
| `typescript` | Gagal di `npm ci` pada run pertama, karena lockfile ditulis npm 12 dan tidak mencatat `utf-8-validate` yang diwajibkan npm 10 (bawaan Node 22). Lockfile dibuat ulang dengan npm 10, dan `npm ci` npm 10 maupun npm 12 lulus secara lokal |
| `anchor`: build SBF, IDL, dan test on-chain | Belum pernah berjalan (skipped karena bergantung pada job `typescript`) |

## Sudah dijalankan secara lokal

| Pemeriksaan | Hasil |
| --- | --- |
| TypeScript strict: root (`packages`, `scripts`, `tests`) dan `apps/web` | Lulus |
| Unit test core + klien Solana (`npm test`) | 52 test lulus |
| Referensi Python independen | Fixture satu, tiga dan lima leaf cocok |
| Build web (`npm run web:build`) | Lulus; satu bundle ±769 kB (gzip ±235 kB), dengan peringatan ukuran chunk |
| Smoke test browser (build produksi) | View verifikasi dan penerbit tampil tanpa error konsol. Proof dengan program lain menghasilkan "Belum dapat diverifikasi" tanpa request RPC |
| Smoke test browser dengan RPC dan wallet Wallet Standard palsu | Terverifikasi, Dicabut, Bukti tidak cocok, dan RPC gagal tampil benar. Publikasi terkunci sampai cadangan draft diunduh. Penolakan wallet dan respons ambigu memicu pemeriksaan FR-10, lalu retry memakai draft yang sama. Pencabutan dan rotasi dua tanda tangan juga dicoba. Body request RPC tidak memuat PDF, nonce, sibling, atau proof |
| Demo dan benchmark (fondasi) | Persiapan 100 payload 1 MiB 244 ms; verifikasi 269 ms pada satu pengukuran |

Unit test klien memakai `Connection` web3.js sungguhan dengan `fetch` palsu. Cakupannya: semua status, klasifikasi kegagalan dan timeout RPC, genesis yang salah, program yang tidak ter-deploy, akun palsu (owner, discriminator, ukuran, relasi), `checkPublishedBatch`, encoding instruksi byte demi byte, dan privasi body request.

## Ditulis, belum dijalankan (butuh Linux/WSL2 atau CI)

| Pemeriksaan | Perintah | Catatan |
| --- | --- | --- |
| Crate `solvcred-proof` terhadap `test-vectors/v1.json` beserta kasus manipulasi | `cargo test --workspace` | Lulus di CI |
| Unit test program (validasi nama/domain, discriminator, kode error) | `cargo test --workspace` | Lulus di CI (build host, bukan SBF) |
| Build program Anchor 0.32.1 dan IDL | `anchor build` | Belum pernah dikompilasi |
| Otorisasi, relasi akun, immutability, lifecycle kunci, dan siklus penuh lewat adapter | `anchor test` → `npm run test:program` | Hanya lolos typecheck. Kode error yang diharapkan diturunkan dari urutan constraint Anchor |
| Kesesuaian IDL dengan konstanta klien | `tests/program/00-idl.test.ts` | Dijalankan setelah `anchor build` |

Risiko yang diketahui: dependensi terbaru bisa menuntut rustc yang lebih baru daripada rustc platform-tools Agave 2.3. `.cargo/config.toml` mengaktifkan resolusi yang sadar MSRV (`rust-version = 1.84`). Jika build SBF tetap gagal karena versi dependensi, kunci versinya di `Cargo.lock`, lalu commit lockfile tersebut.

## Belum diuji

Wallet sungguhan, deployment dan end-to-end Devnet, alur admin di browser (register, deactivate, recover; hanya lolos typecheck), serta pengujian aksesibilitas dengan pembaca layar. Angka benchmark hanya mengukur hashing byte lokal, bukan browser, RPC, atau transaksi.
