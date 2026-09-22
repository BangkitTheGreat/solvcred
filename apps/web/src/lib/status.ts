import type { ValidationError } from '../../../../packages/core/src/index.js';
import {
  REVOCATION_REASONS,
  type OverallStatus,
  type VerificationReport,
} from '../../../../packages/solana/src/index.js';
import type { IconName } from '../components/Icon.js';

export type Tone = 'positive' | 'negative' | 'caution' | 'neutral';

export interface StatusCopy {
  readonly label: string;
  readonly meaning: string;
  readonly tone: Tone;
  readonly icon: IconName;
}

/** PRD §10 labels. Only `verified` may ever be rendered with the positive tone. */
export const OVERALL_STATUS: Readonly<Record<OverallStatus, StatusCopy>> = {
  verified: {
    label: 'Terverifikasi',
    meaning: 'Integritas cocok, penerbit aktif dalam registry, dan tidak ditemukan pencabutan pada pemeriksaan yang berhasil ini.',
    tone: 'positive',
    icon: 'check',
  },
  revoked: {
    label: 'Dicabut',
    meaning: 'Penerbit telah mencatat pencabutan kredensial ini di jaringan. Jangan perlakukan dokumen ini sebagai kredensial yang berlaku.',
    tone: 'negative',
    icon: 'ban',
  },
  'proof-mismatch': {
    label: 'Bukti tidak cocok',
    meaning: 'Dokumen atau file bukti gagal validasi kriptografis. Isi dokumen ini tidak dapat dikaitkan dengan batch yang diterbitkan.',
    tone: 'negative',
    icon: 'x',
  },
  'issuer-untrusted': {
    label: 'Penerbit belum dipercaya',
    meaning: 'Penerbit yang dirujuk file bukti tidak ditemukan dalam registry yang didukung aplikasi ini.',
    tone: 'caution',
    icon: 'shield',
  },
  'issuer-inactive': {
    label: 'Penerbit nonaktif',
    meaning: 'Bukti cocok dan tidak ditemukan pencabutan, tetapi penerbit telah dinonaktifkan oleh admin registry. Status penerbit memerlukan perhatian.',
    tone: 'caution',
    icon: 'pause',
  },
  'batch-not-found': {
    label: 'Batch tidak ditemukan',
    meaning: 'Pembacaan jaringan berhasil, tetapi batch yang dirujuk file bukti tidak ada.',
    tone: 'caution',
    icon: 'search',
  },
  unverifiable: {
    label: 'Belum dapat diverifikasi',
    meaning: 'Pemeriksaan tidak dapat diselesaikan. Hasil ini tidak menyatakan dokumen sah maupun tidak sah.',
    tone: 'neutral',
    icon: 'question',
  },
};

export function reasonExplanation(reason: VerificationReport['reason'], timeoutMs: number): string | null {
  switch (reason) {
    case null:
      return null;
    case 'rpc-error':
      return 'RPC mengembalikan galat atau respons yang tidak dapat dipakai. Kegagalan RPC tidak pernah dianggap sebagai "tidak dicabut"; coba periksa ulang nanti.';
    case 'rpc-timeout':
      return `RPC tidak merespons dalam ${Math.round(timeoutMs / 1000)} detik. Kegagalan RPC tidak pernah dianggap sebagai "tidak dicabut"; coba periksa ulang nanti.`;
    case 'wrong-network':
      return 'Endpoint RPC yang dikonfigurasi melaporkan genesis hash selain Solana Devnet. Hasil dari jaringan lain tidak dipakai.';
    case 'unsupported-proof':
      return 'Versi file bukti, jaringan, atau versi skema batch tidak didukung aplikasi ini.';
    case 'program-mismatch':
      return 'File bukti merujuk program atau jaringan yang berbeda dari konfigurasi aplikasi. Aplikasi tidak pernah mengikuti alamat program atau RPC dari file bukti.';
    case 'program-not-deployed':
      return 'Program SolVcred tidak ditemukan pada program ID yang dikonfigurasi, sehingga registry tidak dapat dibaca.';
    case 'invalid-account':
      return 'Data akun on-chain tidak lolos validasi (pemilik akun, ukuran, discriminator, atau relasi issuer/batch/pencabutan). Data tersebut tidak dipakai.';
    case 'invalid-input':
      return 'File tidak dapat dibaca sebagai PDF dan proof v1 yang valid: format, ukuran, atau struktur JSON tidak sesuai.';
    case 'context':
      return 'File bukti merujuk penerbit, batch, jumlah dokumen, atau root yang berbeda dari data batch on-chain.';
    case 'merkle-path':
      return 'Hash PDF dan jalur Merkle di file bukti tidak menghasilkan root batch on-chain. PDF telah berubah (termasuk dipindai atau diekspor ulang) atau file bukti bukan pasangannya.';
  }
}

export interface SectionCopy {
  readonly state: string;
  readonly detail: string;
  readonly tone: Tone;
  readonly icon: IconName;
}

export function integrityCopy(report: VerificationReport, timeoutMs: number): SectionCopy {
  switch (report.integrity) {
    case 'match':
      return { state: 'Cocok', detail: 'Hash PDF dan jalur Merkle menghasilkan root batch yang tercatat on-chain.', tone: 'positive', icon: 'fileCheck' };
    case 'mismatch':
      return { state: 'Tidak cocok', detail: reasonExplanation(report.reason, timeoutMs) ?? 'Dokumen atau file bukti tidak cocok dengan batch on-chain.', tone: 'negative', icon: 'x' };
    case 'not-checked':
      return { state: 'Belum diperiksa', detail: 'Integritas hanya dinilai terhadap root on-chain. Pemeriksaan berhenti sebelum tahap ini.', tone: 'neutral', icon: 'question' };
  }
}

export function issuerCopy(report: VerificationReport): SectionCopy {
  switch (report.issuer.state) {
    case 'active':
      return { state: 'Aktif dalam registry', detail: 'Penerbit terdaftar oleh admin registry dan berstatus aktif pada slot pemeriksaan.', tone: 'positive', icon: 'shield' };
    case 'inactive':
      return { state: 'Nonaktif', detail: 'Penerbit terdaftar tetapi telah dinonaktifkan admin registry. Penonaktifan menghentikan penerbitan baru; kredensial lama tidak otomatis dicabut, jadi konfirmasikan statusnya kepada institusi.', tone: 'caution', icon: 'pause' };
    case 'not-found':
      return { state: 'Tidak terdaftar', detail: 'Issuer ID pada file bukti tidak ditemukan dalam registry program yang dikonfigurasi.', tone: 'caution', icon: 'shield' };
    case 'unknown':
      return { state: 'Tidak diketahui', detail: 'Status penerbit tidak dapat dibaca pada pemeriksaan ini.', tone: 'neutral', icon: 'question' };
  }
}

export function revocationCopy(report: VerificationReport): SectionCopy {
  switch (report.revocation.state) {
    case 'revoked':
      return { state: 'Dicabut', detail: 'Ditemukan catatan pencabutan permanen untuk kredensial ini.', tone: 'negative', icon: 'ban' };
    case 'not-revoked':
      return { state: 'Tidak ditemukan pencabutan', detail: 'Tidak ada catatan pencabutan pada snapshot jaringan yang dibaca.', tone: 'positive', icon: 'check' };
    case 'unknown':
      return { state: 'Tidak diketahui', detail: 'Status pencabutan tidak dapat dibaca. Jangan anggap kredensial ini belum dicabut.', tone: 'neutral', icon: 'question' };
  }
}

export function revocationReasonLabel(code: number): string {
  return REVOCATION_REASONS.find((reason) => reason.code === code)?.label ?? `Kode alasan ${code} tidak dikenal`;
}

/** Messages for `ValidationError.code` from packages/core; never include file content. */
export function validationMessage(code: ValidationError['code']): string {
  switch (code) {
    case 'INVALID_INPUT':
      return 'File tidak valid: pastikan setiap dokumen adalah PDF (diawali header %PDF-) dan file bukti adalah proof v1.';
    case 'UNSUPPORTED_VERSION':
      return 'Versi file bukti tidak didukung.';
    case 'UNSUPPORTED_NETWORK':
      return 'Jaringan pada file bukti tidak didukung; aplikasi ini hanya untuk Solana Devnet.';
    case 'LIMIT_EXCEEDED':
      return 'Melebihi batas: maksimal 100 PDF per batch, 10 MiB per PDF, 100 MiB total, dan file bukti 16 KiB.';
    case 'DUPLICATE_DOCUMENT':
      return 'Ada PDF identik dalam pilihan ini. Satu dokumen hanya boleh muncul sekali dalam satu batch.';
  }
}
