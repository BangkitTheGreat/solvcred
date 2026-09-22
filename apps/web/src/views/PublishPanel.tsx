import { useWallet } from '@solana/wallet-adapter-react';
import { useState } from 'react';
import {
  documentLeafHash,
  LIMITS,
  prepareBatch,
  randomId,
  ValidationError,
} from '../../../../packages/core/src/index.js';
import {
  batchAddress,
  checkPublishedBatch,
  publishBatchInstruction,
  type BatchAccount,
  type PublishCheck,
  type UnverifiableReason,
} from '../../../../packages/solana/src/index.js';
import { useCluster } from '../cluster.js';
import { ConfirmButton, Fact, Facts, FailureNotice, Notice, Progress, TxLink, Value } from '../components/common.js';
import { FileSlot } from '../components/FileSlot.js';
import { Icon } from '../components/Icon.js';
import { downloadBytes, FileInputError, isPdfFile, readPdf, sha256Hex } from '../lib/files.js';
import { formatBytes, formatDateTime, formatInteger, formatUnixSeconds } from '../lib/format.js';
import type { IssuerEntry } from '../lib/issuer.js';
import {
  buildDraftZip,
  buildFinalZip,
  MAX_DRAFT_ZIP_BYTES,
  PackageError,
  packageNames,
  parseDraftZip,
  type DraftBatch,
  type FinalRecord,
  type PackageDocument,
} from '../lib/package.js';
import { reasonExplanation, validationMessage } from '../lib/status.js';
import { submitAndFinalize, type SubmitStage, type TxFailure } from '../lib/tx.js';

type WorkStep = SubmitStage | 'restoring' | 'checking' | 'packaging';

type Phase =
  | { readonly kind: 'empty' }
  | { readonly kind: 'preparing' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'working'; readonly step: WorkStep; readonly signature: string | null }
  /** FR-10 read says the batch does not exist: the SAME draft may be sent again. */
  | { readonly kind: 'retry'; readonly failure: TxFailure | null; readonly signature: string | null }
  | { readonly kind: 'conflict'; readonly batch: BatchAccount }
  | { readonly kind: 'unknown'; readonly reason: UnverifiableReason; readonly failure: TxFailure | null; readonly signature: string | null; readonly afterFinalized: boolean }
  | { readonly kind: 'final'; readonly record: FinalRecord };

const WORK_MESSAGES: Readonly<Record<WorkStep, string>> = {
  restoring: 'Membaca cadangan dan mencocokkan ulang hash setiap PDF dengan proof-nya…',
  checking: 'Membaca akun batch di jaringan (finalized) sebelum melanjutkan…',
  preparing: 'Menyiapkan transaksi…',
  wallet: 'Menunggu persetujuan di wallet…',
  confirming: 'Transaksi terkirim. Menunggu status finalized, biasanya 15–30 detik…',
  packaging: 'Menghitung leaf hash untuk manifest final…',
};

export function PublishPanel({ entry }: { readonly entry: IssuerEntry }) {
  const { app, config, connection, programId } = useCluster();
  const wallet = useWallet();
  const [draft, setDraft] = useState<DraftBatch | null>(null);
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'empty' });
  const [inputError, setInputError] = useState<string | null>(null);
  const [finalDownloaded, setFinalDownloaded] = useState(false);

  const isAuthority = wallet.publicKey?.equals(entry.issuer.authority) ?? false;
  const busy = phase.kind === 'preparing' || phase.kind === 'working';

  const reset = () => {
    setDraft(null);
    setBackupDownloaded(false);
    setBackupConfirmed(false);
    setFinalDownloaded(false);
    setInputError(null);
    setPhase({ kind: 'empty' });
  };

  const finalize = async (source: DraftBatch, batch: BatchAccount, signature: string | null) => {
    setPhase({ kind: 'working', step: 'packaging', signature });
    const leafHashes = await Promise.all(source.documents.map((document, index) => {
      const proof = source.prepared.proofs[index];
      if (proof === undefined) throw new Error('Draft proof missing');
      return documentLeafHash(document.bytes, proof);
    }));
    setPhase({
      kind: 'final',
      record: {
        signature,
        issuer: { address: batch.issuer.toBase58(), name: entry.issuer.name, domain: entry.issuer.domain },
        batchAddress: batchAddress(programId, batch.issuer, batch.batchId).toBase58(),
        batch,
        leafHashes,
        finalizedAt: new Date().toISOString(),
      },
    });
  };

  /** Applies a finalized batch read (FR-10). Only `matches` ever unlocks the final package. */
  const settle = async (source: DraftBatch, check: PublishCheck, failure: TxFailure | null, signature: string | null, afterFinalized: boolean) => {
    switch (check.state) {
      case 'matches':
        await finalize(source, check.batch, signature);
        return;
      case 'conflict':
        setPhase({ kind: 'conflict', batch: check.batch });
        return;
      case 'unknown':
        setPhase({ kind: 'unknown', reason: check.reason, failure, signature, afterFinalized });
        return;
      case 'missing':
        // A finalized transaction whose batch is not readable yet means a lagging RPC: re-read, never re-send.
        setPhase(afterFinalized
          ? { kind: 'unknown', reason: 'rpc-error', failure, signature, afterFinalized }
          : { kind: 'retry', failure, signature });
        return;
    }
  };

  const onSelectPdfs = async (files: readonly File[]) => {
    setInputError(null);
    if (files.length > LIMITS.documents) {
      setInputError(`Dipilih ${files.length} file; satu batch maksimal ${LIMITS.documents} PDF.`);
      return;
    }
    const notPdf = files.filter((file) => !isPdfFile(file));
    if (notPdf.length > 0) {
      setInputError(`${notPdf.length} file bukan PDF. Pilih hanya PDF final.`);
      return;
    }
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > LIMITS.batchBytes) {
      setInputError(`Total ${formatBytes(total)} melebihi batas batch ${formatBytes(LIMITS.batchBytes)}.`);
      return;
    }
    setPhase({ kind: 'preparing' });
    try {
      const contents = await Promise.all(files.map(readPdf));
      const prepared = await prepareBatch({
        network: config.network,
        programId: config.programId,
        issuerId: entry.issuer.issuerId,
        batchId: randomId(),
      }, contents);
      const names = packageNames(files.map((file) => file.name));
      const documents: PackageDocument[] = await Promise.all(contents.map(async (bytes, index) => {
        const name = names[index];
        if (name === undefined) throw new Error('Missing package name');
        return { ...name, bytes, sha256: await sha256Hex(bytes) };
      }));
      setDraft({ prepared, documents, createdAt: new Date().toISOString() });
      setBackupDownloaded(false);
      setBackupConfirmed(false);
      setPhase({ kind: 'ready' });
    } catch (error) {
      setPhase({ kind: 'empty' });
      if (error instanceof ValidationError) setInputError(validationMessage(error.code));
      else if (error instanceof FileInputError) setInputError(error.message);
      else setInputError('Draft tidak dapat dibuat karena galat tak terduga.');
    }
  };

  const onResume = async (file: File) => {
    setInputError(null);
    if (file.size > MAX_DRAFT_ZIP_BYTES) {
      setInputError('Arsip terlalu besar untuk sebuah cadangan draft.');
      return;
    }
    setPhase({ kind: 'working', step: 'restoring', signature: null });
    try {
      const loaded = await parseDraftZip(new Uint8Array(await file.arrayBuffer()), config);
      if (loaded.prepared.commitment.issuerId !== entry.issuer.issuerId) {
        throw new PackageError('Cadangan ini milik penerbit lain (issuer ID berbeda). Pilih penerbit tersebut terlebih dahulu.');
      }
      setDraft(loaded);
      // The file being restored is itself the backup.
      setBackupDownloaded(true);
      setBackupConfirmed(true);
      setPhase({ kind: 'working', step: 'checking', signature: null });
      await settle(loaded, await checkPublishedBatch(connection, config, loaded.prepared.commitment), null, null, false);
    } catch (error) {
      setDraft(null);
      setPhase({ kind: 'empty' });
      setInputError(error instanceof PackageError ? error.message : 'Cadangan draft tidak dapat dibaca.');
    }
  };

  const onPublish = async () => {
    const authority = wallet.publicKey;
    if (draft === null || authority === null) return;
    const { commitment } = draft.prepared;
    setInputError(null);
    try {
      // FR-10 also guards the first attempt: an earlier send from this draft may already have landed.
      setPhase({ kind: 'working', step: 'checking', signature: null });
      const before = await checkPublishedBatch(connection, config, commitment);
      if (before.state !== 'missing') {
        await settle(draft, before, null, null, false);
        return;
      }
      const result = await submitAndFinalize({
        connection,
        config,
        walletRoutesToDevnet: app.walletRoutesToDevnet,
        wallet,
        feePayer: authority,
        instructions: [publishBatchInstruction(programId, { authority, commitment })],
        onStage: (step, signature) => setPhase({ kind: 'working', step, signature }),
      });
      setPhase({ kind: 'working', step: 'checking', signature: result.signature });
      const after = await checkPublishedBatch(connection, config, commitment);
      await settle(draft, after, result.kind === 'finalized' ? null : result.failure, result.signature, result.kind === 'finalized');
    } catch {
      setPhase({ kind: 'unknown', reason: 'rpc-error', failure: null, signature: null, afterFinalized: false });
    }
  };

  const onRecheck = async () => {
    if (draft === null || phase.kind !== 'unknown') return;
    const { failure, signature, afterFinalized } = phase;
    setPhase({ kind: 'working', step: 'checking', signature });
    await settle(draft, await checkPublishedBatch(connection, config, draft.prepared.commitment), failure, signature, afterFinalized);
  };

  const onDownloadDraft = () => {
    if (draft === null) return;
    downloadBytes(buildDraftZip(draft), `solvcred-draft-${draft.prepared.commitment.batchId.slice(0, 12)}.zip`, 'application/zip');
    setBackupDownloaded(true);
  };

  const onDownloadFinal = () => {
    if (draft === null || phase.kind !== 'final') return;
    downloadBytes(buildFinalZip(draft, phase.record), `solvcred-final-${draft.prepared.commitment.batchId.slice(0, 12)}.zip`, 'application/zip');
    setFinalDownloaded(true);
  };

  const gates = [
    { done: backupDownloaded && backupConfirmed, label: 'Cadangan draft diunduh dan disimpan' },
    { done: wallet.publicKey !== null && isAuthority, label: 'Wallet terhubung sebagai authority penerbit ini' },
    { done: entry.issuer.active, label: 'Penerbit berstatus aktif' },
  ];
  const canPublish = draft !== null && gates.every((gate) => gate.done) && (phase.kind === 'ready' || phase.kind === 'retry');

  if (draft === null) {
    return (
      <div className="panel-body">
        <p className="lede">
          Pilih PDF final. Hash, nonce acak, Merkle root, dan file bukti dibuat di browser ini. Hanya batch ID, root, dan jumlah
          dokumen yang dikirim ke jaringan.
        </p>
        {!entry.issuer.active && (
          <Notice tone="caution" icon="pause" title="Penerbit nonaktif">
            <p>Penerbit nonaktif tidak dapat menerbitkan batch baru. Anda tetap dapat memeriksa cadangan draft yang mungkin sudah terbit.</p>
          </Notice>
        )}
        <div className="slot-stack">
          <FileSlot
            id="publish-pdfs"
            label="PDF final untuk batch baru"
            accept="application/pdf,.pdf"
            multiple
            filled={false}
            disabled={busy || !entry.issuer.active}
            summary={`Maks. ${LIMITS.documents} PDF · ${formatBytes(LIMITS.documentBytes)} per PDF · ${formatBytes(LIMITS.batchBytes)} total`}
            buttonLabel="Pilih PDF"
            onFiles={(files) => { void onSelectPdfs(files); }}
          />
          <FileSlot
            id="publish-resume"
            label="Lanjutkan dari cadangan draft"
            accept="application/zip,.zip"
            filled={false}
            disabled={busy}
            summary="Arsip .zip yang diunduh sebelum publikasi; PDF di dalamnya di-hash ulang dan dicocokkan dengan proof."
            buttonLabel="Pilih cadangan"
            onFiles={(files) => { const [file] = files; if (file !== undefined) void onResume(file); }}
          />
        </div>
        {phase.kind === 'preparing' && <Progress>Menghitung hash dan Merkle tree di browser…</Progress>}
        {phase.kind === 'working' && <Progress>{WORK_MESSAGES[phase.step]}</Progress>}
        {inputError !== null && <Notice tone="negative" live="alert"><p>{inputError}</p></Notice>}
      </div>
    );
  }

  const { commitment } = draft.prepared;
  const totalBytes = draft.documents.reduce((sum, document) => sum + document.bytes.byteLength, 0);
  const isFinal = phase.kind === 'final';

  return (
    <div className="panel-body">
      <ol className="flow">
        <li className="flow-step" data-done="true">
          <h4><Icon name="check" size={18} /> Draft dibuat</h4>
          <p className="muted">Draft belum diterbitkan. Batch ID, nonce, dan root ini dipakai ulang pada setiap percobaan kirim.</p>
          <Facts>
            <Fact label="Batch ID"><Value value={commitment.batchId} label="batch ID" /></Fact>
            <Fact label="Merkle root"><Value value={commitment.root} label="Merkle root" /></Fact>
            <Fact label="Jumlah dokumen"><span className="num">{formatInteger(commitment.leafCount)}</span> · {formatBytes(totalBytes)}</Fact>
            <Fact label="Dibuat">{formatDateTime(draft.createdAt)}</Fact>
          </Facts>
          <details className="doc-list">
            <summary>Daftar dokumen ({formatInteger(draft.documents.length)})</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th scope="col">#</th><th scope="col">Nama file di paket</th><th scope="col">Ukuran</th><th scope="col">SHA-256</th></tr>
                </thead>
                <tbody>
                  {draft.documents.map((document, index) => (
                    <tr key={document.fileName}>
                      <td className="num">{index + 1}</td>
                      <td>{document.fileName}</td>
                      <td className="num">{formatBytes(document.bytes.byteLength)}</td>
                      <td className="mono">{document.sha256.slice(0, 16)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </li>

        <li className="flow-step" data-done={backupDownloaded && backupConfirmed}>
          <h4><Icon name={backupDownloaded && backupConfirmed ? 'check' : 'download'} size={18} /> Unduh cadangan draft</h4>
          <p className="muted">
            Wajib sebelum publikasi. Root saja tidak dapat memulihkan proof. Jika respons transaksi terputus, cadangan ini dipakai untuk
            memeriksa dan mengirim ulang batch yang sama.
          </p>
          <div className="actions">
            <button type="button" className={backupDownloaded ? 'button-secondary' : 'button-primary'} onClick={onDownloadDraft} disabled={busy}>
              <Icon name="download" size={18} />
              {backupDownloaded ? 'Unduh lagi' : 'Unduh cadangan draft (.zip)'}
            </button>
          </div>
          <label className="check-confirm">
            <input
              type="checkbox"
              checked={backupConfirmed}
              disabled={!backupDownloaded || busy || isFinal}
              onChange={(event) => setBackupConfirmed(event.target.checked)}
            />
            <span>Saya sudah menyimpan arsip cadangan ini di lokasi yang aman.</span>
          </label>
        </li>

        <li className="flow-step" data-done={isFinal}>
          <h4><Icon name={isFinal ? 'check' : 'upload'} size={18} /> Tinjau dan terbitkan</h4>
          <Facts>
            <Fact label="Penerbit">{entry.issuer.name}</Fact>
            <Fact label="Issuer ID"><Value value={commitment.issuerId} label="issuer ID" /></Fact>
            <Fact label="Jaringan">Solana Devnet</Fact>
            <Fact label="Program"><Value value={commitment.programId} label="program ID" /></Fact>
            <Fact label="Penanda tangan dan pembayar biaya">
              {wallet.publicKey === null ? 'Wallet belum terhubung' : <Value value={wallet.publicKey.toBase58()} label="alamat wallet" />}
            </Fact>
          </Facts>
          <p className="muted">
            Dikirim ke jaringan: batch ID, Merkle root, jumlah dokumen, dan versi skema 1. Tidak dikirim: PDF, nama file, nonce, dan proof.
          </p>
          <ul className="gates" aria-label="Syarat publikasi">
            {gates.map((gate) => (
              <li key={gate.label} data-done={gate.done}>
                <Icon name={gate.done ? 'check' : 'circle'} size={16} />
                <span>{gate.label}</span>
                <span className="sr-only">{gate.done ? '(terpenuhi)' : '(belum terpenuhi)'}</span>
              </li>
            ))}
          </ul>

          <div aria-live="polite">
            {phase.kind === 'working' && (
              <Progress>
                {WORK_MESSAGES[phase.step]}
                {phase.signature !== null && <> <TxLink signature={phase.signature} /></>}
              </Progress>
            )}
            {phase.kind === 'retry' && (
              <>
                {phase.failure !== null && <FailureNotice failure={phase.failure} title="Batch belum terbit" />}
                <Notice tone="neutral" title="Batch belum ada di jaringan">
                  <p>
                    Pemeriksaan finalized menunjukkan akun batch belum ada. Draft tidak berubah; kirim ulang memakai batch ID, nonce, dan
                    root yang sama.
                  </p>
                </Notice>
              </>
            )}
            {phase.kind === 'conflict' && (
              <Notice tone="negative" title="Batch ID sudah dipakai dengan isi berbeda" live="alert">
                <p>
                  Akun batch untuk batch ID ini sudah ada, tetapi root atau jumlah dokumennya berbeda dari draft ini. Jangan kirim ulang
                  dan jangan bagikan proof dari draft ini. Cari cadangan draft lain yang mungkin telah diterbitkan dengan batch ID ini.
                </p>
                <Facts>
                  <Fact label="Root on-chain"><Value value={phase.batch.root} label="root on-chain" /></Fact>
                  <Fact label="Jumlah dokumen on-chain"><span className="num">{phase.batch.leafCount}</span></Fact>
                </Facts>
              </Notice>
            )}
            {phase.kind === 'unknown' && (
              <>
                {phase.failure !== null && <FailureNotice failure={phase.failure} title="Hasil transaksi belum jelas" />}
                <Notice tone="neutral" icon="question" title="Status batch belum dapat dipastikan">
                  <p>
                    {phase.afterFinalized && phase.reason === 'rpc-error'
                      ? 'Transaksi sudah finalized, tetapi akun batch belum terbaca dari RPC.'
                      : reasonExplanation(phase.reason, config.timeoutMs)}
                  </p>
                  <p>Pengiriman ulang dikunci sampai pemeriksaan berhasil. Jangan membuat draft baru untuk dokumen yang sama.</p>
                  {phase.signature !== null && <p><TxLink signature={phase.signature} /></p>}
                </Notice>
                <div className="actions">
                  <button type="button" className="button-secondary" onClick={() => { void onRecheck(); }}>
                    <Icon name="refresh" size={18} /> Periksa ulang status batch
                  </button>
                </div>
              </>
            )}
          </div>

          {!isFinal && phase.kind !== 'conflict' && phase.kind !== 'unknown' && (
            <div className="actions">
              <button type="button" className="button-primary" disabled={!canPublish || busy} onClick={() => { void onPublish(); }}>
                <Icon name="upload" size={18} />
                {phase.kind === 'retry' && phase.failure !== null ? 'Kirim ulang dengan draft yang sama' : 'Terbitkan batch'}
              </button>
            </div>
          )}
        </li>

        <li className="flow-step" data-done={finalDownloaded}>
          <h4><Icon name={finalDownloaded ? 'check' : 'download'} size={18} /> Paket final</h4>
          {phase.kind === 'final' ? (
            <>
              <Notice tone="positive" title="Batch terbit dan finalized" live="status">
                <p>Akun batch terbaca pada commitment finalized dan cocok dengan draft ini.</p>
              </Notice>
              <Facts>
                <Fact label="Tanda tangan transaksi">
                  {phase.record.signature === null
                    ? 'Tidak tercatat di sesi ini; batch ditemukan melalui pemeriksaan ulang.'
                    : <><Value value={phase.record.signature} label="tanda tangan transaksi" /><TxLink signature={phase.record.signature} /></>}
                </Fact>
                <Fact label="Dicatat">
                  {formatUnixSeconds(phase.record.batch.recordedAt)} · slot <span className="num">{formatInteger(phase.record.batch.recordedSlot)}</span>
                </Fact>
                <Fact label="Alamat akun batch"><Value value={phase.record.batchAddress} label="alamat akun batch" /></Fact>
                <Fact label="Kunci penerbit">
                  <Value value={phase.record.batch.issuingAuthority.toBase58()} label="kunci penerbit" />
                  <span className="fact-note">Versi kunci {phase.record.batch.keyVersion}</span>
                </Fact>
              </Facts>
              <p className="muted">
                Bagikan setiap pasangan PDF dan <code>.proof.json</code> kepada pemiliknya melalui saluran resmi institusi. Simpan{' '}
                <code>manifest.json</code> sebagai arsip; manifest memuat leaf hash yang dibutuhkan untuk pencabutan.
              </p>
              <div className="actions">
                <button type="button" className="button-primary" onClick={onDownloadFinal}>
                  <Icon name="download" size={18} /> Unduh paket final (.zip)
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Tersedia setelah batch terbaca di jaringan dengan status finalized.</p>
          )}
        </li>
      </ol>

      {inputError !== null && <Notice tone="negative" live="alert"><p>{inputError}</p></Notice>}

      <div className="panel-foot">
        <ConfirmButton
          label={isFinal ? 'Mulai batch baru' : 'Buang draft'}
          confirmLabel={isFinal ? 'Mulai batch baru' : 'Buang draft dari layar'}
          prompt={isFinal
            ? 'Pastikan paket final sudah diunduh. Batch ini tetap tercatat di jaringan.'
            : 'Draft akan hilang dari layar. Jika transaksi mungkin sudah terkirim, simpan cadangan dan periksa lewat "Lanjutkan dari cadangan draft" alih-alih membuat draft baru.'}
          onConfirm={reset}
          disabled={busy}
        />
      </div>
    </div>
  );
}
