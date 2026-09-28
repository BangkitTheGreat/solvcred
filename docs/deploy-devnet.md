# Deployment Devnet

`scripts/deploy-devnet.sh` mem-build program, men-deploy-nya sebagai program upgradeable, lalu menjalankan `initialize_registry` dengan upgrade authority sebagai admin registry. Pembacaan status dan bootstrap registry dilakukan oleh `scripts/registry.ts`, yang memakai builder instruksi dan decoder dari `packages/solana`.

Skrip ini aman dijalankan ulang:

- Bytecode yang sama dengan hasil build lokal tidak di-deploy ulang. Perbandingannya dilakukan byte demi byte pada commitment `finalized`.
- Build yang berbeda di-upgrade. Akun program diperluas otomatis bila build baru lebih besar.
- Registry yang sudah diinisialisasi tidak disentuh.
- Genesis hash RPC harus sama dengan genesis Devnet, sehingga salah endpoint tidak menghasilkan deployment di jaringan lain.
- Keypair yang berada di dalam repositori tetapi tidak di-ignore git ditolak.

Sebelum mengirim transaksi, skrip menampilkan rencana (deploy pertama, upgrade, atau tidak ada perubahan), saldo, dan perkiraan biaya, lalu meminta konfirmasi.

## Keputusan sebelum deploy

| Keputusan | Catatan |
| --- | --- |
| Siapa memegang upgrade authority | Program hanya menerima `initialize_registry` dari upgrade authority saat itu, dan wallet tersebut menjadi **admin registry permanen**. MVP tidak memiliki instruksi untuk mengganti admin. Upgrade authority dapat dipindahkan belakangan, tetapi admin registry tetap. |
| Di mana kunci admin disimpan | Lihat [kunci admin registry](#kunci-admin-registry) di bawah. |
| Keypair program | Menentukan alamat program secara permanen dan hanya dibutuhkan untuk deploy pertama. Upgrade berikutnya cukup memakai `--program-id`. Simpan di luar repositori, misalnya `~/.config/solana/solvcred-devnet-program.json`. Skrip membuat file ini jika belum ada. |
| Endpoint RPC | RPC publik Devnet dibatasi rate limit. URL penyedia RPC sering memuat API key, jadi jangan commit URL tersebut. Skrip tidak mencatat URL di `deployments/devnet.json`. |
| Dana | Deploy pertama menahan sekitar **2,53 SOL** sebagai rent program. Selama deploy dibutuhkan sekitar 2,53 SOL tambahan untuk akun buffer, yang dikembalikan setelah deploy selesai. Siapkan minimal **5,1 SOL** Devnet dari [faucet.solana.com](https://faucet.solana.com). |

## Kunci admin registry

**Keputusan:** satu akun admin khusus SolVcred yang dibuat dari seed phrase baru. Akun ini menjadi fee payer deploy, upgrade authority, dan admin registry. Akun yang sama dipakai di wallet browser (untuk Admin UI) dan di CLI (untuk skrip deploy).

Alasannya:

- **Admin registry permanen.** Jika kuncinya hilang, penerbit tidak dapat lagi didaftarkan, dinonaktifkan, atau dipulihkan. Satu-satunya jalan keluar adalah program baru dengan program ID baru, sehingga semua proof yang sudah diterbitkan tidak lagi cocok dengan konfigurasi aplikasi. Karena itu, cadangan kunci adalah hal terpenting.
- **Satu rahasia untuk dicadangkan.** Seed phrase memulihkan akun di wallet browser maupun keypair CLI. Tidak ada private key yang perlu disalin atau dikonversi antarformat.
- **Alamat yang sama di dua tempat.** Admin UI dan skrip deploy memakai akun yang sama, sesuai aturan program bahwa admin registry harus upgrade authority saat bootstrap.
- **Khusus SolVcred, bukan wallet pribadi.** Alamat Solana berlaku di semua cluster, dan keypair CLI tersimpan tanpa enkripsi di disk. Jangan simpan aset mainnet di akun ini.

Pemisahan upgrade authority dari admin registry, multisig, atau hardware wallet belum diperlukan untuk demo Devnet. Upgrade authority tetap dapat dipindahkan nanti dengan `solana program set-upgrade-authority`.

Jika kunci ini bocor, pemegangnya dapat mendaftarkan penerbit palsu yang tampil tepercaya, menonaktifkan penerbit, merebut authority penerbit lewat `recover_authority`, dan mengganti logika program. Di Devnet dampaknya terbatas pada demo, tetapi kunci tetap harus diperlakukan sebagai rahasia.

Langkah pembuatan:

1. Di wallet browser (Phantom, Solflare, atau Backpack), buat **wallet baru** dengan seed phrase baru, misalnya bernama "SolVcred Devnet Admin". Tulis seed phrase di kertas dan simpan di luar komputer. Aktifkan jaringan Devnet di pengaturan wallet.
2. Turunkan keypair CLI dari seed phrase yang sama:

   ```sh
   solana-keygen recover 'prompt://?key=0/0' --outfile ~/.config/solana/solvcred-devnet-admin.json
   ```

   CLI menampilkan `Recovered pubkey` sebelum menulis file. Lanjutkan hanya jika alamatnya **sama** dengan alamat akun di wallet. Kosongkan passphrase (tekan Enter), karena wallet browser tidak memakainya. `prompt://?key=0/0` adalah jalur m/44'/501'/0'/0', yaitu akun pertama di wallet-wallet tersebut. Jika alamatnya berbeda, jawab `n`, lalu coba `prompt://?key=0`.
3. Pastikan file itu hanya dapat dibaca pemiliknya: `chmod 600 ~/.config/solana/solvcred-devnet-admin.json`.
4. Isi saldo alamat tersebut minimal 5,1 SOL Devnet dari [faucet.solana.com](https://faucet.solana.com).

## Prasyarat

Linux atau WSL2 dengan versi yang sama seperti CI:

```sh
rustup toolchain install 1.89.0
sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.13/install)"   # Solana CLI (Agave) 2.3.13
# Alternatif: arsip solana-release-x86_64-unknown-linux-gnu.tar.bz2 di github.com/anza-xyz/agave/releases/tag/v2.3.13
mkdir -p ~/.local/bin   # pastikan ada di PATH
curl -sSfL -o ~/.local/bin/anchor \
  https://github.com/solana-foundation/anchor/releases/download/v0.32.1/anchor-0.32.1-x86_64-unknown-linux-gnu
chmod +x ~/.local/bin/anchor
npm ci --ignore-scripts
```

Skrip berhenti jika versi Solana CLI bukan 2.3.x atau Anchor CLI bukan 0.32.1.

## Gladi di validator lokal (disarankan)

Gladi memakai alur yang sama persis, termasuk konfirmasi, tanpa menyentuh Devnet:

```sh
solana-test-validator --reset            # terminal terpisah
solana-keygen new -o /tmp/solvcred-admin.json --no-bip39-passphrase
solana airdrop 10 "$(solana-keygen pubkey /tmp/solvcred-admin.json)" --url localhost
scripts/deploy-devnet.sh --cluster localnet --authority /tmp/solvcred-admin.json
git checkout programs/solvcred/src/lib.rs Anchor.toml   # kembalikan placeholder setelah gladi
```

Mode `localnet` hanya menerima URL `localhost`/`127.0.0.1`, dan secara default memakai `target/deploy/solvcred-keypair.json` sebagai keypair program. Catatannya ditulis ke `deployments/localnet.json`, yang di-ignore git.

## Deploy ke Devnet

```sh
# Kunci admin dibuat dan diisi saldo sesuai bagian "Kunci admin registry"
scripts/deploy-devnet.sh \
  --program-keypair ~/.config/solana/solvcred-devnet-program.json \
  --authority ~/.config/solana/solvcred-devnet-admin.json
```

Urutan kerja skrip:

1. Memeriksa versi alat, lokasi keypair, dan genesis hash RPC.
2. Menulis program ID ke `declare_id!` (`programs/solvcred/src/lib.rs`) dan `[programs.devnet]` (`Anchor.toml`), lalu `anchor build`. Alamat di IDL dicocokkan dengan program ID.
3. Membaca status on-chain dan saldo, menampilkan rencana, lalu meminta konfirmasi.
4. `solana program deploy` dengan keypair authority sebagai fee payer dan upgrade authority.
5. Menunggu sampai bytecode `finalized` identik dengan build lokal.
6. `initialize_registry` (kecuali `--skip-registry`), lalu menunggu `finalized` dan membaca ulang admin registry.
7. Menulis `deployments/devnet.json` dan menampilkan konfigurasi UI.

Flag tambahan untuk `solana program deploy` diberikan setelah `--`. Contohnya, saat Devnet padat:

```sh
scripts/deploy-devnet.sh --program-keypair … --authority … -- --use-rpc --with-compute-unit-price 10000 --max-sign-attempts 50
```

## Setelah deploy

1. Commit `programs/solvcred/src/lib.rs`, `Anchor.toml`, dan `deployments/devnet.json` supaya source menyebut program yang ter-deploy. Job CI `anchor` tetap memakai keypair sementara lewat `anchor keys sync`.
2. Isi konfigurasi UI dengan nilai yang ditampilkan skrip, di `apps/web/.env.local` (atau pakai `--write-env`) atau di environment hosting: `VITE_SOLVCRED_PROGRAM_ID`, `VITE_SOLVCRED_RPC_URL`, dan `VITE_SOLVCRED_GENESIS_HASH`. Nilai ini ikut masuk bundle statis, jadi gunakan endpoint RPC yang boleh publik.
3. Lengkapi tabel pemegang hak upgrade di bawah.
4. Daftarkan penerbit pertama dari **Admin → Daftarkan penerbit**, lalu jalankan uji end-to-end Devnet (roadmap butir 2): publikasi, respons terputus, pencabutan, dan rotasi dua tanda tangan dengan wallet sungguhan.

Status dapat diperiksa kapan saja:

```sh
npm run registry -- status --url https://api.devnet.solana.com --program-id <PROGRAM_ID>
```

## Pemegang hak upgrade

Alamat diisi setelah deploy pertama dari `deployments/devnet.json`.

| Peran | Alamat | Pemegang dan penyimpanan kunci |
| --- | --- | --- |
| Upgrade authority | _belum di-deploy_ | Pemilik proyek. Akun admin SolVcred: seed phrase di kertas offline, keypair CLI `~/.config/solana/solvcred-devnet-admin.json` |
| Admin registry | _belum di-deploy_ | Sama dengan upgrade authority (akun yang sama) |

Selama program masih upgradeable, pemegang upgrade authority dapat mengganti logika program. Artinya, jaminan immutability batch bergantung pada kunci ini (lihat [model ancaman](threat-model.md)). Membuat program permanen (`solana program set-upgrade-authority --final`) tidak dapat dibatalkan, jadi tidak direncanakan untuk MVP.

## Upgrade

Jalankan skrip lagi setelah perubahan program. Keypair program tidak diperlukan:

```sh
scripts/deploy-devnet.sh --program-id <PROGRAM_ID> --authority ~/.config/solana/solvcred-devnet-admin.json
```

Perubahan pada instruksi, layout akun, atau kode error juga harus diterapkan di `packages/solana` dan `docs/program-interface.md`. Job CI `anchor` memeriksa kesesuaian IDL dengan klien.

## Jika deploy terhenti di tengah jalan

Jalankan skrip lagi. Sebelum memutuskan deploy, upgrade, atau tidak ada perubahan, skrip selalu membaca status `finalized`. Deploy yang gagal dapat meninggalkan akun buffer yang menahan SOL. Periksa dan tutup buffer tersebut untuk mengembalikan dananya:

```sh
solana program show --buffers --url devnet --keypair ~/.config/solana/solvcred-devnet-admin.json
solana program close --buffers --url devnet --keypair ~/.config/solana/solvcred-devnet-admin.json
```

Jika `initialize_registry` terputus, jalankan `npm run registry -- init --url … --program-id … --keypair …`. Perintah itu tidak mengirim ulang bila registry sudah ada.
