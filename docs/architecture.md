# Arsitektur dan diagram SolVcred

Diagram berikut menggambarkan komponen yang sudah ditulis. Program Anchor dan uji on-chain baru diverifikasi setelah CI Linux berjalan; lihat `docs/validation.md`. GitHub dapat merender blok Mermaid langsung.

## 1. Batas kepercayaan

```mermaid
flowchart LR
  Admin[Admin registry] --> Vet[Pemeriksaan institusi di luar aplikasi]
  Vet --> Registry[Registry issuer - programs/solvcred]
  Issuer[Penerbit dan wallet] --> Browser[Frontend lokal - apps/web]
  PDF[PDF final] --> Core[Core TypeScript - packages/core]
  Browser --> Core
  Core --> Draft[Root dan proof draft]
  Draft --> Backup[Cadangan institusi]
  Draft --> Tx[Transaksi bertanda tangan wallet]
  Tx --> Program[Program Anchor]
  Registry --> Program
  Program --> Chain[(Solana Devnet)]
  Backup --> Holder[Penerima: PDF dan proof]
  Holder --> Verifier[Browser verifikator - apps/web]
  Verifier --> Core
  Verifier --> RPC[Adapter RPC packages/solana, endpoint dari konfigurasi]
  RPC --> Chain
```

Dokumen, nama file, nonce, dan proof lengkap tidak dikirim ke RPC. Publikasi hanya mengirim commitment. Pencabutan mengirim leaf hash, indeks, dan jalur Merkle yang diperlukan program, bukan PDF atau nonce. Pembacaan status hanya mengirim alamat akun, tetapi alamat PDA revocation tetap memberi tahu RPC kredensial mana yang sedang diperiksa. Metadata pencabutan tetap dapat dikorelasikan. Registry admin dan upgrade authority adalah batas kepercayaan eksplisit.

## 2. Penerbitan dan pemulihan

```mermaid
sequenceDiagram
  actor I as Penerbit
  participant B as Browser
  participant C as Core lokal
  participant W as Wallet
  participant S as Solana
  I->>B: Pilih PDF final
  B->>C: Validasi, salin byte, buat nonce dan tree
  C-->>B: Draft commitment dan proof
  B-->>I: Unduh cadangan sebelum transaksi
  I->>W: Setujui publikasi
  W->>S: Publish batch
  alt Hasil finalized
    S-->>B: Batch sesuai commitment
    B-->>I: Ekspor paket final
  else Respons terputus
    B->>S: Periksa PDA batch yang sama
    S-->>B: Ada dan cocok / belum ada / konflik
    Note over B,S: Jangan membuat batch ID atau nonce baru saat retry
  end
```

Status `draft` dari core selalu berarti belum diterbitkan. UI hanya menyediakan paket final setelah transaksi dikonfirmasi `finalized`, atau setelah `checkPublishedBatch` menemukan batch dengan root dan jumlah leaf yang sama. UI mewajibkan unduhan cadangan draft sebelum tombol publikasi aktif, dan cadangan itu dapat dimuat ulang untuk melanjutkan publikasi yang hasilnya belum jelas. Root saja tidak dapat memulihkan proof.

## 3. Verifikasi

```mermaid
flowchart TD
  Files[PDF dan proof JSON] --> Parse[Validasi ukuran, versi, dan struktur]
  Parse -->|Versi/jaringan tidak didukung| Unknown[Belum dapat diverifikasi]
  Parse -->|Format rusak| Invalid[Bukti tidak cocok]
  Parse --> Config[Cocokkan jaringan dan program dengan konfigurasi]
  Config -->|Berbeda| Unknown
  Config --> Genesis[Genesis hash RPC sesuai konfigurasi?]
  Genesis -->|Tidak / RPC gagal| Unknown
  Genesis --> Fetch[Satu snapshot finalized: program, issuer, batch, revocation]
  Fetch -->|RPC gagal, program tidak ada, akun tidak valid| Unknown
  Fetch -->|Issuer tidak ada| Untrusted[Penerbit belum dipercaya]
  Fetch -->|Batch tidak ada| Missing[Batch tidak ditemukan]
  Fetch -->|Data akun tervalidasi| Hash[Hitung leaf dan cek root on-chain]
  Hash -->|Tidak cocok| Invalid
  Hash -->|Cocok| Revoke{Dicabut?}
  Revoke -->|Ya| Revoked[Dicabut]
  Revoke -->|Tidak| Trust{Issuer aktif?}
  Trust -->|Nonaktif| Inactive[Penerbit nonaktif]
  Trust -->|Ya| Verified[Terverifikasi pada waktu pemeriksaan]
```

Core hanya menjalankan validasi dan pemeriksaan integritas dengan commitment yang diberikan pemanggil. `integrity-match` bukan status `Terverifikasi`. Adapter `verifyCredential` membangun commitment tepercaya hanya dari konfigurasi dan akun on-chain, tidak pernah dari file proof.

Adapter memvalidasi status program (executable, owner BPF Upgradeable Loader), owner setiap akun, ukuran tetap, discriminator, dan relasi antarakun: issuer ID, batch → issuer, dan revocation → batch serta leaf. Seluruh akun dibaca dalam satu `getMultipleAccounts` dengan commitment `finalized`, sehingga semuanya berasal dari slot yang sama. Timeout tidak pernah diartikan sebagai akun pencabutan tidak ada.

## 4. Relasi akun

```mermaid
erDiagram
  REGISTRY ||--o{ ISSUER : approves
  ISSUER ||--o{ BATCH : publishes
  BATCH ||--o{ REVOCATION : contains
  REGISTRY {
    pubkey admin
    u8 version
  }
  ISSUER {
    bytes32 issuer_id
    pubkey authority
    u32 key_version
    bool active
    u64 registered_slot
    string name
    string domain
  }
  BATCH {
    pubkey issuer
    bytes32 batch_id
    bytes32 root
    u32 leaf_count
    u8 schema_version
    pubkey issuing_authority
    u32 key_version
    u64 recorded_slot
    i64 recorded_at
  }
  REVOCATION {
    pubkey batch
    bytes32 leaf_hash
    u32 leaf_index
    u8 reason_code
    pubkey revoking_authority
    u32 key_version
    u64 recorded_slot
    i64 recorded_at
  }
```

PDA: registry `["registry"]`, issuer `["issuer", issuer_id]`, batch `["batch", issuer_account, batch_id]`, revocation `["revoked", batch_account, leaf_hash]`. Ukuran, discriminator, urutan akun, dan kode error ada di [program-interface.md](program-interface.md).

`initialize_registry` hanya dapat dipanggil oleh upgrade authority program saat itu. Penonaktifan melarang publikasi baru; pencabutan tetap dapat dilakukan oleh authority issuer yang berlaku. Rotasi normal memerlukan tanda tangan kunci lama dan baru. Pemulihan oleh admin adalah kewenangan terpisah yang juga memerlukan tanda tangan kunci baru.

## 5. Status kredensial dan kunci

```mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Published: commitment finalized
  Published --> Revoked: authority yang sah mencabut
  Revoked --> [*]
```

Pencabutan tidak dapat dibatalkan. Koreksi menerbitkan kredensial baru. Status issuer dan versi kunci merupakan sumbu terpisah: mengganti kunci tidak mengubah batch lama atau otomatis mencabut kredensialnya.
