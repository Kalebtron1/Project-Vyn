#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

#[contracttype]
pub enum DataKey {
    Admin,
    Tier(Address),
    Name,
    Symbol,
}

// ─── TTL (vida útil del storage) ───────────────────────────────────────────────
//
// Soroban archiva las entradas persistentes y de instancia cuando su TTL llega a 0.
// Un ledger dura ~5 s. Cada acceso extiende el TTL solo si queda menos de
// `TTL_THRESHOLD`, y entonces lo sube hasta `TTL_EXTEND_TO`. Ver
// docs/contracts/migration.md ("Storage TTL").
pub const LEDGERS_PER_DAY: u32 = 17_280;
/// Se extiende cuando quedan menos de 30 días.
pub const TTL_THRESHOLD: u32 = 30 * LEDGERS_PER_DAY;
/// Se extiende hasta 60 días.
pub const TTL_EXTEND_TO: u32 = 60 * LEDGERS_PER_DAY;

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Extiende el TTL de una entrada persistente si existe (`extend_ttl` falla si no existe).
fn bump_persistent<K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
    if env.storage().persistent().has(key) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

#[contract]
pub struct VinculoSBT;

#[contractimpl]
impl VinculoSBT {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("El contrato ya fue inicializado");
        }
        bump_instance(&env);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Name, &String::from_str(&env, "Vinculo Credito SBT"));
        env.storage().instance().set(&DataKey::Symbol, &String::from_str(&env, "VINC"));
    }

    pub fn name(env: Env) -> String {
        bump_instance(&env);
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(env: Env) -> String {
        bump_instance(&env);
        env.storage().instance().get(&DataKey::Symbol).unwrap()
    }

    pub fn token_uri(env: Env, user: Address) -> String {
        bump_instance(&env);
        let tier_key = DataKey::Tier(user);
        let tier = env.storage().persistent().get(&tier_key).unwrap_or(0u32);
        bump_persistent(&env, &tier_key);
        match tier {
            1 => String::from_str(&env, "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/plata.json"),
            2 => String::from_str(&env, "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/oro.json"),
            3 => String::from_str(&env, "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/diamante.json"),
            4 => String::from_str(&env, "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/platino.json"),
            _ => String::from_str(&env, "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/bronce.json"),
        }
    }

    pub fn mint(env: Env, admin: Address, user: Address, tier: u32) {
        admin.require_auth();
        bump_instance(&env);

        // OPT: single storage read for admin — replaces has() + get() (two reads → one)
        let saved_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != saved_admin {
            panic!("Solo el administrador puede mintear NFTs");
        }

        // OPT: build Tier key once — eliminates redundant user.clone() before the set()
        let tier_key = DataKey::Tier(user);
        let current_tier = env.storage().persistent().get(&tier_key).unwrap_or(0u32);
        if current_tier == tier {
            panic!("El usuario ya posee un NFT de este nivel exacto");
        }

        env.storage().persistent().set(&tier_key, &tier);
        bump_persistent(&env, &tier_key);
    }

    pub fn revoke(env: Env, admin: Address, user: Address) {
        admin.require_auth();
        bump_instance(&env);
        let saved_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != saved_admin {
            panic!("Solo el administrador puede revocar");
        }
        // OPT: pass user directly — no clone needed
        let tier_key = DataKey::Tier(user);
        env.storage().persistent().set(&tier_key, &0u32);
        bump_persistent(&env, &tier_key);
    }

    pub fn get_tier(env: Env, user: Address) -> u32 {
        bump_instance(&env);
        let tier_key = DataKey::Tier(user);
        let tier = env.storage().persistent().get(&tier_key).unwrap_or(0);
        bump_persistent(&env, &tier_key);
        tier
    }
}

#[cfg(test)]
mod test;
