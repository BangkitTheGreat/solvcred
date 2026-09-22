import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Tone } from '../lib/status.js';
import { explorerTxUrl } from '../lib/format.js';
import { failureMessage, type TxFailure } from '../lib/tx.js';
import { Icon, type IconName } from './Icon.js';

const TONE_ICON: Readonly<Record<Tone, IconName>> = { positive: 'check', negative: 'x', caution: 'alert', neutral: 'info' };

export function Notice({ tone, title, children, icon, live }: {
  readonly tone: Tone;
  readonly title?: string;
  readonly children?: ReactNode;
  readonly icon?: IconName;
  /** `alert` for errors the user must notice now; omit for static guidance. */
  readonly live?: 'alert' | 'status';
}) {
  return (
    <div className={`notice tone-${tone}`} role={live}>
      <Icon name={icon ?? TONE_ICON[tone]} />
      <div className="notice-body">
        {title !== undefined && <p className="notice-title">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function Facts({ children }: { readonly children: ReactNode }) {
  return <dl className="facts">{children}</dl>;
}

export function Fact({ label, children, mono }: { readonly label: string; readonly children: ReactNode; readonly mono?: boolean }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd className={mono === true ? 'mono' : undefined}>{children}</dd>
    </div>
  );
}

export function CopyButton({ value, label }: { readonly value: string; readonly label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="button-icon"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => setCopied(true), () => setCopied(false));
      }}
      aria-label={copied ? `${label} tersalin` : `Salin ${label}`}
      title={copied ? 'Tersalin' : `Salin ${label}`}
    >
      <Icon name={copied ? 'check' : 'copy'} size={16} />
    </button>
  );
}

/** Full value (never truncated) with a copy control, for keys and hashes users must compare. */
export function Value({ value, label }: { readonly value: string; readonly label: string }) {
  return (
    <span className="value">
      <code>{value}</code>
      <CopyButton value={value} label={label} />
    </span>
  );
}

export function Progress({ children }: { readonly children: ReactNode }) {
  return (
    <p className="progress" role="status">
      <span className="progress-dot" aria-hidden="true" />
      {children}
    </p>
  );
}

export function FailureNotice({ failure, title }: { readonly failure: TxFailure; readonly title: string }) {
  return (
    <Notice tone={failure.kind === 'rejected' ? 'neutral' : 'negative'} title={title} live="alert">
      <p>{failureMessage(failure)}</p>
      {'detail' in failure && (
        <details className="tech">
          <summary>Detail teknis</summary>
          <p className="mono">{failure.detail}</p>
        </details>
      )}
    </Notice>
  );
}

export function TxLink({ signature }: { readonly signature: string }) {
  return (
    <a className="link-external" href={explorerTxUrl(signature)} target="_blank" rel="noreferrer noopener">
      Lihat transaksi di Solana Explorer
      <Icon name="link" size={14} />
    </a>
  );
}

export interface TabItem<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly icon?: IconName;
}

/** WAI-ARIA tabs with roving focus (arrow keys, Home, End). Panels are rendered by the caller. */
export function Tabs<T extends string>({ items, selected, onSelect, label, idPrefix, variant }: {
  readonly items: readonly TabItem<T>[];
  readonly selected: T;
  readonly onSelect: (id: T) => void;
  readonly label: string;
  readonly idPrefix: string;
  readonly variant?: 'primary' | 'secondary';
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === selected);
    const target = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: items.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = items[(target + items.length) % items.length];
    if (next === undefined) return;
    onSelect(next.id);
    refs.current.get(next.id)?.focus();
  };
  return (
    <div className={`tabs tabs-${variant ?? 'primary'}`} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.id}
          ref={(element) => {
            if (element === null) refs.current.delete(item.id);
            else refs.current.set(item.id, element);
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${item.id}`}
          aria-controls={`${idPrefix}-panel-${item.id}`}
          aria-selected={item.id === selected}
          tabIndex={item.id === selected ? 0 : -1}
          onClick={() => onSelect(item.id)}
        >
          {item.icon !== undefined && <Icon name={item.icon} size={18} />}
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ idPrefix, id, selected, children }: {
  readonly idPrefix: string;
  readonly id: string;
  readonly selected: boolean;
  readonly children: ReactNode;
}) {
  // Inactive panels stay mounted (hidden) so in-progress drafts and signatures survive tab switches.
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${id}`} aria-labelledby={`${idPrefix}-tab-${id}`} hidden={!selected} tabIndex={0}>
      {children}
    </div>
  );
}

/** Two-step inline confirmation instead of a modal for destructive, local-only actions. */
export function ConfirmButton({ label, confirmLabel, prompt, onConfirm, disabled }: {
  readonly label: string;
  readonly confirmLabel: string;
  readonly prompt: string;
  readonly onConfirm: () => void;
  readonly disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return <button type="button" className="button-quiet" disabled={disabled} onClick={() => setAsking(true)}>{label}</button>;
  }
  return (
    <div className="confirm-inline" role="group" aria-label={label}>
      <p>{prompt}</p>
      <div className="actions">
        <button type="button" className="button-danger" onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</button>
        <button type="button" className="button-quiet" onClick={() => setAsking(false)}>Batal</button>
      </div>
    </div>
  );
}
