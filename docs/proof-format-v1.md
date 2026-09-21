# Format proof v1

Status: implementasi core lokal; belum ada deployment SolVcred. Nama repository kanonis `BangkitTheGreat/solvcred`. PRD asli disimpan tanpa perubahan di `PRD.md`, termasuk nama repo lamanya.

## Representasi JSON

Field wajib, tanpa field tambahan:

| Field | Encoding |
| --- | --- |
| schemaVersion | Integer `1` |
| network | String `solana-devnet` (tag biner `0x01`) |
| programId | Public key base58 kanonis, decode tepat 32 byte |
| issuerId | ID stabil 32 byte, 64 karakter lowercase hex |
| batchId | ID batch acak 32 byte, lowercase hex |
| leafCount | Integer 1–100 |
| leafIndex | Integer 0–leafCount-1 |
| nonce | Acak kriptografis 32 byte, lowercase hex |
| root | SHA-256 Merkle root, lowercase hex |
| siblings | Array hash 32 byte dari level daun ke root |

Proof tidak memuat nama, NIM, nama file, URL atau endpoint RPC. Urutan field dan whitespace JSON tidak memengaruhi hash karena yang di-hash adalah encoding biner berikut, bukan teks JSON. Parser JSON mengikuti semantik `JSON.parse`; konsumennya wajib memakai hasil validasi yang dikembalikan core, bukan menginterpretasikan ulang input dengan aturan berbeda.

## Encoding hash

`documentHash = SHA256(exact PDF bytes)`

```
leaf = SHA256(
  0x00                       // prefix leaf: 1 byte
  || UTF8("SolVcred")         // 8 byte ASCII, tanpa terminator
  || 0x01                    // versi: 1 byte
  || 0x01                    // network Devnet: 1 byte
  || decodeBase58(programId)  // 32 byte
  || decodeHex(issuerId)      // 32 byte
  || decodeHex(batchId)       // 32 byte
  || u32le(leafCount)         // 4 byte
  || u32le(leafIndex)         // 4 byte
  || decodeHex(nonce)         // 32 byte
  || documentHash            // 32 byte
)

parent = SHA256(0x01 || leftChild32 || rightChild32)
```

Leaf preimage tepat 179 byte. Posisi sibling berasal dari bit indeks pada setiap level: indeks genap berarti sibling kanan, ganjil berarti sibling kiri. Pasangan hash tidak diurutkan alfabetis.

Jika jumlah node ganjil, node terakhir diduplikasi pada level tersebut; proof wajib menyertakan hash duplikat itu. Verifier memeriksa duplikasi, bukan hanya root akhir. Satu leaf memiliki root sama dengan leaf dan path kosong. Panjang path harus tepat `ceil(log2(leafCount))`.

Program ID, network, issuer ID, batch ID, jumlah, dan indeks diikat ke leaf untuk membatasi penggunaan proof pada konteks berbeda. Integrasi on-chain tetap wajib memvalidasi konteks tersebut; hashing tidak menggantikan otorisasi.

## Batas operasional MVP

- Maksimum 100 PDF, 10 MiB per PDF, dan 100 MiB total.
- Maksimum proof JSON 16 KiB UTF-8, path maksimum 7 hash.
- Header `%PDF-` wajib; ini pemeriksaan format awal, bukan parser PDF atau pemindai malware. PDF tidak dirender atau dieksekusi.
- PDF identik di satu batch ditolak untuk mencegah penerbitan ganda yang tidak disengaja. PDF yang sama dapat diterbitkan ulang dalam batch lain.
- `prepareBatch` membuat nonce dengan Web Crypto, bukan nilai dari pengguna.
- `randomId()` menyediakan ID batch/issuer 32 byte; authority issuer harus terpisah dari ID stabilnya.
- Dokumen disalin sebelum operasi async agar perubahan input selama hashing tidak menghasilkan batch campuran.
- Verifikasi hanya mengembalikan hasil integritas. Status issuer dan pencabutan membutuhkan adapter Solana yang belum tersedia.

## Pemulihan dan perubahan versi

Simpan draft commitment, proof, dan PDF final sebelum mengirim transaksi. Retry memakai batch ID, nonce dan root yang sama. Jangan regenerasi nonce untuk menyelesaikan publikasi yang hasilnya belum jelas.

Setiap perubahan encoding/hash/tag jaringan memerlukan versi baru. Menaikkan batas operasional perlu ditinjau terhadap batas transaksi dan komputasi program. Fixture statis `test-vectors/v1.json` dibuat implementasi Python independen; implementasi Rust mendatang harus menghasilkan byte/hash yang sama sebelum integrasi.

Referensi API: [Node Web Crypto](https://nodejs.org/api/webcrypto.html), [TypeScript strict](https://www.typescriptlang.org/tsconfig/strict.html).
