import { useWallet } from '@solana/wallet-adapter-react';
import type { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { useEffect, useId, useState } from 'react';
import { useCluster } from '../cluster.js';
import { parsePublicKeyInput } from '../lib/validate.js';
import {
  assertReadyCluster,
  describeTxError,
  prepareTransaction,
  SEND_OPTIONS,
  waitForFinalized,
  type TxFailure,
} from '../lib/tx.js';
import { FailureNotice, Notice, Progress, TxLink, Value } from './common.js';
import { Icon } from './Icon.js';

/** Solana slots average ~400 ms; used only to present a rough countdown. */
const MS_PER_BLOCK = 400;
const HEIGHT_POLL_MS = 4_000;

type Step =
  | { readonly kind: 'input' }
  | { readonly kind: 'signing-first' }
  | { readonly kind: 'await-second'; readonly transaction: Transaction; readonly lastValidBlockHeight: number; readonly newAuthority: PublicKey; readonly signing: boolean }
  | { readonly kind: 'sending'; readonly signature: string | null; readonly newAuthority: PublicKey }
  | { readonly kind: 'done'; readonly signature: string | null; readonly newAuthority: PublicKey }
  | { readonly kind: 'failed'; readonly failure: TxFailure };

/**
 * Builds one transaction that needs two wallets: the first signer (current authority or registry
 * admin, also fee payer) signs, the user switches to the new key's wallet, which signs, and the
 * fully signed bytes are broadcast through the configured RPC.
 */
export function TwoStepSigning({ firstSignerLabel, firstSigner, currentAuthority, buildInstruction, isApplied, onDone }: {
  readonly firstSignerLabel: string;
  readonly firstSigner: PublicKey;
  readonly currentAuthority: PublicKey;
  readonly buildInstruction: (newAuthority: PublicKey) => TransactionInstruction;
  /** Finalized read that tells whether the new authority is already in place (ambiguity recovery). */
  readonly isApplied: (newAuthority: PublicKey) => Promise<boolean>;
  readonly onDone: () => void;
}) {
  const { config, connection } = useCluster();
  const wallet = useWallet();
  const inputId = useId();
  const [input, setInput] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'input' });
  const [remainingBlocks, setRemainingBlocks] = useState<number | null>(null);

  const parsed = parsePublicKeyInput(input);
  const inputProblem = input.trim() === ''
    ? null
    : parsed === null
      ? 'Bukan public key Solana yang valid.'
      : parsed.equals(currentAuthority)
        ? 'Kunci baru sama dengan authority yang berlaku.'
        : parsed.equals(firstSigner)
          ? 'Kunci baru harus berbeda dari penanda tangan pertama.'
          : null;
  const firstConnected = wallet.publicKey?.equals(firstSigner) ?? false;

  const waiting = step.kind === 'await-second' ? step : null;
  useEffect(() => {
    if (waiting === null) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const height = await connection.getBlockHeight('confirmed');
        if (!cancelled) setRemainingBlocks(waiting.lastValidBlockHeight - height);
      } catch {
        // A missed poll only affects the countdown display; the send itself reports expiry.
      }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, HEIGHT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connection, waiting]);

  const settleFailure = async (failure: TxFailure, newAuthority: PublicKey, signature: string | null) => {
    // Re-read before reporting: a timed-out send may still have applied the change.
    if (await isApplied(newAuthority).catch(() => false)) {
      setStep({ kind: 'done', signature, newAuthority });
      onDone();
      return;
    }
    setStep({ kind: 'failed', failure });
  };

  const onFirstSign = async () => {
    if (parsed === null || inputProblem !== null || !firstConnected || wallet.publicKey === null) return;
    if (wallet.signTransaction === undefined) {
      setStep({ kind: 'failed', failure: { kind: 'wallet', detail: 'Wallet ini tidak mendukung penandatanganan tanpa pengiriman.' } });
      return;
    }
    setStep({ kind: 'signing-first' });
    try {
      await assertReadyCluster(connection, config);
      const { transaction, lastValidBlockHeight } = await prepareTransaction(connection, wallet.publicKey, [buildInstruction(parsed)]);
      const signed = await wallet.signTransaction(transaction);
      setRemainingBlocks(null);
      setStep({ kind: 'await-second', transaction: signed, lastValidBlockHeight, newAuthority: parsed, signing: false });
    } catch (error) {
      setStep({ kind: 'failed', failure: describeTxError(error) });
    }
  };

  const onSecondSign = async () => {
    if (waiting === null || wallet.signTransaction === undefined || !(wallet.publicKey?.equals(waiting.newAuthority) ?? false)) return;
    const { newAuthority, lastValidBlockHeight } = waiting;
    setStep({ ...waiting, signing: true });
    let signature: string | null = null;
    try {
      const signed = await wallet.signTransaction(waiting.transaction);
      if (!signed.verifySignatures()) {
        setStep({ kind: 'failed', failure: { kind: 'wallet', detail: 'Transaksi belum memuat kedua tanda tangan yang valid.' } });
        return;
      }
      setStep({ kind: 'sending', signature: null, newAuthority });
      signature = await connection.sendRawTransaction(signed.serialize(), SEND_OPTIONS);
      setStep({ kind: 'sending', signature, newAuthority });
      const finality = await waitForFinalized(connection, signature, lastValidBlockHeight);
      if (finality.kind === 'finalized') {
        setStep({ kind: 'done', signature, newAuthority });
        onDone();
        return;
      }
      await settleFailure(finality.kind === 'failed' ? finality.failure : { kind: finality.kind }, newAuthority, signature);
    } catch (error) {
      const failure = describeTxError(error);
      if (failure.kind === 'rejected') setStep({ ...waiting, signing: false });
      else await settleFailure(failure, newAuthority, signature);
    }
  };

  const restart = () => {
    setStep({ kind: 'input' });
    setRemainingBlocks(null);
  };

  if (step.kind === 'done') {
    return (
      <Notice tone="positive" title="Authority diganti (finalized)" live="status">
        <p>Kunci lama tidak lagi berwenang. Batch yang sudah terbit tetap dapat diperiksa dan mencatat kunci saat publikasinya.</p>
        <p>Authority baru: <Value value={step.newAuthority.toBase58()} label="authority baru" /></p>
        {step.signature !== null && <p><TxLink signature={step.signature} /></p>}
        <div className="actions"><button type="button" className="button-quiet" onClick={restart}>Selesai</button></div>
      </Notice>
    );
  }

  const expired = remainingBlocks !== null && remainingBlocks <= 0;
  const secondConnected = waiting !== null && (wallet.publicKey?.equals(waiting.newAuthority) ?? false);

  return (
    <div className="two-step">
      <ol className="flow">
        <li className="flow-step" data-done={waiting !== null || step.kind === 'sending'}>
          <h4><Icon name="key" size={18} /> Tanda tangan {firstSignerLabel}</h4>
          <div className="field">
            <label htmlFor={inputId}>Public key authority baru</label>
            <input
              id={inputId}
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              className="mono"
              value={input}
              disabled={step.kind !== 'input' && step.kind !== 'failed'}
              aria-invalid={inputProblem !== null}
              aria-describedby={`${inputId}-hint`}
              onChange={(event) => setInput(event.target.value)}
            />
            <p id={`${inputId}-hint`} className={inputProblem === null ? 'hint' : 'hint hint-error'}>
              {inputProblem ?? 'Alamat wallet yang akan menjadi authority. Wallet itu harus ikut menandatangani.'}
            </p>
          </div>
          {!firstConnected && (step.kind === 'input' || step.kind === 'failed') && (
            <Notice tone="caution" title={`Hubungkan wallet ${firstSignerLabel}`}>
              <p>Penanda tangan pertama sekaligus pembayar biaya harus <Value value={firstSigner.toBase58()} label="alamat penanda tangan pertama" /></p>
            </Notice>
          )}
          {(step.kind === 'input' || step.kind === 'failed') && (
            <div className="actions">
              <button
                type="button"
                className="button-primary"
                disabled={parsed === null || inputProblem !== null || !firstConnected}
                onClick={() => { void onFirstSign(); }}
              >
                Tanda tangani dengan {firstSignerLabel}
              </button>
            </div>
          )}
          {step.kind === 'signing-first' && <Progress>Menunggu tanda tangan pertama di wallet…</Progress>}
        </li>

        <li className="flow-step" data-done={secondConnected || step.kind === 'sending'}>
          <h4><Icon name="wallet" size={18} /> Ganti ke wallet kunci baru</h4>
          {waiting === null ? (
            <p className="muted">Setelah tanda tangan pertama, putuskan wallet ini lalu hubungkan wallet kunci baru.</p>
          ) : (
            <>
              <p>
                Putuskan wallet saat ini lalu hubungkan wallet <Value value={waiting.newAuthority.toBase58()} label="authority baru" />
              </p>
              <p className="status-line">
                <Icon name={secondConnected ? 'check' : 'clock'} size={18} />
                {secondConnected ? 'Wallet kunci baru terhubung.' : 'Menunggu wallet kunci baru terhubung…'}
              </p>
              <p className={expired ? 'hint hint-error' : 'hint'} aria-live="polite">
                {remainingBlocks === null
                  ? 'Menghitung sisa waktu transaksi…'
                  : expired
                    ? 'Blockhash transaksi sudah kedaluwarsa. Mulai ulang dari tanda tangan pertama.'
                    : `Sisa sekitar ${Math.max(1, Math.round((remainingBlocks * MS_PER_BLOCK) / 1000))} detik (${remainingBlocks} blok) sebelum transaksi kedaluwarsa.`}
              </p>
            </>
          )}
        </li>

        <li className="flow-step" data-done={false}>
          <h4><Icon name="upload" size={18} /> Tanda tangan kunci baru dan kirim</h4>
          {waiting !== null && (
            <div className="actions">
              <button
                type="button"
                className="button-primary"
                disabled={!secondConnected || waiting.signing || expired}
                onClick={() => { void onSecondSign(); }}
              >
                Tanda tangani dengan kunci baru dan kirim
              </button>
              <button type="button" className="button-quiet" disabled={waiting.signing} onClick={restart}>Batalkan</button>
            </div>
          )}
          {waiting?.signing === true && <Progress>Menunggu tanda tangan kedua di wallet…</Progress>}
          {step.kind === 'sending' && (
            <Progress>
              Mengirim transaksi dan menunggu status finalized…
              {step.signature !== null && <> <TxLink signature={step.signature} /></>}
            </Progress>
          )}
        </li>
      </ol>
      {step.kind === 'failed' && <FailureNotice failure={step.failure} title="Pergantian authority belum terjadi" />}
      <p className="muted small">
        Kedua tanda tangan harus mengikat blockhash yang sama. Blockhash berlaku sekitar 150 blok (kurang lebih 60–90 detik); jika
        pergantian wallet terlalu lama, transaksi kedaluwarsa dan harus dibuat ulang. Tidak ada kunci privat yang disimpan aplikasi.
      </p>
    </div>
  );
}
