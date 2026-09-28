// Deployment status and registry bootstrap, used by scripts/deploy-devnet.sh (see docs/deploy-devnet.md).
//
//   node dist/scripts/registry.js status --url <rpc> --program-id <id> [--expect-genesis <hash>] [--compare <program.so>] [--json]
//   node dist/scripts/registry.js init   --url <rpc> --program-id <id> --keypair <admin.json> [--expect-genesis <hash>]
//
// Every read uses commitment `finalized`. `init` is idempotent: rerun it after an interrupted or unclear result.
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { Keypair, PublicKey, SendTransactionError, Transaction, type AccountInfo, type Connection } from '@solana/web3.js';
import {
  AccountDataError, BPF_LOADER_UPGRADEABLE_PROGRAM_ID, createConnection, decodeRegistry, initializeRegistryInstruction,
  programDataAddress, registryAddress,
} from '../packages/solana/src/index.js';

/** UpgradeableLoaderState::ProgramData header: u32 tag (3), u64 slot, Option<Pubkey> (1 + 32). */
const PROGRAM_DATA_HEADER = 45;
const RPC_TIMEOUT_MS = 30_000;
const FINALIZE_TIMEOUT_MS = 180_000;

class CliError extends Error {}

/** Progress messages; moved to stderr under `--json` so stdout stays machine-readable. */
let log: (message: string) => void = (message) => console.log(message);

interface ProgramStatus {
  readonly programDataAddress: string;
  /** null when the program is immutable. */
  readonly upgradeAuthority: string | null;
  readonly lastDeploySlot: number;
  readonly programDataLength: number;
  /** Present only with `--compare`: the deployed bytecode equals the local build. */
  readonly matchesLocalBuild?: boolean;
}

interface Status {
  readonly genesisHash: string;
  readonly slot: number;
  readonly programId: string;
  readonly program: ProgramStatus | null;
  readonly registryAddress: string;
  readonly registry: { readonly admin: string; readonly version: number } | null;
}

function loadKeypair(path: string): Keypair {
  let bytes: unknown;
  try {
    bytes = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new CliError(`Cannot read keypair ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw new CliError(`${path} is not a Solana CLI keypair file (JSON array of 64 bytes)`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
}

function publicKey(value: string, what: string): PublicKey {
  try {
    const key = new PublicKey(value);
    if (key.toBase58() === value) return key;
  } catch { /* reported below */ }
  throw new CliError(`${what} is not a base58 public key: ${value}`);
}

function decodeProgram(programId: PublicKey, programInfo: AccountInfo<Buffer>, programData: PublicKey, dataInfo: AccountInfo<Buffer> | null): Omit<ProgramStatus, 'matchesLocalBuild'> {
  const program = programInfo.data;
  if (!programInfo.executable || !programInfo.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) ||
      program.length < 36 || program.readUInt32LE(0) !== 2 || !new PublicKey(program.subarray(4, 36)).equals(programData)) {
    throw new CliError(`Account ${programId.toBase58()} exists but is not a program of the upgradeable BPF loader`);
  }
  const data = dataInfo?.data;
  if (!dataInfo || !dataInfo.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) || !data ||
      data.length < PROGRAM_DATA_HEADER || data.readUInt32LE(0) !== 3 || (data[12] !== 0 && data[12] !== 1)) {
    throw new CliError(`ProgramData account ${programData.toBase58()} is missing or malformed`);
  }
  return {
    programDataAddress: programData.toBase58(),
    upgradeAuthority: data[12] === 1 ? new PublicKey(data.subarray(13, PROGRAM_DATA_HEADER)).toBase58() : null,
    lastDeploySlot: Number(data.readBigUInt64LE(4)),
    programDataLength: data.length,
  };
}

/** The loader zero-pads program data beyond the ELF when the account was sized for a larger build. */
function sameBytecode(dataInfo: AccountInfo<Buffer>, local: Uint8Array): boolean {
  const deployed = dataInfo.data.subarray(PROGRAM_DATA_HEADER);
  return deployed.length >= local.length &&
    Buffer.compare(deployed.subarray(0, local.length), local) === 0 &&
    deployed.subarray(local.length).every((byte) => byte === 0);
}

async function readStatus(connection: Connection, programId: PublicKey, expectGenesis: string | undefined, compare?: Uint8Array): Promise<Status> {
  const genesisHash = await connection.getGenesisHash();
  if (expectGenesis !== undefined && genesisHash !== expectGenesis) {
    throw new CliError(`RPC reports genesis ${genesisHash}, expected ${expectGenesis}: wrong cluster`);
  }
  const programData = programDataAddress(programId);
  const registry = registryAddress(programId);
  const { context, value } = await connection.getMultipleAccountsInfoAndContext([programId, programData, registry], 'finalized');
  const [programInfo, dataInfo, registryInfo] = value;

  let program: ProgramStatus | null = null;
  if (programInfo) {
    const decoded = decodeProgram(programId, programInfo, programData, dataInfo ?? null);
    program = compare && dataInfo ? { ...decoded, matchesLocalBuild: sameBytecode(dataInfo, compare) } : decoded;
  }
  let registryState: Status['registry'] = null;
  if (registryInfo) {
    if (!registryInfo.owner.equals(programId)) throw new CliError(`Registry ${registry.toBase58()} is not owned by the program`);
    try {
      const decoded = decodeRegistry(registryInfo.data);
      registryState = { admin: decoded.admin.toBase58(), version: decoded.version };
    } catch (error) {
      if (error instanceof AccountDataError) throw new CliError(`Registry ${registry.toBase58()} is malformed: ${error.message}`);
      throw error;
    }
  }
  return {
    genesisHash, slot: context.slot, programId: programId.toBase58(), program,
    registryAddress: registry.toBase58(), registry: registryState,
  };
}

function printStatus(status: Status): void {
  const { program, registry } = status;
  const row = (label: string, value: string | number): void => console.log(`${label.padEnd(21)}${value}`);
  row('Genesis hash', `${status.genesisHash} (finalized slot ${status.slot})`);
  row('Program', `${status.programId}${program ? '' : ' (not deployed)'}`);
  if (program) {
    row('  ProgramData', `${program.programDataAddress} (${program.programDataLength} bytes)`);
    row('  Upgrade authority', program.upgradeAuthority ?? 'none: program is immutable');
    row('  Last deploy slot', program.lastDeploySlot);
    if (program.matchesLocalBuild !== undefined) {
      row('  Local build', program.matchesLocalBuild ? 'identical to the deployed bytecode' : 'differs from the deployed bytecode');
    }
  }
  row('Registry', `${status.registryAddress}${registry ? '' : ' (not initialized)'}`);
  if (registry) {
    row('  Admin', registry.admin);
    row('  Version', registry.version);
  }
}

async function initRegistry(connection: Connection, programId: PublicKey, admin: Keypair, expectGenesis: string | undefined): Promise<Status> {
  const adminKey = admin.publicKey.toBase58();
  const before = await readStatus(connection, programId, expectGenesis);
  if (!before.program) throw new CliError(`Program ${before.programId} is not deployed on this cluster`);
  if (before.registry) {
    if (before.registry.admin === adminKey) {
      log(`Registry already initialized; admin ${adminKey}. Nothing to do.`);
      return before;
    }
    throw new CliError(`Registry already initialized with admin ${before.registry.admin}, not ${adminKey}`);
  }
  if (before.program.upgradeAuthority === null) {
    throw new CliError('Program is immutable, so no upgrade authority can bootstrap the registry anymore');
  }
  if (before.program.upgradeAuthority !== adminKey) {
    throw new CliError(`initialize_registry must be signed by the upgrade authority ${before.program.upgradeAuthority}, not ${adminKey}`);
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ feePayer: admin.publicKey, blockhash, lastValidBlockHeight })
    .add(initializeRegistryInstruction(programId, admin.publicKey));
  transaction.sign(admin);
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(transaction.serialize(), { preflightCommitment: 'confirmed' });
  } catch (error) {
    const logs = error instanceof SendTransactionError ? (error.logs ?? []).join('\n') : '';
    throw new CliError(`initialize_registry was rejected: ${error instanceof Error ? error.message : String(error)}${logs ? `\n${logs}` : ''}`);
  }
  log(`initialize_registry sent: ${signature}. Waiting for finalized…`);

  const deadline = Date.now() + FINALIZE_TIMEOUT_MS;
  for (;;) {
    const [state] = (await connection.getSignatureStatuses([signature])).value;
    if (state?.err) throw new CliError(`initialize_registry failed: ${JSON.stringify(state.err)}`);
    if (state?.confirmationStatus === 'finalized') break;
    // An unseen transaction can no longer land once its blockhash expires; the re-read below decides.
    if (!state && await connection.getBlockHeight('confirmed') > lastValidBlockHeight) break;
    if (Date.now() > deadline) break;
    await sleep(1_000);
  }
  const after = await readStatus(connection, programId, expectGenesis);
  if (after.registry?.admin !== adminKey) {
    throw new CliError(`Registry is not initialized at finalized yet (transaction ${signature}). Rerun \`init\`; it is idempotent.`);
  }
  log(`Registry initialized; admin ${adminKey}.`);
  return after;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      'program-id': { type: 'string' },
      keypair: { type: 'string' },
      'expect-genesis': { type: 'string' },
      compare: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });
  const [command, ...extra] = positionals;
  if ((command !== 'status' && command !== 'init') || extra.length > 0 || !values.url || !values['program-id']) {
    throw new CliError('Usage: registry.js status|init --url <rpc> --program-id <id> [--keypair <admin.json>] [--expect-genesis <hash>] [--compare <program.so>] [--json]');
  }
  if (values.json) log = (message) => console.error(message);
  const programId = publicKey(values['program-id'], '--program-id');
  const expectGenesis = values['expect-genesis'];
  const connection = createConnection({
    network: 'solana-devnet', programId: programId.toBase58(), rpcUrl: values.url,
    expectedGenesisHash: expectGenesis ?? '', timeoutMs: RPC_TIMEOUT_MS,
  });

  let status: Status;
  if (command === 'init') {
    if (!values.keypair) throw new CliError('init requires --keypair <admin.json> (the program upgrade authority)');
    status = await initRegistry(connection, programId, loadKeypair(values.keypair), expectGenesis);
  } else {
    status = await readStatus(connection, programId, expectGenesis, values.compare ? readFileSync(values.compare) : undefined);
  }
  if (values.json) console.log(JSON.stringify(status));
  else if (command === 'status') printStatus(status);
}

try {
  await main();
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
