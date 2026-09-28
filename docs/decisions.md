# Keputusan arsitektur (ADR)

> Catatan keputusan besar yang membentuk SolVcred: konteks, keputusan, alternatif yang ditolak, dan konsekuensinya.
> ADR tidak ditulis ulang saat keputusan berubah. Keputusan baru ditambahkan dan menandai ADR lama sebagai *digantikan*.

| ID | Keputusan | Status |
| --- | --- | --- |
| [ADR-001](#adr-001-merkle-root-per-batch-sebagai-unit-komitmen) | Merkle root per batch sebagai unit komitmen | Diterima |
| [ADR-002](#adr-002-tanpa-backend-aplikasi) | Tanpa backend aplikasi | Diterima |
| [ADR-003](#adr-003-leaf-mengikat-konteks-dan-nonce-acak) | Leaf mengikat konteks dan nonce acak | Diterima |
| [ADR-004](#adr-004-issuer-id-stabil-terpisah-dari-authority) | Issuer ID stabil terpisah dari authority | Diterima |
| [ADR-005](#adr-005-pencabutan-sebagai-pda-per-leaf-dengan-verifikasi-on-chain) | Pencabutan sebagai PDA per leaf dengan verifikasi on-chain | Diterima |
| [ADR-006](#adr-006-bootstrap-registry-terikat-upgrade-authority) | Bootstrap registry terikat upgrade authority | Diterima |
| [ADR-007](#adr-007-status-dibaca-finalized-dalam-satu-snapshot-dan-fail-closed) | Status dibaca `finalized` dalam satu snapshot dan fail-closed | Diterima |
| [ADR-008](#adr-008-batas-100-dokumen-per-batch-di-skema-v1) | Batas 100 dokumen per batch di skema v1 | Diterima |
| [ADR-009](#adr-009-dua-implementasi-satu-fixture-independen) | Dua implementasi, satu fixture independen | Diterima |
| [ADR-010](#adr-010-cadangan-draft-wajib-dan-publikasi-idempoten) | Cadangan draft wajib dan publikasi idempoten | Diterima |
| [ADR-011](#adr-011-issuer-nonaktif-tetap-boleh-mencabut) | Issuer nonaktif tetap boleh mencabut | Diterima |
| [ADR-012](#adr-012-rotasi-dua-tanda-tangan-dan-pemulihan-oleh-admin) | Rotasi dua tanda tangan dan pemulihan oleh admin | Diterima |
| [ADR-013](#adr-013-program-id-placeholder-tanpa-private-key) | Program ID placeholder tanpa private key | Diterima |
| [ADR-014](#adr-014-wallet-standard-tanpa-paket-adapter) | Wallet Standard tanpa paket adapter | Diterima |

---

## ADR-001: Merkle root per batch sebagai unit komitmen

**Konteks.** Institusi menerbitkan puluhan sampai ratusan kredensial sekaligus. Menyimpan satu akun per kredensial berarti satu
rent dan satu instruksi per dokumen.

**Keputusan.** Satu batch (≤ 100 PDF) diwakili satu SHA-256 Merkle root di akun `Batch`. Setiap dokumen mendapat proof berisi
path sibling ke root.

**Alternatif.**
- *Akun per kredensial.* Pencarian sederhana, tetapi biaya dan jumlah transaksi linear terhadap jumlah dokumen.
- *Hash dokumen langsung di log transaksi (memo).* Murah, tetapi tidak ada akun yang dapat dibaca secara deterministik dan tidak ada relasi ke issuer.
- *NFT / token per kredensial.* Di luar cakupan PRD dan menambah beban wallet bagi penerima.

**Konsekuensi.** Satu transaksi 77 byte data untuk seluruh batch. Penerima wajib menyimpan proof, karena root tidak dapat
memulihkan proof. Pencabutan harus membuktikan keanggotaan leaf (lihat ADR-005).

## ADR-002: Tanpa backend aplikasi

**Konteks.** Dokumen berisi data pribadi. Setiap server yang menerima PDF menjadi target kebocoran dan pihak yang harus dipercaya.

**Keputusan.** SPA statis. Hashing, Merkle tree, dan verifikasi integritas berjalan di browser. Status dibaca langsung dari RPC.
Program ID, RPC, dan genesis hash dibekukan ke dalam bundle saat build (`VITE_SOLVCRED_*`).

**Alternatif.**
- *API verifikasi terpusat.* UX lebih sederhana, tetapi melanggar G2 (dokumen tetap milik pemegang) dan menambah pihak tepercaya.
- *Indexer sendiri.* Mempercepat pencarian issuer per wallet, tetapi menambah infrastruktur. Ditunda (lihat [system-design §12](system-design.md#12-skalabilitas-dan-batas)).

**Konsekuensi.** Tidak ada database atau analytics. Hosting frontend dan operator RPC tetap menjadi dependensi. Pencarian issuer
milik wallet memakai `getProgramAccounts`, yang tidak skalabel di RPC publik.

## ADR-003: Leaf mengikat konteks dan nonce acak

**Konteks.** Proof dapat dipindahkan ke konteks lain (program, issuer, batch) atau dipakai untuk menebak isi dokumen dari leaf publik.

**Keputusan.** Preimage leaf 179 byte mengikat prefix `0x00`, tag `"SolVcred"`, versi, tag jaringan, program ID, issuer ID,
batch ID, jumlah leaf, indeks, nonce acak 32 byte, dan hash PDF. Node internal memakai prefix `0x01`. Pasangan tidak diurutkan;
node ganjil diduplikasi, dan verifier memeriksa duplikasi itu. Spesifikasi: [proof-format-v1.md](proof-format-v1.md).

**Alternatif.**
- *Leaf = SHA-256(PDF).* Proof bisa dipakai di batch lain, dan leaf publik dapat dicocokkan dengan PDF yang ditebak.
- *Pasangan diurutkan (sorted pairs).* Path lebih sederhana, tetapi indeks tidak terikat dan muncul ambiguitas posisi.

**Konsekuensi.** Setiap perubahan encoding memerlukan versi skema baru. Mainnet memerlukan tag jaringan baru.

## ADR-004: Issuer ID stabil terpisah dari authority

**Konteks.** Kunci penerbit dapat hilang, dicuri, atau dirotasi. Jika identitas issuer sama dengan public key-nya, semua batch lama
harus berpindah atau kehilangan hubungan.

**Keputusan.** Issuer diidentifikasi `issuer_id` acak 32 byte (PDA `["issuer", issuer_id]`). `authority` adalah field yang dapat
diganti. PDA batch diturunkan dari **alamat akun issuer**, bukan dari authority. Batch dan revocation mencatat
`issuing_authority` / `revoking_authority` dan `key_version` saat itu.

**Konsekuensi.** Rotasi tidak memindahkan batch. Riwayat kunci dapat diaudit dari akun batch dan revocation. Issuer ID harus
dibagikan kepada penerbit di luar aplikasi, atau ditemukan lewat `fetchIssuersByAuthority`.

## ADR-005: Pencabutan sebagai PDA per leaf dengan verifikasi on-chain

**Konteks.** Verifikator perlu memeriksa status pencabutan dengan satu pembacaan, dan penerbit tidak boleh dapat mencabut leaf
yang tidak pernah diterbitkan.

**Keputusan.** Akun `Revocation` di PDA `["revoked", batch, leaf_hash]` dibuat dengan `init`. `revoke_credential` menerima
`leaf_hash`, `leaf_index`, dan `siblings`, lalu menjalankan `verify_path` terhadap root batch sebelum membuat akun.

**Alternatif.**
- *Bitmap per batch.* Rent lebih murah per pencabutan, tetapi membutuhkan akun yang dapat diubah (bertentangan dengan immutability), kontensi tulis, dan pembacaan yang lebih besar.
- *Daftar pencabutan off-chain.* Membutuhkan server dan kepercayaan tambahan.
- *Tanpa verifikasi keanggotaan.* Lebih murah, tetapi penerbit dapat mengisi rantai dengan pencabutan fiktif.

**Konsekuensi.** Pencabutan permanen dan tidak dapat diulang. Setiap pencabutan membayar rent ±0,0013 SOL. Leaf hash dan path
menjadi publik untuk kredensial yang dicabut. Operator RPC melihat alamat revocation yang diperiksa.

## ADR-006: Bootstrap registry terikat upgrade authority

**Konteks.** Instruksi inisialisasi yang dapat dipanggil siapa pun memungkinkan pihak pertama merebut peran admin segera setelah deploy.

**Keputusan.** `initialize_registry` mewajibkan `program.programdata_address == program_data` dan
`program_data.upgrade_authority_address == Some(admin)`.

**Konsekuensi.** Program harus di-deploy sebagai *upgradeable*, dan inisialisasi harus dilakukan **sebelum** upgrade authority
dilepas. Tidak ada instruksi untuk mengganti admin, sehingga admin bersifat permanen tanpa upgrade program.
`scripts/deploy-devnet.sh` menjalankan deploy dan bootstrap berurutan dengan kunci yang sama. Lihat
[deploy-devnet.md](deploy-devnet.md#kunci-admin-registry).

## ADR-007: Status dibaca `finalized` dalam satu snapshot dan fail-closed

**Konteks.** Membaca akun terpisah pada slot berbeda dapat menghasilkan gabungan status yang tidak pernah ada. Galat jaringan
tidak boleh terlihat seperti "tidak dicabut".

**Keputusan.** `verifyCredential` memeriksa genesis hash, lalu membaca program, issuer, batch, dan revocation dalam satu
`getMultipleAccountsInfoAndContext` pada `finalized`. Setiap galat, timeout, atau akun yang gagal validasi menghasilkan
`unverifiable`. Commitment tepercaya hanya dibangun dari konfigurasi dan data on-chain.

**Alternatif.** *`confirmed`.* Latensi lebih rendah, tetapi hasil dapat mundur saat fork. *Retry otomatis.* Menunda hasil tanpa batas
dan menyembunyikan kegagalan. `disableRetryOnRateLimit` dipasang agar timeout tetap berarti.

**Konsekuensi.** Publikasi baru terlihat setelah ±15–30 detik. Pengguna dapat melihat **Belum dapat diverifikasi** saat RPC sibuk,
dan ini disengaja.

## ADR-008: Batas 100 dokumen per batch di skema v1

**Konteks.** Kedalaman path menentukan ukuran argumen `revoke_credential`, biaya komputasi on-chain, dan memori browser.

**Keputusan.** `MAX_LEAVES = 100` dan `MAX_DEPTH = 7`, ditegakkan di crate proof, program, core, dan UI. Batas file 10 MiB/PDF
dan 100 MiB/batch.

**Konsekuensi.** Target 5.000 dokumen dari PRD memerlukan skema v2 dan upgrade program. Institusi dengan lebih dari 100 dokumen
menerbitkan beberapa batch.

## ADR-009: Dua implementasi, satu fixture independen

**Konteks.** Hashing dilakukan di TypeScript (browser) dan diverifikasi di Rust (on-chain). Perbedaan satu byte berarti proof
valid ditolak, atau lebih buruk, proof palsu diterima.

**Keputusan.** `test-vectors/v1.json` dibuat implementasi Python independen (`scripts/reference_vectors.py`). Core TypeScript dan
crate Rust sama-sama diuji terhadapnya. Program memakai `verify_path` dari crate yang sama. `tests/program/00-idl.test.ts`
membandingkan IDL hasil build dengan konstanta klien.

**Konsekuensi.** Perubahan encoding harus memperbarui tiga implementasi dan fixture sekaligus. Drift IDL ↔ klien tertangkap di CI.

## ADR-010: Cadangan draft wajib dan publikasi idempoten

**Konteks.** Respons transaksi dapat hilang setelah wallet menandatangani. Membuat draft baru (nonce baru) untuk retry akan
menghasilkan root berbeda dan dapat menerbitkan dua batch untuk dokumen yang sama.

**Keputusan.** UI mewajibkan unduhan ZIP draft sebelum tombol terbit aktif. Sebelum dan sesudah setiap pengiriman, UI memanggil
`checkPublishedBatch`. Retry selalu memakai batch ID, nonce, dan root yang sama. Karena PDA batch deterministik dan dibuat dengan
`init`, pengiriman ganda tidak dapat membuat batch kedua.

**Konsekuensi.** Satu langkah tambahan bagi penerbit. Draft dapat dipulihkan kapan pun dari ZIP. Setiap PDF di-hash ulang dan
dicocokkan dengan proof-nya saat pemulihan.

## ADR-011: Issuer nonaktif tetap boleh mencabut

**Konteks.** PRD §8: penonaktifan menghentikan penerbitan baru, tetapi institusi mungkin masih perlu mencabut kredensial lama.

**Keputusan.** `PublishBatch` mewajibkan `issuer.active`. `RevokeCredential`, `RotateAuthority`, dan `RecoverAuthority` tidak
mewajibkannya. Tidak ada instruksi reaktivasi di MVP.

**Konsekuensi.** Kredensial dari issuer nonaktif tampil sebagai **Penerbit nonaktif**, bukan **Terverifikasi**, kecuali sudah
dicabut. Reaktivasi memerlukan upgrade program atau pendaftaran issuer baru.

## ADR-012: Rotasi dua tanda tangan dan pemulihan oleh admin

**Konteks.** Rotasi yang hanya ditandatangani kunci lama dapat memindahkan kontrol ke kunci yang tidak dikuasai siapa pun. Kunci
yang hilang tidak dapat ikut menandatangani.

**Keputusan.** `rotate_authority` membutuhkan tanda tangan authority lama dan baru. `recover_authority` membutuhkan admin dan
authority baru. Keduanya menaikkan `key_version` dengan `checked_add`. UI membangun satu transaksi yang ditandatangani dua wallet
secara bergantian.

**Konsekuensi.** Kunci baru selalu terbukti dikuasai. Kedua tanda tangan harus selesai sebelum blockhash kedaluwarsa. Batch yang
diterbitkan penyerang sebelum pemulihan tidak otomatis batal, dan institusi tidak dapat mencabutnya tanpa PDF + proof yang dipegang
penyerang (ADR-005). Satu-satunya penetralan menyeluruh di MVP adalah menonaktifkan issuer secara permanen. Lihat
[deployment.md R1](deployment.md#r1--kunci-penerbit-hilang-atau-dicuri).

## ADR-013: Program ID placeholder tanpa private key

**Konteks.** Program ID di source harus dapat dikompilasi, tetapi program ID sungguhan membutuhkan keypair yang tidak boleh
di-commit.

**Keputusan.** Source memakai `CZtvDiPBJ4voLQ9XchqAaXk9fzzghgsB62uSjwLMxASo`, yang diturunkan dari hash label sehingga tidak ada
yang memegang private key-nya. `anchor keys sync` menggantinya saat build lokal atau CI. UI menampilkan banner selama program ID
masih placeholder.

**Konsekuensi.** Tidak ada yang dapat men-deploy ke alamat placeholder. Program ID lokal tidak boleh di-commit sebagai program ID
produksi.

## ADR-014: Wallet Standard tanpa paket adapter

**Konteks.** Paket adapter per wallet memperbesar bundle dan cepat usang.

**Keputusan.** `WalletProvider` dijalankan dengan daftar adapter kosong. Wallet yang mendukung Wallet Standard terdeteksi otomatis.
Karena wallet memilih jaringan dari URL RPC, UI hanya memakai `sendTransaction` bawaan wallet jika URL mengandung `devnet`. Jika
tidak, UI meminta `signTransaction` lalu menyiarkan sendiri lewat RPC yang dikonfigurasi.

**Konsekuensi.** Wallet lama tanpa Wallet Standard tidak didukung. RPC kustom tanpa kata `devnet` memerlukan wallet yang
mendukung `signTransaction`.
