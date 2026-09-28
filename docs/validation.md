# Validasi

Lingkungan lokal: Windows x64, Node v22.23.2, Python 3.11, Intel Core i7-13620H. Rust, Solana CLI, dan Anchor **tidak terpasang** di mesin ini.

## GitHub Actions

| Job | Hasil |
| --- | --- |
| `rust`: `cargo test --workspace` (Rust 1.89, host) | Lulus sejak run pertama (commit `744c2a0`): crate proof terhadap `test-vectors/v1.json` dan unit test program |
| `typescript` | Gagal di `npm ci` pada commit `744c2a0`, karena lockfile ditulis npm 12 dan tidak mencatat `utf-8-validate` yang diwajibkan npm 10 (bawaan Node 22). Setelah lockfile dibuat ulang dengan npm 10 (commit `0b00df5`), `npm run check`, referensi Python, dan `npm run web:build` lulus |
| `anchor`: build SBF, IDL, dan test on-chain | Lulus pada commit `0b00df5` (dua kali, 22 dan 25 September 2026): `anchor build` dengan Solana CLI 2.3.13 dan Anchor CLI 0.32.1 (crate `anchor-lang` ter-resolve ke 0.32.2) tanpa warning kompilasi, `anchor keys sync`, lalu `anchor test` dengan **22/22 test on-chain lulus** |

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

## Dijalankan di CI (Linux)

| Pemeriksaan | Perintah | Hasil |
| --- | --- | --- |
| Crate `solvcred-proof` terhadap `test-vectors/v1.json` beserta kasus manipulasi | `cargo test --workspace` | Lulus di CI |
| Unit test program (validasi nama/domain, discriminator, kode error) | `cargo test --workspace` | Lulus di CI (build host, bukan SBF) |
| Build program Anchor 0.32.1 dan IDL | `anchor build` | Lulus; build SBF tanpa warning |
| Otorisasi, relasi akun, immutability, lifecycle kunci, dan siklus penuh lewat adapter | `anchor test` → `npm run test:program` | 18 test lulus, termasuk bootstrap registry, publikasi dan pencabutan lintas issuer, rotasi/pemulihan kunci, serta siklus publish → verify → revoke → deactivate lewat adapter pada commitment `finalized` |
| Kesesuaian IDL dengan konstanta klien | `tests/program/00-idl.test.ts` | 4 test lulus: alamat program, discriminator dan layout instruksi, layout akun, tabel kode error |

`Cargo.lock` sekarang di-commit, dengan versi crate yang sama seperti yang dikompilasi di run CI tersebut. Dependensi baru bisa menuntut rustc yang lebih baru daripada rustc platform-tools Agave 2.3, sehingga `.cargo/config.toml` tetap mengaktifkan resolusi yang sadar MSRV (`rust-version = 1.84`) dan job `rust` memakai `--locked`. Perbarui lockfile secara sengaja, lalu pastikan job `anchor` tetap lulus.

## Belum diuji

Wallet sungguhan, deployment dan end-to-end Devnet, alur admin di browser (register, deactivate, recover; instruksinya lulus test on-chain, UI-nya hanya lolos typecheck), serta pengujian aksesibilitas dengan pembaca layar. Angka benchmark hanya mengukur hashing byte lokal, bukan browser, RPC, atau transaksi.
