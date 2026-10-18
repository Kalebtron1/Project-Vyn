#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

#[contracttype]
pub enum DataKey {
    Admin,
    Tier(Address),
    Name,
    Symbol,
}

// ─── TTL de almacenamiento ───────────────────────────────────────────────────

pub const DAY_IN_LEDGERS: u32 = 17_280;
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
pub const INSTANCE_BUMP_AMOUNT: u32 = 60 * DAY_IN_LEDGERS;
pub const PERSISTENT_LIFETIME_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
pub const PERSISTENT_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;

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
        Self::bump_instance(&env);
    }

    pub fn name(env: Env) -> String {
        let val: String = env.storage().instance().get(&DataKey::Name).unwrap();
        Self::bump_instance(&env);
        val
    }

    pub fn symbol(env: Env) -> String {
        let val: String = env.storage().instance().get(&DataKey::Symbol).unwrap();
        Self::bump_instance(&env);
        val
    }

    pub fn token_uri(env: Env, user: Address) -> String {
        let key = DataKey::Tier(user);
        let tier = if let Some(t) = env.storage().persistent().get::<DataKey, u32>(&key) {
            Self::bump_persistent(&env, &key);
            t
        } else {
            0u32
        };
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
        Self::bump_instance(&env);

        // OPT: build Tier key once — eliminates redundant user.clone() before the set()
        let tier_key = DataKey::Tier(user);
        let current_tier = env.storage().persistent().get(&tier_key).unwrap_or(0u32);
        if current_tier == tier {
            panic!("El usuario ya posee un NFT de este nivel exacto");
        }

        env.storage().persistent().set(&tier_key, &tier);
        Self::bump_persistent(&env, &tier_key);
    }

    pub fn revoke(env: Env, admin: Address, user: Address) {
        admin.require_auth();
        let saved_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != saved_admin {
            panic!("Solo el administrador puede revocar");
        }
        Self::bump_instance(&env);
        let tier_key = DataKey::Tier(user);
        env.storage().persistent().set(&tier_key, &0u32);
        Self::bump_persistent(&env, &tier_key);
    }

    pub fn get_tier(env: Env, user: Address) -> u32 {
        let key = DataKey::Tier(user);
        let Some(tier) = env.storage().persistent().get(&key) else {
            return 0;
        };
        Self::bump_instance(&env);
        Self::bump_persistent(&env, &key);
        tier
    }

    fn bump_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    }

    fn bump_persistent(env: &Env, key: &DataKey) {
        env.storage().persistent().extend_ttl(
            key,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{
        storage::Instance as _, storage::Persistent as _, Address as _, Ledger,
    };

    #[test]
    fn test_vinculo_sbt_extends_storage_ttl() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let contract_addr = env.register_contract(None, VinculoSBT);
        let client = VinculoSBTClient::new(&env, &contract_addr);
        client.init(&admin);

        client.mint(&admin, &user, &3);

        env.ledger().with_mut(|li| {
            li.sequence_number += 35 * DAY_IN_LEDGERS;
        });
        assert_eq!(client.symbol(), String::from_str(&env, "VINC"));

        env.ledger().with_mut(|li| {
            li.sequence_number += 30 * DAY_IN_LEDGERS;
        });

        assert_eq!(client.get_tier(&user), 3);
        assert_eq!(client.symbol(), String::from_str(&env, "VINC"));

        env.as_contract(&contract_addr, || {
            let tier_ttl = env
                .storage()
                .persistent()
                .get_ttl(&DataKey::Tier(user.clone()));
            assert!(tier_ttl >= PERSISTENT_BUMP_AMOUNT);

            let instance_ttl = env.storage().instance().get_ttl();
            assert!(instance_ttl >= INSTANCE_BUMP_AMOUNT);
        });
    }
}
