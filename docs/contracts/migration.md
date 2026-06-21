# Contract Migration & Upgrade Guide

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

Requires a Stellar Asset Contract (SAC) address for the token. Use the XLM SAC on testnet or deploy your own:

```bash
stellar contract invoke \
  --id $STAKING_CONTRACT_ID \
  --source $ADMIN_SECRET \
  --network $NETWORK \
  -- init \
  --token <TOKEN_SAC_ADDRESS>
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
  --token <TOKEN_SAC_ADDRESS> \
  --sbt $SBT_CONTRACT_ID
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
```

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
