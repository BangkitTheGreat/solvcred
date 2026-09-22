import { PublicKey } from '@solana/web3.js';
import { fromHex, hex32 } from '../../core/src/encoding.js';

export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

const utf8 = new TextEncoder();

function derive(programId: PublicKey, seeds: readonly Uint8Array[]): PublicKey {
  return PublicKey.findProgramAddressSync([...seeds], programId)[0];
}

export function registryAddress(programId: PublicKey): PublicKey {
  return derive(programId, [utf8.encode('registry')]);
}

export function issuerAddress(programId: PublicKey, issuerIdHex: string): PublicKey {
  return derive(programId, [utf8.encode('issuer'), fromHex(hex32(issuerIdHex, 'issuerId'))]);
}

/** Derived from the issuer account, not its authority, so key rotation never moves old batches. */
export function batchAddress(programId: PublicKey, issuerAccount: PublicKey, batchIdHex: string): PublicKey {
  return derive(programId, [utf8.encode('batch'), issuerAccount.toBytes(), fromHex(hex32(batchIdHex, 'batchId'))]);
}

export function revocationAddress(programId: PublicKey, batchAccount: PublicKey, leafHashHex: string): PublicKey {
  return derive(programId, [utf8.encode('revoked'), batchAccount.toBytes(), fromHex(hex32(leafHashHex, 'leafHash'))]);
}

/** ProgramData account of an upgradeable program; holds the upgrade authority checked at bootstrap. */
export function programDataAddress(programId: PublicKey): PublicKey {
  return derive(BPF_LOADER_UPGRADEABLE_PROGRAM_ID, [programId.toBytes()]);
}
