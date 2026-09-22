import './styles.css';
import type { Adapter } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import type { ConnectionConfig } from '@solana/web3.js';
import { useEffect, useState } from 'react';
import { ClusterProvider, useCluster } from './cluster.js';
import { Notice, TabPanel, Tabs, type TabItem } from './components/common.js';
import { Icon } from './components/Icon.js';
import { useWalletErrorHandler, WalletNoticeProvider } from './components/WalletControl.js';
import { rpcHost, type AppConfig } from './lib/config.js';
import { AdminView } from './views/AdminView.js';
import { IssuerView } from './views/IssuerView.js';
import { VerifyView } from './views/VerifyView.js';

// Stable references: no adapter packages, Wallet Standard wallets are detected automatically.
const WALLET_ADAPTERS: Adapter[] = [];
const CONNECTION_CONFIG: ConnectionConfig = { commitment: 'finalized' };

type ViewId = 'verifikasi' | 'penerbit' | 'admin';

const VIEWS: readonly TabItem<ViewId>[] = [
  { id: 'verifikasi', label: 'Verifikasi', icon: 'search' },
  { id: 'penerbit', label: 'Penerbit', icon: 'key' },
  { id: 'admin', label: 'Admin registry', icon: 'shield' },
];

function viewFromHash(): ViewId {
  const hash = window.location.hash.slice(1);
  return VIEWS.find((view) => view.id === hash)?.id ?? 'verifikasi';
}

export function App({ app }: { readonly app: AppConfig }) {
  const { notice, onError } = useWalletErrorHandler();
  if (app.problems.length > 0) return <ConfigProblems problems={app.problems} />;
  return (
    <ConnectionProvider endpoint={app.cluster.rpcUrl} config={CONNECTION_CONFIG}>
      <WalletProvider wallets={WALLET_ADAPTERS} autoConnect onError={onError}>
        <WalletNoticeProvider notice={notice}>
          <ClusterProvider app={app}>
            <Shell />
          </ClusterProvider>
        </WalletNoticeProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function Shell() {
  const { app, config } = useCluster();
  const [view, setView] = useState<ViewId>(viewFromHash);
  // Wallet views mount on first visit only, then stay mounted so their state survives tab switches.
  const [visited, setVisited] = useState<ReadonlySet<ViewId>>(() => new Set([viewFromHash()]));

  useEffect(() => {
    const onHashChange = () => {
      const next = viewFromHash();
      setView(next);
      setVisited((current) => new Set(current).add(next));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const select = (next: ViewId) => {
    setView(next);
    setVisited((current) => new Set(current).add(next));
    window.history.replaceState(null, '', `#${next}`);
  };

  return (
    <>
      <a className="skip-link" href="#main">Lewati ke konten</a>
      <header className="app-header">
        <div className="container header-row">
          <div className="brand">
            <svg className="brand-mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
              <path d="M16 7v6M16 13 9 21M16 13l7 8" />
              <circle cx="16" cy="6" r="3" />
              <rect x="5.5" y="21" width="7" height="7" rx="1.5" />
              <rect x="19.5" y="21" width="7" height="7" rx="1.5" />
            </svg>
            <div>
              <h1 className="brand-name">SolVcred</h1>
              <p className="brand-sub">Verifikasi kredensial digital</p>
            </div>
          </div>
          <ul className="env-badges" aria-label="Lingkungan">
            <li className="badge badge-network" title="Jaringan uji Solana; bukan mainnet.">
              <span className="badge-dot" aria-hidden="true" />Devnet
            </li>
            <li className="badge badge-sim" title="Institusi, dokumen, dan kredensial di sini adalah contoh, bukan kredensial resmi.">
              <Icon name="info" size={14} />Data simulasi
            </li>
          </ul>
        </div>
        <nav className="container" aria-label="Bagian aplikasi">
          <Tabs items={VIEWS} selected={view} onSelect={select} label="Bagian aplikasi" idPrefix="view" />
        </nav>
      </header>

      {app.isPlaceholderProgram && (
        <div className="banner" role="note">
          <div className="container banner-inner">
            <Icon name="alert" size={20} />
            <p>
              <strong>Program belum di-deploy.</strong> Aplikasi memakai program ID placeholder{' '}
              <code>{config.programId}</code> yang tidak memiliki deployment. Verifikasi akan berakhir dengan status
              “Belum dapat diverifikasi” dan transaksi akan gagal sampai <code>VITE_SOLVCRED_PROGRAM_ID</code> diatur.
            </p>
          </div>
        </div>
      )}

      <main id="main" className="container" tabIndex={-1}>
        <TabPanel idPrefix="view" id="verifikasi" selected={view === 'verifikasi'}>
          <VerifyView />
        </TabPanel>
        <TabPanel idPrefix="view" id="penerbit" selected={view === 'penerbit'}>
          {visited.has('penerbit') && <IssuerView />}
        </TabPanel>
        <TabPanel idPrefix="view" id="admin" selected={view === 'admin'}>
          {visited.has('admin') && <AdminView />}
        </TabPanel>
      </main>

      <footer className="app-footer">
        <div className="container footer-grid">
          <p>
            <strong>Data simulasi di Solana Devnet.</strong> Tidak ada server aplikasi: file diproses di browser Anda, dan status dibaca
            langsung dari RPC berikut.
          </p>
          <dl className="config-list">
            <div><dt>Jaringan</dt><dd>Solana Devnet</dd></div>
            <div><dt>RPC</dt><dd><code>{rpcHost(config.rpcUrl)}</code></dd></div>
            <div><dt>Program</dt><dd><code>{config.programId}</code></dd></div>
          </dl>
        </div>
      </footer>
    </>
  );
}

function ConfigProblems({ problems }: { readonly problems: readonly string[] }) {
  return (
    <main className="container config-problems">
      <h1>Konfigurasi aplikasi tidak valid</h1>
      <Notice tone="negative" title="Aplikasi tidak menghubungi jaringan sampai konfigurasi diperbaiki.">
        <ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
      </Notice>
      <p>Periksa berkas <code>apps/web/.env.local</code> (lihat <code>.env.example</code>) lalu bangun ulang aplikasi.</p>
    </main>
  );
}
