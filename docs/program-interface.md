# Antarmuka program `solvcred` v1

Kontrak biner antara program Anchor (`programs/solvcred`), crate Rust (`crates/solvcred-proof`), dan klien TypeScript (`packages/solana`). Semua perubahan di sini harus dilakukan serentak di ketiga tempat tersebut. Test program di `tests/program` membandingkan konstanta klien dengan IDL hasil `anchor build`.

- Anchor `0.32.1`, Solana CLI/Agave `2.3.x`.
- Program ID di source adalah **placeholder** `CZtvDiPBJ4voLQ9XchqAaXk9fzzghgsB62uSjwLMxASo`, diturunkan dari hash label, sehingga tidak ada yang memegang private key-nya. Jalankan `anchor keys sync` sebelum build atau deploy.
- Encoding: Borsh (little-endian). `String` = `u32` panjang byte + UTF-8. `Vec<T>` = `u32` jumlah + elemen.
- Discriminator: instruksi `sha256("global:<nama_snake>")[0..8]`, akun `sha256("account:<NamaStruct>")[0..8]`.

## PDA

| Akun | Seeds |
| --- | --- |
| Registry | `["registry"]` |
| Issuer | `["issuer", issuer_id(32)]` |
| Batch | `["batch", issuer_account(32), batch_id(32)]` |
| Revocation | `["revoked", batch_account(32), leaf_hash(32)]` |

Batch diturunkan dari **alamat akun issuer**, bukan authority, sehingga rotasi kunci tidak memindahkan batch lama.

## Akun

Semua akun dialokasikan dengan ukuran tetap `8 + INIT_SPACE`. Klien menolak data yang panjangnya berbeda, owner selain program ID, atau discriminator lain.

| Akun | Discriminator | Ukuran | Field berurutan |
| --- | --- | --- | --- |
| `Registry` | `[47,174,110,246,184,182,252,218]` | 42 | `admin: Pubkey`, `version: u8` (=1), `bump: u8` |
| `Issuer` | `[216,19,83,230,108,53,80,14]` | 254 | `issuer_id: [u8;32]`, `authority: Pubkey`, `key_version: u32`, `active: bool`, `registered_slot: u64`, `bump: u8`, `name: String` (maks 96 byte), `domain: String` (maks 64 byte) |
| `Batch` | `[156,194,70,44,22,88,137,44]` | 162 | `issuer: Pubkey`, `batch_id: [u8;32]`, `root: [u8;32]`, `leaf_count: u32`, `schema_version: u8`, `issuing_authority: Pubkey`, `key_version: u32`, `recorded_slot: u64`, `recorded_at: i64`, `bump: u8` |
| `Revocation` | `[128,117,129,229,11,159,79,234]` | 130 | `batch: Pubkey`, `leaf_hash: [u8;32]`, `leaf_index: u32`, `reason_code: u8`, `revoking_authority: Pubkey`, `key_version: u32`, `recorded_slot: u64`, `recorded_at: i64`, `bump: u8` |

Offset `authority` pada `Issuer` adalah byte 40. Offset ini dipakai filter `memcmp` untuk mencari issuer milik sebuah wallet.

`bool` hanya boleh bernilai `0` atau `1`. Panjang string ≤ batas, dan sisa ruang alokasi berisi nol.

## Instruksi

Urutan akun di tabel adalah urutan `AccountMeta`. Notasi: `w` = writable, `s` = signer.

| Instruksi | Discriminator | Argumen | Akun |
| --- | --- | --- | --- |
| `initialize_registry` | `[189,181,20,17,174,57,249,59]` | – | registry (w), admin (w,s), program, program_data, system_program |
| `register_issuer` | `[145,117,52,59,189,27,127,18]` | `issuer_id: [u8;32]`, `name: String`, `domain: String`, `authority: Pubkey` | registry, issuer (w), admin (w,s), system_program |
| `publish_batch` | `[54,109,78,161,111,240,97,38]` | `batch_id: [u8;32]`, `root: [u8;32]`, `leaf_count: u32`, `schema_version: u8` | issuer, batch (w), authority (w,s), system_program |
| `revoke_credential` | `[38,123,95,95,223,158,169,87]` | `leaf_hash: [u8;32]`, `leaf_index: u32`, `siblings: Vec<[u8;32]>`, `reason_code: u8` | issuer, batch, revocation (w), authority (w,s), system_program |
| `deactivate_issuer` | `[52,10,163,187,247,22,150,37]` | – | registry, issuer (w), admin (s) |
| `rotate_authority` | `[248,225,151,35,28,15,85,12]` | – | issuer (w), authority (s), new_authority (s) |
| `recover_authority` | `[63,8,20,46,33,134,155,245]` | – | registry, issuer (w), admin (s), new_authority (s) |

`program` adalah akun program `solvcred` itu sendiri. `program_data` adalah akun ProgramData milik BPF Upgradeable Loader.

### Aturan otorisasi dan validasi

- `initialize_registry`: `program.programdata_address == program_data` dan `program_data.upgrade_authority_address == Some(admin)`. Siapa pun selain upgrade authority saat itu ditolak, sehingga bootstrap bukan first-come-first-served. Akun registry dibuat dengan `init`, jadi inisialisasi kedua gagal.
- `register_issuer`: `registry.admin == admin`. Nama 1–96 byte tanpa karakter kontrol. Domain 1–64 byte dari `a-z 0-9 . -` yang tidak diawali atau diakhiri `.`/`-`. `authority` tidak boleh `Pubkey::default()`. Issuer dibuat dengan `active = true` dan `key_version = 1`. Issuer ID yang sudah ada gagal karena `init`.
- `publish_batch`: `issuer.authority == authority` dan `issuer.active`. `1 ≤ leaf_count ≤ 100`, `schema_version == 1`, root bukan 32 byte nol. Batch dibuat dengan `init`, sehingga root tidak bisa ditimpa. Tidak ada instruksi yang mengubah atau menutup batch. Batch mencatat `issuing_authority`, `key_version`, slot, dan unix timestamp.
- `revoke_credential`: `issuer.authority == authority`, sedangkan issuer nonaktif **tetap diizinkan** (kebijakan PRD §8). `batch.issuer == issuer`, dan PDA batch diperiksa dengan seeds serta `batch.bump`. `1 ≤ reason_code ≤ 4`. Keanggotaan leaf diverifikasi dengan `solvcred_proof::verify_path(leaf_hash, leaf_index, batch.leaf_count, siblings, batch.root)`, termasuk panjang path yang tepat dan aturan duplikasi node ganjil. Revocation dibuat dengan `init`, sehingga pencabutan permanen dan tidak bisa diulang.
- `deactivate_issuer`: `registry.admin == admin` dan issuer masih aktif. Tidak ada instruksi reaktivasi di MVP.
- `rotate_authority`: `issuer.authority == authority`, `new_authority` ikut menandatangani, dan `new_authority != authority`. Menaikkan `key_version` dengan `checked_add`.
- `recover_authority`: `registry.admin == admin`, `new_authority` ikut menandatangani, dan `new_authority != issuer.authority`. Menaikkan `key_version`.

Semua akun issuer dan batch yang dirujuk diperiksa dengan seeds dan `bump` yang tersimpan.

### Kode alasan pencabutan

| Kode | Arti |
| --- | --- |
| 1 | Kesalahan data pada dokumen |
| 2 | Digantikan kredensial baru |
| 3 | Penerbitan tidak sah (misalnya kunci disalahgunakan) |
| 4 | Keputusan institusi lainnya |

### Kode error (`#[error_code]`, mulai 6000)

| Kode | Nama |
| --- | --- |
| 6000 | `UnauthorizedBootstrap` |
| 6001 | `InvalidProgramData` |
| 6002 | `NotRegistryAdmin` |
| 6003 | `NotIssuerAuthority` |
| 6004 | `IssuerInactive` |
| 6005 | `IssuerAlreadyInactive` |
| 6006 | `InvalidName` |
| 6007 | `InvalidDomain` |
| 6008 | `InvalidAuthority` |
| 6009 | `InvalidLeafCount` |
| 6010 | `UnsupportedSchemaVersion` |
| 6011 | `InvalidRoot` |
| 6012 | `InvalidReasonCode` |
| 6013 | `InvalidMerkleProof` |
| 6014 | `BatchIssuerMismatch` |
| 6015 | `SameAuthority` |
| 6016 | `KeyVersionOverflow` |

Error bawaan Anchor yang juga diuji: signer hilang (`3010 AccountNotSigner`), constraint seeds (`2006`), dan akun sudah ada (`init` gagal di System Program).

## Privasi transaksi

`publish_batch` hanya mengirim batch ID, root, dan jumlah leaf. `revoke_credential` mengirim leaf hash, indeks, dan sibling hash. PDF, nonce, nama file, dan identitas pemilik tidak pernah dikirim. Leaf hash dan path tetap dapat dikorelasikan oleh siapa pun yang memegang dokumen dan proof terkait.
