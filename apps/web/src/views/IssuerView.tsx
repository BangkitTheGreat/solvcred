import { useWallet } from '@solana/wallet-adapter-react';
import type { PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useState } from 'react';
import { fetchIssuer, fetchIssuersByAuthority, rotateAuthorityInstruction } from '../../../../packages/solana/src/index.js';
import { useCluster } from '../cluster.js';
import { Fact, Facts, Notice, TabPanel, Tabs, Value, type TabItem } from '../components/common.js';
import { Icon } from '../components/Icon.js';
import { TwoStepSigning } from '../components/TwoStepSigning.js';
import { WalletControl } from '../components/WalletControl.js';
import { formatInteger } from '../lib/format.js';
import type { IssuerEntry } from '../lib/issuer.js';
import { assertReadyCluster, readErrorMessage } from '../lib/tx.js';
import { PublishPanel } from './PublishPanel.js';
import { RevokePanel } from './RevokePanel.js';

type Lookup =
  | { readonly state: 'idle' }
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly entries: readonly IssuerEntry[] }
  | { readonly state: 'error'; readonly message: string };

type Section = 'publish' | 'revoke' | 'rotate';

const SECTIONS: readonly TabItem<Section>[] = [
  { id: 'publish', label: 'Terbitkan batch', icon: 'upload' },
  { id: 'revoke', label: 'Cabut kredensial', icon: 'ban' },
  { id: 'rotate', label: 'Rotasi kunci', icon: 'key' },
];

export function IssuerView() {
  const { app, config, connection, programId } = useCluster();
  const { publicKey } = useWallet();
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  // Selection survives wallet switches so key rotation and in-progress drafts are not lost.
  const [selected, setSelected] = useState<IssuerEntry | null>(null);
  const [section, setSection] = useState<Section>('publish');

  const load = useCallback(async (authority: PublicKey, isCancelled: () => boolean) => {
    setLookup({ state: 'loading' });
    try {
      await assertReadyCluster(connection, config);
      const entries = await fetchIssuersByAuthority(connection, config, authority);
      if (isCancelled()) return;
      setLookup({ state: 'ready', entries });
      setSelected((current) => {
        const refreshed = current === null ? undefined : entries.find((entry) => entry.address.equals(current.address));
        return refreshed ?? current ?? entries[0] ?? null;
      });
    } catch (error) {
      if (!isCancelled()) setLookup({ state: 'error', message: readErrorMessage(error) });
    }
  }, [config, connection]);

  useEffect(() => {
    if (publicKey === null) {
      setLookup({ state: 'idle' });
      return;
    }
    let cancelled = false;
    void load(publicKey, () => cancelled);
    return () => { cancelled = true; };
  }, [load, publicKey]);

  const refreshSelected = useCallback(async () => {
    if (selected === null) return;
    try {
      const issuer = await fetchIssuer(connection, config, selected.issuer.issuerId);
      if (issuer !== null) setSelected({ address: selected.address, issuer });
    } catch {
      // Keep the last known snapshot; the next lookup retries.
    }
  }, [config, connection, selected]);

  const isAuthority = selected !== null && publicKey !== null && publicKey.equals(selected.issuer.authority);
  const entries = lookup.state === 'ready' ? lookup.entries : [];

  return (
    <div className="view">
      <header className="view-head view-head-split">
        <div>
          <h2>Penerbit</h2>
          <p className="lede">
            Terbitkan batch, cabut kredensial, dan rotasi kunci. Membutuhkan wallet authority yang telah didaftarkan admin registry.
          </p>
        </div>
        <WalletControl />
      </header>
      {!app.walletRoutesToDevnet && (
        <Notice tone="caution" title="RPC khusus terdeteksi">
          <p>URL RPC tidak memuat kata "devnet", jadi transaksi ditandatangani wallet lalu dikirim lewat RPC konfigurasi.</p>
        </Notice>
      )}

      {publicKey === null && selected === null && (
        <div className="result-empty">
          <h3>Hubungkan wallet penerbit</h3>
          <p>Wallet dipakai untuk menandatangani publikasi, pencabutan, dan rotasi kunci. Verifikasi dokumen tidak membutuhkan wallet.</p>
        </div>
      )}

      {publicKey !== null && (
        <section className="issuer-lookup" aria-labelledby="issuer-lookup-title" aria-busy={lookup.state === 'loading'}>
          <div className="section-head">
            <h3 id="issuer-lookup-title">Penerbit untuk wallet ini</h3>
            <button
              type="button"
              className="button-quiet"
              disabled={lookup.state === 'loading'}
              onClick={() => { void load(publicKey, () => false); }}
            >
              <Icon name="refresh" size={16} /> Muat ulang
            </button>
          </div>
          {lookup.state === 'loading' && <div className="skeleton skeleton-row" aria-label="Memuat penerbit" />}
          {lookup.state === 'error' && <Notice tone="negative" live="alert"><p>{lookup.message}</p></Notice>}
          {lookup.state === 'ready' && entries.length === 0 && (
            <Notice tone="neutral" title="Wallet ini belum menjadi authority penerbit">
              <p>
                Minta admin registry mendaftarkan public key berikut setelah pemeriksaan institusi di luar aplikasi:{' '}
                <Value value={publicKey.toBase58()} label="public key wallet" />
              </p>
            </Notice>
          )}
          {entries.length === 1 && (
            <p className="muted">Wallet ini adalah authority untuk satu penerbit terdaftar, ditampilkan di bawah.</p>
          )}
          {entries.length > 1 && (
            <fieldset className="radio-group">
              <legend>Pilih penerbit</legend>
              {entries.map((entry) => (
                <label key={entry.address.toBase58()} className="radio">
                  <input
                    type="radio"
                    name="issuer-choice"
                    checked={selected?.address.equals(entry.address) ?? false}
                    onChange={() => setSelected(entry)}
                  />
                  <span>{entry.issuer.name} <span className="muted">· {entry.issuer.domain}</span></span>
                </label>
              ))}
            </fieldset>
          )}
        </section>
      )}

      {selected !== null && (
        <>
          <section className="issuer-card" aria-labelledby="issuer-card-title">
            <div className="section-head">
              <h3 id="issuer-card-title">{selected.issuer.name}</h3>
              <span className={`badge ${selected.issuer.active ? 'badge-positive' : 'badge-caution'}`}>
                <Icon name={selected.issuer.active ? 'check' : 'pause'} size={14} />
                {selected.issuer.active ? 'Aktif' : 'Nonaktif'}
              </span>
            </div>
            <Facts>
              <Fact label="Domain tercatat">{selected.issuer.domain}</Fact>
              <Fact label="Issuer ID"><Value value={selected.issuer.issuerId} label="issuer ID" /></Fact>
              <Fact label="Authority saat ini"><Value value={selected.issuer.authority.toBase58()} label="authority" /></Fact>
              <Fact label="Versi kunci"><span className="num">{selected.issuer.keyVersion}</span></Fact>
              <Fact label="Terdaftar pada slot"><span className="num">{formatInteger(selected.issuer.registeredSlot)}</span></Fact>
              <Fact label="Alamat akun issuer"><Value value={selected.address.toBase58()} label="alamat akun issuer" /></Fact>
            </Facts>
            {!isAuthority && (
              <Notice tone="caution" title="Wallet terhubung bukan authority penerbit ini">
                <p>Publikasi dan pencabutan akan ditolak program. Rotasi kunci memakai wallet ini hanya sebagai penanda tangan kedua.</p>
              </Notice>
            )}
          </section>

          <Tabs items={SECTIONS} selected={section} onSelect={setSection} label="Tindakan penerbit" idPrefix="issuer" variant="secondary" />
          {/* Keyed by issuer so switching issuers never carries a draft across identities. */}
          <div key={selected.address.toBase58()}>
            <TabPanel idPrefix="issuer" id="publish" selected={section === 'publish'}>
              <PublishPanel entry={selected} />
            </TabPanel>
            <TabPanel idPrefix="issuer" id="revoke" selected={section === 'revoke'}>
              <RevokePanel entry={selected} />
            </TabPanel>
            <TabPanel idPrefix="issuer" id="rotate" selected={section === 'rotate'}>
              <div className="panel-body">
                <p className="lede">
                  Rotasi normal membutuhkan persetujuan kunci lama dan kunci baru dalam satu transaksi. Issuer ID dan batch lama tidak
                  berubah; kunci lama langsung kehilangan otorisasi. Jika kunci lama hilang atau dicuri, minta pemulihan ke admin registry.
                </p>
                <TwoStepSigning
                  firstSignerLabel="kunci lama"
                  firstSigner={selected.issuer.authority}
                  currentAuthority={selected.issuer.authority}
                  buildInstruction={(newAuthority) => rotateAuthorityInstruction(programId, {
                    issuerId: selected.issuer.issuerId,
                    authority: selected.issuer.authority,
                    newAuthority,
                  })}
                  isApplied={async (newAuthority) => {
                    const issuer = await fetchIssuer(connection, config, selected.issuer.issuerId);
                    return issuer?.authority.equals(newAuthority) ?? false;
                  }}
                  onDone={() => { void refreshSelected(); }}
                />
              </div>
            </TabPanel>
          </div>
        </>
      )}
    </div>
  );
}
