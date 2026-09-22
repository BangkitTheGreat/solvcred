import { useWallet } from '@solana/wallet-adapter-react';
import type { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { randomId } from '../../../../packages/core/src/index.js';
import {
  deactivateIssuerInstruction,
  fetchIssuer,
  fetchRegistry,
  initializeRegistryInstruction,
  isValidIssuerDomain,
  isValidIssuerName,
  recoverAuthorityInstruction,
  registerIssuerInstruction,
  type IssuerAccount,
  type RegistryAccount,
} from '../../../../packages/solana/src/index.js';
import { useCluster } from '../cluster.js';
import { CopyButton, Fact, Facts, FailureNotice, Notice, Progress, TabPanel, Tabs, TxLink, Value, type TabItem } from '../components/common.js';
import { Icon } from '../components/Icon.js';
import { TwoStepSigning } from '../components/TwoStepSigning.js';
import { WalletControl } from '../components/WalletControl.js';
import { formatInteger } from '../lib/format.js';
import { parseIssuerIdInput, parsePublicKeyInput } from '../lib/validate.js';
import {
  assertReadyCluster,
  readErrorMessage,
  submitAndFinalize,
  type SubmitStage,
  type TxFailure,
} from '../lib/tx.js';

type Registry =
  | { readonly state: 'loading' }
  | { readonly state: 'missing' }
  | { readonly state: 'ready'; readonly registry: RegistryAccount }
  | { readonly state: 'error'; readonly message: string };

type Section = 'registry' | 'register' | 'deactivate' | 'recover';

const SECTIONS: readonly TabItem<Section>[] = [
  { id: 'registry', label: 'Registry', icon: 'shield' },
  { id: 'register', label: 'Daftarkan penerbit', icon: 'key' },
  { id: 'deactivate', label: 'Nonaktifkan', icon: 'pause' },
  { id: 'recover', label: 'Pulihkan kunci', icon: 'refresh' },
];

const STAGE_MESSAGES: Readonly<Record<SubmitStage, string>> = {
  preparing: 'Menyiapkan transaksi…',
  wallet: 'Menunggu persetujuan di wallet…',
  confirming: 'Transaksi terkirim. Menunggu status finalized…',
};

type Submission =
  | { readonly state: 'idle' }
  | { readonly state: 'working'; readonly stage: SubmitStage | 'verifying'; readonly signature: string | null }
  | { readonly state: 'done'; readonly signature: string | null }
  | { readonly state: 'failed'; readonly failure: TxFailure };

/**
 * Sends one admin instruction and then re-reads the affected account at `finalized`; the re-read,
 * not the send result, decides success, so an ambiguous send is never reported as failure or success.
 * Resolves with the re-read account (or null when it could not be read).
 */
function useAdminSubmit() {
  const { app, config, connection } = useCluster();
  const wallet = useWallet();
  const [submission, setSubmission] = useState<Submission>({ state: 'idle' });
  const submit = useCallback(async <T,>(
    build: (admin: PublicKey) => TransactionInstruction,
    readBack: () => Promise<T | null>,
    applied: (account: T) => boolean,
  ): Promise<T | null> => {
    const admin = wallet.publicKey;
    if (admin === null) return null;
    const result = await submitAndFinalize({
      connection,
      config,
      walletRoutesToDevnet: app.walletRoutesToDevnet,
      wallet,
      feePayer: admin,
      instructions: [build(admin)],
      onStage: (stage, signature) => setSubmission({ state: 'working', stage, signature }),
    });
    setSubmission({ state: 'working', stage: 'verifying', signature: result.signature });
    const account = await readBack().catch(() => null);
    if (account !== null && applied(account)) {
      setSubmission({ state: 'done', signature: result.signature });
    } else {
      setSubmission({
        state: 'failed',
        failure: result.kind === 'finalized'
          ? { kind: 'unknown', detail: 'Transaksi finalized tetapi perubahan belum terbaca dari RPC.' }
          : result.failure,
      });
    }
    return account;
  }, [app.walletRoutesToDevnet, config, connection, wallet]);
  const reset = useCallback(() => setSubmission({ state: 'idle' }), []);
  return { submission, submit, reset };
}

function SubmissionStatus({ submission, successTitle, failureTitle }: {
  readonly submission: Submission;
  readonly successTitle: string;
  readonly failureTitle: string;
}) {
  return (
    <div aria-live="polite">
      {submission.state === 'working' && (
        <Progress>
          {submission.stage === 'verifying' ? 'Membaca ulang akun di jaringan (finalized)…' : STAGE_MESSAGES[submission.stage]}
          {submission.signature !== null && <> <TxLink signature={submission.signature} /></>}
        </Progress>
      )}
      {submission.state === 'done' && (
        <Notice tone="positive" title={successTitle}>
          {submission.signature !== null && <p><TxLink signature={submission.signature} /></p>}
        </Notice>
      )}
      {submission.state === 'failed' && <FailureNotice failure={submission.failure} title={failureTitle} />}
    </div>
  );
}

export function AdminView() {
  const { config, connection } = useCluster();
  const { publicKey } = useWallet();
  const [registry, setRegistry] = useState<Registry>({ state: 'loading' });
  const [section, setSection] = useState<Section>('registry');

  const loadRegistry = useCallback(async () => {
    setRegistry({ state: 'loading' });
    try {
      await assertReadyCluster(connection, config);
      const account = await fetchRegistry(connection, config);
      setRegistry(account === null ? { state: 'missing' } : { state: 'ready', registry: account });
    } catch (error) {
      setRegistry({ state: 'error', message: readErrorMessage(error) });
    }
  }, [config, connection]);

  useEffect(() => { void loadRegistry(); }, [loadRegistry]);

  const admin = registry.state === 'ready' ? registry.registry.admin : null;
  const isAdmin = admin !== null && publicKey !== null && publicKey.equals(admin);

  return (
    <div className="view">
      <header className="view-head view-head-split">
        <div>
          <h2>Admin registry</h2>
          <p className="lede">
            Admin memeriksa institusi di luar aplikasi, lalu mendaftarkan, menonaktifkan, atau memulihkan kunci penerbit. Pendaftaran
            mandiri tidak menjadikan institusi dipercaya.
          </p>
        </div>
        <WalletControl />
      </header>

      <section className="registry-card" aria-labelledby="registry-title" aria-busy={registry.state === 'loading'}>
        <div className="section-head">
          <h3 id="registry-title">Status registry</h3>
          <button type="button" className="button-quiet" disabled={registry.state === 'loading'} onClick={() => { void loadRegistry(); }}>
            <Icon name="refresh" size={16} /> Muat ulang
          </button>
        </div>
        {registry.state === 'loading' && <div className="skeleton skeleton-row" aria-label="Memuat registry" />}
        {registry.state === 'error' && <Notice tone="negative" live="alert"><p>{registry.message}</p></Notice>}
        {registry.state === 'missing' && (
          <Notice tone="neutral" title="Registry belum diinisialisasi">
            <p>Buka tab Registry untuk inisialisasi oleh upgrade authority program.</p>
          </Notice>
        )}
        {registry.state === 'ready' && (
          <>
            <Facts>
              <Fact label="Admin registry"><Value value={registry.registry.admin.toBase58()} label="admin registry" /></Fact>
              <Fact label="Versi konfigurasi"><span className="num">{registry.registry.version}</span></Fact>
            </Facts>
            {publicKey !== null && !isAdmin && (
              <Notice tone="caution" title="Wallet terhubung bukan admin registry">
                <p>Tindakan admin akan ditolak program. Pemulihan kunci tetap memakai wallet ini sebagai penanda tangan kedua.</p>
              </Notice>
            )}
          </>
        )}
      </section>

      <Tabs items={SECTIONS} selected={section} onSelect={setSection} label="Tindakan admin" idPrefix="admin" variant="secondary" />
      <TabPanel idPrefix="admin" id="registry" selected={section === 'registry'}>
        <InitializePanel registry={registry} onChanged={() => { void loadRegistry(); }} />
      </TabPanel>
      <TabPanel idPrefix="admin" id="register" selected={section === 'register'}>
        <RegisterPanel isAdmin={isAdmin} />
      </TabPanel>
      <TabPanel idPrefix="admin" id="deactivate" selected={section === 'deactivate'}>
        <DeactivatePanel isAdmin={isAdmin} />
      </TabPanel>
      <TabPanel idPrefix="admin" id="recover" selected={section === 'recover'}>
        <RecoverPanel admin={admin} />
      </TabPanel>
    </div>
  );
}

function InitializePanel({ registry, onChanged }: { readonly registry: Registry; readonly onChanged: () => void }) {
  const { config, connection, programId } = useCluster();
  const { publicKey } = useWallet();
  const { submission, submit } = useAdminSubmit();
  const busy = submission.state === 'working';
  return (
    <div className="panel-body">
      <p className="lede">
        Inisialisasi hanya dapat dilakukan satu kali oleh upgrade authority program saat ini; wallet lain ditolak program, sehingga
        bootstrap bukan siapa-cepat-dia-dapat. Wallet yang menginisialisasi menjadi admin registry.
      </p>
      {registry.state === 'ready' ? (
        <Notice tone="positive" title="Registry sudah diinisialisasi">
          <p>Tidak ada inisialisasi ulang. Pergantian admin tidak tersedia di MVP.</p>
        </Notice>
      ) : (
        <>
          <SubmissionStatus submission={submission} successTitle="Registry diinisialisasi (finalized)" failureTitle="Registry belum diinisialisasi" />
          <div className="actions">
            <button
              type="button"
              className="button-primary"
              disabled={publicKey === null || registry.state !== 'missing' || busy || submission.state === 'done'}
              onClick={() => {
                void submit(
                  (admin) => initializeRegistryInstruction(programId, admin),
                  () => fetchRegistry(connection, config),
                  () => true,
                ).then(onChanged);
              }}
            >
              <Icon name="shield" size={18} /> Inisialisasi registry
            </button>
          </div>
          {publicKey === null && <p className="hint">Hubungkan wallet upgrade authority terlebih dahulu.</p>}
        </>
      )}
    </div>
  );
}

function RegisterPanel({ isAdmin }: { readonly isAdmin: boolean }) {
  const { config, connection, programId } = useCluster();
  const { submission, submit, reset } = useAdminSubmit();
  const formId = useId();
  const [issuerId, setIssuerId] = useState(randomId);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [authority, setAuthority] = useState('');
  const [touched, setTouched] = useState(false);
  const [registered, setRegistered] = useState<IssuerAccount | null>(null);
  const busy = submission.state === 'working';

  const authorityKey = parsePublicKeyInput(authority);
  const problems = {
    name: isValidIssuerName(name) ? null : 'Nama wajib 1–96 byte tanpa karakter kontrol.',
    domain: isValidIssuerDomain(domain) ? null : 'Gunakan huruf kecil a-z, angka, titik, atau tanda hubung (maks. 64), tanpa titik/tanda hubung di awal atau akhir.',
    authority: authorityKey === null ? 'Masukkan public key Solana yang valid (bukan kunci nol).' : null,
  };
  const valid = Object.values(problems).every((problem) => problem === null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (!valid || authorityKey === null || !isAdmin || busy) return;
    const account = await submit(
      (admin) => registerIssuerInstruction(programId, { admin, issuerId, name, domain, authority: authorityKey }),
      () => fetchIssuer(connection, config, issuerId),
      () => true,
    );
    setRegistered(account);
  };

  const startNext = () => {
    setIssuerId(randomId());
    setName('');
    setDomain('');
    setAuthority('');
    setTouched(false);
    setRegistered(null);
    reset();
  };

  return (
    <div className="panel-body">
      <p className="lede">
        Daftarkan institusi setelah identitas, domain, dan penguasaan wallet diperiksa di luar aplikasi. Issuer ID adalah identitas
        stabil; authority dapat berganti tanpa mengubahnya.
      </p>
      {registered !== null ? (
        <>
          <SubmissionStatus submission={submission} successTitle="Penerbit terdaftar (finalized)" failureTitle="Penerbit belum terdaftar" />
          <Facts>
            <Fact label="Nama">{registered.name}</Fact>
            <Fact label="Domain">{registered.domain}</Fact>
            <Fact label="Issuer ID"><Value value={registered.issuerId} label="issuer ID" /></Fact>
            <Fact label="Authority"><Value value={registered.authority.toBase58()} label="authority" /></Fact>
            <Fact label="Status">{registered.active ? 'Aktif' : 'Nonaktif'} · versi kunci {registered.keyVersion}</Fact>
          </Facts>
          <p className="hint">Serahkan issuer ID ini kepada institusi; mereka tidak memerlukannya untuk masuk, tetapi berguna untuk dukungan.</p>
          <div className="actions"><button type="button" className="button-secondary" onClick={startNext}>Daftarkan penerbit lain</button></div>
        </>
      ) : (
        <form className="form-grid" onSubmit={(event) => { void onSubmit(event); }} noValidate>
          <div className="field">
            <span className="field-label" id={`${formId}-id`}>Issuer ID (dibuat acak, 32 byte)</span>
            <span className="value-row" aria-labelledby={`${formId}-id`}>
              <code>{issuerId}</code>
              <CopyButton value={issuerId} label="issuer ID" />
              <button type="button" className="button-quiet" disabled={busy} onClick={() => setIssuerId(randomId())}>Buat ulang</button>
            </span>
            <p className="hint">Salin dan simpan bersama dokumen pemeriksaan institusi.</p>
          </div>
          <TextField id={`${formId}-name`} label="Nama institusi" value={name} onChange={setName} disabled={busy}
            error={touched ? problems.name : null} hint="Contoh: Universitas Contoh Nusantara (data simulasi)." />
          <TextField id={`${formId}-domain`} label="Domain resmi" value={domain} onChange={(value) => setDomain(value.trim())} disabled={busy}
            error={touched ? problems.domain : null} hint="Dicatat sebagai informasi pendukung, bukan bukti legitimasi otomatis." mono />
          <TextField id={`${formId}-authority`} label="Public key authority penerbit" value={authority} onChange={setAuthority} disabled={busy}
            error={touched ? problems.authority : null} hint="Wallet institusi yang akan menandatangani publikasi dan pencabutan." mono />
          <SubmissionStatus submission={submission} successTitle="Penerbit terdaftar (finalized)" failureTitle="Penerbit belum terdaftar" />
          <div className="actions">
            <button type="submit" className="button-primary" disabled={!isAdmin || busy}>
              <Icon name="key" size={18} /> Daftarkan penerbit
            </button>
          </div>
          {!isAdmin && <p className="hint">Hanya wallet admin registry yang dapat mendaftarkan penerbit.</p>}
        </form>
      )}
    </div>
  );
}

function TextField({ id, label, value, onChange, error, hint, disabled, mono }: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | null;
  readonly hint: string;
  readonly disabled?: boolean;
  readonly mono?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        className={mono === true ? 'mono' : undefined}
        value={value}
        disabled={disabled}
        aria-invalid={error !== null}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={`${id}-hint`} className={error === null ? 'hint' : 'hint hint-error'}>{error ?? hint}</p>
    </div>
  );
}

/** Looks up an issuer by ID for admin actions that take the ID as input. */
function IssuerLookup({ id, onFound, disabled }: {
  readonly id: string;
  readonly onFound: (issuer: IssuerAccount | null) => void;
  readonly disabled?: boolean;
}) {
  const { config, connection } = useCluster();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<{ readonly state: 'idle' | 'loading' | 'missing' } | { readonly state: 'error'; readonly message: string }>({ state: 'idle' });
  const issuerId = parseIssuerIdInput(input);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (issuerId === null) return;
    setStatus({ state: 'loading' });
    onFound(null);
    try {
      await assertReadyCluster(connection, config);
      const issuer = await fetchIssuer(connection, config, issuerId);
      setStatus({ state: issuer === null ? 'missing' : 'idle' });
      onFound(issuer);
    } catch (error) {
      setStatus({ state: 'error', message: readErrorMessage(error) });
    }
  };

  return (
    <form className="lookup" onSubmit={(event) => { void onSubmit(event); }} noValidate>
      <div className="field">
        <label htmlFor={id}>Issuer ID</label>
        <div className="inline-field">
          <input
            id={id}
            type="text"
            className="mono"
            autoComplete="off"
            spellCheck={false}
            value={input}
            disabled={disabled}
            aria-invalid={input.trim() !== '' && issuerId === null}
            aria-describedby={`${id}-hint`}
            onChange={(event) => { setInput(event.target.value); setStatus({ state: 'idle' }); onFound(null); }}
          />
          <button type="submit" className="button-secondary" disabled={issuerId === null || status.state === 'loading' || disabled}>
            <Icon name="search" size={18} /> Cari
          </button>
        </div>
        <p id={`${id}-hint`} className={input.trim() !== '' && issuerId === null ? 'hint hint-error' : 'hint'}>
          {input.trim() !== '' && issuerId === null ? 'Issuer ID adalah 64 karakter heksadesimal.' : '64 karakter heksadesimal dari pendaftaran penerbit.'}
        </p>
      </div>
      {status.state === 'loading' && <Progress>Membaca akun issuer (finalized)…</Progress>}
      {status.state === 'missing' && <Notice tone="neutral"><p>Issuer dengan ID ini tidak ada dalam registry.</p></Notice>}
      {status.state === 'error' && <Notice tone="negative" live="alert"><p>{status.message}</p></Notice>}
    </form>
  );
}

function IssuerSummary({ issuer }: { readonly issuer: IssuerAccount }) {
  return (
    <Facts>
      <Fact label="Nama">{issuer.name}</Fact>
      <Fact label="Domain tercatat">{issuer.domain}</Fact>
      <Fact label="Status">
        <span className="status-line">
          <Icon name={issuer.active ? 'check' : 'pause'} size={16} />
          {issuer.active ? 'Aktif' : 'Nonaktif'}
        </span>
      </Fact>
      <Fact label="Authority saat ini"><Value value={issuer.authority.toBase58()} label="authority" /></Fact>
      <Fact label="Versi kunci"><span className="num">{issuer.keyVersion}</span></Fact>
      <Fact label="Terdaftar pada slot"><span className="num">{formatInteger(issuer.registeredSlot)}</span></Fact>
    </Facts>
  );
}

function DeactivatePanel({ isAdmin }: { readonly isAdmin: boolean }) {
  const { config, connection, programId } = useCluster();
  const { submission, submit, reset } = useAdminSubmit();
  const lookupId = useId();
  const [issuer, setIssuer] = useState<IssuerAccount | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const busy = submission.state === 'working';

  const onDeactivate = async () => {
    if (issuer === null) return;
    const target = issuer.issuerId;
    const refreshed = await submit(
      (admin) => deactivateIssuerInstruction(programId, { admin, issuerId: target }),
      () => fetchIssuer(connection, config, target),
      (account) => !account.active,
    );
    if (refreshed !== null) setIssuer(refreshed);
    setAcknowledged(false);
  };

  return (
    <div className="panel-body">
      <p className="lede">
        Penonaktifan menghentikan penerbitan batch baru. Kredensial lama tidak otomatis dicabut dan verifikator melihat peringatan
        "Penerbit nonaktif". Authority penerbit tetap dapat mencabut kredensial. Tidak ada reaktivasi di MVP.
      </p>
      <IssuerLookup id={lookupId} disabled={busy} onFound={(found) => { setIssuer(found); setAcknowledged(false); reset(); }} />
      {issuer !== null && (
        <section className="confirm-card" aria-label="Penerbit yang akan dinonaktifkan">
          <IssuerSummary issuer={issuer} />
          <SubmissionStatus submission={submission} successTitle="Penerbit dinonaktifkan (finalized)" failureTitle="Penerbit belum dinonaktifkan" />
          {issuer.active ? (
            <>
              <label className="check-confirm">
                <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} />
                <span>Saya telah memeriksa bahwa {issuer.name} harus dinonaktifkan, dan memahami tindakan ini tidak dapat dibatalkan di MVP.</span>
              </label>
              <div className="actions">
                <button type="button" className="button-danger" disabled={!isAdmin || !acknowledged || busy} onClick={() => { void onDeactivate(); }}>
                  <Icon name="pause" size={18} /> Nonaktifkan penerbit
                </button>
              </div>
              {!isAdmin && <p className="hint">Hanya wallet admin registry yang dapat menonaktifkan penerbit.</p>}
            </>
          ) : submission.state !== 'done' && (
            <Notice tone="neutral" title="Penerbit sudah nonaktif"><p>Tidak ada tindakan lanjutan.</p></Notice>
          )}
        </section>
      )}
    </div>
  );
}

function RecoverPanel({ admin }: { readonly admin: PublicKey | null }) {
  const { config, connection, programId } = useCluster();
  const lookupId = useId();
  const [issuer, setIssuer] = useState<IssuerAccount | null>(null);

  const refresh = async (issuerId: string) => {
    try {
      const account = await fetchIssuer(connection, config, issuerId);
      if (account !== null) setIssuer(account);
    } catch {
      // Keep the last known snapshot.
    }
  };

  return (
    <div className="panel-body">
      <p className="lede">
        Untuk kunci penerbit yang hilang atau dicuri, setelah pemeriksaan di luar aplikasi. Admin dan kunci baru menandatangani satu
        transaksi. Pemulihan tidak membatalkan batch yang mungkin telah diterbitkan penyerang; tinjau batch terdampak dan cabut
        kredensialnya.
      </p>
      <IssuerLookup id={lookupId} onFound={setIssuer} />
      {issuer !== null && admin === null && (
        <Notice tone="neutral"><p>Registry belum terbaca, sehingga admin penanda tangan belum diketahui.</p></Notice>
      )}
      {issuer !== null && admin !== null && (
        <section className="confirm-card" aria-label="Penerbit yang dipulihkan">
          <IssuerSummary issuer={issuer} />
          <TwoStepSigning
            key={issuer.issuerId}
            firstSignerLabel="admin registry"
            firstSigner={admin}
            currentAuthority={issuer.authority}
            buildInstruction={(newAuthority) => recoverAuthorityInstruction(programId, { admin, issuerId: issuer.issuerId, newAuthority })}
            isApplied={async (newAuthority) => (await fetchIssuer(connection, config, issuer.issuerId))?.authority.equals(newAuthority) ?? false}
            onDone={() => { void refresh(issuer.issuerId); }}
          />
        </section>
      )}
    </div>
  );
}
