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
        env.storage().instance().set(
            &DataKey::Name,
            &String::from_str(&env, "Vinculo Credito SBT"),
        );
        env.storage()
            .instance()
            .set(&DataKey::Symbol, &String::from_str(&env, "VINC"));
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
        assert!((1..=4).contains(&tier), "Nivel de SBT invalido");

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
        env.storage()
            .persistent()
            .get(&DataKey::Tier(user))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation},
        IntoVal, Symbol,
    };

    fn setup() -> (Env, Address, VinculoSBTClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_addr = env.register_contract(None, VinculoSBT);
        let client = VinculoSBTClient::new(&env, &contract_addr);
        client.init(&admin);
        (env, admin, client, contract_addr)
    }

    #[test]
    fn test_initialize_and_mint_badge() {
        let (env, admin, client, contract_addr) = setup();
        let user = Address::generate(&env);

        assert_eq!(client.name(), String::from_str(&env, "Vinculo Credito SBT"));
        assert_eq!(client.symbol(), String::from_str(&env, "VINC"));
        assert_eq!(client.get_tier(&user), 0);
        assert_eq!(
            client.token_uri(&user),
            String::from_str(
                &env,
                "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/bronce.json"
            )
        );

        client.mint(&admin, &user, &2);
        assert_eq!(
            env.auths(),
            std::vec![(
                admin.clone(),
                AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        contract_addr,
                        Symbol::new(&env, "mint"),
                        (admin.clone(), user.clone(), 2u32).into_val(&env),
                    )),
                    sub_invocations: std::vec![],
                }
            )]
        );
        assert_eq!(client.get_tier(&user), 2);
        assert_eq!(
            client.token_uri(&user),
            String::from_str(
                &env,
                "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/oro.json"
            )
        );

        // Upgrade user to tier 4 (Platino)
        client.mint(&admin, &user, &4);
        assert_eq!(client.get_tier(&user), 4);
        assert_eq!(
            client.token_uri(&user),
            String::from_str(
                &env,
                "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/platino.json"
            )
        );
    }

    #[test]
    #[should_panic(expected = "El contrato ya fue inicializado")]
    fn test_reinitialize_panics() {
        let (_env, admin, client, _addr) = setup();
        client.init(&admin);
    }

    #[test]
    #[should_panic(expected = "Nivel de SBT invalido")]
    fn test_invalid_tier_panics() {
        let (env, admin, client, _addr) = setup();
        let user = Address::generate(&env);
        client.mint(&admin, &user, &5);
    }

    #[test]
    #[should_panic(expected = "Nivel de SBT invalido")]
    fn test_zero_tier_panics() {
        let (env, admin, client, _addr) = setup();
        let user = Address::generate(&env);
        client.mint(&admin, &user, &0);
    }

    #[test]
    #[should_panic(expected = "El usuario ya posee un NFT de este nivel exacto")]
    fn test_duplicate_same_tier_panics() {
        let (env, admin, client, _addr) = setup();
        let user = Address::generate(&env);
        client.mint(&admin, &user, &1);
        client.mint(&admin, &user, &1);
    }

    #[test]
    fn test_multiple_users_independent_tiers() {
        let (env, admin, client, _addr) = setup();
        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);
        let user_c = Address::generate(&env);

        client.mint(&admin, &user_a, &1);
        client.mint(&admin, &user_b, &3);

        assert_eq!(client.get_tier(&user_a), 1);
        assert_eq!(client.get_tier(&user_b), 3);
        assert_eq!(client.get_tier(&user_c), 0);
    }

    #[test]
    fn test_revoke_resets_tier_to_zero() {
        let (env, admin, client, _addr) = setup();
        let user = Address::generate(&env);

        client.mint(&admin, &user, &3);
        assert_eq!(client.get_tier(&user), 3);

        client.revoke(&admin, &user);
        assert_eq!(client.get_tier(&user), 0);
        assert_eq!(
            client.token_uri(&user),
            String::from_str(
                &env,
                "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/bronce.json"
            )
        );
    }

    #[test]
    #[should_panic(expected = "Solo el administrador puede mintear NFTs")]
    fn test_non_admin_cannot_mint() {
        let (env, _admin, client, _addr) = setup();
        let attacker = Address::generate(&env);
        let user = Address::generate(&env);
        client.mint(&attacker, &user, &2);
    }

    #[test]
    #[should_panic(expected = "Solo el administrador puede revocar")]
    fn test_non_admin_cannot_revoke() {
        let (env, admin, client, _addr) = setup();
        let attacker = Address::generate(&env);
        let user = Address::generate(&env);
        client.mint(&admin, &user, &2);
        client.revoke(&attacker, &user);
    }
}
