import { useWallet } from '@solana/wallet-adapter-react';
import { useState, type FormEvent } from 'react';
import {
  documentLeafHash,
  parseProofJson,
  ValidationError,
  type CredentialProof,
} from '../../../../packages/core/src/index.js';
import {
  REVOCATION_REASONS,
  revokeCredentialInstruction,
  verifyCredential,
  type RevocationReasonCode,
  type VerificationReport,
} from '../../../../packages/solana/src/index.js';
import { useCluster } from '../cluster.js';
import { Fact, Facts, FailureNotice, Notice, Progress, TxLink, Value } from '../components/common.js';
import { FileSlot } from '../components/FileSlot.js';
import { Icon } from '../components/Icon.js';
import { VerificationReportView } from '../components/Report.js';
import { FileInputError, isJsonFile, isPdfFile, readPdf, readProofText } from '../lib/files.js';
import { formatBytes, formatInteger, formatUnixSeconds } from '../lib/format.js';
import type { IssuerEntry } from '../lib/issuer.js';
import { OVERALL_STATUS, reasonExplanation, validationMessage } from '../lib/status.js';
import { submitAndFinalize, type SubmitStage, type TxFailure } from '../lib/tx.js';

interface Candidate {
  readonly report: VerificationReport;
  readonly proof: CredentialProof;
  readonly leafHash: string;
  readonly pdfName: string;
  /** Kept locally only to re-check status after sending; never transmitted. */
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly proofText: string;
}

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready'; readonly candidate: Candidate; readonly failure: TxFailure | null }
  | { readonly kind: 'working'; readonly candidate: Candidate; readonly step: SubmitStage | 'verifying'; readonly signature: string | null }
  | { readonly kind: 'done'; readonly report: VerificationReport; readonly signature: string | null };

const STEP_MESSAGES: Readonly<Record<SubmitStage | 'verifying', string>> = {
  preparing: 'Menyiapkan transaksi pencabutan…',
  wallet: 'Menunggu persetujuan di wallet…',
  confirming: 'Transaksi terkirim. Menunggu status finalized…',
  verifying: 'Membaca ulang status pencabutan di jaringan (finalized)…',
};

/** Why the program would reject this revocation, if anything; checked before the wallet is asked. */
function blocker(candidate: Candidate, entry: IssuerEntry, isAuthority: boolean, timeoutMs: number): string | null {
  const { report } = candidate;
  if (report.status === 'revoked') return 'Kredensial ini sudah dicabut. Pencabutan bersifat permanen dan tidak dapat diulang.';
  if (report.status !== 'verified' && report.status !== 'issuer-inactive') {
    return `${OVERALL_STATUS[report.status].label}. ${reasonExplanation(report.reason, timeoutMs) ?? OVERALL_STATUS[report.status].meaning}`;
  }
  if (report.issuer.account?.issuerId !== entry.issuer.issuerId) {
    return 'Kredensial ini diterbitkan penerbit lain. Hanya authority penerbit terkait yang dapat mencabutnya.';
  }
  if (!isAuthority) return 'Wallet yang terhubung bukan authority penerbit yang berlaku, sehingga program akan menolak pencabutan.';
  return null;
}

export function RevokePanel({ entry }: { readonly entry: IssuerEntry }) {
  const { app, config, connection, programId } = useCluster();
  const wallet = useWallet();
  const [pdf, setPdf] = useState<File | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [reason, setReason] = useState<RevocationReasonCode | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const isAuthority = wallet.publicKey?.equals(entry.issuer.authority) ?? false;
  const busy = state.kind === 'checking' || state.kind === 'working';

  const choose = (files: readonly File[]) => {
    const nextPdf = files.find(isPdfFile);
    const nextProof = files.find(isJsonFile);
    if (nextPdf !== undefined) setPdf(nextPdf);
    if (nextProof !== undefined) setProofFile(nextProof);
    setInputError(null);
    setState({ kind: 'idle' });
    setAcknowledged(false);
  };

  const onInspect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pdf === null || proofFile === null || busy) return;
    setInputError(null);
    setState({ kind: 'checking' });
    try {
      const [bytes, proofText] = await Promise.all([readPdf(pdf), readProofText(proofFile)]);
      const proof = parseProofJson(proofText);
      if (proof.programId !== config.programId || proof.network !== config.network) {
        throw new FileInputError('File bukti merujuk program atau jaringan lain dari konfigurasi aplikasi.');
      }
      // The leaf hash binds the exact PDF; the proof alone cannot identify the credential.
      const leafHash = await documentLeafHash(bytes, proof);
      const report = await verifyCredential(connection, config, bytes, proofText);
      setState({ kind: 'ready', candidate: { report, proof, leafHash, pdfName: pdf.name, bytes, proofText }, failure: null });
    } catch (error) {
      setState({ kind: 'idle' });
      if (error instanceof ValidationError) setInputError(validationMessage(error.code));
      else if (error instanceof FileInputError) setInputError(error.message);
      else setInputError('Kredensial tidak dapat diperiksa karena galat tak terduga.');
    }
  };

  const onRevoke = async (candidate: Candidate) => {
    const authority = wallet.publicKey;
    if (authority === null || reason === null) return;
    try {
      const result = await submitAndFinalize({
        connection,
        config,
        walletRoutesToDevnet: app.walletRoutesToDevnet,
        wallet,
        feePayer: authority,
        instructions: [revokeCredentialInstruction(programId, { authority, proof: candidate.proof, leafHash: candidate.leafHash, reasonCode: reason })],
        onStage: (step, signature) => setState({ kind: 'working', candidate, step, signature }),
      });
      // Whatever the send outcome, the finalized account state decides what happened.
      setState({ kind: 'working', candidate, step: 'verifying', signature: result.signature });
      const report = await verifyCredential(connection, config, candidate.bytes, candidate.proofText);
      if (report.revocation.state === 'revoked') {
        setState({ kind: 'done', report, signature: result.signature });
        return;
      }
      const failure: TxFailure = result.kind === 'finalized'
        ? { kind: 'unknown', detail: 'Transaksi finalized tetapi catatan pencabutan belum terbaca dari RPC.' }
        : result.failure;
      setState({ kind: 'ready', candidate: { ...candidate, report }, failure });
    } catch (error) {
      setState({ kind: 'ready', candidate, failure: { kind: 'unknown', detail: error instanceof Error ? error.message : 'Galat tak terduga' } });
    }
  };

  if (state.kind === 'done') {
    return (
      <div className="panel-body" aria-live="polite">
        <Notice tone="positive" title="Pencabutan tercatat (finalized)">
          <p>Pemeriksaan berikutnya atas kredensial ini akan menampilkan status Dicabut.</p>
          {state.signature !== null && <p><TxLink signature={state.signature} /></p>}
        </Notice>
        <VerificationReportView report={state.report} timeoutMs={config.timeoutMs} headingId="revoke-after-status" />
        <div className="actions">
          <button
            type="button"
            className="button-secondary"
            onClick={() => { setPdf(null); setProofFile(null); setReason(null); setAcknowledged(false); setState({ kind: 'idle' }); }}
          >
            Cabut kredensial lain
          </button>
        </div>
      </div>
    );
  }

  const candidate = state.kind === 'ready' || state.kind === 'working' ? state.candidate : null;
  const blocked = candidate === null ? null : blocker(candidate, entry, isAuthority, config.timeoutMs);
  const report = candidate?.report;
  const batch = report?.batch.account ?? null;

  return (
    <div className="panel-body">
      <p className="lede">
        Pencabutan bersifat permanen. Kesalahan pada dokumen diperbaiki dengan mencabut kredensial lama lalu menerbitkan penggantinya
        dalam batch baru.
      </p>
      <form onSubmit={(event) => { void onInspect(event); }} noValidate>
        <fieldset className="dropzone" disabled={busy}>
          <legend>Pilih dokumen dan bukti kredensial yang dicabut</legend>
          <p className="hint">PDF diperlukan untuk menghitung leaf hash; PDF itu sendiri tidak dikirim.</p>
          <FileSlot
            id="revoke-pdf"
            label="Dokumen PDF"
            accept="application/pdf,.pdf"
            filled={pdf !== null}
            summary={pdf === null ? 'Belum dipilih' : `${pdf.name} · ${formatBytes(pdf.size)}`}
            onFiles={choose}
          />
          <FileSlot
            id="revoke-proof"
            label="File bukti (JSON)"
            accept="application/json,.json"
            filled={proofFile !== null}
            summary={proofFile === null ? 'Belum dipilih' : `${proofFile.name} · ${formatBytes(proofFile.size)}`}
            onFiles={choose}
          />
        </fieldset>
        <div className="actions">
          <button type="submit" className="button-secondary" disabled={pdf === null || proofFile === null || busy}>
            <Icon name="search" size={18} /> Periksa kredensial
          </button>
        </div>
      </form>
      {state.kind === 'checking' && <Progress>Menghitung leaf hash dan membaca status on-chain…</Progress>}
      {inputError !== null && <Notice tone="negative" live="alert"><p>{inputError}</p></Notice>}

      {candidate !== null && report !== undefined && (
        <section className="revoke-review" aria-labelledby="revoke-identity">
          <h4 id="revoke-identity">Konfirmasi kredensial</h4>
          <p className="status-line">
            <Icon name={OVERALL_STATUS[report.status].icon} size={18} />
            Status saat ini: <strong>{OVERALL_STATUS[report.status].label}</strong>
          </p>
          <Facts>
            <Fact label="Penerbit">{report.issuer.account?.name ?? 'Tidak terbaca'}</Fact>
            <Fact label="Batch ID"><Value value={candidate.proof.batchId} label="batch ID" /></Fact>
            {batch !== null && (
              <Fact label="Batch dicatat">
                {formatUnixSeconds(batch.recordedAt)} · slot <span className="num">{formatInteger(batch.recordedSlot)}</span>
              </Fact>
            )}
            <Fact label="Posisi dalam batch">
              Kredensial ke-<span className="num">{candidate.proof.leafIndex + 1}</span> dari <span className="num">{candidate.proof.leafCount}</span>
            </Fact>
            <Fact label="Leaf hash"><Value value={candidate.leafHash} label="leaf hash" /></Fact>
            <Fact label="Dokumen lokal">{candidate.pdfName} <span className="fact-note">Hanya untuk konfirmasi di layar ini; tidak dikirim.</span></Fact>
          </Facts>

          <div aria-live="polite">
            {state.kind === 'working' && (
              <Progress>
                {STEP_MESSAGES[state.step]}
                {state.signature !== null && <> <TxLink signature={state.signature} /></>}
              </Progress>
            )}
            {state.kind === 'ready' && state.failure !== null && (
              <FailureNotice failure={state.failure} title="Kredensial belum dicabut" />
            )}
          </div>

          {blocked !== null ? (
            <Notice tone={report.status === 'revoked' ? 'neutral' : 'caution'} title="Pencabutan tidak dapat dilanjutkan">
              <p>{blocked}</p>
              {report.status === 'unverifiable' && <p>Periksa kredensial lagi setelah RPC dapat dibaca; jangan anggap belum dicabut.</p>}
            </Notice>
          ) : (
            <>
              <fieldset className="radio-group" disabled={busy}>
                <legend>Alasan pencabutan</legend>
                {REVOCATION_REASONS.map((item) => (
                  <label key={item.code} className="radio">
                    <input type="radio" name="revoke-reason" value={item.code} checked={reason === item.code} onChange={() => setReason(item.code)} />
                    <span>{item.label}</span>
                  </label>
                ))}
              </fieldset>
              <div className="onchain-box">
                <h5>Yang dicatat di jaringan</h5>
                <ul>
                  <li>Leaf hash kredensial dan indeksnya dalam batch.</li>
                  <li>Jalur Merkle: {candidate.proof.siblings.length} sibling hash, agar program dapat memeriksa keanggotaan terhadap root batch.</li>
                  <li>Kode alasan, authority penanda tangan beserta versi kuncinya, serta slot dan waktu pencatatan.</li>
                </ul>
                <p>
                  Tidak dikirim: PDF, nonce, nama file, dan identitas pemilik. Siapa pun yang memegang PDF dan file bukti ini tetap
                  dapat mengaitkannya dengan catatan pencabutan.
                </p>
              </div>
              <label className="check-confirm">
                <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} />
                <span>Saya memahami pencabutan ini permanen dan tidak dapat dibatalkan.</span>
              </label>
              <div className="actions">
                <button
                  type="button"
                  className="button-danger"
                  disabled={reason === null || !acknowledged || busy}
                  onClick={() => { void onRevoke(candidate); }}
                >
                  <Icon name="ban" size={18} /> Cabut kredensial
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
