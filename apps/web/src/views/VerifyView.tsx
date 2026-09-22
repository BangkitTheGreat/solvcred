import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { LIMITS } from '../../../../packages/core/src/index.js';
import { verifyCredential, type VerificationReport } from '../../../../packages/solana/src/index.js';
import { useCluster } from '../cluster.js';
import { Notice } from '../components/common.js';
import { FileSlot } from '../components/FileSlot.js';
import { Icon } from '../components/Icon.js';
import { VerificationReportView } from '../components/Report.js';
import { rpcHost } from '../lib/config.js';
import { FileInputError, isJsonFile, isPdfFile, readPdf, readProofText } from '../lib/files.js';
import { formatBytes } from '../lib/format.js';
import { OVERALL_STATUS } from '../lib/status.js';

type Run =
  | { readonly state: 'idle' }
  | { readonly state: 'checking' }
  | { readonly state: 'done'; readonly report: VerificationReport; readonly pdfName: string; readonly proofName: string }
  | { readonly state: 'failed'; readonly message: string };

export function VerifyView() {
  const { config, connection } = useCluster();
  const [pdf, setPdf] = useState<File | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [run, setRun] = useState<Run>({ state: 'idle' });
  const [dragging, setDragging] = useState(false);
  const runId = useRef(0);
  const busy = run.state === 'checking';

  const accept = (files: readonly File[]) => {
    const rejected = files.filter((file) => !isPdfFile(file) && !isJsonFile(file));
    const nextPdf = files.find(isPdfFile);
    const nextProof = files.find(isJsonFile);
    if (nextPdf !== undefined) setPdf(nextPdf);
    if (nextProof !== undefined) setProof(nextProof);
    setInputError(rejected.length > 0 ? 'Hanya dokumen PDF dan file bukti .json yang dapat diperiksa.' : null);
    // A result always belongs to the exact files it was computed from.
    setRun({ state: 'idle' });
  };

  const onDrop = (event: DragEvent<HTMLFieldSetElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!busy) accept(Array.from(event.dataTransfer.files));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pdf === null || proof === null || busy) return;
    const id = ++runId.current;
    setInputError(null);
    setRun({ state: 'checking' });
    try {
      const [bytes, proofText] = await Promise.all([readPdf(pdf), readProofText(proof)]);
      const report = await verifyCredential(connection, config, bytes, proofText);
      if (id === runId.current) setRun({ state: 'done', report, pdfName: pdf.name, proofName: proof.name });
    } catch (error) {
      if (id !== runId.current) return;
      if (error instanceof FileInputError) {
        setInputError(error.message);
        setRun({ state: 'idle' });
      } else {
        setRun({ state: 'failed', message: 'Pemeriksaan berhenti karena galat tak terduga. Tidak ada status yang dapat disimpulkan dari percobaan ini.' });
      }
    }
  };

  return (
    <div className="view">
      <header className="view-head">
        <h2>Verifikasi dokumen</h2>
        <p className="lede">
          Periksa PDF kredensial beserta file buktinya terhadap registry SolVcred di Solana Devnet. Tidak perlu akun atau wallet.
        </p>
      </header>

      <div className="verify-layout">
        <div className="verify-input">
          <form onSubmit={(event) => { void onSubmit(event); }} noValidate>
            <fieldset
              className="dropzone"
              data-dragging={dragging}
              disabled={busy}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <legend>Pilih dokumen dan bukti</legend>
              <p className="hint">
                PDF asli yang Anda terima dan file bukti <code>.json</code> pasangannya. Anda juga dapat menyeret keduanya ke sini.
              </p>
              <FileSlot
                id="verify-pdf"
                label="Dokumen PDF"
                accept="application/pdf,.pdf"
                filled={pdf !== null}
                summary={pdf === null ? `Belum dipilih · maks. ${formatBytes(LIMITS.documentBytes)}` : `${pdf.name} · ${formatBytes(pdf.size)}`}
                onFiles={accept}
              />
              <FileSlot
                id="verify-proof"
                label="File bukti (JSON)"
                accept="application/json,.json"
                filled={proof !== null}
                summary={proof === null ? `Belum dipilih · maks. ${formatBytes(LIMITS.proofBytes)}` : `${proof.name} · ${formatBytes(proof.size)}`}
                onFiles={accept}
              />
            </fieldset>
            {inputError !== null && <Notice tone="negative" live="alert"><p>{inputError}</p></Notice>}
            <div className="actions">
              <button type="submit" className="button-primary" disabled={pdf === null || proof === null || busy}>
                <Icon name="search" size={18} />
                {busy ? 'Memeriksa…' : run.state === 'done' || run.state === 'failed' ? 'Periksa ulang' : 'Periksa'}
              </button>
              {(pdf !== null || proof !== null) && (
                <button
                  type="button"
                  className="button-quiet"
                  disabled={busy}
                  onClick={() => { setPdf(null); setProof(null); setInputError(null); setRun({ state: 'idle' }); }}
                >
                  Kosongkan
                </button>
              )}
            </div>
            <p className="privacy-note">
              <Icon name="lock" size={16} />
              File dibaca dan di-hash di browser ini, tidak pernah diunggah. RPC hanya menerima alamat akun.
            </p>
          </form>
        </div>

        <div className="verify-result" aria-busy={busy}>
          <p className="sr-only" aria-live="polite">
            {run.state === 'checking' && 'Memeriksa dokumen dan status on-chain.'}
            {run.state === 'done' && `Hasil pemeriksaan: ${OVERALL_STATUS[run.report.status].label}.`}
            {run.state === 'failed' && `Hasil pemeriksaan: ${OVERALL_STATUS.unverifiable.label}.`}
          </p>
          {run.state === 'idle' && <EmptyResult />}
          {run.state === 'checking' && <CheckingResult />}
          {run.state === 'failed' && (
            <Notice tone="neutral" icon="question" title={OVERALL_STATUS.unverifiable.label}>
              <p>{run.message}</p>
            </Notice>
          )}
          {run.state === 'done' && (
            <>
              <p className="checked-files">
                <Icon name="file" size={16} />
                <span>{run.pdfName}</span>
                <span aria-hidden="true">+</span>
                <span>{run.proofName}</span>
              </p>
              <VerificationReportView report={run.report} timeoutMs={config.timeoutMs} headingId="verify-report-status" />
            </>
          )}
        </div>
      </div>

      <Limits rpcUrl={config.rpcUrl} />
    </div>
  );
}

function EmptyResult() {
  return (
    <div className="result-empty">
      <h3>Yang akan diperiksa</h3>
      <ol className="steps">
        <li><strong>Integritas.</strong> Hash PDF dan jalur Merkle di file bukti harus menghasilkan root batch yang tercatat on-chain.</li>
        <li><strong>Penerbit.</strong> Issuer harus terdaftar dan aktif dalam registry program yang dikonfigurasi.</li>
        <li><strong>Pencabutan.</strong> Tidak boleh ada catatan pencabutan untuk kredensial ini.</li>
      </ol>
      <p>Ketiganya dibaca dari satu snapshot jaringan berstatus finalized, beserta waktu pemeriksaannya.</p>
    </div>
  );
}

function CheckingResult() {
  return (
    <div className="result-skeleton" aria-hidden="true">
      <div className="skeleton skeleton-head" />
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-row" />
    </div>
  );
}

function Limits({ rpcUrl }: { readonly rpcUrl: string }) {
  return (
    <section className="limits" aria-labelledby="limits-title">
      <h3 id="limits-title">Batas jaminan pemeriksaan</h3>
      <ul>
        <li>
          <strong>Memegang file bukan bukti identitas.</strong> Siapa pun yang memiliki PDF dan file bukti dapat menjalankan
          pemeriksaan ini. Hasilnya tidak menunjukkan bahwa orang yang menyerahkan file adalah pemilik kredensial.
        </li>
        <li>
          <strong>PDF yang dipindai atau diekspor ulang adalah file berbeda.</strong> Meskipun tampak sama, byte-nya berubah sehingga
          hasilnya Bukti tidak cocok. Minta PDF asli yang diterbitkan institusi.
        </li>
        <li>
          <strong>Hasil bergantung pada RPC yang dikonfigurasi</strong> (<code>{rpcHost(rpcUrl)}</code>). Aplikasi membaca data
          finalized dari endpoint tersebut; endpoint yang salah atau tidak jujur dapat memengaruhi hasil.
        </li>
        <li>
          <strong>Isi kredensial tidak dinilai.</strong> SolVcred tidak membuktikan kebenaran kegiatan akademik, kejujuran institusi,
          atau identitas pemegang dokumen. Domain penerbit dicatat admin registry, bukan diverifikasi otomatis.
        </li>
        <li>
          <strong>Status berlaku pada waktu pemeriksaan.</strong> Pencabutan atau penonaktifan setelahnya hanya terlihat pada
          pemeriksaan berikutnya.
        </li>
      </ul>
    </section>
  );
}
