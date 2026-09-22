import { Connection } from '@solana/web3.js';
import { ValidationError } from '../../core/src/index.js';

export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
/** Not deployable: nobody holds its key. `anchor keys sync` replaces it before a real deployment. */
export const PLACEHOLDER_PROGRAM_ID = 'CZtvDiPBJ4voLQ9XchqAaXk9fzzghgsB62uSjwLMxASo';

/** Application configuration. Proofs never choose the RPC endpoint, network, or program. */
export interface ClusterConfig {
  readonly network: 'solana-devnet';
  readonly programId: string;
  readonly rpcUrl: string;
  readonly expectedGenesisHash: string;
  readonly timeoutMs: number;
}

/** An RPC HTTP exchange did not complete within `ClusterConfig.timeoutMs`. */
export class RpcTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`RPC request exceeded ${timeoutMs} ms`);
    this.name = 'RpcTimeoutError';
  }
}

/** Connection that reads at `finalized` and aborts every HTTP request after `config.timeoutMs`. */
export function createConnection(config: ClusterConfig, fetchImpl?: typeof fetch): Connection {
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new ValidationError('INVALID_INPUT', 'timeoutMs must be a positive integer');
  }
  const base = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  return new Connection(config.rpcUrl, {
    commitment: 'finalized',
    fetch: withTimeout(base, config.timeoutMs),
    // 429 retries would sleep for seconds and defeat the timeout; callers decide when to retry.
    disableRetryOnRateLimit: true,
  });
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function withTimeout(fetchImpl: typeof fetch, timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const timeout = new AbortController();
    // A plain timer (not AbortSignal.timeout) keeps the deadline alive even if the fetch holds no I/O handle.
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal;
    // Racing the signal also bounds fetch implementations that ignore it, including the body read.
    const aborted = new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('RPC request aborted')), { once: true });
    });
    try {
      const response = await Promise.race([fetchImpl(input, { ...init, signal }), aborted]);
      const body = NULL_BODY_STATUSES.has(response.status) ? null : await Promise.race([response.text(), aborted]);
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      if (timeout.signal.aborted) throw new RpcTimeoutError(timeoutMs);
      throw error instanceof Error ? error : new Error('RPC request failed');
    } finally {
      clearTimeout(timer);
    }
  };
}
