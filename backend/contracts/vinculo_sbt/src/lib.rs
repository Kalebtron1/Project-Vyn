#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

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
        env.storage().instance().set(&DataKey::Name, &String::from_str(&env, "Vinculo Credito SBT"));
        env.storage().instance().set(&DataKey::Symbol, &String::from_str(&env, "VINC"));
    }

    pub fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(env: Env) -> String {
        env.storage().instance().get(&DataKey::Symbol).unwrap()
    }

    pub fn token_uri(env: Env, user: Address) -> String {
        let tier = env.storage().persistent().get(&DataKey::Tier(user)).unwrap_or(0u32);
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
        let tier_key = DataKey::Tier(user);
        let current_tier = env.storage().persistent().get(&tier_key).unwrap_or(0u32);
        if current_tier == tier {
            panic!("El usuario ya posee un NFT de este nivel exacto");
        }

        env.storage().persistent().set(&tier_key, &tier);
    }

    pub fn revoke(env: Env, admin: Address, user: Address) {
        admin.require_auth();
        let saved_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != saved_admin {
            panic!("Solo el administrador puede revocar");
        }
        // OPT: pass user directly — no clone needed
        env.storage().persistent().set(&DataKey::Tier(user), &0u32);
    }

    pub fn get_tier(env: Env, user: Address) -> u32 {
        env.storage().persistent().get(&DataKey::Tier(user)).unwrap_or(0)
    }
}

// ─── Benchmark tests ─────────────────────────────────────────────────────────
// Run with: cargo test --features soroban-sdk/testutils -- --nocapture
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    fn setup() -> (Env, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let contract_id = env.register_contract(None, VinculoSBT);
        let client = VinculoSBTClient::new(&env, &contract_id);
        client.init(&admin);
        (env, contract_id, admin, user)
    }

    #[test]
    fn bench_mint() {
        let (env, contract_id, admin, user) = setup();
        env.budget().reset_default();
        let client = VinculoSBTClient::new(&env, &contract_id);
        client.mint(&admin, &user, &2);
        println!(
            "[bench_mint] cpu={} mem={}",
            env.budget().cpu_instruction_cost(),
            env.budget().memory_bytes_cost()
        );
    }

    #[test]
    fn test_invalid_tier_panics() {
        let (env, contract_id, admin, user) = setup();
        let client = VinculoSBTClient::new(&env, &contract_id);
        client.mint(&admin, &user, &1);
        // minting same tier again should panic
        let result = std::panic::catch_unwind(|| {
            client.mint(&admin, &user, &1);
        });
        assert!(result.is_err());
    }

    #[test]
    fn test_initialize_and_mint_badge() {
        let (env, contract_id, admin, user) = setup();
        let client = VinculoSBTClient::new(&env, &contract_id);
        client.mint(&admin, &user, &3);
        assert_eq!(client.get_tier(&user), 3);
    }

    #[test]
    fn test_multiple_users_independent_tiers() {
        let (env, contract_id, admin, _) = setup();
        let client = VinculoSBTClient::new(&env, &contract_id);
        let u1 = Address::generate(&env);
        let u2 = Address::generate(&env);
        client.mint(&admin, &u1, &1);
        client.mint(&admin, &u2, &4);
        assert_eq!(client.get_tier(&u1), 1);
        assert_eq!(client.get_tier(&u2), 4);
    }
}
