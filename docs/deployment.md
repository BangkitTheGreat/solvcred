# Operasi dan runbook

> Semua yang terjadi **setelah** program ter-deploy: konfigurasi dan hosting frontend, onboarding penerbit, uji penerimaan Devnet,
> aturan upgrade, dan prosedur insiden. Ditujukan bagi operator yang memegang peran admin registry.

**Deploy program ada di dokumen terpisah.** Build, deploy atau upgrade, dan `initialize_registry` dijalankan oleh
`scripts/deploy-devnet.sh` beserta CLI `npm run registry`. Keputusan pemegang kunci, biaya (±5,1 SOL Devnet), gladi di validator
lokal, dan pemulihan deploy yang terhenti ada di **[deploy-devnet.md](deploy-devnet.md)**. Keputusan kunci admin:
[deploy-devnet.md § Kunci admin registry](deploy-devnet.md#kunci-admin-registry).

**Status:** skrip deploy baru diuji di validator lokal ([validation.md](validation.md)). Program belum pernah di-deploy ke Devnet.

> **Peringatan.** Jangan deploy dengan `--final` dan jangan melepas upgrade authority sebelum `initialize_registry` berhasil.
> Program hanya menerima bootstrap dari upgrade authority saat itu, dan admin registry bersifat permanen.

## Daftar isi

1. [Konfigurasi frontend](#1-konfigurasi-frontend)
2. [Build dan hosting frontend](#2-build-dan-hosting-frontend)
3. [Onboarding penerbit](#3-onboarding-penerbit)
4. [Uji penerimaan Devnet](#4-uji-penerimaan-devnet)
5. [Aturan upgrade dan pembekuan](#5-aturan-upgrade-dan-pembekuan)
6. [Runbook insiden](#6-runbook-insiden)

## 1. Konfigurasi frontend

Salin `apps/web/.env.example` menjadi `apps/web/.env.local`, atau jalankan `scripts/deploy-devnet.sh` dengan `--write-env`.
Nilai program ID dan genesis juga dicatat skrip di `deployments/devnet.json`.

| Variabel | Wajib | Aturan validasi (`apps/web/src/lib/config.ts`) |
| --- | --- | --- |
| `VITE_SOLVCRED_PROGRAM_ID` | Ya, untuk deployment nyata | Public key base58 kanonis. Kosong berarti placeholder, dan UI menampilkan banner "Program belum di-deploy" |
| `VITE_SOLVCRED_RPC_URL` | Tidak (default `https://api.devnet.solana.com`) | Harus `https://`. `http://` hanya untuk `localhost` / `127.0.0.1` |
| `VITE_SOLVCRED_GENESIS_HASH` | Tidak (default genesis Devnet) | Hash base58 32 byte. RPC yang melaporkan genesis lain ditolak |

Semua nilai bersifat publik karena ditanam ke dalam bundle. Jangan memakai URL RPC yang memuat API key rahasia. Konfigurasi yang
tidak valid membuat aplikasi menampilkan "Konfigurasi aplikasi tidak valid" dan tidak menghubungi jaringan.

**RPC kustom.** Wallet Wallet Standard memilih jaringan dari URL RPC. Jika URL tidak mengandung kata `devnet`, wallet akan mengira
jaringannya mainnet. Karena itu UI hanya meminta tanda tangan (`signTransaction`) lalu menyiarkan transaksi sendiri. Wallet yang
tidak mendukung `signTransaction` tidak dapat dipakai dengan RPC seperti itu.

## 2. Build dan hosting frontend

### 2.1. Build

```bash
npm ci --ignore-scripts
npm run web:build
```

Hasilnya di `dist/web/`. Vite memakai `base: './'`, jadi bundle dapat di-host di root domain maupun subpath.

### 2.2. Hosting

Layanan statis HTTPS apa pun dapat dipakai. `index.html` sudah memuat CSP lewat `<meta>` (`object-src 'none'`, `frame-src 'none'`,
`base-uri 'none'`, `form-action 'none'`) dan `referrer: no-referrer`. Tambahkan header HTTP berikut di hosting, karena sebagian
direktif tidak berlaku lewat `<meta>`:

| Header | Nilai yang disarankan | Alasan |
| --- | --- | --- |
| `Content-Security-Policy` | `frame-ancestors 'none'` (plus direktif di atas) | Mencegah UI dibungkus iframe untuk clickjacking tanda tangan |
| `X-Content-Type-Options` | `nosniff` | Mencegah MIME sniffing |
| `Strict-Transport-Security` | `max-age=31536000` | Memaksa HTTPS |

Integritas bundle bergantung pada hosting. Siapa pun yang dapat mengubah file di hosting dapat mengubah logika verifikasi.

## 3. Onboarding penerbit

1. **Di luar aplikasi**, admin memeriksa identitas institusi, domain resmi, dan penguasaan wallet penerbit (misalnya dengan meminta penerbit menandatangani pesan acak).
2. Buka **Admin registry → Daftarkan penerbit**. UI membuat issuer ID acak 32 byte; issuer ID dapat dibuat ulang sebelum dikirim.
3. Isi nama institusi (1–96 byte, tanpa karakter kontrol), domain (1–64 karakter `a-z 0-9 . -`), dan public key authority penerbit.
4. Setujui transaksi. Rent akun issuer (±0,0019 SOL) dibayar admin.
5. Kirim issuer ID kepada penerbit. Penerbit juga dapat menemukannya dengan menghubungkan wallet di tab **Penerbit**.

Aturan validasi lengkap: [program-interface.md](program-interface.md#aturan-otorisasi-dan-validasi).

## 4. Uji penerimaan Devnet

Checklist ini menutup celah DoD di [requirements-traceability.md](requirements-traceability.md#6-definition-of-done-prd-13).
Catat hasil, tanggal, wallet, dan signature di [validation.md](validation.md).

- [ ] `npm run registry -- status --url <rpc> --program-id <id>` menampilkan program dan admin registry yang benar
- [ ] Register issuer uji; wallet non-admin ditolak
- [ ] Terbitkan batch 3 PDF, unduh cadangan draft dan paket final
- [ ] Verifikasi setiap PDF + proof dari paket final: **Terverifikasi**
- [ ] Ubah satu byte PDF: **Bukti tidak cocok**
- [ ] Putuskan jaringan saat menunggu finalitas, lalu pulihkan dari cadangan draft: batch tidak terbit dua kali
- [ ] Cabut satu kredensial: **Dicabut**; pencabutan kedua ditolak
- [ ] Rotasi kunci dengan dua wallet; kunci lama ditolak saat publish
- [ ] Nonaktifkan issuer: kredensial lain tampil **Penerbit nonaktif**; publish ditolak; pencabutan masih bisa
- [ ] Pulihkan kunci oleh admin
- [ ] Ubah RPC ke endpoint salah jaringan: **Belum dapat diverifikasi**
- [ ] Periksa tab Network browser: body request tidak memuat PDF, nonce, sibling, atau proof

## 5. Aturan upgrade dan pembekuan

Upgrade dijalankan dengan skrip yang sama (`scripts/deploy-devnet.sh --program-id <PROGRAM_ID> --authority <admin.json>`), lihat
[deploy-devnet.md § Upgrade](deploy-devnet.md#upgrade). Aturan isi upgrade:

- **Jangan ubah layout akun, discriminator, urutan field, seeds, atau urutan error.** Akun lama tidak dimigrasi, dan klien menolak ukuran yang berbeda.
- Perubahan kontrak memerlukan pembaruan serentak di program, `crates/solvcred-proof`, `packages/solana`, dan [program-interface.md](program-interface.md). CI wajib hijau, termasuk `tests/program/00-idl.test.ts`. Lihat [development.md §6](development.md#6-mengubah-kontrak-dengan-aman).
- Setiap upgrade mengubah kode yang menjamin immutability batch. Umumkan upgrade kepada penerbit.

**Pembekuan** (`solana program set-upgrade-authority <PROGRAM_ID> --final`) tidak dapat dibatalkan: program tidak dapat diperbaiki
lagi dan admin registry tidak dapat diganti. Pembekuan tidak direncanakan untuk MVP. Lakukan hanya setelah rotasi admin dan
reaktivasi issuer diputuskan tidak dibutuhkan, dan audit selesai.

## 6. Runbook insiden

### R1 — Kunci penerbit hilang atau dicuri

**Batas penting.** Pencabutan membutuhkan leaf hash, indeks, dan jalur Merkle. Leaf hash bergantung pada nonce per dokumen dan
hash PDF, sedangkan akun Batch hanya menyimpan root. Artinya, **hanya pemegang file proof yang dapat mencabut sebuah kredensial.**
Untuk batch yang diterbitkan penyerang dengan kunci curian, file proof ada di tangan penyerang, bukan institusi. Institusi tidak
dapat mencabut kredensial itu secara proaktif, dan kredensial tersebut tetap tampil **Terverifikasi** selama issuer aktif.

1. Penerbit melapor ke admin. Admin memverifikasi pelapor di luar aplikasi.
2. **Hentikan penyalahgunaan lebih lanjut dengan Pulihkan kunci.** Penerbit membuat keypair baru. Admin membuka **Admin registry → Pulihkan kunci**, mencari issuer ID, memasukkan public key baru, menandatangani lebih dulu, lalu berganti ke wallet kunci baru yang menandatangani transaksi yang sama sebelum blockhash kedaluwarsa (±60–90 detik). Setelah finalized, kunci lama langsung kehilangan hak publish dan revoke.
3. **Inventarisasi batch yang diterbitkan kunci lama.** Belum ada alat di repo. Pakai `getProgramAccounts` terhadap program ID dengan filter:
   - `dataSize: 162` (akun Batch),
   - `memcmp` offset **8** = alamat akun issuer (field `issuer`, tepat setelah discriminator),
   - `memcmp` offset **109** = public key kunci lama (field `issuing_authority`).

   Offset diturunkan dari `ACCOUNTS.batch` di `packages/solana/src/layout.ts`. Bandingkan `recorded_at` dengan perkiraan waktu kebocoran, lalu cocokkan batch ID dengan arsip paket final milik institusi. Batch yang tidak ada di arsip adalah batch tidak sah.
4. **Putuskan cara menetralkan batch tidak sah:**

   | Pilihan | Efek | Biaya |
   | --- | --- | --- |
   | Cabut per kredensial | Hanya mungkin untuk salinan PDF + proof yang berhasil diperoleh institusi, misalnya dari laporan verifikator. Pakai kode alasan **3 (Penerbitan tidak sah)** | Kredensial yang tidak pernah muncul tetap **Terverifikasi** |
   | **Nonaktifkan** issuer | Semua kredensial issuer ini, sah maupun tidak, tampil **Penerbit nonaktif** | **Permanen.** Institusi harus didaftarkan ulang dengan issuer ID baru, lalu kredensial yang sah diterbitkan ulang dan dibagikan lagi kepada penerima |

   Jika jumlah atau dampak batch tidak sah tidak dapat diterima, penonaktifan adalah satu-satunya cara menyeluruh di MVP.
5. Catat insiden, batch tidak sah, dan keputusan yang diambil. Beri tahu verifikator yang relevan.

### R2 — Publikasi terputus atau hasilnya tidak jelas

1. Jangan membuat draft baru dari PDF yang sama.
2. Di tab **Penerbit → Terbitkan batch**, pilih **Lanjutkan dari cadangan draft** dan muat ZIP draft.
3. UI memverifikasi ulang setiap PDF, lalu membaca batch pada `finalized`:
   - **Cocok** → unduh paket final.
   - **Belum ada** → kirim ulang draft yang sama.
   - **Konflik** → hentikan. Batch ID sudah dipakai dengan root berbeda; eskalasi ke admin.
   - **Belum diketahui** → tunggu, lalu periksa ulang. Jangan kirim.

### R3 — ZIP draft hilang sebelum paket final diunduh

Root on-chain tidak dapat memulihkan nonce atau proof. Jika batch sudah terbit tanpa paket final, kredensial di batch itu tidak
dapat diverifikasi. Terbitkan batch baru untuk dokumen yang sama. Jika perlu, catat batch lama sebagai tidak dipakai di catatan
internal institusi. Mencabutnya membutuhkan proof yang juga sudah hilang.

### R4 — RPC lambat, rate-limit, atau salah jaringan

- Gejala: **Belum dapat diverifikasi** dengan alasan `rpc-timeout`, `rpc-error`, atau `wrong-network`.
- Ini perilaku yang benar (fail-closed). Tidak ada data yang dianggap valid.
- Ganti `VITE_SOLVCRED_RPC_URL` ke penyedia lain, pastikan genesis hash cocok, lalu build ulang dan deploy ulang frontend.

### R5 — Issuer harus dihentikan

Admin membuka **Admin registry → Nonaktifkan**, mencari issuer ID, mencentang konfirmasi, lalu menandatangani. Tindakan ini tidak
dapat dibatalkan di MVP. Kredensial lama tidak otomatis dicabut dan akan tampil sebagai **Penerbit nonaktif**.

### R6 — Kunci admin atau upgrade authority bocor

Ini insiden terberat. Program tidak memiliki instruksi rotasi admin. Menurut keputusan kunci di
[deploy-devnet.md](deploy-devnet.md#kunci-admin-registry), fee payer deploy, upgrade authority, dan admin registry adalah satu akun,
jadi kebocoran satu kunci berarti kebocoran ketiganya.

1. Jika upgrade authority masih dikuasai, segera pindahkan ke kunci aman dengan `solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <KUNCI_BARU>`.
2. Siapkan upgrade program yang menambahkan rotasi admin, atau deploy program baru dengan registry baru.
3. Tinjau semua issuer yang didaftarkan atau dinonaktifkan, dan semua pemulihan kunci setelah perkiraan waktu kebocoran.
4. Umumkan kepada penerbit dan verifikator. Jika registry diganti, kredensial lama harus diterbitkan ulang di program baru.

### R7 — Deploy atau `initialize_registry` terhenti

Jalankan ulang skrip. Skrip membaca status `finalized` sebelum memutuskan deploy, upgrade, atau tanpa perubahan, dan registry yang
sudah ada tidak disentuh. Buffer yatim dan `npm run registry -- init` dijelaskan di
[deploy-devnet.md § Jika deploy terhenti](deploy-devnet.md#jika-deploy-terhenti-di-tengah-jalan).
