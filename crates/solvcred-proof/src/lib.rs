//! SolVcred proof format v1: leaf encoding, SHA-256 Merkle tree and path verification.
//!
//! Rust counterpart of `packages/core`. It MUST produce the same bytes and hashes as
//! `test-vectors/v1.json`; the encoding is specified in `docs/proof-format-v1.md`.
//! Hashing goes through `solana-sha256-hasher`: the `sol_sha256` syscall on-chain and
//! `sha2` everywhere else.
#![cfg_attr(not(test), no_std)]

#[cfg(feature = "alloc")]
extern crate alloc;

#[cfg(feature = "alloc")]
use alloc::vec::Vec;

use solana_sha256_hasher::hashv;

/// SHA-256 digest.
pub type Hash = [u8; 32];

/// Maximum number of leaves in a v1 batch.
pub const MAX_LEAVES: u32 = 100;
/// Path length for [`MAX_LEAVES`] leaves: `ceil(log2(100))`.
pub const MAX_DEPTH: usize = 7;
/// Proof schema version bound into every leaf.
pub const SCHEMA_VERSION: u8 = 1;
/// Binary network tag for `solana-devnet`.
pub const NETWORK_DEVNET: u8 = 1;
/// Exact leaf preimage length in bytes.
pub const LEAF_PREIMAGE_LEN: usize = 179;
/// Domain-separation prefix of leaf hashes.
pub const LEAF_PREFIX: u8 = 0x00;
/// Domain-separation prefix of internal node hashes.
pub const NODE_PREFIX: u8 = 0x01;
/// ASCII protocol tag, without terminator.
pub const PROTOCOL_TAG: &[u8; 8] = b"SolVcred";

const _: () = assert!(matches!(proof_depth(MAX_LEAVES), Some(MAX_DEPTH)));

/// Batch context bound into every leaf.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LeafContext {
    pub program_id: [u8; 32],
    pub issuer_id: [u8; 32],
    pub batch_id: [u8; 32],
    pub leaf_count: u32,
}

/// `SHA256(exact PDF bytes)`.
pub fn document_hash(pdf: &[u8]) -> Hash {
    hashv(&[pdf]).to_bytes()
}

/// Leaf preimage:
/// `0x00 || "SolVcred" || version || network || program_id || issuer_id || batch_id ||
/// u32le(leaf_count) || u32le(leaf_index) || nonce || document_hash`.
pub fn leaf_preimage(
    context: &LeafContext,
    leaf_index: u32,
    nonce: &Hash,
    document_hash: &Hash,
) -> [u8; LEAF_PREIMAGE_LEN] {
    let mut out = [0u8; LEAF_PREIMAGE_LEN];
    out[0] = LEAF_PREFIX;
    out[1..9].copy_from_slice(PROTOCOL_TAG);
    out[9] = SCHEMA_VERSION;
    out[10] = NETWORK_DEVNET;
    out[11..43].copy_from_slice(&context.program_id);
    out[43..75].copy_from_slice(&context.issuer_id);
    out[75..107].copy_from_slice(&context.batch_id);
    out[107..111].copy_from_slice(&context.leaf_count.to_le_bytes());
    out[111..115].copy_from_slice(&leaf_index.to_le_bytes());
    out[115..147].copy_from_slice(nonce);
    out[147..179].copy_from_slice(document_hash);
    out
}

/// `SHA256(leaf_preimage(..))`.
pub fn hash_leaf(context: &LeafContext, leaf_index: u32, nonce: &Hash, document_hash: &Hash) -> Hash {
    let preimage = leaf_preimage(context, leaf_index, nonce, document_hash);
    hashv(&[preimage.as_slice()]).to_bytes()
}

/// `SHA256(0x01 || left || right)`. Order-sensitive: pairs are never sorted.
pub fn hash_node(left: &Hash, right: &Hash) -> Hash {
    let prefix = [NODE_PREFIX];
    hashv(&[prefix.as_slice(), left.as_slice(), right.as_slice()]).to_bytes()
}

/// Exact path length `ceil(log2(leaf_count))`, or `None` outside `1..=MAX_LEAVES`.
pub const fn proof_depth(leaf_count: u32) -> Option<usize> {
    if leaf_count == 0 || leaf_count > MAX_LEAVES {
        return None;
    }
    let mut width = leaf_count;
    let mut depth = 0;
    while width > 1 {
        width = (width + 1) / 2;
        depth += 1;
    }
    Some(depth)
}

/// Checks that `leaf` sits at `leaf_index` of a `leaf_count`-leaf tree with root `root`.
///
/// Same semantics as `checkPath` in `packages/core/src/merkle.ts`, plus the exact-depth and
/// `leaf_index < leaf_count` checks the TypeScript parser performs. An odd final node must be
/// paired with its own duplicate; pairing it with any other hash is rejected even when the
/// resulting root matches.
pub fn verify_path(leaf: &Hash, leaf_index: u32, leaf_count: u32, siblings: &[Hash], root: &Hash) -> bool {
    let depth = match proof_depth(leaf_count) {
        Some(depth) => depth,
        None => return false,
    };
    if leaf_index >= leaf_count || siblings.len() != depth {
        return false;
    }
    let mut current = *leaf;
    let mut index = leaf_index;
    let mut width = leaf_count;
    for sibling in siblings {
        let is_left = index % 2 == 0;
        if is_left && index + 1 >= width && *sibling != current {
            return false;
        }
        current = if is_left {
            hash_node(&current, sibling)
        } else {
            hash_node(sibling, &current)
        };
        index /= 2;
        width = (width + 1) / 2;
    }
    width == 1 && index == 0 && current == *root
}

/// All tree levels, leaves first and the single root last. Odd levels duplicate their last
/// node. `None` for an empty batch or more than [`MAX_LEAVES`] leaves.
#[cfg(feature = "alloc")]
pub fn build_tree(leaves: &[Hash]) -> Option<Vec<Vec<Hash>>> {
    let leaf_count = u32::try_from(leaves.len()).ok()?;
    let depth = proof_depth(leaf_count)?;
    let mut levels = Vec::with_capacity(depth + 1);
    let mut current = leaves.to_vec();
    while current.len() > 1 {
        let mut next = Vec::with_capacity((current.len() + 1) / 2);
        for pair in current.chunks(2) {
            if let Some((left, rest)) = pair.split_first() {
                next.push(hash_node(left, rest.first().unwrap_or(left)));
            }
        }
        levels.push(core::mem::replace(&mut current, next));
    }
    levels.push(current);
    Some(levels)
}

/// Sibling hashes from leaf level to root for `index`, including duplicated odd nodes.
/// `None` when `levels` is empty or `index` is not a leaf position.
#[cfg(feature = "alloc")]
pub fn path_for(levels: &[Vec<Hash>], index: usize) -> Option<Vec<Hash>> {
    let (_, inner) = levels.split_last()?;
    if index >= levels.first()?.len() {
        return None;
    }
    let mut position = index;
    let mut siblings = Vec::with_capacity(inner.len());
    for level in inner {
        let sibling = level.get(position ^ 1).or_else(|| level.get(position))?;
        siblings.push(*sibling);
        position /= 2;
    }
    Some(siblings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proof_depth_boundaries() {
        assert_eq!(proof_depth(0), None);
        assert_eq!(proof_depth(1), Some(0));
        assert_eq!(proof_depth(2), Some(1));
        assert_eq!(proof_depth(3), Some(2));
        assert_eq!(proof_depth(4), Some(2));
        assert_eq!(proof_depth(5), Some(3));
        assert_eq!(proof_depth(64), Some(6));
        assert_eq!(proof_depth(65), Some(7));
        assert_eq!(proof_depth(100), Some(MAX_DEPTH));
        assert_eq!(proof_depth(101), None);
        assert_eq!(proof_depth(u32::MAX), None);
    }

    #[test]
    fn node_hash_is_order_sensitive_and_domain_separated() {
        let a = [1u8; 32];
        let b = [2u8; 32];
        assert_ne!(hash_node(&a, &b), hash_node(&b, &a));
        let mut concatenated = [0u8; 64];
        concatenated[..32].copy_from_slice(&a);
        concatenated[32..].copy_from_slice(&b);
        assert_ne!(hash_node(&a, &b), document_hash(&concatenated));
    }

    #[test]
    fn verify_path_rejects_leaf_counts_outside_the_protocol_range() {
        let leaf = [7u8; 32];
        assert!(verify_path(&leaf, 0, 1, &[], &leaf));
        assert!(!verify_path(&leaf, 0, 0, &[], &leaf));
        // Leaf 0 is never an odd final node for 100 or 101 leaves, so only the range check
        // separates these two calls (both have depth 7).
        let siblings = [[9u8; 32]; MAX_DEPTH];
        let mut root = leaf;
        for sibling in &siblings {
            root = hash_node(&root, sibling);
        }
        assert!(verify_path(&leaf, 0, MAX_LEAVES, &siblings, &root));
        assert!(!verify_path(&leaf, 0, MAX_LEAVES + 1, &siblings, &root));
    }

    #[cfg(feature = "alloc")]
    fn leaves(count: u8) -> Vec<Hash> {
        (0..count).map(|i| document_hash(&[i])).collect()
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn every_path_of_a_full_batch_verifies_at_max_depth() {
        let leaves = leaves(100);
        let tree = build_tree(&leaves).expect("100 leaves are allowed");
        assert_eq!(tree.len(), MAX_DEPTH + 1);
        let root = tree[MAX_DEPTH][0];
        for (index, leaf) in leaves.iter().enumerate() {
            let path = path_for(&tree, index).expect("index is in range");
            assert_eq!(path.len(), MAX_DEPTH);
            assert!(verify_path(leaf, index as u32, 100, &path, &root));
            assert!(!verify_path(leaf, index as u32, 100, &path[1..], &root));
        }
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn every_small_tree_shape_round_trips() {
        for count in 1..=17u8 {
            let leaves = leaves(count);
            let tree = build_tree(&leaves).expect("count is in range");
            let root = tree.last().and_then(|level| level.first()).copied().expect("root");
            assert_eq!(tree.len() - 1, proof_depth(u32::from(count)).expect("depth"));
            for (index, leaf) in leaves.iter().enumerate() {
                let path = path_for(&tree, index).expect("index is in range");
                assert!(verify_path(leaf, index as u32, u32::from(count), &path, &root));
            }
            assert_eq!(path_for(&tree, usize::from(count)), None);
        }
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn tree_construction_rejects_empty_and_oversized_batches() {
        assert_eq!(build_tree(&[]), None);
        assert_eq!(build_tree(&vec![[0u8; 32]; 101]), None);
        assert_eq!(path_for(&[], 0), None);
    }
}
