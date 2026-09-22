import type { PublicKey } from '@solana/web3.js';
import type { IssuerAccount } from '../../../../packages/solana/src/index.js';

/** Issuer account plus its PDA, as returned by `fetchIssuersByAuthority`. */
export interface IssuerEntry {
  readonly address: PublicKey;
  readonly issuer: IssuerAccount;
}
