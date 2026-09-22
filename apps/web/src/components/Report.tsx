import type { ReactNode } from 'react';
import type { VerificationReport } from '../../../../packages/solana/src/index.js';
import { formatDateTime, formatInteger, formatUnixSeconds } from '../lib/format.js';
import {
  integrityCopy,
  issuerCopy,
  OVERALL_STATUS,
  reasonExplanation,
  revocationCopy,
  revocationReasonLabel,
  type SectionCopy,
} from '../lib/status.js';
import { Fact, Facts, Notice, Value } from './common.js';
import { Icon } from './Icon.js';

function CheckSection({ title, copy, children }: { readonly title: string; readonly copy: SectionCopy; readonly children?: ReactNode }) {
  return (
    <section className={`check tone-${copy.tone}`}>
      <div className="check-head">
        <Icon name={copy.icon} size={22} />
        <h4>{title}</h4>
        <p className="check-state">{copy.state}</p>
      </div>
      <p className="check-detail">{copy.detail}</p>
      {children}
    </section>
  );
}

export function VerificationReportView({ report, timeoutMs, headingId }: {
  readonly report: VerificationReport;
  readonly timeoutMs: number;
  readonly headingId: string;
}) {
  const overall = OVERALL_STATUS[report.status];
  const explanation = report.status === 'verified' ? null : reasonExplanation(report.reason, timeoutMs);
  const issuer = report.issuer.account;
  const batch = report.batch.account;
  const revocation = report.revocation.account;
  return (
    <article className={`report tone-${overall.tone}`} aria-labelledby={headingId}>
      <header className="report-head">
        <Icon name={overall.icon} size={36} />
        <div>
          <h3 id={headingId} className="report-status">{overall.label}</h3>
          <p className="report-meaning">{overall.meaning}</p>
        </div>
      </header>
      <p className="report-stamp">
        <span><Icon name="clock" size={16} /> Diperiksa {formatDateTime(report.checkedAt)}</span>
        <span>
          {report.slot === null ? 'Tidak ada snapshot jaringan' : <>Snapshot finalized slot <span className="num">{formatInteger(report.slot)}</span></>}
        </span>
      </p>

      {explanation !== null && (
        <Notice tone={overall.tone === 'neutral' ? 'neutral' : 'caution'} title="Penjelasan">
          <p>{explanation}</p>
        </Notice>
      )}
      {report.issuer.state === 'inactive' && (
        <Notice tone="caution" icon="pause" title="Penerbit nonaktif">
          <p>
            Admin registry telah menonaktifkan penerbit ini. Kredensial lama tidak otomatis dicabut, tetapi statusnya memerlukan
            perhatian: hubungi institusi melalui saluran resmi sebelum mengandalkan dokumen ini.
          </p>
        </Notice>
      )}

      <div className="checks">
        <CheckSection title="Integritas" copy={integrityCopy(report, timeoutMs)} />
        <CheckSection title="Penerbit" copy={issuerCopy(report)}>
          {issuer !== null && (
            <Facts>
              <Fact label="Nama institusi">{issuer.name}</Fact>
              <Fact label="Domain tercatat">
                {issuer.domain}
                <span className="fact-note">Dicatat admin sebagai informasi pendukung; tidak diperiksa otomatis.</span>
              </Fact>
              <Fact label="Issuer ID"><Value value={issuer.issuerId} label="issuer ID" /></Fact>
              <Fact label="Versi kunci saat ini"><span className="num">{issuer.keyVersion}</span></Fact>
            </Facts>
          )}
        </CheckSection>
        <CheckSection title="Pencabutan" copy={revocationCopy(report)}>
          {revocation !== null && (
            <Facts>
              <Fact label="Alasan">{revocationReasonLabel(revocation.reasonCode)}</Fact>
              <Fact label="Dicatat">
                {formatUnixSeconds(revocation.recordedAt)} · slot <span className="num">{formatInteger(revocation.recordedSlot)}</span>
              </Fact>
              <Fact label="Dicabut oleh authority"><Value value={revocation.revokingAuthority.toBase58()} label="authority pencabut" /></Fact>
              <Fact label="Versi kunci pencabut"><span className="num">{revocation.keyVersion}</span></Fact>
            </Facts>
          )}
        </CheckSection>
      </div>

      {batch !== null && (
        <section className="report-batch" aria-label="Data batch on-chain">
          <h4>Batch on-chain</h4>
          <Facts>
            <Fact label="Batch ID"><Value value={batch.batchId} label="batch ID" /></Fact>
            <Fact label="Jumlah dokumen"><span className="num">{formatInteger(batch.leafCount)}</span></Fact>
            <Fact label="Dicatat">
              {formatUnixSeconds(batch.recordedAt)} · slot <span className="num">{formatInteger(batch.recordedSlot)}</span>
            </Fact>
            <Fact label="Kunci penerbit saat publikasi">
              <Value value={batch.issuingAuthority.toBase58()} label="kunci penerbit saat publikasi" />
              <span className="fact-note">Versi kunci {batch.keyVersion}</span>
            </Fact>
            {report.batch.address !== null && <Fact label="Alamat akun batch"><Value value={report.batch.address} label="alamat akun batch" /></Fact>}
          </Facts>
        </section>
      )}
    </article>
  );
}
