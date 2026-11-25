//! VinculoSBT — NFT soulbound con el tier de crédito del usuario.
//!
//! # Eventos
//!
//! Cada función que cambia estado publica un evento Soroban con el esquema
//! `(topic0 = acción, topic1 = sujeto)` y un payload pequeño. Ver `docs/websocket.md`:
//!
//! | topic0   | topic1 | datos                 |
//! |----------|--------|-----------------------|
//! | `init`   | admin  | `()` (sin payload)    |
//! | `mint`   | user   | `tier: u32`           |
//! | `revoke` | user   | `previous_tier: u32`  |

#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol};

#[contracttype]
pub enum DataKey {
    Admin,
    Tier(Address),
    Name,
    Symbol,
}

#[contract]
pub struct VinculoSBT;

#[contractimpl]
impl VinculoSBT {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("El contrato ya fue inicializado");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(
            &DataKey::Name,
            &String::from_str(&env, "Vinculo Credito SBT"),
        );
        env.storage()
            .instance()
            .set(&DataKey::Symbol, &String::from_str(&env, "VINC"));

        // `init` → sin payload: el admin va en topic1.
        env.events().publish((Symbol::new(&env, "init"), admin), ());
    }

    pub fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(env: Env) -> String {
        env.storage().instance().get(&DataKey::Symbol).unwrap()
    }

    pub fn token_uri(env: Env, user: Address) -> String {
        let tier = env
            .storage()
            .persistent()
            .get(&DataKey::Tier(user))
            .unwrap_or(0u32);
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

        // OPT: single storage read for admin — replaces has() + get() (two reads → one)
        let saved_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != saved_admin {
            panic!("Solo el administrador puede mintear NFTs");
        }

        // OPT: build Tier key once — eliminates redundant user.clone() before the set()
        let tier_key = DataKey::Tier(user.clone());
        let current_tier = env.storage().persistent().get(&tier_key).unwrap_or(0u32);
        if current_tier == tier {
            panic!("El usuario ya posee un NFT de este nivel exacto");
        }

        env.storage().persistent().set(&tier_key, &tier);

        // `mint` → tier minteado; el usuario va en topic1.
        env.events()
            .publish((Symbol::new(&env, "mint"), user), tier);
    }

    pub fn revoke(env: Env, admin: Address, user: Address) {
        admin.require_auth();
        let saved_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != saved_admin {
            panic!("Solo el administrador puede revocar");
        }
        // Tier anterior, para que el indexador sepa qué se revocó.
        let previous_tier: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Tier(user.clone()))
            .unwrap_or(0u32);

        env.storage()
            .persistent()
            .set(&DataKey::Tier(user.clone()), &0u32);

        // `revoke` → tier que tenía el usuario (topic1).
        env.events()
            .publish((Symbol::new(&env, "revoke"), user), previous_tier);
    }

    pub fn get_tier(env: Env, user: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Tier(user))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod test;
