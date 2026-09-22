const dateTime = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'long' });
const integer = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

export function formatDateTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date);
}

/** On-chain `recorded_at` is a unix timestamp in seconds reported by the validator clock. */
export function formatUnixSeconds(seconds: bigint): string {
  return formatDateTime(new Date(Number(seconds) * 1000));
}

export function formatInteger(value: number | bigint): string {
  return integer.format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${integer.format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${decimal.format(bytes / 1024)} KiB`;
  return `${decimal.format(bytes / (1024 * 1024))} MiB`;
}

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}
