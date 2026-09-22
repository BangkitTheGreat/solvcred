import { WalletReadyState, type WalletError } from '@solana/wallet-adapter-base';
import { useWallet } from '@solana/wallet-adapter-react';
import { createContext, useCallback, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { CopyButton, Notice } from './common.js';
import { Icon } from './Icon.js';

interface WalletNotice {
  readonly message: string | null;
  readonly clear: () => void;
}

const WalletNoticeContext = createContext<WalletNotice>({ message: null, clear: () => undefined });

const CONNECT_ERRORS: Readonly<Record<string, true>> = {
  WalletConnectionError: true,
  WalletWindowClosedError: true,
  WalletAccountError: true,
  WalletNotReadyError: true,
};

/** Surfaces connection failures; transaction errors are reported by each flow instead. */
export function useWalletErrorHandler(): { readonly notice: WalletNotice; readonly onError: (error: WalletError) => void } {
  const [message, setMessage] = useState<string | null>(null);
  const onError = useCallback((error: WalletError) => {
    if (CONNECT_ERRORS[error.name] !== true) return;
    setMessage(error.name === 'WalletNotReadyError'
      ? 'Wallet belum siap. Pastikan ekstensi wallet terpasang dan aktif, lalu coba lagi.'
      : 'Wallet tidak terhubung: permintaan koneksi dibatalkan atau gagal.');
  }, []);
  const clear = useCallback(() => setMessage(null), []);
  const notice = useMemo(() => ({ message, clear }), [message, clear]);
  return { notice, onError };
}

export function WalletNoticeProvider({ notice, children }: { readonly notice: WalletNotice; readonly children: ReactNode }) {
  return <WalletNoticeContext.Provider value={notice}>{children}</WalletNoticeContext.Provider>;
}

/** Indonesian wallet picker over Wallet Standard autodetection (no adapter packages bundled). */
export function WalletControl() {
  const { wallets, wallet, publicKey, connecting, disconnecting, select, disconnect } = useWallet();
  const notice = useContext(WalletNoticeContext);
  const [open, setOpen] = useState(false);
  const listId = useId();

  if (publicKey !== null) {
    const address = publicKey.toBase58();
    return (
      <div className="wallet wallet-connected">
        {wallet !== null && <img src={wallet.adapter.icon} alt="" width={20} height={20} />}
        <div className="wallet-id">
          <span className="wallet-name">{wallet?.adapter.name ?? 'Wallet'}</span>
          <code title={address}>{address.slice(0, 4)}…{address.slice(-4)}</code>
        </div>
        <CopyButton value={address} label="alamat wallet" />
        <button type="button" className="button-quiet" disabled={disconnecting} onClick={() => { void disconnect(); }}>
          Putuskan
        </button>
      </div>
    );
  }

  const available = wallets.filter((item) => item.readyState === WalletReadyState.Installed || item.readyState === WalletReadyState.Loadable);
  return (
    <div className="wallet">
      <button
        type="button"
        className="button-secondary"
        aria-expanded={open}
        aria-controls={listId}
        disabled={connecting}
        onClick={() => { setOpen(!open); notice.clear(); }}
      >
        <Icon name="wallet" size={18} />
        {connecting ? 'Menghubungkan…' : 'Hubungkan wallet'}
      </button>
      {notice.message !== null && <Notice tone="negative" live="alert"><p>{notice.message}</p></Notice>}
      <div id={listId} className="wallet-list" hidden={!open}>
        {available.length === 0 ? (
          <p>
            Tidak ada wallet Solana yang terdeteksi di browser ini. Pasang wallet yang mendukung Wallet Standard, atur ke Devnet,
            lalu muat ulang halaman.
          </p>
        ) : (
          <ul aria-label="Wallet yang terdeteksi">
            {available.map((item) => (
              <li key={item.adapter.name}>
                <button type="button" onClick={() => { notice.clear(); select(item.adapter.name); setOpen(false); }}>
                  <img src={item.adapter.icon} alt="" width={20} height={20} />
                  {item.adapter.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
