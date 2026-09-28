# Glosarium

> Istilah yang dipakai di seluruh dokumentasi dan kode SolVcred, diurutkan per kelompok. Nama field dan identifier kode ditulis
> dalam bentuk aslinya.

## Domain SolVcred

| Istilah | Arti |
| --- | --- |
| **Admin registry** | Pihak yang memeriksa institusi di luar aplikasi, lalu mendaftarkan, menonaktifkan, dan memulihkan kunci penerbit. Public key-nya tersimpan di akun `Registry` |
| **Authority (issuer)** | Public key wallet yang saat ini berwenang menerbitkan dan mencabut atas nama penerbit. Dapat dirotasi atau dipulihkan |
| **Batch** | Kumpulan 1–100 kredensial yang diterbitkan bersama dan diwakili satu Merkle root di akun `Batch` |
| **Batch ID** | ID acak 32 byte untuk sebuah batch. Bagian dari seeds PDA batch |
| **Cadangan draft** | ZIP (`draft-manifest.json` + pasangan PDF/proof) yang wajib diunduh sebelum publikasi. Dipakai untuk retry dengan draft yang sama |
| **Commitment (batch)** | Gabungan konteks batch + `leafCount` + `root`. Dalam konteks Solana, "commitment" juga berarti tingkat konfirmasi (lihat bawah) |
| **Draft** | Batch yang sudah dihitung lokal tetapi belum terbukti ada on-chain. `PreparedBatch.state` selalu `draft` |
| **FR-10** | Kebutuhan PRD: setelah respons transaksi tidak jelas, periksa keberadaan batch sebelum retry. Diimplementasikan oleh `checkPublishedBatch` |
| **Issuer / penerbit** | Institusi yang terdaftar di registry dan menerbitkan kredensial |
| **Issuer ID** | ID stabil 32 byte untuk penerbit. Tidak berubah saat kunci dirotasi |
| **Kode alasan** | Angka 1–4 yang menjelaskan pencabutan: kesalahan data, digantikan, penerbitan tidak sah, keputusan lain |
| **Key version** | Penghitung yang naik setiap rotasi atau pemulihan kunci. Dicatat di batch dan revocation |
| **Paket final** | ZIP (`manifest.json` + pasangan PDF/proof) yang tersedia setelah batch terbaca cocok pada `finalized` |
| **Penerima / pemegang** | Orang yang menyimpan PDF dan proof, lalu membagikannya kepada verifikator |
| **Pencabutan / revocation** | Catatan permanen bahwa satu kredensial tidak lagi berlaku. Disimpan di akun `Revocation` |
| **Proof (file bukti)** | JSON `schemaVersion: 1` berisi konteks batch, indeks leaf, nonce, dan sibling. Spesifikasi di [proof-format-v1.md](proof-format-v1.md) |
| **Registry** | Akun tunggal yang menyimpan admin. Dibuat sekali oleh upgrade authority |
| **Verifikator** | Pihak yang memeriksa PDF + proof, misalnya HR. Tidak membutuhkan wallet |

## Status verifikasi

| Status (UI) | `OverallStatus` | Ringkas |
| --- | --- | --- |
| Terverifikasi | `verified` | Integritas cocok, issuer aktif, tidak dicabut |
| Dicabut | `revoked` | Ada akun Revocation untuk leaf ini |
| Bukti tidak cocok | `proof-mismatch` | PDF atau proof gagal validasi kriptografis |
| Penerbit belum dipercaya | `issuer-untrusted` | Issuer tidak ada di registry |
| Penerbit nonaktif | `issuer-inactive` | Cocok, tetapi issuer dinonaktifkan |
| Batch tidak ditemukan | `batch-not-found` | Pembacaan berhasil, batch tidak ada |
| Belum dapat diverifikasi | `unverifiable` | Pemeriksaan tidak selesai; bukan sah maupun tidak sah |

## Kriptografi

| Istilah | Arti |
| --- | --- |
| **Domain separation** | Prefix berbeda untuk leaf (`0x00`) dan node internal (`0x01`) agar hash satu jenis tidak dapat menyamar sebagai jenis lain |
| **Hash dokumen** | `SHA-256` dari byte persis PDF |
| **Leaf** | SHA-256 dari preimage 179 byte yang mengikat konteks batch, indeks, nonce, dan hash dokumen |
| **Leaf hash** | Nilai leaf. Dipakai sebagai seed PDA revocation |
| **Merkle root** | Hash tunggal di puncak tree. Satu-satunya representasi batch yang disimpan on-chain |
| **Merkle path / sibling** | Daftar hash saudara dari leaf ke root, panjangnya tepat `ceil(log2(leafCount))` |
| **Nonce** | 32 byte acak per dokumen dari Web Crypto. Mencegah pencocokan leaf dengan PDF yang ditebak |
| **Node ganjil diduplikasi** | Jika jumlah node di satu level ganjil, node terakhir dipasangkan dengan dirinya sendiri, dan verifier memeriksa hal ini |
| **Test vector** | `test-vectors/v1.json`: fixture deterministik dari implementasi Python independen, dipakai TypeScript dan Rust |

## Solana dan Anchor

| Istilah | Arti |
| --- | --- |
| **Account / akun** | Unit penyimpanan data on-chain. Akun program SolVcred berukuran tetap |
| **Anchor** | Framework program Solana (versi 0.32.1). Menyediakan constraint akun, discriminator, dan IDL |
| **BPF Upgradeable Loader** | Program sistem yang memiliki program *upgradeable* dan akun ProgramData-nya |
| **Blockhash** | Referensi blok terbaru di transaksi. Transaksi kedaluwarsa jika tidak masuk sebelum `lastValidBlockHeight` |
| **Commitment (Solana)** | Tingkat konfirmasi: `processed`, `confirmed`, `finalized`. SolVcred membaca status pada `finalized` |
| **Discriminator** | 8 byte pertama data akun atau instruksi: `sha256("account:<Nama>")` atau `sha256("global:<nama>")` |
| **Genesis hash** | Identitas jaringan. Dipakai untuk menolak RPC yang terhubung ke cluster lain |
| **IDL** | Deskripsi antarmuka program hasil `anchor build`. Dibandingkan dengan konstanta klien di test |
| **`init`** | Constraint Anchor yang membuat akun baru dan gagal jika akun sudah ada. Dasar immutability batch dan revocation |
| **PDA** | Program Derived Address: alamat deterministik dari seeds dan program ID, tanpa private key |
| **ProgramData** | Akun milik loader yang menyimpan bytecode dan upgrade authority program |
| **Rent-exempt** | Saldo minimum agar akun tidak dihapus. Dibayar sekali saat akun dibuat |
| **RPC** | Endpoint JSON-RPC untuk membaca akun dan mengirim transaksi |
| **Slot** | Satuan waktu Solana (±400 ms). Laporan verifikasi mencatat slot snapshot |
| **Upgrade authority** | Kunci yang berhak meng-upgrade program. Satu-satunya pihak yang dapat menjalankan `initialize_registry` |
| **Wallet Standard** | Standar deteksi wallet di browser. SolVcred tidak memakai paket adapter per wallet |

## Proses

| Istilah | Arti |
| --- | --- |
| **ADR** | Architecture Decision Record. Lihat [decisions.md](decisions.md) |
| **DoD** | Definition of Done dari PRD §13 |
| **Fail-closed** | Kegagalan selalu menghasilkan status negatif atau tidak diketahui, tidak pernah positif |
| **FR / NFR** | Functional / non-functional requirement |
| **Snapshot** | Satu pembacaan beberapa akun pada slot yang sama (`getMultipleAccountsInfoAndContext`) |
