# Kemajuan fondasi

## Dikerjakan pada tahap ini

- [x] PRD sumber disimpan dan nama repo kanonis dicatat.
- [x] Diagram arsitektur, sequence publikasi, verifikasi, relasi akun, dan lifecycle.
- [x] Spesifikasi proof v1 dan encoding biner dengan pemisahan domain.
- [x] Modul TypeScript tanpa dependensi runtime untuk menyiapkan draft batch dan memeriksa integritas.
- [x] Batas ukuran, validasi field, nonce kriptografis, serta penolakan PDF duplikat.
- [x] Test vector independen Python untuk satu leaf dan jumlah leaf ganjil.
- [x] Test suite manipulasi dokumen/proof serta konfigurasi CI.

## Pekerjaan berikutnya

1. Implementasi Rust dari hashing dan verifikasi menggunakan fixture v1 yang sama.
2. Program Anchor: inisialisasi registry dengan bootstrap admin yang diotorisasi; register issuer, publish batch, revoke, deactivate, rotate, recover.
3. Uji signer, PDA, relasi akun, immutability batch dan rotasi/pemulihan kunci. Bootstrap registry tidak boleh first-come-first-served tanpa pengikatan ke admin deployment.
4. Adapter RPC dengan validasi akun dan snapshot finalized yang konsisten; kode status aplikasi yang tidak mengubah kegagalan jaringan menjadi hasil valid.
5. UI React/Vite, wallet adapter, backup draft, ekspor final, serta pengujian transaksi terputus.
6. Deployment Devnet, keputusan upgrade authority, dan uji end-to-end.

Fase 1 PRD **belum selesai**: registry, otorisasi on-chain, dan wallet belum diimplementasikan. Kode saat ini tidak menerbitkan atau mencabut kredensial di Solana.

## Penjelasan tambahan terhadap PRD

PRD menyebut proof tidak dikirim ke RPC. Untuk `revoke`, program perlu memeriksa keanggotaan leaf; jalur Merkle dan leaf hash perlu dikirim sebagai argumen transaksi. File proof lengkap, nonce, PDF, dan data identitas tetap lokal. Pengecualian ini harus dijelaskan pada UI dan threat model sebelum implementasi pencabutan.

Root Merkle yang dibuat lokal bukan identitas penerbit yang dipercaya. Jangan membuat konfigurasi production dengan program ID fixture, dan jangan membuat label terverifikasi sebelum adapter Solana tersedia.
