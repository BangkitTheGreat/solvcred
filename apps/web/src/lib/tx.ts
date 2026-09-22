import type { WalletContextState } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, type Connection, type SendOptions, type TransactionInstruction } from '@solana/web3.js';
import { AccountDataError, BPF_LOADER_UPGRADEABLE_PROGRAM_ID, type ClusterConfig } from '../../../../packages/solana/src/index.js';

/** Blockhash and preflight share one commitment so simulation always knows the blockhash. */
export const SEND_OPTIONS: SendOptions = { preflightCommitment: 'confirmed' };
const POLL_INTERVAL_MS = 2_000;
const MAX_FINALITY_WAIT_MS = 120_000;

export type WalletSigner = Pick<WalletContextState, 'publicKey' | 'sendTransaction' | 'signTransaction'>;

export type TxFailure =
  | { readonly kind: 'rejected' }
  | { readonly kind: 'program'; readonly code: number }
  | { readonly kind: 'already-exists' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'wrong-network' }
  | { readonly kind: 'program-missing' }
  | { readonly kind: 'network'; readonly detail: string }
  | { readonly kind: 'wallet'; readonly detail: string }
  | { readonly kind: 'unknown'; readonly detail: string };

export class WrongNetworkError extends Error {
  override readonly name = 'WrongNetworkError';
}

export class ProgramNotDeployedError extends Error {
  override readonly name = 'ProgramNotDeployedError';
}

/**
 * Refuses to read wallet-scoped data or send anything unless the configured RPC is the expected
 * cluster and the configured program is deployed there; an empty lookup must never be mistaken
 * for "no issuer" or "registry not initialized" when the program itself is missing.
 */
export async function assertReadyCluster(connection: Connection, config: ClusterConfig): Promise<void> {
  if (await connection.getGenesisHash() !== config.expectedGenesisHash) {
    throw new WrongNetworkError('RPC genesis hash does not match the configured cluster');
  }
  const program = await connection.getAccountInfo(new PublicKey(config.programId), { commitment: 'finalized' });
  if (program === null || !program.executable || !program.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)) {
    throw new ProgramNotDeployedError('Configured program is not deployed on this cluster');
  }
}

/** User-facing message for failed account reads (issuer/registry lookups). */
export function readErrorMessage(error: unknown): string {
  if (error instanceof WrongNetworkError) return 'Endpoint RPC yang dikonfigurasi bukan Solana Devnet. Data tidak dibaca.';
  if (error instanceof ProgramNotDeployedError) return 'Program SolVcred tidak ditemukan pada program ID yang dikonfigurasi, sehingga registry tidak dapat dibaca.';
  if (error instanceof AccountDataError) return 'Data akun on-chain tidak lolos validasi dan diabaikan.';
  return 'Gagal membaca data dari RPC. Periksa koneksi lalu coba lagi.';
}

export interface PreparedTransaction {
  readonly transaction: Transaction;
  readonly lastValidBlockHeight: number;
}

export async function prepareTransaction(
  connection: Connection,
  feePayer: PublicKey,
  instructions: readonly TransactionInstruction[],
): Promise<PreparedTransaction> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ feePayer, blockhash, lastValidBlockHeight }).add(...instructions);
  return { transaction, lastValidBlockHeight };
}

/**
 * Wallet-standard wallets pick the chain from the RPC URL. When the configured URL does not name
 * devnet the wallet would route to mainnet, so sign only and broadcast through our own connection.
 */
export async function sendWithWallet(
  wallet: WalletSigner,
  connection: Connection,
  walletRoutesToDevnet: boolean,
  transaction: Transaction,
): Promise<string> {
  if (walletRoutesToDevnet) return wallet.sendTransaction(transaction, connection, SEND_OPTIONS);
  if (wallet.signTransaction === undefined) {
    throw new Error('Wallet cannot sign transactions for a custom Devnet RPC');
  }
  const signed = await wallet.signTransaction(transaction);
  return connection.sendRawTransaction(signed.serialize(), SEND_OPTIONS);
}

export type Finality =
  | { readonly kind: 'finalized'; readonly slot: number }
  | { readonly kind: 'failed'; readonly failure: TxFailure }
  | { readonly kind: 'expired' }
  | { readonly kind: 'timeout' };

/**
 * Polls signature status until `finalized`. `expired` means the blockhash can no longer land;
 * `timeout` means the outcome is still unknown. RPC errors propagate: the caller must treat them
 * as ambiguous and re-read on-chain state before any retry.
 */
export async function waitForFinalized(connection: Connection, signature: string, lastValidBlockHeight: number): Promise<Finality> {
  const deadline = Date.now() + MAX_FINALITY_WAIT_MS;
  for (;;) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status) {
      if (status.err !== null) return { kind: 'failed', failure: describeTxError(status.err) };
      if (status.confirmationStatus === 'finalized') return { kind: 'finalized', slot: status.slot };
    } else if (await connection.getBlockHeight('finalized') > lastValidBlockHeight) {
      return { kind: 'expired' };
    }
    if (Date.now() > deadline) return { kind: 'timeout' };
    await new Promise<void>((resolve) => { setTimeout(resolve, POLL_INTERVAL_MS); });
  }
}

export type SubmitResult =
  | { readonly kind: 'finalized'; readonly signature: string; readonly slot: number }
  | { readonly kind: 'not-finalized'; readonly signature: string | null; readonly failure: TxFailure };

export type SubmitStage = 'preparing' | 'wallet' | 'confirming';

/** Single-signer path shared by every wallet flow. Never throws; callers re-read state on failure. */
export async function submitAndFinalize(args: {
  readonly connection: Connection;
  readonly config: ClusterConfig;
  readonly walletRoutesToDevnet: boolean;
  readonly wallet: WalletSigner;
  readonly feePayer: PublicKey;
  readonly instructions: readonly TransactionInstruction[];
  readonly onStage: (stage: SubmitStage, signature: string | null) => void;
}): Promise<SubmitResult> {
  let signature: string | null = null;
  try {
    args.onStage('preparing', null);
    await assertReadyCluster(args.connection, args.config);
    const { transaction, lastValidBlockHeight } = await prepareTransaction(args.connection, args.feePayer, args.instructions);
    args.onStage('wallet', null);
    signature = await sendWithWallet(args.wallet, args.connection, args.walletRoutesToDevnet, transaction);
    args.onStage('confirming', signature);
    const finality = await waitForFinalized(args.connection, signature, lastValidBlockHeight);
    switch (finality.kind) {
      case 'finalized':
        return { kind: 'finalized', signature, slot: finality.slot };
      case 'failed':
        return { kind: 'not-finalized', signature, failure: finality.failure };
      case 'expired':
      case 'timeout':
        return { kind: 'not-finalized', signature, failure: { kind: finality.kind } };
    }
  } catch (error) {
    return { kind: 'not-finalized', signature, failure: describeTxError(error) };
  }
}

function collectText(value: unknown, depth: number, out: string[]): void {
  if (depth > 4 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, depth + 1, out);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['message'] === 'string') out.push(record['message']);
  if (typeof record['code'] === 'number') out.push(`code:${record['code']}`);
  for (const key of ['error', 'cause', 'logs', 'transactionLogs', 'InstructionError']) {
    collectText(record[key], depth + 1, out);
  }
  if (!('message' in record)) out.push(JSON.stringify(value));
}

/** Classifies wallet, RPC and program errors without echoing transaction data into the UI. */
export function describeTxError(error: unknown): TxFailure {
  if (error instanceof WrongNetworkError) return { kind: 'wrong-network' };
  if (error instanceof ProgramNotDeployedError) return { kind: 'program-missing' };
  const parts: string[] = [];
  collectText(error, 0, parts);
  const text = parts.join('\n');
  const detail = (parts[0] ?? 'Tidak ada detail').slice(0, 300);
  if (/code:4001\b|user rejected|rejected the request|user denied|declined|cancell?ed by (the )?user|request was cancell?ed/i.test(text)) {
    return { kind: 'rejected' };
  }
  const hex = /custom program error: 0x([0-9a-f]+)/i.exec(text)?.[1];
  const custom = hex === undefined ? /"Custom":\s*(\d+)/.exec(text)?.[1] : undefined;
  const code = hex !== undefined ? Number.parseInt(hex, 16) : custom !== undefined ? Number(custom) : null;
  // System Program `AccountAlreadyInUse` (0) surfaces when an Anchor `init` target already exists.
  if (code === 0 || /already in use/i.test(text)) return { kind: 'already-exists' };
  if (code !== null) return { kind: 'program', code };
  if (/blockhash not found|block height exceeded|TransactionExpired/i.test(text)) return { kind: 'expired' };
  if (/RpcTimeoutError|RPC request (exceeded|aborted)|failed to fetch|NetworkError|timed? ?out|ECONN|429/i.test(text)) {
    return { kind: 'network', detail };
  }
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  if (name.startsWith('Wallet')) return { kind: 'wallet', detail };
  return { kind: 'unknown', detail };
}

const PROGRAM_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  6000: 'Hanya upgrade authority program yang dapat menginisialisasi registry.',
  6001: 'Akun ProgramData tidak sesuai dengan program yang dikonfigurasi.',
  6002: 'Wallet ini bukan admin registry.',
  6003: 'Wallet ini bukan authority penerbit yang berlaku.',
  6004: 'Penerbit nonaktif sehingga tidak dapat menerbitkan batch baru.',
  6005: 'Penerbit sudah nonaktif.',
  6006: 'Nama institusi harus 1–96 byte tanpa karakter kontrol.',
  6007: 'Domain harus 1–64 karakter a-z, 0-9, titik, atau tanda hubung, dan tidak diawali atau diakhiri titik/tanda hubung.',
  6008: 'Public key authority tidak valid.',
  6009: 'Jumlah dokumen dalam batch harus 1–100.',
  6010: 'Versi skema batch tidak didukung program.',
  6011: 'Merkle root tidak valid.',
  6012: 'Kode alasan pencabutan tidak valid.',
  6013: 'Program menolak bukti keanggotaan: PDF atau file bukti tidak cocok dengan batch.',
  6014: 'Batch ini bukan milik penerbit tersebut.',
  6015: 'Kunci baru sama dengan kunci yang sedang berlaku.',
  6016: 'Versi kunci telah mencapai batas maksimum.',
  2006: 'Alamat akun tidak sesuai dengan seeds program.',
  3010: 'Tanda tangan yang diwajibkan program tidak ada.',
  3012: 'Akun yang dibutuhkan belum ada di jaringan (misalnya registry belum diinisialisasi).',
};

export function failureMessage(failure: TxFailure): string {
  switch (failure.kind) {
    case 'rejected':
      return 'Permintaan dibatalkan di wallet. Tidak ada yang ditandatangani.';
    case 'program':
      return PROGRAM_ERROR_MESSAGES[failure.code] ?? `Program menolak transaksi (kode ${failure.code}).`;
    case 'already-exists':
      return 'Akun tujuan sudah ada di jaringan, sehingga transaksi ini tidak dapat dijalankan ulang.';
    case 'expired':
      return 'Transaksi kedaluwarsa sebelum masuk ke blok (blockhash tidak berlaku lagi).';
    case 'timeout':
      return 'Status transaksi belum finalized dalam batas waktu tunggu. Hasilnya belum diketahui.';
    case 'wrong-network':
      return 'Endpoint RPC yang dikonfigurasi bukan Solana Devnet. Tidak ada transaksi yang dibuat.';
    case 'program-missing':
      return 'Program SolVcred tidak ditemukan pada program ID yang dikonfigurasi. Tidak ada transaksi yang dibuat.';
    case 'network':
      return 'Koneksi ke RPC gagal atau terputus. Hasil transaksi belum diketahui.';
    case 'wallet':
      return 'Wallet gagal memproses permintaan.';
    case 'unknown':
      return 'Terjadi galat yang tidak dikenali.';
  }
}
