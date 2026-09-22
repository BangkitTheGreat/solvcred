# Model ancaman fondasi

## Aset dan batas kepercayaan

- Dokumen serta proof disimpan pemilik/institusi; root tidak menjadi backup.
- Private key tetap di wallet. Core, adapter, dan UI tidak menyimpan atau meminta private key.
- Proof pengguna tidak boleh menentukan RPC, jaringan yang dipercaya, program yang dipercaya atau expected root.
- Issuer ID stabil berbeda dari authority yang bisa berganti.
- Admin registry dipercaya untuk pemeriksaan identitas. Domain yang dicatat bukan validasi institusi otomatis.

## Ancaman dan mitigasi

| Ancaman | Mitigasi/status |
| --- | --- |
| PDF atau nonce berubah | Leaf SHA-256 dan pemeriksaan root, diuji |
| Proof dari issuer/batch/program lain | Konteks diikat ke leaf dan dicocokkan dengan commitment eksternal, diuji |
| Pohon ambigu ketika jumlah leaf ganjil | Leaf count/index diikat; path dan duplikasi node diperiksa, diuji |
| Memakai root buatan penyerang | Adapter mengambil root, jumlah leaf, dan issuer hanya dari akun on-chain tervalidasi, bukan dari proof; unit test |
| Memory exhaustion | Batas byte/count diterapkan sebelum penyalinan batch |
| Buffer berubah selama operasi async | Snapshot sebelum await; SharedArrayBuffer ditolak |
| PDF mengandung konten aktif | Tidak dirender atau dieksekusi; header bukan pemindaian malware |
| Proof memuat URL berbahaya | Field tambahan ditolak; core tidak melakukan request jaringan |
| RPC gagal dianggap tidak dicabut | Error/timeout RPC selalu menghasilkan `unverifiable`; satu snapshot finalized untuk program, issuer, batch, dan revocation; unit test dengan RPC palsu |
| RPC mengembalikan akun palsu atau jaringan lain | Cek genesis hash, owner, ukuran, discriminator, relasi antarakun, serta program executable milik loader upgradeable; unit test |
| Bootstrap registry direbut pihak pertama | `initialize_registry` mewajibkan `program_data.upgrade_authority == admin`; test on-chain ditulis, belum dijalankan |
| Penerbitan/pencabutan tanpa izin atau lintas issuer | `has_one` authority, PDA dengan bump tersimpan, `batch.issuer == issuer`; test on-chain ditulis, belum dijalankan |
| Root batch ditimpa | Batch dibuat dengan `init`, dan tidak ada instruksi yang mengubah atau menutupnya; bergantung pada upgrade authority |
| Kunci issuer dicuri | Rotasi dua tanda tangan dan pemulihan oleh admin; `key_version` tercatat di batch dan revocation. Batch yang sudah diterbitkan penyerang tidak otomatis batal dan harus dicabut |
| Penyalahgunaan admin/upgrade authority | Di luar kendali program; wajib didokumentasikan sebelum Devnet/produksi |
| Kebocoran data melalui analytics | Core tidak memiliki analytics atau logging input |

## Pencabutan dan privasi

Pencabutan memerlukan leaf hash serta sibling hashes di transaksi agar program dapat memverifikasi membership. File PDF, nonce dan data identitas tidak dikirim. Karena leaf hash diturunkan dari hash PDF, UI penerbit meminta PDF dan proof secara lokal. Leaf/proof path tetap dapat dikorelasikan dengan orang yang sudah memiliki dokumen dan proof; jangan menjanjikan anonimitas.

Saat verifikasi, RPC menerima alamat PDA issuer, batch, dan revocation. Isinya tidak dikirim, tetapi operator RPC dapat mengetahui kredensial mana yang sedang diperiksa dan kapan.

## Kontrak parser

Field yang tidak dikenali, hash nonkanonis, path salah panjang, versi/jaringan tidak didukung, dan input oversized ditolak. Versi diperiksa sebelum set field, sehingga proof versi mendatang dilaporkan sebagai tidak didukung, bukan rusak. JSON tidak di-hash mentah. Konsumen menggunakan objek hasil parser tervalidasi dan tidak boleh menafsirkan file yang sama dengan semantik parser berbeda. Program Anchor menerima argumen biner, bukan JSON.

## Gerbang sebelum Devnet

Sebelum Devnet, jalankan `cargo test --workspace` dan `anchor test` (CI) sampai lulus, review ulang constraint Anchor, tetapkan pemegang upgrade authority dan admin registry, lalu uji wallet sungguhan untuk publikasi, pencabutan, dan rotasi. Klaim keamanan program on-chain baru berlaku setelah test on-chain berjalan dan lulus.
