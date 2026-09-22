# Kemajuan

## Fondasi (selesai)

- [x] PRD sumber disimpan dan nama repo kanonis dicatat.
- [x] Diagram arsitektur, sequence publikasi, verifikasi, relasi akun, dan lifecycle.
- [x] Spesifikasi proof v1 dan encoding biner dengan pemisahan domain.
- [x] Modul TypeScript tanpa dependensi runtime untuk menyiapkan draft batch dan memeriksa integritas.
- [x] Batas ukuran, validasi field, nonce kriptografis, serta penolakan PDF duplikat.
- [x] Test vector independen Python untuk satu leaf dan jumlah leaf ganjil.
- [x] Test suite manipulasi dokumen/proof serta konfigurasi CI.

## Menuju MVP (kode ditulis, sebagian menunggu eksekusi di Linux/CI)

| # | Pekerjaan | Status |
| --- | --- | --- |
| 1 | Hashing dan proof di Rust, dicocokkan dengan test vector | Selesai; `cargo test` lulus di CI terhadap `test-vectors/v1.json` |
| 2 | Program Anchor: registry, publikasi batch, pencabutan, penonaktifan, rotasi/pemulihan kunci | Kode ditulis (`programs/solvcred`); bootstrap terikat upgrade authority; build host dan unit test lulus di CI, **build SBF/IDL belum dijalankan** |
| 3 | Pengujian otorisasi dan keamanan akun on-chain | Test ditulis (`tests/program`) dan lolos typecheck; **belum dijalankan** di validator |
| 4 | Adapter RPC untuk batch, issuer, dan pencabutan | Selesai dan diuji dengan unit test (`packages/solana`) |
| 5 | UI React, wallet penerbit/admin, ekspor dan verifikasi | Selesai; build dan smoke test browser lokal; alur wallet belum diuji dengan wallet sungguhan |

Gerbang berikutnya adalah menjalankan workflow CI (atau `cargo test` + `anchor test` di Linux/WSL2) dan memperbaiki temuan kompilasi atau perilaku.

## Di luar lima kelompok ini (dibutuhkan untuk menyatakan MVP selesai menurut PRD)

1. Deployment Devnet: keypair program, keputusan pemegang upgrade authority, `initialize_registry` oleh authority tersebut, lalu mengganti `VITE_SOLVCRED_PROGRAM_ID`.
2. Uji end-to-end di Devnet dengan wallet sungguhan: publikasi, respons terputus, pencabutan, dan rotasi dua tanda tangan.
3. Data demo, panduan pengguna, audit aksesibilitas, dan benchmark browser.
4. Commit `Cargo.lock` setelah build Linux pertama berhasil supaya build program dapat direproduksi.

## Keputusan yang dicatat

- Pencabutan mengirim leaf hash, indeks, dan jalur Merkle sebagai argumen transaksi agar program dapat memverifikasi keanggotaan. File proof lengkap, nonce, PDF, dan data identitas tetap lokal. Karena leaf hash membutuhkan hash PDF, alur pencabutan di UI meminta PDF sekaligus proof.
- Issuer nonaktif tidak dapat menerbitkan, tetapi tetap dapat mencabut dan merotasi kunci. MVP belum memiliki instruksi reaktivasi.
- Verifikasi memeriksa issuer yang tidak terdaftar sebelum batch yang hilang, sehingga issuer tak dikenal selalu tampil sebagai **Penerbit belum dipercaya**.
- Root Merkle yang dibuat lokal bukan identitas penerbit yang dipercaya. Jangan membuat konfigurasi produksi dengan program ID fixture atau placeholder.
