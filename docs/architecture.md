# Arsitektur dan diagram SolVcred

Diagram berikut membedakan komponen yang sudah diimplementasikan dan integrasi yang masih direncanakan. GitHub dapat merender blok Mermaid langsung.

## 1. Batas kepercayaan

```mermaid
flowchart LR
  Admin[Admin registry] --> Vet[Pemeriksaan institusi di luar aplikasi]
  Vet --> Registry[Registry issuer - direncanakan]
  Issuer[Penerbit dan wallet] --> Browser[Frontend lokal - direncanakan]
  PDF[PDF final] --> Core[Core TypeScript - tersedia]
  Browser --> Core
  Core --> Draft[Root dan proof draft]
  Draft --> Backup[Cadangan institusi]
  Draft --> Tx[Transaksi bertanda tangan - direncanakan]
  Tx --> Program[Program Anchor - direncanakan]
  Registry --> Program
  Program --> Chain[(Solana Devnet)]
  Backup --> Holder[Penerima: PDF dan proof]
  Holder --> Verifier[Browser verifikator - direncanakan]
  Verifier --> Core
  Verifier --> RPC[RPC tetap dari konfigurasi - direncanakan]
  RPC --> Chain
```

Dokumen, nama file, nonce, dan proof lengkap tidak dikirim ke RPC. Publikasi hanya mengirim commitment; pencabutan nantinya mengirim leaf hash dan jalur Merkle yang diperlukan program, bukan PDF atau nonce. Metadata pencabutan tetap dapat dikorelasikan. Registry admin dan upgrade authority adalah batas kepercayaan eksplisit.

## 2. Penerbitan dan pemulihan

```mermaid
sequenceDiagram
  actor I as Penerbit
  participant B as Browser
  participant C as Core lokal
  participant W as Wallet
  participant S as Solana (direncanakan)
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

Status `draft` dari core selalu berarti belum diterbitkan. Hanya integrasi transaksi yang telah memeriksa hasil finalized dapat menyebut paket sebagai final. Salinan draft harus disimpan utuh; root saja tidak dapat memulihkan proof.

## 3. Verifikasi

```mermaid
flowchart TD
  Files[PDF dan proof JSON] --> Parse[Validasi ukuran, versi, dan struktur]
  Parse --> Config[Cocokkan jaringan dan program dengan konfigurasi]
  Config --> Fetch[Baca batch, issuer, dan pencabutan secara finalized]
  Fetch -->|RPC gagal| Unknown[Belum dapat diverifikasi]
  Fetch -->|Batch tidak ada| Missing[Batch tidak ditemukan]
  Fetch -->|Data akun tervalidasi| Hash[Hitung leaf dan cek root tepercaya]
  Hash -->|Tidak cocok| Invalid[Bukti tidak cocok]
  Hash -->|Cocok| Revoke{Dicabut?}
  Revoke -->|Ya| Revoked[Dicabut]
  Revoke -->|Tidak| Trust{Issuer dipercaya dan aktif?}
  Trust -->|Tidak terdaftar| Untrusted[Penerbit belum dipercaya]
  Trust -->|Nonaktif| Inactive[Penerbit nonaktif]
  Trust -->|Ya| Verified[Terverifikasi pada waktu pemeriksaan]
```

Core saat ini hanya menjalankan validasi dan pemeriksaan integritas dengan commitment yang diberikan pemanggil. `integrity-match` bukan status `Terverifikasi`. Mengambil expected root dari file proof itu sendiri hanya membuktikan konsistensi internal.

Adapter RPC mendatang wajib memvalidasi program owner, discriminator, PDA dan hubungan akun. Baca seluruh akun terkait dalam satu respons snapshot jika memungkinkan. Jangan mengartikan timeout sebagai akun pencabutan tidak ada.

## 4. Relasi akun yang direncanakan

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
    string name
    string domain
  }
  BATCH {
    bytes32 batch_id
    pubkey issuer_account
    bytes32 root
    u32 leaf_count
    pubkey issuing_authority
    u32 key_version
    u64 recorded_slot
  }
  REVOCATION {
    pubkey batch_account
    bytes32 leaf_hash
    u8 reason_code
    u64 recorded_slot
  }
```

PDA rencana: registry `["registry"]`, issuer `["issuer", issuer_id]`, batch `["batch", issuer_pubkey, batch_id]`, revocation `["revoked", batch_pubkey, leaf_hash]`. Ukuran dan constraint Anchor belum diimplementasikan. Penonaktifan melarang publikasi baru; pencabutan tetap dapat dilakukan oleh authority issuer yang berlaku. Rotasi normal memerlukan kunci lama dan baru; pemulihan administratif merupakan kewenangan terpisah.

## 5. Status kredensial dan kunci

```mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Published: commitment finalized
  Published --> Revoked: authority yang sah mencabut
  Revoked --> [*]
```

Pencabutan tidak dapat dibatalkan. Koreksi menerbitkan kredensial baru. Status issuer dan versi kunci merupakan sumbu terpisah: mengganti kunci tidak mengubah batch lama atau otomatis mencabut kredensialnya.
