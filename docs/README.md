# Dokumentasi SolVcred

> Pusat navigasi seluruh dokumentasi SolVcred: sistem penerbitan dan verifikasi kredensial digital berbasis Merkle root di
> Solana Devnet. Mulailah dari jalur baca sesuai peran Anda, atau langsung ke peta dokumen.

| | |
| --- | --- |
| **Status** | MVP selesai ditulis dan lulus CI (TypeScript, Rust, build SBF, 22 test on-chain di localnet). Belum di-deploy ke Devnet |
| **Jaringan** | Solana Devnet saja, dengan data simulasi |
| **Stack** | Rust + Anchor 0.32.1 · TypeScript 5.9 · React 19 + Vite 8 · `@solana/web3.js` 1.99 |
| **Bahasa dokumen** | Bahasa Indonesia. Identifier kode, perintah, dan nama field tetap dalam bentuk aslinya |

## Jalur baca per peran

| Anda adalah… | Baca berurutan |
| --- | --- |
| **Pendatang baru** | [README repo](../README.md) → [System design §1](system-design.md#1-ringkasan) → [Arsitektur](architecture.md) → [Glosarium](glossary.md) |
| **Product / pemangku kepentingan** | [PRD](PRD.md) → [Keterlacakan kebutuhan](requirements-traceability.md) → [System design §16](system-design.md#16-keterbatasan-dan-pertanyaan-terbuka) → [Roadmap](roadmap.md) |
| **Engineer baru** | [Panduan pengembangan](development.md) → [Arsitektur](architecture.md) → [System design](system-design.md) → [Referensi API](api-reference.md) |
| **Engineer program on-chain** | [Antarmuka program](program-interface.md) → [Format proof v1](proof-format-v1.md) → [Keputusan arsitektur](decisions.md) |
| **Reviewer keamanan** | [Model ancaman](threat-model.md) → [System design §9–11](system-design.md#9-konsistensi-keandalan-dan-mode-kegagalan) → [Antarmuka program](program-interface.md#aturan-otorisasi-dan-validasi) |
| **Operator deployment** | [Deployment Devnet](deploy-devnet.md) → [Operasi dan runbook](deployment.md) → [Validasi](validation.md) |
| **Admin, penerbit, atau verifikator** | [Panduan pengguna](user-guide.md) |

## Peta dokumen

### Produk dan kebutuhan

| Dokumen | Isi |
| --- | --- |
| [PRD.md](PRD.md) | Kebutuhan produk asli: masalah, pengguna, alur, FR-01–FR-11, status UI, roadmap. **Dipertahankan tanpa perubahan** |
| [requirements-traceability.md](requirements-traceability.md) | Setiap FR, kriteria keberhasilan, dan syarat DoD dipetakan ke kode, test, dan status bukti |
| [roadmap.md](roadmap.md) | Kemajuan per kelompok kerja, sisa pekerjaan menuju MVP, dan keputusan yang dicatat |

### Desain dan arsitektur

| Dokumen | Isi |
| --- | --- |
| [system-design.md](system-design.md) | Tujuan desain, kebutuhan non-fungsional, kapasitas dan biaya rent, desain komponen, alur, mode kegagalan, skalabilitas, trade-off |
| [architecture.md](architecture.md) | Diagram C4 (konteks, kontainer, komponen), batas kepercayaan, relasi akun, sequence, state machine, deployment |
| [decisions.md](decisions.md) | Architecture Decision Records (ADR): alasan, alternatif, dan konsekuensi setiap keputusan besar |

### Spesifikasi dan kontrak

| Dokumen | Isi | Sumber kebenaran untuk |
| --- | --- | --- |
| [program-interface.md](program-interface.md) | PDA, layout akun, instruksi, aturan otorisasi, kode error | Kontrak biner program ↔ Rust ↔ klien |
| [proof-format-v1.md](proof-format-v1.md) | Field proof JSON, encoding leaf 179 byte, aturan Merkle, batas operasional | Format proof dan hashing |
| [api-reference.md](api-reference.md) | API publik `packages/core` dan `packages/solana`, tipe hasil, dan kode galat | Pemakaian library dari kode |

### Keamanan dan kualitas

| Dokumen | Isi |
| --- | --- |
| [threat-model.md](threat-model.md) | Aset, batas kepercayaan, ancaman dan mitigasi, gerbang sebelum Devnet |
| [validation.md](validation.md) | Hasil CI dan pemeriksaan lokal, apa yang sudah dan belum diuji |

### Operasi dan penggunaan

| Dokumen | Isi |
| --- | --- |
| [development.md](development.md) | Setup toolchain, struktur repo, perintah, strategi test, CI, cara mengubah kontrak dengan aman |
| [deploy-devnet.md](deploy-devnet.md) | Skrip `scripts/deploy-devnet.sh` dan CLI `npm run registry`: keputusan kunci admin, biaya, gladi localnet, deploy, upgrade |
| [deployment.md](deployment.md) | Operasi setelah deploy: konfigurasi dan hosting web, onboarding penerbit, uji penerimaan, runbook insiden R1–R7 |
| [user-guide.md](user-guide.md) | Panduan UI untuk verifikator, penerbit, dan admin registry |
| [glossary.md](glossary.md) | Istilah domain, kriptografi, dan Solana yang dipakai di seluruh dokumen |

## Diagram interaktif

Diagram di bawah dibuat dengan Archify: HTML mandiri dengan pan/zoom, pencarian, fokus relasi, tema terang/gelap, dan ekspor
PNG/SVG. **GitHub tidak merender HTML ini.** Buka file-nya secara lokal di browser (misalnya `xdg-open docs/diagrams/<nama>.html`
atau klik dua kali). Setiap HTML punya sumber `.json` di sebelahnya untuk dibuat ulang. Isi diagram berbahasa Indonesia; tombol
UI viewer tetap berbahasa Inggris karena viewer hanya mendukung `en` dan `zh-CN`.

| Diagram | Jenis | Menjawab pertanyaan |
| --- | --- | --- |
| [system-architecture.html](diagrams/system-architecture.html) | Arsitektur | Komponen apa saja, di mana batas kepercayaannya, dan apa yang melewati batas itu? |
| [publish-batch.html](diagrams/publish-batch.html) | Sequence | Bagaimana satu batch diterbitkan, dan apa yang terjadi jika respons transaksi terputus (FR-10)? |
| [proof-dataflow.html](diagrams/proof-dataflow.html) | Data flow | Data apa yang tetap lokal, apa yang masuk ke rantai, dan bagaimana PDF menjadi Merkle root? |
| [verify-credential.html](diagrams/verify-credential.html) | Workflow | Bagaimana PDF + proof menghasilkan salah satu dari tujuh status verifikasi? |
| [credential-lifecycle.html](diagrams/credential-lifecycle.html) | Lifecycle | State apa yang dilalui sebuah kredensial dari draft sampai dicabut? |

Membuat ulang diagram setelah mengubah sumber JSON (butuh skill Archify terpasang):

```bash
node ~/.claude/skills/archify/bin/archify.mjs deliver sequence docs/diagrams/publish-batch.sequence.json docs/diagrams/publish-batch.html --quality showcase --json
```

## Konvensi dokumentasi

- **Satu fakta, satu rumah.** Layout biner hanya di `program-interface.md`, encoding hanya di `proof-format-v1.md`, kebutuhan hanya di `PRD.md`. Dokumen lain merangkum dan menautkan.
- **Klaim status selalu membawa bukti:** nomor run CI, commit, atau perintah yang bisa diulang. Kata "lulus" tanpa bukti tidak dipakai.
- **Mermaid untuk GitHub, Archify untuk eksplorasi.** Diagram penting tersedia dalam keduanya.
- **Perubahan kontrak** (layout, instruksi, error, encoding) wajib memperbarui dokumen spesifikasi pada commit yang sama. Lihat [development.md §6](development.md#6-mengubah-kontrak-dengan-aman).
