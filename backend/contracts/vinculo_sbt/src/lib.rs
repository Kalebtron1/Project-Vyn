#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String};

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
        env.events()
            .publish((symbol_short!("mint"), user), (current_tier, tier));
    }

    pub fn revoke(env: Env, admin: Address, user: Address) {
        admin.require_auth();
        let saved_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != saved_admin {
            panic!("Solo el administrador puede revocar");
        }
        let tier_key = DataKey::Tier(user.clone());
        let prev_tier = env.storage().persistent().get(&tier_key).unwrap_or(0u32);
        env.storage().persistent().set(&tier_key, &0u32);
        env.events()
            .publish((symbol_short!("revoke"), user), prev_tier);
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
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events},
        IntoVal, Symbol,
    };

    #[test]
    fn test_vinculo_sbt_emits_mint_and_revoke_events() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let contract_addr = env.register_contract(None, VinculoSBT);
        let client = VinculoSBTClient::new(&env, &contract_addr);
        client.init(&admin);

        client.mint(&admin, &user, &2);
        let mint_evt = env.events().all().last().unwrap();
        assert_eq!(mint_evt.0, contract_addr);
        assert_eq!(
            mint_evt.1,
            (Symbol::new(&env, "mint"), user.clone()).into_val(&env)
        );
        let mint_data: (u32, u32) = mint_evt.2.into_val(&env);
        assert_eq!(mint_data, (0, 2));

        client.revoke(&admin, &user);
        let revoke_evt = env.events().all().last().unwrap();
        assert_eq!(revoke_evt.0, contract_addr);
        assert_eq!(
            revoke_evt.1,
            (Symbol::new(&env, "revoke"), user.clone()).into_val(&env)
        );
        let revoke_data: u32 = revoke_evt.2.into_val(&env);
        assert_eq!(revoke_data, 2);
    }
}
