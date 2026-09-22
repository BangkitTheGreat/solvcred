import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Keypair } from '@solana/web3.js';
import { ACCOUNTS, INSTRUCTIONS, PROGRAM_ERRORS, type ArgType, type FieldType } from '../../packages/solana/src/index.js';

// Compares the hand-written TypeScript client constants with the IDL produced by `anchor build`.
interface IdlAccountItem { readonly name: string; readonly writable?: boolean; readonly signer?: boolean; readonly accounts?: readonly IdlAccountItem[] }
interface IdlField { readonly name: string; readonly type: unknown }
interface Idl {
  readonly address: string;
  readonly instructions: readonly { readonly name: string; readonly discriminator: readonly number[]; readonly accounts: readonly IdlAccountItem[]; readonly args: readonly IdlField[] }[];
  readonly accounts?: readonly { readonly name: string; readonly discriminator: readonly number[] }[];
  readonly errors?: readonly { readonly code: number; readonly name: string }[];
  readonly types?: readonly { readonly name: string; readonly type: { readonly kind: string; readonly fields?: readonly IdlField[] } }[];
}

const idl = JSON.parse(readFileSync('target/idl/solvcred.json', 'utf8')) as Idl;
const bytes32 = { array: ['u8', 32] };
const argType = (type: ArgType): unknown => (type === 'bytes32' ? bytes32 : type === 'vec<bytes32>' ? { vec: bytes32 } : type);
const fieldType = (type: FieldType): unknown => (typeof type === 'object' ? 'string' : type === 'bytes32' ? bytes32 : type);

test('IDL address is the deployed program keypair (anchor keys sync)', () => {
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('target/deploy/solvcred-keypair.json', 'utf8')) as number[]));
  assert.equal(idl.address, keypair.publicKey.toBase58());
});

test('IDL instructions match client discriminators, argument layout, and account metas', () => {
  const specs = Object.values(INSTRUCTIONS);
  assert.deepEqual(idl.instructions.map(({ name }) => name).sort(), specs.map(({ name }) => name).sort());
  for (const spec of specs) {
    const instruction = idl.instructions.find(({ name }) => name === spec.name);
    assert.ok(instruction, spec.name);
    assert.deepEqual([...instruction.discriminator], [...spec.discriminator], `${spec.name} discriminator`);
    assert.deepEqual(instruction.args.map(({ name, type }) => [name, type]), spec.args.map(([name, type]) => [name, argType(type)]), `${spec.name} args`);
    assert.ok(instruction.accounts.every(({ accounts }) => accounts === undefined), `${spec.name} uses no nested account groups`);
    assert.deepEqual(
      instruction.accounts.map(({ name, writable, signer }) => [name, writable === true, signer === true]),
      spec.accounts.map(({ name, writable, signer }) => [name, writable, signer]),
      `${spec.name} accounts`,
    );
  }
});

test('IDL accounts match client discriminators and field layout', () => {
  const specs = Object.values(ACCOUNTS);
  // External loader types (ProgramData) may be listed without a discriminator; every program account must be known.
  const programAccounts = (idl.accounts ?? []).filter(({ discriminator }) => discriminator.length > 0);
  assert.deepEqual(programAccounts.map(({ name }) => name).sort(), specs.map(({ name }) => name).sort());
  for (const spec of specs) {
    assert.deepEqual([...(idl.accounts?.find(({ name }) => name === spec.name)?.discriminator ?? [])], [...spec.discriminator], `${spec.name} discriminator`);
    const type = idl.types?.find(({ name }) => name === spec.name)?.type;
    assert.ok(type && type.kind === 'struct', `${spec.name} is a struct type`);
    assert.deepEqual(type.fields?.map(({ name, type: idlType }) => [name, idlType]), spec.fields.map(([name, fieldSpec]) => [name, fieldType(fieldSpec)]), `${spec.name} fields`);
  }
});

test('IDL error codes match the client error table', () => {
  assert.deepEqual(
    (idl.errors ?? []).map(({ code, name }) => [code, name]).sort((left, right) => Number(left[0]) - Number(right[0])),
    Object.entries(PROGRAM_ERRORS).map(([name, code]) => [code, name]).sort((left, right) => Number(left[0]) - Number(right[0])),
  );
});
