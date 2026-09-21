import { concat, fromHex, publicKeyBytes, toHex, u32le } from './encoding.js';
import type { BatchContext } from './types.js';

export async function sha256(bytes: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes))));
}

export function randomId(): string {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashLeaf(context: BatchContext, leafCount: number, leafIndex: number, nonce: string, documentHash: string): Promise<string> {
  return sha256(concat(
    new Uint8Array([0]), new TextEncoder().encode('SolVcred'), new Uint8Array([1, 1]),
    publicKeyBytes(context.programId), fromHex(context.issuerId), fromHex(context.batchId),
    u32le(leafCount), u32le(leafIndex), fromHex(nonce), fromHex(documentHash),
  ));
}

export async function hashNode(left: string, right: string): Promise<string> {
  return sha256(concat(new Uint8Array([1]), fromHex(left), fromHex(right)));
}

export async function buildTree(leaves: readonly string[]): Promise<readonly (readonly string[])[]> {
  if (leaves.length === 0) throw new Error('Cannot build an empty Merkle tree');
  const levels: string[][] = [[...leaves]];
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      if (left === undefined) throw new Error('Missing tree node');
      next.push(await hashNode(left, level[i + 1] ?? left));
    }
    levels.push(next);
    level = next;
  }
  return levels;
}

export function pathFor(levels: readonly (readonly string[])[], index: number): readonly string[] {
  const siblings: string[] = [];
  for (const level of levels.slice(0, -1)) {
    const sibling = level[index ^ 1] ?? level[index];
    if (sibling === undefined) throw new Error('Missing proof node');
    siblings.push(sibling);
    index = Math.floor(index / 2);
  }
  return siblings;
}

export async function checkPath(leaf: string, leafIndex: number, leafCount: number, siblings: readonly string[], root: string): Promise<boolean> {
  let current = leaf;
  let index = leafIndex;
  let width = leafCount;
  for (const sibling of siblings) {
    // Odd final nodes must be duplicated, never paired with an arbitrary hash.
    if (index % 2 === 0 && index + 1 >= width && sibling !== current) return false;
    current = index % 2 === 0 ? await hashNode(current, sibling) : await hashNode(sibling, current);
    index = Math.floor(index / 2);
    width = Math.ceil(width / 2);
  }
  return width === 1 && index === 0 && current === root;
}
