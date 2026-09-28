#!/usr/bin/env bash
# Build the solvcred program, deploy it to Devnet (or to a local validator as a rehearsal), and bootstrap the
# registry with the upgrade authority as admin. Safe to rerun: an identical deployed build is not redeployed
# and an initialized registry is left alone. Runbook: docs/deploy-devnet.md.
set -euo pipefail

readonly DEVNET_GENESIS=EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
readonly PLACEHOLDER_PROGRAM_ID=CZtvDiPBJ4voLQ9XchqAaXk9fzzghgsB62uSjwLMxASo
readonly SOLANA_SERIES=2.3
readonly ANCHOR_VERSION=0.32.1
# Write-transaction fees of a deployment plus the registry account; unused lamports stay in the wallet.
readonly FEE_MARGIN_LAMPORTS=20000000
# UpgradeableLoaderState headers: Buffer 37 bytes, ProgramData 45 bytes, Program account 36 bytes.
readonly BUFFER_HEADER=37 PROGRAM_DATA_HEADER=45 PROGRAM_ACCOUNT_SIZE=36

usage() {
  cat <<'EOF'
Usage: scripts/deploy-devnet.sh (--program-keypair <file> | --program-id <address>) [options] [-- <solana program deploy flags>]

  --program-keypair <file>  Keypair that fixes the program address. Created if the file does not exist.
                            Required for the first deployment; keep it outside the repository.
  --program-id <address>    Upgrade an already deployed program without its keypair.
  --authority <file>        Fee payer, upgrade authority and registry admin
                            (default: the Solana CLI keypair, `solana config get keypair`).
  --cluster devnet|localnet Default devnet. localnet rehearses against a local validator
                            (default URL http://127.0.0.1:8899; program keypair defaults to target/deploy).
  --url <rpc>               RPC endpoint (default https://api.devnet.solana.com for devnet).
  --skip-registry           Deploy only; do not run initialize_registry.
  --write-env               Write the web app settings to apps/web/.env.local.
  -y, --yes                 Do not ask for confirmation.

Flags after `--` go to `solana program deploy`, e.g. -- --use-rpc --with-compute-unit-price 10000
EOF
}

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }
need_value() { [[ $# -ge 2 && -n $2 ]] || die "$1 needs a value"; }
sol() { node -e 'process.stdout.write((Number(process.argv[1]) / 1e9).toFixed(4))' "$1"; }
# json <document> <dotted.path>: prints the value, or nothing for null/missing.
json() {
  node -e 'let v = JSON.parse(process.argv[1]); for (const k of process.argv[2].split(".")) v = v == null ? v : v[k];
    process.stdout.write(v == null ? "" : String(v));' "$1" "$2"
}

cluster=devnet url='' program_keypair='' program_id='' authority='' skip_registry=0 write_env=0 assume_yes=0
deploy_args=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --program-keypair) need_value "$@"; program_keypair=$(realpath -m -- "$2"); shift 2 ;;
    --program-id) need_value "$@"; program_id=$2; shift 2 ;;
    --authority) need_value "$@"; authority=$(realpath -m -- "$2"); shift 2 ;;
    --cluster) need_value "$@"; cluster=$2; shift 2 ;;
    --url) need_value "$@"; url=$2; shift 2 ;;
    --skip-registry) skip_registry=1; shift ;;
    --write-env) write_env=1; shift ;;
    -y|--yes) assume_yes=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; deploy_args=("$@"); break ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo"

# ---------------------------------------------------------------------------------------------------------------
step 'Checking tools and inputs'
for tool in solana solana-keygen anchor node npm git; do
  command -v "$tool" >/dev/null || die "$tool is not in PATH (docs/deploy-devnet.md, Prasyarat)"
done
solana_version=$(solana --version | awk '{print $2}')
[[ $solana_version == "$SOLANA_SERIES".* ]] || die "Solana CLI $solana_version found; the program is built and tested with Agave $SOLANA_SERIES.x"
anchor_version=$(anchor --version | awk '{print $2}')
[[ $anchor_version == "$ANCHOR_VERSION" ]] || die "Anchor CLI $anchor_version found; expected $ANCHOR_VERSION"
[[ -d node_modules/@solana/web3.js ]] || die 'node_modules is missing; run npm ci --ignore-scripts'

case $cluster in
  devnet)
    url=${url:-https://api.devnet.solana.com}
    genesis=$DEVNET_GENESIS
    ;;
  localnet)
    url=${url:-http://127.0.0.1:8899}
    [[ $url =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]+)?/?$ ]] || die "--cluster localnet only accepts a local validator URL, got $url"
    [[ -n $program_keypair || -n $program_id ]] || program_keypair=$repo/target/deploy/solvcred-keypair.json
    genesis='' # read from the validator below
    ;;
  *) die '--cluster must be devnet or localnet' ;;
esac
[[ -n $program_keypair || -n $program_id ]] || die 'pass --program-keypair <file> (first deployment) or --program-id <address> (upgrade)'
[[ -z $program_keypair || -z $program_id ]] || die 'pass either --program-keypair or --program-id, not both'
authority=${authority:-$(solana config get keypair | awk '{print $NF}')}
[[ -f $authority ]] || die "authority keypair $authority does not exist; create one with solana-keygen new -o $authority"

# Keypairs never belong in commits.
guard_secret() {
  case $1 in "$repo"/*) ;; *) return 0 ;; esac
  git check-ignore -q -- "$1" || die "$1 is inside the repository and not ignored by git; keep keypairs out of commits"
}
guard_secret "$authority"
if [[ -n $program_keypair ]]; then
  guard_secret "$program_keypair"
  if [[ ! -f $program_keypair ]]; then
    mkdir -p "$(dirname "$program_keypair")"
    solana-keygen new --no-bip39-passphrase --silent --outfile "$program_keypair"
    echo "Created program keypair $program_keypair"
  fi
  program_id=$(solana-keygen pubkey "$program_keypair")
  program_arg=$program_keypair
else
  program_arg=$program_id
fi
authority_pubkey=$(solana-keygen pubkey "$authority")
[[ $program_id != "$authority_pubkey" ]] || die 'the program keypair and the authority must be different keys'
[[ $program_id != "$PLACEHOLDER_PROGRAM_ID" ]] || die 'the placeholder program ID has no private key and cannot be deployed'

npm run --silent build
registry_cli() { node --no-deprecation dist/scripts/registry.js "$@" --url "$url" --program-id "$program_id" ${genesis:+--expect-genesis "$genesis"}; }

step "Checking the cluster at $url"
status=$(registry_cli status --json) || die "cannot read the cluster at $url"
genesis=$(json "$status" genesisHash)
echo "Genesis hash $genesis"

# ---------------------------------------------------------------------------------------------------------------
step "Building the program for $program_id"
lib=programs/solvcred/src/lib.rs
declared_id=$(sed -nE 's/^declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\);$/\1/p' "$lib")
[[ -n $declared_id ]] || die "declare_id! not found in $lib"
id_note=''
if [[ $declared_id != "$program_id" ]]; then
  [[ $declared_id == "$PLACEHOLDER_PROGRAM_ID" ]] || id_note="WARNING: $lib declared $declared_id, a different program."
  sed -E "s/^declare_id!\(\"[1-9A-HJ-NP-Za-km-z]+\"\);$/declare_id!(\"$program_id\");/" "$lib" > "$lib.tmp" && mv "$lib.tmp" "$lib"
fi
# Record the address under [programs.<cluster>] in Anchor.toml.
awk -v section="[programs.$cluster]" -v id="$program_id" '
  $0 == section { inside = 1; found = 1; print; next }
  /^\[/ { inside = 0 }
  inside && /^solvcred = / { print "solvcred = \"" id "\""; next }
  { print }
  END { if (!found) exit 3 }' Anchor.toml > Anchor.toml.tmp || { rm -f Anchor.toml.tmp; die "Anchor.toml has no [programs.$cluster] section"; }
mv Anchor.toml.tmp Anchor.toml

anchor build
so=target/deploy/solvcred.so
idl_address=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("target/idl/solvcred.json", "utf8")).address)')
[[ $idl_address == "$program_id" ]] || die "IDL address $idl_address does not match $program_id"
so_size=$(wc -c < "$so" | tr -d ' ')
so_sha256=$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$so")
echo "Built $so: $so_size bytes, sha256 $so_sha256"

# Program sources with changes beyond declare_id! are not reproducible from the recorded commit.
source_changes=$(
  git diff HEAD -U0 -- programs crates Cargo.toml Cargo.lock | grep -E '^[-+]' | grep -vE '^(\+\+\+|---) ' | grep -v 'declare_id!'
  git status --porcelain --untracked-files=all -- programs crates | grep '^??'
) || true

# ---------------------------------------------------------------------------------------------------------------
step 'Planning'
status=$(registry_cli status --compare "$so" --json)
deployed_authority=$(json "$status" program.upgradeAuthority)
rent() { solana rent "$1" --lamports --url "$url" | awk '{print $3}'; }
needed=$FEE_MARGIN_LAMPORTS
if [[ -z $(json "$status" program.programDataAddress) ]]; then
  [[ -n $program_keypair ]] || die "program $program_id is not deployed; the first deployment needs --program-keypair"
  action=deploy
  needed=$((needed + $(rent $((so_size + BUFFER_HEADER))) + $(rent $((so_size + PROGRAM_DATA_HEADER))) + $(rent $PROGRAM_ACCOUNT_SIZE)))
elif [[ -z $deployed_authority ]]; then
  die "program $program_id is immutable (no upgrade authority)"
elif [[ $deployed_authority != "$authority_pubkey" ]]; then
  die "the upgrade authority of $program_id is $deployed_authority; pass its keypair with --authority"
elif [[ $(json "$status" program.matchesLocalBuild) == true ]]; then
  action=none
else
  action=upgrade
  needed=$((needed + $(rent $((so_size + BUFFER_HEADER)))))
  data_length=$(json "$status" program.programDataLength)
  if (( so_size + PROGRAM_DATA_HEADER > data_length )); then
    needed=$((needed + $(rent $((so_size + PROGRAM_DATA_HEADER))) - $(rent "$data_length")))
  fi
fi

registry_admin=$(json "$status" registry.admin)
if (( skip_registry )); then registry_action=skip
elif [[ -z $registry_admin ]]; then registry_action=init
elif [[ $registry_admin == "$authority_pubkey" ]]; then registry_action=present
else registry_action=foreign
fi

balance=$(solana balance "$authority_pubkey" --lamports --url "$url" | awk '{print $1}')
case $action in
  deploy) action_text="first deployment (about $(sol $((needed - FEE_MARGIN_LAMPORTS))) SOL, of which the buffer rent is refunded)" ;;
  upgrade) action_text='upgrade to the local build (buffer rent is refunded)' ;;
  none) action_text='none: the deployed bytecode is identical to the local build' ;;
esac
case $registry_action in
  init) registry_text="initialize_registry with admin $authority_pubkey" ;;
  present) registry_text="already initialized with admin $authority_pubkey" ;;
  foreign) registry_text="already initialized with ANOTHER admin $registry_admin (left unchanged)" ;;
  skip) registry_text='skipped (--skip-registry)' ;;
esac
cat <<EOF

  Cluster            $cluster ($url)
  Genesis hash       $genesis
  Program ID         $program_id
  Upgrade authority  $authority_pubkey (also fee payer and registry admin)
  Balance            $(sol "$balance") SOL, needed about $(sol "$needed") SOL
  Program            $action_text
  Registry           $registry_text
EOF
[[ -z $id_note ]] || printf '\n  %s\n' "$id_note"
[[ -z $source_changes ]] || printf '\n  WARNING: program sources have uncommitted changes; the deployment record cannot point to them.\n'

if (( balance < needed )); then
  if [[ $cluster == devnet ]]; then
    die "insufficient balance; fund $authority_pubkey at https://faucet.solana.com (or solana airdrop 2 $authority_pubkey --url devnet)"
  fi
  die "insufficient balance; run solana airdrop 10 $authority_pubkey --url $url"
fi
if [[ $action == none && $registry_action != init ]]; then
  echo; echo 'Nothing to send.'
elif (( ! assume_yes )); then
  [[ -t 0 ]] || die 'stdin is not a terminal; pass --yes to proceed without confirmation'
  read -r -p $'\nProceed? [y/N] ' answer
  [[ $answer =~ ^[yY]([eE][sS])?$ ]] || die 'aborted; nothing was sent'
fi

# ---------------------------------------------------------------------------------------------------------------
if [[ $action != none ]]; then
  step "Deploying ($action)"
  solana program deploy "$so" --url "$url" --keypair "$authority" --upgrade-authority "$authority" \
    --program-id "$program_arg" ${deploy_args[@]+"${deploy_args[@]}"}

  step 'Waiting until the deployed bytecode is finalized'
  for _ in $(seq 1 60); do
    status=$(registry_cli status --compare "$so" --json)
    [[ $(json "$status" program.matchesLocalBuild) == true ]] && break
    sleep 3
  done
  [[ $(json "$status" program.matchesLocalBuild) == true ]] ||
    die 'the finalized program does not match the local build yet; rerun this script (it is idempotent)'
  echo 'Finalized program matches the local build.'
fi

if [[ $registry_action == init ]]; then
  step 'Bootstrapping the registry'
  registry_cli init --keypair "$authority"
fi

# ---------------------------------------------------------------------------------------------------------------
step 'Result'
status=$(registry_cli status --json)
registry_cli status
record=deployments/$cluster.json
mkdir -p deployments
# Rewritten only when the on-chain state changed, so a verifying rerun leaves the committed record alone.
node -e '
  const fs = require("fs");
  const [path, status, cluster, sha256, commit, modified] = process.argv.slice(1);
  const s = JSON.parse(status);
  const onChain = {
    cluster, genesisHash: s.genesisHash, programId: s.programId,
    programDataAddress: s.program.programDataAddress, upgradeAuthority: s.program.upgradeAuthority,
    lastDeploySlot: s.program.lastDeploySlot, programSha256: sha256,
    registryAddress: s.registryAddress, registryAdmin: s.registry ? s.registry.admin : null,
  };
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(path, "utf8")); } catch {}
  if (previous && Object.entries(onChain).every(([key, value]) => previous[key] === value)) {
    console.log("Deployment record " + path + " is up to date");
  } else {
    const record = { ...onChain, sourceCommit: commit, sourceModified: modified === "1", recordedAt: new Date().toISOString() };
    fs.writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
    console.log("Deployment record written to " + path);
  }' "$record" "$status" "$cluster" "$so_sha256" "$(git rev-parse HEAD)" "$([[ -n $source_changes ]] && echo 1 || echo 0)"

env_lines=("VITE_SOLVCRED_PROGRAM_ID=$program_id" "VITE_SOLVCRED_RPC_URL=$url" "VITE_SOLVCRED_GENESIS_HASH=$genesis")
if (( write_env )); then
  env_file=apps/web/.env.local
  { [[ -f $env_file ]] && grep -vE '^VITE_SOLVCRED_(PROGRAM_ID|RPC_URL|GENESIS_HASH)=' "$env_file" || true; printf '%s\n' "${env_lines[@]}"; } > "$env_file.tmp"
  mv "$env_file.tmp" "$env_file"
  echo "Web app settings written to $env_file"
else
  printf '\nWeb app settings (apps/web/.env.local or the hosting environment):\n'
  printf '  %s\n' "${env_lines[@]}"
fi

if [[ $cluster == devnet ]]; then
  printf '\nNext: commit %s, Anchor.toml and %s so the source names the deployed program.\n' "$lib" "$record"
else
  printf '\nRehearsal only: git checkout %s Anchor.toml restores the source.\n' "$lib"
fi
