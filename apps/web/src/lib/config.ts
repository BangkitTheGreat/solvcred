import { PublicKey } from '@solana/web3.js';
import { DEVNET_GENESIS_HASH, PLACEHOLDER_PROGRAM_ID, type ClusterConfig } from '../../../../packages/solana/src/index.js';

export const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
export const RPC_TIMEOUT_MS = 15_000;

export interface AppConfig {
  readonly cluster: ClusterConfig;
  readonly isPlaceholderProgram: boolean;
  /** Mirrors wallet-standard `getChainForEndpoint`: only URLs naming devnet make wallets send to Devnet. */
  readonly walletRoutesToDevnet: boolean;
  /** Human-readable configuration errors; a non-empty list disables every network feature. */
  readonly problems: readonly string[];
}

function setting(env: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function isBase58Hash(value: string): boolean {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

function isAllowedRpcUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

export function readConfig(env: Readonly<Record<string, unknown>>): AppConfig {
  const programId = setting(env, 'VITE_SOLVCRED_PROGRAM_ID') ?? PLACEHOLDER_PROGRAM_ID;
  const rpcUrl = setting(env, 'VITE_SOLVCRED_RPC_URL') ?? DEFAULT_RPC_URL;
  const expectedGenesisHash = setting(env, 'VITE_SOLVCRED_GENESIS_HASH') ?? DEVNET_GENESIS_HASH;
  const problems: string[] = [];
  if (!isBase58Hash(programId)) problems.push('VITE_SOLVCRED_PROGRAM_ID bukan public key base58 yang valid.');
  if (!isAllowedRpcUrl(rpcUrl)) problems.push('VITE_SOLVCRED_RPC_URL harus berupa URL https (http hanya untuk localhost).');
  if (!isBase58Hash(expectedGenesisHash)) problems.push('VITE_SOLVCRED_GENESIS_HASH bukan hash base58 32 byte yang valid.');
  return {
    cluster: Object.freeze({ network: 'solana-devnet', programId, rpcUrl, expectedGenesisHash, timeoutMs: RPC_TIMEOUT_MS }),
    isPlaceholderProgram: programId === PLACEHOLDER_PROGRAM_ID,
    walletRoutesToDevnet: /\bdevnet\b/i.test(rpcUrl),
    problems,
  };
}

export function rpcHost(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return rpcUrl;
  }
}
