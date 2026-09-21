# Validasi lokal

Lingkungan: Windows x64, Node v22.23.2, Intel Core i7-13620H. Hasil ini merupakan pemeriksaan lokal; workflow GitHub Actions belum diklaim berjalan.

| Pemeriksaan | Hasil |
| --- | --- |
| TypeScript strict dan build | Lulus |
| Test core | 25 test lulus |
| Referensi Python independen | Fixture satu, tiga dan lima leaf cocok |
| Demo ekspor lokal | Tiga PDF fiktif beserta proof dan draft manifest berhasil diperiksa |
| Audit instalasi npm | 0 vulnerability dilaporkan pada saat instalasi; bukan audit keamanan kode |
| Benchmark 100 payload sintetis, total 100 MiB | Persiapan 244 ms; verifikasi seluruh payload 269 ms pada satu pengukuran |

Angka benchmark hanya menggambarkan satu pengukuran lokal atas hashing byte. Benchmark ini tidak menggunakan 100 ijazah nyata, tidak mengukur browser, RPC atau transaksi, dan bukan SLA produk.

Yang belum diuji: implementasi Rust/Anchor, otorisasi on-chain, RPC, UI/browser, wallet, deployment dan end-to-end Devnet. Rust, Anchor dan Solana CLI belum tersedia di lingkungan pengerjaan.

Test runner Node memerlukan subprocess; pada lingkungan sandbox Windows ini dijalankan dengan izin eksekusi yang sesuai setelah runner awal gagal `spawn EPERM`.
