# Model ancaman fondasi

## Aset dan batas kepercayaan

- Dokumen serta proof disimpan pemilik/institusi; root tidak menjadi backup.
- Private key tetap di wallet; core ini tidak mengakses wallet atau kunci.
- Proof pengguna tidak boleh menentukan RPC, jaringan yang dipercaya, program yang dipercaya atau expected root.
- Issuer ID stabil berbeda dari authority yang bisa berganti.
- Admin registry dipercaya untuk pemeriksaan identitas. Domain yang dicatat bukan validasi institusi otomatis.

## Ancaman dan mitigasi

| Ancaman | Mitigasi/status |
| --- | --- |
| PDF atau nonce berubah | Leaf SHA-256 dan pemeriksaan root, diuji |
| Proof dari issuer/batch/program lain | Konteks diikat ke leaf dan dicocokkan dengan commitment eksternal, diuji |
| Pohon ambigu ketika jumlah leaf ganjil | Leaf count/index diikat; path dan duplikasi node diperiksa, diuji |
| Memakai root buatan penyerang | API membutuhkan commitment eksternal; autentikasi on-chain masih pekerjaan berikutnya |
| Memory exhaustion | Batas byte/count diterapkan sebelum penyalinan batch |
| Buffer berubah selama operasi async | Snapshot sebelum await; SharedArrayBuffer ditolak |
| PDF mengandung konten aktif | Tidak dirender atau dieksekusi; header bukan pemindaian malware |
| Proof memuat URL berbahaya | Field tambahan ditolak; core tidak melakukan request jaringan |
| RPC gagal dianggap tidak dicabut | Belum ada adapter/status sah; wajib ditangani saat integrasi |
| Issuer palsu, kunci dicuri, penyalahgunaan admin | Registry, rotasi dan recovery belum tersedia; wajib diuji on-chain |
| Kebocoran data melalui analytics | Core tidak memiliki analytics atau logging input |

## Pencabutan dan privasi

Pencabutan memerlukan leaf hash serta sibling hashes di transaksi agar program dapat memverifikasi membership. File PDF, nonce dan data identitas tidak perlu dikirim. Leaf/proof path tetap dapat dikorelasikan dengan orang yang sudah memiliki dokumen dan proof; jangan menjanjikan anonimitas.

## Kontrak parser

Field yang tidak dikenali, hash nonkanonis, path salah panjang, versi/jaringan tidak didukung, dan input oversized ditolak. JSON tidak di-hash mentah. Konsumen menggunakan objek hasil parser tervalidasi dan tidak boleh menafsirkan file yang sama dengan semantik parser berbeda. Pemindai JSON duplikat lintas bahasa belum dibutuhkan untuk program Anchor karena program akan menerima argumen biner, bukan JSON.

## Gerbang sebelum Devnet

Uji Rust terhadap semua fixture, review constraint Anchor dan bootstrap admin, validasi RPC owner/PDA/discriminator, integrasi wallet, serta pengujian publikasi/pencabutan end-to-end. Tidak ada klaim keamanan program on-chain pada tahap fondasi ini.
