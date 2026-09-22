import { PublicKey, type Connection } from '@solana/web3.js';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createConnection, type ClusterConfig } from '../../../packages/solana/src/index.js';
import type { AppConfig } from './lib/config.js';

export interface Cluster {
  readonly app: AppConfig;
  readonly config: ClusterConfig;
  readonly connection: Connection;
  readonly programId: PublicKey;
}

const ClusterContext = createContext<Cluster | null>(null);

export function ClusterProvider({ app, children }: { readonly app: AppConfig; readonly children: ReactNode }) {
  const value = useMemo<Cluster>(() => ({
    app,
    config: app.cluster,
    // One timeout-bounded, finalized connection for every read and send; the proof never picks it.
    connection: createConnection(app.cluster),
    programId: new PublicKey(app.cluster.programId),
  }), [app]);
  return <ClusterContext.Provider value={value}>{children}</ClusterContext.Provider>;
}

export function useCluster(): Cluster {
  const cluster = useContext(ClusterContext);
  if (cluster === null) throw new Error('useCluster must be used inside ClusterProvider');
  return cluster;
}
