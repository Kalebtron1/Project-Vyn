# Contract Migration & Upgrade Guide

> ⚠️ **Read first (2026-10-22).** None of the three contracts exposes an `upgrade`
> function. In Soroban a contract can only replace its own Wasm if it implements a function
> that calls `update_current_contract_wasm`, so the **Upgrade** sections below (and
> `scripts/upgrade_contract.sh`) fail against the deployed contracts. Today a change means
> deploying a new instance, initializing it, and updating the IDs in Vercel
> ([deployment](../deployment.md#contract-redeployment)). Storage does not carry over: SBT
> tiers, pool shares and loans start empty.

Covers the full deploy and upgrade sequence for the three Soroban contracts in this repo.  
All commands target **Stellar Testnet** (`--network testnet`). Swap `testnet` for `futurenet` or a local node as needed.

## Prerequisites

```bash
# Rust + wasm target
rustup target add wasm32-unknown-unknown

# Stellar CLI (must be ≥ 21.x to match soroban-sdk 21.7.6)
cargo install --locked stellar-cli --features opt

# Confirm versions
stellar --version
rustc --version
```

Set these shell variables once per session (or export them from `.env.local`):

```bash
export ADMIN_SECRET="S..."          # Secret key of the deployer/admin account
export ADMIN_PUBLIC="G..."          # Matching public key
export NETWORK="testnet"
export RPC_URL="https://soroban-testnet.stellar.org"
export NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
```

Fund the account on testnet if needed:

```bash
stellar keys fund $ADMIN_PUBLIC --network $NETWORK
```

---

## Deploy Order

`vinculo_lending` depends on `vinculo_sbt` at the Rust crate level, so deploy in this order:

1. `vinculo_sbt`
2. `staking_pool` (independent, can be parallel with step 1)
3. `vinculo_lending`

---

## 1. vinculo_sbt

### Build

```bash
cd backend/contracts/vinculo_sbt
cargo build --release --target wasm32-unknown-unknown
```

Wasm output: `target/wasm32-unknown-unknown/release/vinculo_sbt.wasm`

### Deploy (first time)

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/vinculo_sbt.wasm \
  --source $ADMIN_SECRET \
  --network $NETWORK
```

Save the printed contract ID:

```bash
export SBT_CONTRACT_ID="C..."
```

### Initialize

```bash
stellar contract invoke \
  --id $SBT_CONTRACT_ID \
  --source $ADMIN_SECRET \
  --network $NETWORK \
  -- init \
  --admin $ADMIN_PUBLIC
```

`init` panics if called twice — it is safe to re-run only on a freshly deployed contract.

### Upgrade (existing deployment)

```bash
# 1. Build the new wasm
cargo build --release --target wasm32-unknown-unknown

# 2. Upload the new wasm blob and capture the hash
WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/vinculo_sbt.wasm \
  --source $ADMIN_SECRET \
  --network $NETWORK)

# 3. Upgrade the live contract in-place
stellar contract invoke \
  --id $SBT_CONTRACT_ID \
  --source $ADMIN_SECRET \
  --network $NETWORK \
  -- upgrade \
  --new_wasm_hash $WASM_HASH
```

> **Note:** `upgrade` is a built-in Soroban host function. The contract code is replaced but all storage (tiers, admin) is preserved.

### Metadata base URI (issue #103)

`token_uri` now builds tier metadata URLs from `DataKey::MetadataBaseUri`. `init` sets
it to the project-owned default
`https://raw.githubusercontent.com/Kalebtron1/Project-Vyn/main/metadata/`. Because the
deployed contracts cannot be upgraded in place today (see the warning at the top), this
change ships with a fresh deploy. Instances that lack the key (for example, if an
`upgrade` entry point is added later) fall back to the same default, so no migration
call is required. To use a different host, set it as the admin:

```bash
stellar contract invoke \
  --id $SBT_CONTRACT_ID \
  --source $ADMIN_SECRET \
  --network $NETWORK \
  -- set_metadata_base_uri \
  --admin $ADMIN_PUBLIC \
  --base_uri "https://cdn.example.com/vyn/metadata/"
```

The base URI must be non-empty, at most 512 bytes, and end with `/`. The tier files
are `bronce.json`, `plata.json`, `oro.json`, `diamante.json`, and `platino.json`.

---

## 2. staking_pool

### Build

```bash
cd backend/contracts/staking_pool
cargo build --release --target wasm32-unknown-unknown
```

Wasm output: `target/wasm32-unknown-unknown/release/staking_pool.wasm`

### Deploy (first time)

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/staking_pool.wasm \
  --source $ADMIN_SECRET \
  --network $NETWORK
```

```bash
export STAKING_CONTRACT_ID="C..."
```

### Initialize

Requires the admin address, the SAC of the **USDC** token held by the DeFindex vault, and
the vault address (create the vault first with `scripts/create_vault.sh`):

```bash
stellar contract invoke \
  --id $STAKING_CONTRACT_ID \
  --source $ADMIN_SECRET \
  --network $NETWORK \
  -- init \
  --admin $ADMIN_PUBLIC \
  --token <USDC_SAC_ADDRESS> \
  --vault <DEFINDEX_VAULT_ADDRESS>
```

### Upgrade

```bash
cd backend/contracts/staking_pool
cargo build --release --target wasm32-unknown-unknown

WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/staking_pool.wasm \
  --source $ADMIN_SECRET \
  --network $NETWORK)

stellar contract invoke \
  --id $STAKING_CONTRACT_ID \
  --source $ADMIN_SECRET \
  --network $NETWORK \
  -- upgrade \
  --new_wasm_hash $WASM_HASH
```

> All balances and stake records in persistent storage survive the upgrade.

---

## 3. vinculo_lending

Depends on `vinculo_sbt` — `$SBT_CONTRACT_ID` must be set before deploying.

### Build

```bash
cd backend/contracts/vinculo_lending
cargo build --release --target wasm32-unknown-unknown
```

Wasm output: `target/wasm32-unknown-unknown/release/vinculo_lending.wasm`

### Deploy (first time)

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/vinculo_lending.wasm \
  --source $ADMIN_SECRET \
  --network $NETWORK
```

```bash
export LENDING_CONTRACT_ID="C..."
```

### Initialize

```bash
stellar contract invoke \
  --id $LENDING_CONTRACT_ID \
  --source $ADMIN_SECRET \
  --network $NETWORK \
  -- init_lending \
  --token <XLM_SAC_ADDRESS> \
  --sbt $SBT_CONTRACT_ID \
  --treasury <TREASURY_G_ADDRESS>
```

### Fund the pool

```bash
stellar contract invoke \
  --id $LENDING_CONTRACT_ID \
  --source $ADMIN_SECRET \
  --network $NETWORK \
  -- fund_pool \
  --from $ADMIN_PUBLIC \
  --amount 10000000000
```

### Upgrade

```bash
cd backend/contracts/vinculo_lending
cargo build --release --target wasm32-unknown-unknown

WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/vinculo_lending.wasm \
  --source $ADMIN_SECRET \
  --network $NETWORK)

stellar contract invoke \
  --id $LENDING_CONTRACT_ID \
  --source $ADMIN_SECRET \
  --network $NETWORK \
  -- upgrade \
  --new_wasm_hash $WASM_HASH
```

> Active loans (`Loan` entries in persistent storage) are preserved across upgrades.

---

## After Any Deploy or Upgrade

Update `.env.local` with the new contract IDs:

```
NFT_CONTRACT_ID=<new SBT_CONTRACT_ID>
VITE_LENDING_CONTRACT_ID=<new LENDING_CONTRACT_ID>
STAKING_CONTRACT_ID=<new STAKING_CONTRACT_ID>
VITE_STAKING_CONTRACT_ID=<new STAKING_CONTRACT_ID>
VITE_TREASURY_ADDRESS=<treasury G address>
```

Set the same values in Vercel and redeploy (`VITE_*` are compiled into the bundle).

Restart the backend and frontend so they pick up the new values.

---

## Rollback / Recovery

Soroban does not support reverting a `upgrade` call directly. Recovery options:

| Scenario | Action |
|---|---|
| Bad upgrade (logic bug) | Re-upload the previous wasm blob and call `upgrade` again with the old hash. Keep the old `.wasm` file or its hash in version control. |
| Bad deploy (wrong init args) | Deploy a fresh contract instance, re-initialize with correct args, update `.env.local`. |
| Corrupted storage | There is no on-chain rollback. Redeploy and migrate user state off-chain if needed. |
| Lost contract ID | Query `stellar contract id` or check the deployment transaction in the Stellar explorer. |

**Best practice:** before any upgrade, record the current wasm hash:

```bash
stellar contract info --id $CONTRACT_ID --network $NETWORK
```

Store that hash so you can roll back by re-uploading the old wasm.

---

## Automated Script

See [`scripts/deploy_contracts.sh`](../../scripts/deploy_contracts.sh) for a single script that runs the full deploy + init sequence from a clean clone.
