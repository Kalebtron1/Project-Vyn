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
        env.storage().instance().set(&DataKey::Name, &String::from_str(&env, "Vinculo Credito SBT"));
        env.storage().instance().set(&DataKey::Symbol, &String::from_str(&env, "VINC"));
        env.events()
            .publish((Symbol::new(&env, "init"), admin), true);
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

        // Tiers válidos: 0 (sin nivel) a 4 (Platino).
        if tier > 4 {
            panic!("Invalid tier");
        }

        // OPT: build Tier key once — eliminates redundant user.clone() before the set()
        let tier_key = DataKey::Tier(user.clone());
        let current_tier = env.storage().persistent().get(&tier_key).unwrap_or(0u32);
        if current_tier == tier {
            panic!("El usuario ya posee un NFT de este nivel exacto");
        }

        env.storage().persistent().set(&tier_key, &tier);
        env.events()
            .publish((Symbol::new(&env, "mint"), user), tier);
    }

    pub fn revoke(env: Env, admin: Address, user: Address) {
        admin.require_auth();
        let saved_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != saved_admin {
            panic!("Solo el administrador puede revocar");
        }
        env.storage().persistent().set(&DataKey::Tier(user.clone()), &0u32);
        env.events()
            .publish((Symbol::new(&env, "revoke"), user), 0u32);
    }

    pub fn get_tier(env: Env, user: Address) -> u32 {
        env.storage().persistent().get(&DataKey::Tier(user)).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Events, Env};

    fn setup() -> (Env, VinculoSBTClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, VinculoSBT);
        let client = VinculoSBTClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.init(&admin);
        (env, client, admin)
    }

    fn assert_event(env: &Env, name: &str) {
        let events = env.events().all();
        let dumped = std::format!("{events:?}");
        assert!(dumped.contains(name), "missing event {name}: {dumped}");
    }

    #[test]
    fn test_initialize_and_mint_badge() {
        let (env, client, admin) = setup();
        assert_event(&env, "init");
        let user = Address::generate(&env);

        assert_eq!(client.get_tier(&user), 0);
        assert_eq!(
            client.token_uri(&user),
            String::from_str(
                &env,
                "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/bronce.json"
            )
        );

        client.mint(&admin, &user, &3);
        assert_eq!(client.get_tier(&user), 3);
        assert_eq!(
            client.token_uri(&user),
            String::from_str(
                &env,
                "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/diamante.json"
            )
        );
        assert_event(&env, "mint");

        client.mint(&admin, &user, &1);
        assert_eq!(client.get_tier(&user), 1);
        assert_eq!(client.name(), String::from_str(&env, "Vinculo Credito SBT"));
        assert_eq!(client.symbol(), String::from_str(&env, "VINC"));
    }

    #[test]
    #[should_panic(expected = "Invalid tier")]
    fn test_invalid_tier_panics() {
        let (_env, client, admin) = setup();
        let user = Address::generate(&_env);
        client.mint(&admin, &user, &99);
    }

    #[test]
    fn test_multiple_users_independent_tiers() {
        let (env, client, admin) = setup();
        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);

        client.mint(&admin, &user_a, &2);
        client.mint(&admin, &user_b, &4);

        assert_eq!(client.get_tier(&user_a), 2);
        assert_eq!(client.get_tier(&user_b), 4);
        assert_eq!(
            client.token_uri(&user_a),
            String::from_str(
                &env,
                "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/oro.json"
            )
        );
        assert_eq!(
            client.token_uri(&user_b),
            String::from_str(
                &env,
                "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/platino.json"
            )
        );
    }

    #[test]
    fn test_revoke_resets_tier() {
        let (env, client, admin) = setup();
        let user = Address::generate(&env);
        client.mint(&admin, &user, &2);
        client.revoke(&admin, &user);
        assert_eq!(client.get_tier(&user), 0);
        assert_eq!(
            client.token_uri(&user),
            String::from_str(
                &env,
                "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/bronce.json"
            )
        );
        assert_event(&env, "revoke");
    }

    #[test]
    #[should_panic(expected = "Solo el administrador puede mintear")]
    fn test_non_admin_cannot_mint() {
        let (env, client, _admin) = setup();
        let attacker = Address::generate(&env);
        let user = Address::generate(&env);
        client.mint(&attacker, &user, &1);
    }

    #[test]
    #[should_panic(expected = "Solo el administrador puede revocar")]
    fn test_non_admin_cannot_revoke() {
        let (env, client, admin) = setup();
        let user = Address::generate(&env);
        let attacker = Address::generate(&env);
        client.mint(&admin, &user, &1);
        client.revoke(&attacker, &user);
    }

    #[test]
    fn test_mint_requires_auth() {
        let env = Env::default();
        let contract_id = env.register_contract(None, VinculoSBT);
        let client = VinculoSBTClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        client.init(&admin);
        assert!(client.try_mint(&admin, &user, &1).is_err());
    }
}
