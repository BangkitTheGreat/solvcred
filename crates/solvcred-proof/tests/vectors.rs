//! Cross-implementation check against `test-vectors/v1.json` (independent Python reference)
//! plus the tamper cases mirrored from `packages/core/test/core.test.ts`.

use std::path::Path;

use serde_json::Value;
use solvcred_proof::{
    build_tree, document_hash, hash_leaf, hash_node, leaf_preimage, path_for, proof_depth, verify_path, Hash,
    LeafContext, LEAF_PREIMAGE_LEN, SCHEMA_VERSION,
};

struct Document {
    pdf: Vec<u8>,
    document_hash: Hash,
    leaf_preimage: Vec<u8>,
    leaf_hash: Hash,
    leaf_index: u32,
    nonce: Hash,
    siblings: Vec<Hash>,
}

struct Case {
    context: LeafContext,
    root: Hash,
    documents: Vec<Document>,
}

impl Case {
    fn document(&self, index: usize) -> &Document {
        self.documents.get(index).expect("fixture document")
    }

    /// Leaf computed from possibly tampered inputs, like `verifyDocument` does locally.
    fn leaf(&self, context: &LeafContext, pdf: &[u8], leaf_index: u32, nonce: &Hash) -> Hash {
        hash_leaf(context, leaf_index, nonce, &document_hash(pdf))
    }

    fn verifies(&self, leaf: &Hash, leaf_index: u32, siblings: &[Hash]) -> bool {
        verify_path(leaf, leaf_index, self.context.leaf_count, siblings, &self.root)
    }
}

fn field<'a>(value: &'a Value, key: &str) -> &'a Value {
    value.get(key).unwrap_or_else(|| panic!("missing field {key}"))
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    field(value, key).as_str().unwrap_or_else(|| panic!("{key} is not a string"))
}

fn uint(value: &Value, key: &str) -> u32 {
    let number = field(value, key).as_u64().unwrap_or_else(|| panic!("{key} is not an integer"));
    u32::try_from(number).expect("u32 range")
}

fn bytes(hex_text: &str) -> Vec<u8> {
    hex::decode(hex_text).expect("valid hex")
}

fn hash32(hex_text: &str) -> Hash {
    bytes(hex_text).try_into().expect("32-byte hash")
}

fn context_of(value: &Value) -> LeafContext {
    assert_eq!(text(value, "network"), "solana-devnet");
    let program_id: Hash = bs58::decode(text(value, "programId"))
        .into_vec()
        .expect("valid base58")
        .try_into()
        .expect("32-byte program id");
    LeafContext {
        program_id,
        issuer_id: hash32(text(value, "issuerId")),
        batch_id: hash32(text(value, "batchId")),
        leaf_count: uint(value, "leafCount"),
    }
}

fn load_cases() -> Vec<Case> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-vectors/v1.json");
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let fixture: Value = serde_json::from_str(&raw).expect("valid JSON fixture");
    let cases = field(&fixture, "cases").as_array().expect("cases array");
    cases
        .iter()
        .map(|case| {
            let commitment = field(case, "commitment");
            let context = context_of(commitment);
            let root = hash32(text(commitment, "root"));
            let documents = field(case, "documents")
                .as_array()
                .expect("documents array")
                .iter()
                .map(|document| {
                    let proof = field(document, "proof");
                    // Every proof carries exactly the commitment's context.
                    assert_eq!(context_of(proof), context);
                    assert_eq!(hash32(text(proof, "root")), root);
                    assert_eq!(uint(proof, "schemaVersion"), u32::from(SCHEMA_VERSION));
                    let siblings = field(proof, "siblings")
                        .as_array()
                        .expect("siblings array")
                        .iter()
                        .map(|sibling| hash32(sibling.as_str().expect("sibling hex")))
                        .collect();
                    Document {
                        pdf: bytes(text(document, "pdfHex")),
                        document_hash: hash32(text(document, "documentHash")),
                        leaf_preimage: bytes(text(document, "leafPreimage")),
                        leaf_hash: hash32(text(document, "leafHash")),
                        leaf_index: uint(proof, "leafIndex"),
                        nonce: hash32(text(proof, "nonce")),
                        siblings,
                    }
                })
                .collect();
            Case { context, root, documents }
        })
        .collect()
}

fn case_with(leaf_count: u32) -> Case {
    load_cases()
        .into_iter()
        .find(|case| case.context.leaf_count == leaf_count)
        .unwrap_or_else(|| panic!("fixture with {leaf_count} leaves"))
}

/// Root implied by a path without any duplication or depth checks, i.e. what a naive
/// verifier would accept.
fn fold_unchecked(leaf: &Hash, leaf_index: u32, siblings: &[Hash]) -> Hash {
    let mut current = *leaf;
    let mut index = leaf_index;
    for sibling in siblings {
        current = if index % 2 == 0 {
            hash_node(&current, sibling)
        } else {
            hash_node(sibling, &current)
        };
        index /= 2;
    }
    current
}

#[test]
fn fixture_covers_single_and_odd_batches() {
    let counts: Vec<u32> = load_cases().iter().map(|case| case.context.leaf_count).collect();
    assert_eq!(counts, [1, 3, 5]);
}

#[test]
fn every_fixture_document_matches_the_reference_bytes_hashes_and_paths() {
    for case in load_cases() {
        let count = case.context.leaf_count;
        assert_eq!(case.documents.len(), count as usize);
        let leaves: Vec<Hash> = case.documents.iter().map(|document| document.leaf_hash).collect();
        let tree = build_tree(&leaves).expect("fixture batch size is valid");
        assert_eq!(tree.last().map(Vec::as_slice), Some([case.root].as_slice()), "{count} leaves: root");
        assert_eq!(Some(tree.len() - 1), proof_depth(count));
        for (position, document) in case.documents.iter().enumerate() {
            let label = format!("{count} leaves, document {position}");
            assert_eq!(document.leaf_index as usize, position, "{label}: index");
            assert_eq!(document_hash(&document.pdf), document.document_hash, "{label}: document hash");
            let preimage = leaf_preimage(&case.context, document.leaf_index, &document.nonce, &document.document_hash);
            assert_eq!(preimage.len(), LEAF_PREIMAGE_LEN);
            assert_eq!(preimage.as_slice(), document.leaf_preimage.as_slice(), "{label}: preimage");
            assert_eq!(document_hash(&preimage), document.leaf_hash, "{label}: preimage hash");
            assert_eq!(
                hash_leaf(&case.context, document.leaf_index, &document.nonce, &document.document_hash),
                document.leaf_hash,
                "{label}: leaf hash"
            );
            assert_eq!(path_for(&tree, position).as_deref(), Some(document.siblings.as_slice()), "{label}: path");
            assert!(case.verifies(&document.leaf_hash, document.leaf_index, &document.siblings), "{label}: verify");
            let local_leaf = case.leaf(&case.context, &document.pdf, document.leaf_index, &document.nonce);
            assert!(case.verifies(&local_leaf, document.leaf_index, &document.siblings), "{label}: from PDF");
        }
    }
}

#[test]
fn single_leaf_path_is_empty_and_root_equals_leaf() {
    let case = case_with(1);
    let document = case.document(0);
    assert!(document.siblings.is_empty());
    assert_eq!(case.root, document.leaf_hash);
    assert_eq!(proof_depth(1), Some(0));
    let tree = build_tree(&[document.leaf_hash]).expect("one leaf");
    assert_eq!(path_for(&tree, 0), Some(Vec::new()));
    assert!(case.verifies(&document.leaf_hash, 0, &[]));
    // A self-duplicated padding level yields a consistent root but violates the exact depth.
    let padded_root = hash_node(&document.leaf_hash, &document.leaf_hash);
    assert!(!verify_path(&document.leaf_hash, 0, 1, &[document.leaf_hash], &padded_root));
    assert!(!case.verifies(&document.leaf_hash, 1, &[]));
}

#[test]
fn detects_a_changed_pdf_byte() {
    let case = case_with(3);
    let document = case.document(0);
    let mut changed = document.pdf.clone();
    changed[20] ^= 1;
    let leaf = case.leaf(&case.context, &changed, document.leaf_index, &document.nonce);
    assert!(!case.verifies(&leaf, document.leaf_index, &document.siblings));
}

#[test]
fn detects_a_proof_exchanged_between_documents() {
    let case = case_with(3);
    let document = case.document(0);
    let other = case.document(1);
    let leaf = case.leaf(&case.context, &document.pdf, other.leaf_index, &other.nonce);
    assert!(!case.verifies(&leaf, other.leaf_index, &other.siblings));
}

#[test]
fn rejects_tampered_context_nonce_and_root() {
    let case = case_with(3);
    let document = case.document(0);
    let forged = [0xffu8; 32];
    let mut contexts = [case.context; 3];
    contexts[0].issuer_id = forged;
    contexts[1].batch_id = forged;
    // Base58 "11111111111111111111111111111111" is 32 zero bytes: another program.
    contexts[2].program_id = [0u8; 32];
    for context in &contexts {
        let leaf = case.leaf(context, &document.pdf, document.leaf_index, &document.nonce);
        assert!(!case.verifies(&leaf, document.leaf_index, &document.siblings));
    }
    let swapped_nonce = case.leaf(&case.context, &document.pdf, document.leaf_index, &case.document(1).nonce);
    assert!(!case.verifies(&swapped_nonce, document.leaf_index, &document.siblings));
    let forged_nonce = case.leaf(&case.context, &document.pdf, document.leaf_index, &forged);
    assert!(!case.verifies(&forged_nonce, document.leaf_index, &document.siblings));
    assert!(!verify_path(&document.leaf_hash, document.leaf_index, case.context.leaf_count, &document.siblings, &forged));
}

#[test]
fn rejects_index_changes_and_out_of_range_indices() {
    let case = case_with(3);
    let document = case.document(0);
    // The index is bound into the leaf and selects the sibling side.
    let reindexed = case.leaf(&case.context, &document.pdf, 1, &document.nonce);
    assert!(!case.verifies(&reindexed, 1, &document.siblings));
    assert!(!case.verifies(&document.leaf_hash, 1, &document.siblings));
    for leaf_index in [3, 4, u32::MAX] {
        assert!(!case.verifies(&document.leaf_hash, leaf_index, &document.siblings));
    }
}

#[test]
fn rejects_altered_leaf_counts() {
    let case = case_with(3);
    let document = case.document(0);
    // Leaf 0 has the same path shape for 3 and 4 leaves, so only the count bound into the
    // leaf hash rejects this change; other counts also change the path depth.
    let mut recounted = case.context;
    recounted.leaf_count = 4;
    let leaf = case.leaf(&recounted, &document.pdf, document.leaf_index, &document.nonce);
    assert!(!verify_path(&leaf, document.leaf_index, 4, &document.siblings, &case.root));
    for leaf_count in [0, 1, 2, 5, 101] {
        assert!(!verify_path(&document.leaf_hash, document.leaf_index, leaf_count, &document.siblings, &case.root));
    }
}

#[test]
fn rejects_every_altered_sibling() {
    for case in load_cases() {
        for document in &case.documents {
            for level in 0..document.siblings.len() {
                let mut siblings = document.siblings.clone();
                siblings[level][0] ^= 1;
                assert!(
                    !case.verifies(&document.leaf_hash, document.leaf_index, &siblings),
                    "{} leaves, document {}, level {level}",
                    case.context.leaf_count,
                    document.leaf_index
                );
            }
        }
    }
}

#[test]
fn rejects_unexpected_path_depth() {
    let case = case_with(3);
    let document = case.document(0);
    let extended_root_sibling = [0xffu8; 32];
    let mut longer = document.siblings.clone();
    longer.push(extended_root_sibling);
    let longer_root = fold_unchecked(&document.leaf_hash, document.leaf_index, &longer);
    assert!(!verify_path(&document.leaf_hash, document.leaf_index, 3, &longer, &longer_root));
    assert!(!case.verifies(&document.leaf_hash, document.leaf_index, &longer));
    assert!(!case.verifies(&document.leaf_hash, document.leaf_index, &document.siblings[..1]));
    assert!(!case.verifies(&document.leaf_hash, document.leaf_index, &[]));
}

#[test]
fn rejects_a_nonduplicated_odd_node_even_when_the_root_matches_the_forged_path() {
    // Mirrors the TypeScript test on the last document of the 3-leaf batch.
    let case = case_with(3);
    let last = case.document(2);
    let left = last.siblings[1];
    let fake_sibling = [0xffu8; 32];
    let fake_root = hash_node(&left, &hash_node(&last.leaf_hash, &fake_sibling));
    let forged = [fake_sibling, left];
    assert_eq!(fold_unchecked(&last.leaf_hash, 2, &forged), fake_root);
    assert!(!verify_path(&last.leaf_hash, 2, 3, &forged, &fake_root));

    // Every level where an odd final node must be duplicated, across all odd fixtures.
    let mut checked = 0;
    for case in load_cases().into_iter().filter(|case| case.context.leaf_count > 1) {
        for document in &case.documents {
            let mut current = document.leaf_hash;
            let mut index = document.leaf_index;
            let mut width = case.context.leaf_count;
            for (level, sibling) in document.siblings.iter().enumerate() {
                if index % 2 == 0 && index + 1 >= width {
                    assert_eq!(*sibling, current, "fixture duplicates the odd node");
                    let mut forged = document.siblings.clone();
                    forged[level] = fake_sibling;
                    let forged_root = fold_unchecked(&document.leaf_hash, document.leaf_index, &forged);
                    assert!(!verify_path(
                        &document.leaf_hash,
                        document.leaf_index,
                        case.context.leaf_count,
                        &forged,
                        &forged_root
                    ));
                    checked += 1;
                }
                current = if index % 2 == 0 {
                    hash_node(&current, sibling)
                } else {
                    hash_node(sibling, &current)
                };
                index /= 2;
                width = (width + 1) / 2;
            }
            assert_eq!(current, case.root);
        }
    }
    // 3 leaves: leaf 2 at level 0. 5 leaves: leaf 4 at levels 0 and 1.
    assert_eq!(checked, 3);
}
