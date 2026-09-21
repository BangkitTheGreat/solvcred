# PRD — SolVcred
**Sistem Penerbitan dan Verifikasi Kredensial Digital Berbasis Solana**

| Atribut | Keterangan |
|---|---|
| Nama produk | SolVcred |
| Nama repositori yang direncanakan | `sol-vcred` |
| Versi | 1.0 |
| Status | Rancangan MVP |
| Target | Demo portofolio di Solana Devnet |

## 1. Ringkasan produk

SolVcred membantu institusi menerbitkan kredensial digital yang dapat diperiksa secara mandiri oleh penerima, HR, atau pihak lain.

Dokumen tetap berada di tangan pemilik. Sistem mencatat satu Merkle root untuk satu batch dokumen di Solana. Setiap penerima mendapatkan PDF asli dan file proof untuk memverifikasi integritas dokumen, identitas penerbit dalam registry, serta status pencabutan.

Penerima dan verifikator tidak membutuhkan akun atau wallet. Wallet hanya digunakan admin dan penerbit untuk tindakan yang mengubah data on-chain.

**Batas jaminan:** SolVcred tidak membuktikan kebenaran kegiatan akademik, kejujuran institusi, atau identitas orang yang menunjukkan dokumen.

## 2. Masalah dan hipotesis

Verifikasi kredensial dapat melibatkan email ke institusi, pemeriksaan manual, atau portal yang berbeda-beda. Dokumen PDF juga dapat diedit tanpa perubahan yang mudah dikenali secara visual.

Hipotesis yang ingin diuji:

- HR dapat memahami hasil pemeriksaan tanpa memahami blockchain.
- Institusi dapat menerbitkan banyak kredensial dalam satu alur.
- Penerima dapat menyimpan dan membagikan dokumen beserta bukti tanpa wallet.
- Verifikasi mandiri mengurangi kebutuhan menghubungi penerbit untuk setiap pemeriksaan.

Hipotesis ini perlu divalidasi lewat pengujian pengguna; belum dianggap sebagai temuan riset.

## 3. Pengguna dan kebutuhan

| Pengguna | Kebutuhan utama |
|---|---|
| Admin registry | Mendaftarkan institusi yang telah diperiksa dan mengelola statusnya |
| Penerbit institusi | Menerbitkan batch, mengekspor proof, dan mencabut kredensial |
| Penerima | Menyimpan serta membagikan PDF dan proof |
| Verifikator/HR | Memeriksa dokumen, penerbit, dan status terkini |

**Keberhasilan pertama:** pengguna memilih satu contoh PDF dan proof, lalu memahami hasil pemeriksaannya tanpa membuat akun.

## 4. Tujuan dan ukuran keberhasilan

MVP harus mendemonstrasikan satu siklus lengkap:

> Daftarkan penerbit → terbitkan batch → bagikan dokumen/proof → verifikasi → cabut → verifikasi ulang.

Kriteria keberhasilan:

- Dokumen yang diubah gagal pemeriksaan integritas.
- Kredensial yang dicabut tidak ditampilkan sebagai terverifikasi.
- Kegagalan RPC tidak menghasilkan status valid.
- Pengguna tanpa hak akses tidak dapat menerbitkan atau mencabut.
- Pergantian kunci tidak merusak bukti batch lama.
- Isi PDF dan proof tidak dikirim ke server aplikasi, RPC, atau analytics.
- Target uji kapasitas awal: 100 PDF dalam satu batch; jumlah, ukuran total, perangkat, dan waktu proses dicatat dalam hasil pengujian.

Kapasitas 5.000 dokumen menjadi target benchmark lanjutan, bukan janji MVP.

## 5. Ruang lingkup

### 5.1. Termasuk MVP

- Registry penerbit dengan persetujuan admin.
- Koneksi wallet admin/penerbit.
- Penerbitan batch PDF menggunakan Merkle root.
- Ekspor proof per dokumen.
- Verifikasi lokal dan pemeriksaan status on-chain.
- Pencabutan permanen per kredensial.
- Penonaktifan penerbit dan rotasi kunci.
- Data demo, panduan, dan penjelasan batas jaminan.

### 5.2. Di luar MVP

- Pembuatan PDF ijazah dari CSV.
- NFT, soulbound token, dan ZK selective disclosure.
- Integrasi `did:web` atau klaim kompatibilitas W3C VC.
- Pencarian mahasiswa berdasarkan nama/NIM.
- Riwayat verifikasi tersimpan dan manajemen pelamar.
- Distribusi otomatis melalui email.
- Penyimpanan dokumen di cloud/IPFS.
- Dashboard multi-tenant dan integrasi sistem akademik.
- Peluncuran produksi/mainnet.

## 6. Alur pengguna

### 6.1. Pendaftaran penerbit

1. Admin memeriksa identitas institusi, domain, dan penguasaan wallet melalui prosedur di luar aplikasi.
2. Admin menghubungkan wallet.
3. Admin memasukkan identitas institusi, domain resmi, dan public key penerbit.
4. Program mencatat issuer dengan identitas stabil dan status aktif.

Pendaftaran mandiri tidak otomatis menjadikan institusi dipercaya.

### 6.2. Penerbitan batch

1. Penerbit menghubungkan wallet yang terdaftar.
2. Penerbit memilih kumpulan PDF final.
3. Aplikasi memvalidasi file dan menghitung hash secara lokal.
4. Aplikasi membuat nonce, leaf, Merkle root, dan proof.
5. Penerbit mengunduh paket cadangan draft sebelum publikasi.
6. Penerbit meninjau ringkasan dan menyetujui transaksi wallet.
7. Setelah transaksi terkonfirmasi dengan commitment `finalized`, aplikasi menyediakan paket final.

Paket ekspor berisi pasangan PDF/proof serta manifest untuk institusi. Penerbit membagikannya melalui saluran yang sudah digunakan institusi.

### 6.3. Verifikasi

1. Pengguna memilih PDF dan proof JSON.
2. Aplikasi memvalidasi format dan menghitung hash PDF secara lokal.
3. Aplikasi memeriksa Merkle proof.
4. Aplikasi membaca batch, issuer, dan pencabutan dari jaringan yang didukung.
5. Aplikasi menampilkan hasil tiap pemeriksaan, status keseluruhan, serta waktu pemeriksaan.

PDF yang dipindai atau diekspor ulang harus dijelaskan sebagai file berbeda, meskipun tampilannya serupa.

### 6.4. Pencabutan

1. Penerbit memasukkan proof kredensial.
2. Aplikasi menampilkan batch dan identitas kredensial untuk dikonfirmasi.
3. Penerbit memilih kode alasan umum.
4. Program memeriksa otorisasi dan keanggotaan leaf dalam batch.
5. Program membuat catatan pencabutan permanen.
6. Pemeriksaan berikutnya menampilkan status dicabut.

Kesalahan pada dokumen diperbaiki dengan mencabut kredensial lama dan menerbitkan penggantinya.

## 7. Kebutuhan fungsional

| ID | Kebutuhan | Kriteria penerimaan |
|---|---|---|
| FR-01 | Otorisasi | Program menolak mutasi dari wallet tanpa hak, meskipun transaksi dikirim tanpa UI |
| FR-02 | Registry issuer | Identitas issuer tetap sama ketika signing key berubah |
| FR-03 | Publikasi batch | Hanya issuer aktif yang dapat menerbitkan; root batch tidak dapat ditimpa melalui instruksi program |
| FR-04 | Ekspor proof | Setiap dokumen memiliki proof yang cocok dan dapat diverifikasi secara terpisah |
| FR-05 | Integritas | Perubahan byte PDF atau manipulasi proof tidak menghasilkan verifikasi sukses |
| FR-06 | Pemeriksaan status | Hasil sukses membutuhkan pembacaan status on-chain yang berhasil |
| FR-07 | Pencabutan | Hanya issuer terkait yang dapat mencabut; batch dan proof diperiksa program |
| FR-08 | Penonaktifan | Issuer nonaktif tidak dapat menerbitkan batch baru |
| FR-09 | Rotasi kunci | Kunci lama kehilangan otorisasi mutasi setelah rotasi; batch lama tetap dapat diperiksa |
| FR-10 | Pemulihan publikasi | Setelah respons transaksi tidak jelas, aplikasi memeriksa keberadaan batch sebelum mencoba ulang |
| FR-11 | Portabilitas | Proof cukup untuk menemukan batch pada jaringan yang didukung tanpa database aplikasi |

## 8. Model kepercayaan dan siklus hidup

Admin registry merupakan pihak yang dipercaya untuk memeriksa institusi dan mengelola otorisasinya. Domain resmi dicatat sebagai informasi pendukung; domain tidak diperiksa secara otomatis sebagai bukti legitimasi.

Kebijakan MVP:

- Penonaktifan issuer menghentikan penerbitan baru.
- Kredensial lama tidak otomatis dicabut; UI menampilkan peringatan bahwa issuer nonaktif.
- Pencabutan tetap diizinkan bagi kunci issuer yang saat itu berwenang.
- Rotasi normal membutuhkan persetujuan kunci lama dan baru.
- Pemulihan ketika kunci hilang atau dicuri dilakukan admin setelah pemeriksaan di luar aplikasi.
- Batch menyimpan public key dan versi kunci saat diterbitkan.
- Pemulihan kunci tidak otomatis membatalkan batch yang telah diterbitkan penyerang; batch terdampak perlu ditinjau dan kredensialnya dicabut.

Hak upgrade program harus didokumentasikan. Selama program dapat di-upgrade, klaim immutability juga bergantung pada pengelolaan upgrade authority.

## 9. Struktur data

| Objek | Data utama |
|---|---|
| Registry | Admin authority dan versi konfigurasi |
| Issuer | ID stabil, nama institusi, domain, authority aktif, versi kunci, status |
| Batch | Issuer ID, batch ID, root, jumlah leaf, versi skema, kunci penerbit saat publikasi, slot/waktu pencatatan |
| Revocation | Referensi batch, leaf hash, kode alasan, slot/waktu pencabutan |
| Proof JSON | Versi, identitas jaringan/program, issuer, batch, nonce, indeks leaf, sibling hashes |

Nama mahasiswa, NIM, IPK, nama file asli, dan isi PDF tidak dicatat on-chain.

Aturan hashing:

- Gunakan SHA-256 dengan encoding yang ditetapkan dalam spesifikasi.
- Nonce acak 32 byte dibuat dengan generator kriptografis.
- Leaf mengikat versi skema, issuer, batch, indeks, nonce, dan hash PDF.
- Leaf dan node internal menggunakan prefix berbeda.
- Aturan urutan sibling dan jumlah node ganjil harus deterministik.
- Implementasi TypeScript dan Rust harus lulus test vector yang sama.

Root batch tidak cukup untuk merekonstruksi dokumen, nonce, atau proof. Institusi bertanggung jawab menyimpan paket cadangan.

## 10. Status dan pengalaman pengguna

| Status | Arti |
|---|---|
| Terverifikasi | Integritas cocok, issuer aktif dalam registry, dan tidak ditemukan pencabutan pada pemeriksaan yang berhasil |
| Dicabut | Ditemukan catatan pencabutan |
| Bukti tidak cocok | Dokumen atau proof gagal validasi kriptografis |
| Penerbit belum dipercaya | Penerbit tidak ditemukan dalam registry yang didukung |
| Penerbit nonaktif | Bukti dapat cocok, tetapi status issuer memerlukan perhatian |
| Batch tidak ditemukan | Pembacaan berhasil, tetapi batch tidak ada |
| Belum dapat diverifikasi | RPC gagal, jaringan tidak didukung, atau versi proof tidak dikenali |

UI harus:

- Memisahkan hasil integritas, kepercayaan penerbit, dan pencabutan.
- Menampilkan waktu pemeriksaan.
- Menggunakan teks dan ikon, bukan warna saja.
- Menyebut pemilihan file sebagai **“Pilih dokumen dan bukti”**.
- Menampilkan label Devnet dan data simulasi.
- Tidak menyamakan kepemilikan file dengan identitas pemilik ijazah.

## 11. Arsitektur dan keamanan

**Stack:** Rust + Anchor, Solana Devnet, TypeScript, React, dan Vite.

Frontend statis menjalankan validasi file, hashing, pembuatan Merkle tree, dan verifikasi proof. RPC digunakan untuk transaksi dan pembacaan data on-chain.

Persyaratan keamanan:

- Network, program ID, dan endpoint RPC berasal dari konfigurasi aplikasi; proof tidak boleh menentukan endpoint arbitrer.
- Validasi kepemilikan akun program, PDA, relasi issuer/batch, signer, dan status dilakukan sesuai operasinya.
- Batasi ukuran file, jumlah file, panjang proof, dan ukuran input JSON.
- Jangan merender PDF atau HTML dari input sebagai konten aktif.
- Jangan mencatat isi dokumen/proof dalam log atau analytics.
- Jangan menyimpan private key; penandatanganan dilakukan wallet.
- Pemeriksaan terkait harus menggunakan data on-chain yang konsisten dan commitment `finalized`.
- Jelaskan bahwa hasil bergantung pada respons RPC yang digunakan.

Tanpa backend aplikasi bukan berarti tanpa ketergantungan layanan: hosting frontend dan RPC tetap dibutuhkan.

## 12. Roadmap

| Fase | Pekerjaan | Syarat selesai |
|---|---|---|
| 1 — Fondasi | Spesifikasi proof, model kepercayaan, registry, otorisasi, wallet | Test vector cocok dan akses tanpa izin ditolak |
| 2 — Alur utama | Publikasi batch, ekspor, verifikasi lokal/on-chain | Satu batch berhasil diterbitkan dan diperiksa |
| 3 — Lifecycle | Pencabutan, penonaktifan, rotasi/pemulihan kunci | Skenario lifecycle dan kegagalan lulus uji |
| 4 — Demo | Panduan, data contoh, aksesibilitas, benchmark, deployment | Demo dapat digunakan dan batas sistem jelas |

Fase 1–3 merupakan fungsi inti MVP. Penjelasan batas jaminan tersedia sejak halaman verifikasi dapat digunakan.

## 13. Pengujian dan kriteria penyelesaian (Definition of Done)

Pengujian wajib mencakup:

- PDF asli, PDF berubah, dan proof tertukar.
- Batch dengan satu leaf serta jumlah leaf ganjil.
- Nonce, indeks, issuer, atau batch yang dimanipulasi.
- Publikasi dan pencabutan tanpa otorisasi.
- Pencabutan lintas issuer.
- Rotasi kunci dan penggunaan kembali kunci lama.
- Issuer nonaktif dan batch lama.
- RPC timeout, batch tidak ada, dan jaringan salah.
- Transaksi ditolak wallet atau respons publikasinya terputus.
- Tidak adanya pengiriman isi dokumen/proof melalui jaringan.

MVP selesai ketika alur end-to-end berjalan di Devnet, seluruh pengujian kritis lulus, paket hasil dapat diverifikasi ulang tanpa database aplikasi, dan repository memuat petunjuk menjalankan proyek, spesifikasi format, keputusan arsitektur, serta batas kepercayaan dan privasinya.
