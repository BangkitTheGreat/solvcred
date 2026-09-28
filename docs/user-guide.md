# Panduan pengguna

> Cara memakai aplikasi web SolVcred untuk tiga peran: **verifikator** (tanpa wallet), **penerbit institusi**, dan **admin
> registry**. Semua pemrosesan file terjadi di browser Anda; tidak ada file yang diunggah ke server.

Aplikasi memiliki tiga tab: **Verifikasi**, **Penerbit**, dan **Admin registry**. Label **Devnet** dan **Data simulasi** di
header menandakan bahwa ini lingkungan uji. Kredensial di sini bukan kredensial resmi.

## Daftar isi

1. [Verifikator: memeriksa dokumen](#1-verifikator-memeriksa-dokumen)
2. [Penerima: menyimpan dan membagikan](#2-penerima-menyimpan-dan-membagikan)
3. [Penerbit: menerbitkan batch](#3-penerbit-menerbitkan-batch)
4. [Penerbit: mencabut kredensial](#4-penerbit-mencabut-kredensial)
5. [Penerbit: rotasi kunci](#5-penerbit-rotasi-kunci)
6. [Admin registry](#6-admin-registry)
7. [Pertanyaan umum](#7-pertanyaan-umum)

## 1. Verifikator: memeriksa dokumen

Anda membutuhkan dua file dari pemegang kredensial: **PDF asli** dan **file bukti** (`*.proof.json`). Tidak perlu akun atau wallet.

1. Buka tab **Verifikasi**.
2. Di bagian **Pilih dokumen dan bukti**, pilih **Dokumen PDF** dan **File bukti (JSON)**.
3. Tekan **Periksa**. Aplikasi menghitung hash secara lokal, lalu membaca status dari jaringan. Tombol **Kosongkan** menghapus pilihan file.

### Membaca hasil

Hasil dibagi menjadi tiga bagian yang terpisah (**Integritas**, **Penerbit**, **Pencabutan**) ditambah satu status keseluruhan
dan waktu pemeriksaan.

| Status | Artinya | Yang sebaiknya dilakukan |
| --- | --- | --- |
| ✅ **Terverifikasi** | Dokumen cocok dengan batch on-chain, penerbit aktif di registry, dan tidak ada pencabutan pada waktu pemeriksaan | Terima sebagai bukti integritas dan status. Identitas pembawa tetap perlu diperiksa terpisah |
| ⛔ **Dicabut** | Penerbit telah mencatat pencabutan kredensial ini | Jangan perlakukan sebagai kredensial yang berlaku |
| ✖ **Bukti tidak cocok** | PDF atau file bukti gagal validasi kriptografis | Minta PDF asli dari penerbit. PDF yang dipindai atau diekspor ulang adalah file berbeda |
| ⚠ **Penerbit belum dipercaya** | Penerbit tidak ada di registry yang didukung aplikasi ini | Jangan anggap resmi. Hubungi institusi lewat saluran resminya |
| ⏸ **Penerbit nonaktif** | Bukti cocok dan tidak dicabut, tetapi penerbit dinonaktifkan admin | Konfirmasikan status kredensial langsung kepada institusi |
| 🔍 **Batch tidak ditemukan** | Jaringan terbaca, tetapi batch yang dirujuk tidak ada | File bukti mungkin dari draft yang tidak pernah terbit |
| ❔ **Belum dapat diverifikasi** | Pemeriksaan tidak selesai: RPC gagal, jaringan salah, atau versi bukti tidak didukung | Coba lagi nanti. Hasil ini **tidak** menyatakan sah maupun tidak sah |

### Batas jaminan

- **Memegang file bukan bukti identitas.** Siapa pun yang memiliki PDF dan file bukti dapat memperoleh hasil yang sama.
- **Isi kredensial tidak dinilai.** SolVcred tidak membuktikan kebenaran kegiatan akademik atau kejujuran institusi.
- **Hasil berlaku pada waktu pemeriksaan.** Pencabutan setelahnya baru terlihat pada pemeriksaan berikutnya.
- **Hasil bergantung pada RPC yang dikonfigurasi.** Alamat RPC tertera di footer.

## 2. Penerima: menyimpan dan membagikan

Institusi mengirimkan pasangan file untuk setiap kredensial: `nama.pdf` dan `nama.proof.json`.

- **Simpan keduanya, tanpa mengubah PDF.** Membuka lalu menyimpan ulang, mencetak ke PDF, atau memindai akan mengubah byte file.
- **Bagikan keduanya** kepada verifikator, melalui email, portal lamaran, atau media lain.
- **File bukti tidak berisi data pribadi** seperti nama atau NIM. Isinya ID batch, nonce acak, dan hash.
- Jika file bukti hilang, mintalah salinan dari institusi. Data on-chain tidak dapat membuat ulang file bukti.

## 3. Penerbit: menerbitkan batch

### Persiapan

- Wallet Solana yang mendukung Wallet Standard, terhubung ke Devnet, dengan sedikit SOL Devnet untuk biaya dan rent (±0,0015 SOL per batch).
- Wallet tersebut sudah didaftarkan admin sebagai **authority** penerbit Anda.
- PDF **final** (maksimal 100 file, 10 MiB per file, 100 MiB total, tanpa duplikat).

### Langkah

1. Buka tab **Penerbit** dan hubungkan wallet. Aplikasi mencari penerbit yang authority-nya adalah wallet ini. Pilih penerbit jika ada lebih dari satu.
2. Pada **Terbitkan batch**, pilih PDF final. Hash, nonce acak, Merkle root, dan file bukti dibuat di browser.
3. Tekan **Unduh cadangan draft (.zip)** (`solvcred-draft-….zip`), simpan di tempat aman, lalu centang konfirmasi bahwa cadangan sudah disimpan. Tombol terbit terkunci sampai langkah ini selesai.
4. Periksa ringkasan (jumlah dokumen, ukuran total, batch ID, root), lalu tekan **Terbitkan batch** dan setujui transaksi di wallet.
5. Tunggu status **finalized** (biasanya 15–30 detik). Aplikasi membaca ulang batch dari jaringan.
6. Setelah batch terbaca cocok, **unduh paket final** (`solvcred-final-….zip`). Paket ini berisi setiap pasangan PDF + file bukti dan `manifest.json` untuk arsip institusi.
7. Distribusikan setiap pasangan PDF + file bukti kepada penerimanya melalui saluran institusi.

Yang dikirim ke jaringan hanya batch ID, Merkle root, jumlah dokumen, dan versi skema. PDF, nama file, dan nonce tidak pernah dikirim.

### Jika sesuatu terputus

Jangan membuat draft baru dari PDF yang sama. Pilih **Lanjutkan dari cadangan draft** dan muat ZIP draft. Aplikasi memverifikasi
ulang setiap PDF, lalu memeriksa jaringan:

| Hasil | Tindakan |
| --- | --- |
| Batch cocok | Unduh paket final. Batch sudah terbit |
| Batch belum ada | Tekan **Kirim ulang dengan draft yang sama**. Batch ID, nonce, dan root tetap sama |
| Konflik | Berhenti. Batch ID ini sudah dipakai dengan root lain. Hubungi admin |
| Belum diketahui | RPC bermasalah. Tunggu, lalu periksa ulang. Jangan kirim ulang |

## 4. Penerbit: mencabut kredensial

Pencabutan **permanen** dan tidak dapat dibatalkan. Untuk memperbaiki kesalahan, cabut kredensial lama lalu terbitkan pengganti.

1. Buka **Penerbit → Cabut kredensial** dengan wallet authority penerbit.
2. Pada **Pilih dokumen dan bukti kredensial yang dicabut**, pilih PDF dan file bukti kredensial tersebut.
3. Aplikasi menghitung leaf hash lokal dan membaca status. Periksa **Konfirmasi kredensial**: penerbit, batch ID, waktu batch dicatat, posisi dalam batch, dan leaf hash.
4. Pilih **Alasan pencabutan**:

   | Kode | Alasan |
   | --- | --- |
   | 1 | Kesalahan data pada dokumen |
   | 2 | Digantikan kredensial baru |
   | 3 | Penerbitan tidak sah (misalnya kunci disalahgunakan) |
   | 4 | Keputusan institusi lainnya |

5. Centang **Saya memahami pencabutan ini permanen dan tidak dapat dibatalkan**, lalu setujui di wallet.
6. Setelah finalized, aplikasi membaca ulang dan menampilkan status **Dicabut**.

Aplikasi menolak lebih awal jika kredensial sudah dicabut, milik penerbit lain, tidak cocok dengan batch, atau wallet bukan
authority yang berlaku. Penerbit yang sudah **nonaktif** tetap dapat mencabut.

Yang disimpan di akun Revocation: leaf hash dan indeksnya, kode alasan, authority beserta versi kunci, serta slot dan waktu. Jalur Merkle ikut terlihat di data transaksi publik.

## 5. Penerbit: rotasi kunci

Rotasi mengganti wallet authority tanpa mengubah identitas penerbit atau batch lama. Dibutuhkan **dua wallet**: kunci lama dan
kunci baru.

1. Siapkan wallet kunci baru dan catat public key-nya.
2. Buka **Penerbit → Rotasi kunci** dengan wallet kunci **lama** terhubung.
3. Masukkan **Public key authority baru**, lalu tandatangani di wallet lama. Wallet lama juga membayar biaya.
4. **Segera** putuskan wallet lama dan hubungkan wallet kunci baru. Aplikasi menampilkan sisa waktu sebelum transaksi kedaluwarsa (±60–90 detik).
5. Tandatangani dengan wallet baru. Aplikasi menyiarkan transaksi dan menunggu finalized.
6. Hasil: **Authority diganti**. Kunci lama langsung kehilangan hak menerbitkan dan mencabut. Versi kunci naik satu.

Jika waktu habis, ulangi dari langkah 3. Jika kunci lama hilang atau dicuri, rotasi tidak mungkin dilakukan; minta admin
menjalankan **Pulihkan kunci** (§6).

## 6. Admin registry

Tab **Admin registry** memiliki empat bagian. Wallet yang terhubung harus admin registry; wallet lain ditolak program.

| Bagian | Fungsi | Catatan |
| --- | --- | --- |
| **Registry** | Melihat admin dan versi konfigurasi; inisialisasi satu kali | Inisialisasi hanya oleh upgrade authority program. Biasanya sudah dijalankan `scripts/deploy-devnet.sh` |
| **Daftarkan penerbit** | Mendaftarkan institusi yang sudah diperiksa di luar aplikasi | Issuer ID acak dibuat otomatis. Nama 1–96 byte, domain `a-z 0-9 . -`, public key authority penerbit |
| **Nonaktifkan** | Menghentikan penerbitan baru oleh penerbit | Tidak dapat dibatalkan di MVP. Kredensial lama tidak otomatis dicabut |
| **Pulihkan kunci** | Mengganti authority penerbit saat kunci hilang atau dicuri | Admin menandatangani lebih dulu, lalu wallet kunci baru. Batch yang sudah diterbitkan penyerang tidak ikut batal; lihat runbook R1 |

Domain yang dicatat adalah informasi pendukung. Aplikasi tidak memverifikasinya secara otomatis. Tanggung jawab pemeriksaan
institusi ada pada admin. Prosedur insiden lengkap ada di [deployment.md §6](deployment.md#6-runbook-insiden).

## 7. Pertanyaan umum

**Apakah dokumen saya diunggah?**
Tidak. PDF dan file bukti dibaca di browser. Jaringan hanya menerima alamat akun (saat verifikasi) atau commitment (saat penerbitan
dan pencabutan).

**Mengapa PDF yang tampak sama hasilnya "Bukti tidak cocok"?**
Verifikasi membandingkan byte persis. Menyimpan ulang, mencetak ke PDF, mengompresi, atau memindai menghasilkan file berbeda.

**Mengapa hasilnya "Belum dapat diverifikasi" padahal dokumennya asli?**
Aplikasi tidak dapat menyelesaikan pembacaan jaringan, misalnya karena RPC sibuk atau lambat. Aplikasi sengaja tidak menebak.
Coba lagi beberapa saat kemudian.

**Apakah "Terverifikasi" berarti orang ini lulusan institusi tersebut?**
Tidak sepenuhnya. Artinya dokumen ini diterbitkan penerbit terdaftar dan belum dicabut. Identitas pembawa file harus diperiksa
dengan cara lain.

**Bisakah pencabutan dibatalkan?**
Tidak. Terbitkan kredensial baru sebagai pengganti.
