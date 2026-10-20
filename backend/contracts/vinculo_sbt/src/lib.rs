#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, Env, String};

/// Default metadata location owned by this project.
pub const DEFAULT_METADATA_BASE_URI: &str =
    "https://raw.githubusercontent.com/Kalebtron1/Project-Vyn/main/metadata/";

/// Upper bound for an admin-supplied base URI (keeps the on-chain value bounded).
pub const MAX_METADATA_BASE_URI_LEN: usize = 512;

#[contracttype]
pub enum DataKey {
    Admin,
    Tier(Address),
    Name,
    Symbol,
    /// Base URI (must end with `/`) used to build tier metadata URLs.
    /// Appended at the end of the enum for additive storage compatibility.
    MetadataBaseUri,
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
        env.storage().instance().set(
            &DataKey::MetadataBaseUri,
            &String::from_str(&env, DEFAULT_METADATA_BASE_URI),
        );
    }

    pub fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(env: Env) -> String {
        env.storage().instance().get(&DataKey::Symbol).unwrap()
    }

    /// Current metadata base URI. Legacy instances without the key fall back to
    /// [`DEFAULT_METADATA_BASE_URI`], so upgrading the wasm is safe.
    pub fn get_metadata_base_uri(env: Env) -> String {
        Self::metadata_base_uri_or_default(&env)
    }

    /// Build the tier metadata URL from the configured base URI.
    ///
    /// Tier mapping is unchanged: 1 = plata, 2 = oro, 3 = diamante,
    /// 4 = platino, everything else (including 0) = bronce.
    pub fn token_uri(env: Env, user: Address) -> String {
        let tier = env
            .storage()
            .persistent()
            .get(&DataKey::Tier(user))
            .unwrap_or(0u32);
        let base_uri = Self::metadata_base_uri_or_default(&env);
        Self::build_token_uri(&env, &base_uri, Self::tier_metadata_name(tier))
    }

    /// Admin-only setter for the metadata base URI.
    ///
    /// The URI must be non-empty, at most [`MAX_METADATA_BASE_URI_LEN`] bytes,
    /// and end with `/` so `token_uri` can append `<tier>.json` directly.
    pub fn set_metadata_base_uri(env: Env, admin: Address, base_uri: String) {
        admin.require_auth();

        let saved_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != saved_admin {
            panic!("Solo el administrador puede cambiar la URI base de metadata");
        }

        Self::validate_metadata_base_uri(&base_uri);
        env.storage()
            .instance()
            .set(&DataKey::MetadataBaseUri, &base_uri);
    }

    fn metadata_base_uri_or_default(env: &Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::MetadataBaseUri)
            .unwrap_or_else(|| String::from_str(env, DEFAULT_METADATA_BASE_URI))
    }

    fn tier_metadata_name(tier: u32) -> &'static str {
        match tier {
            1 => "plata",
            2 => "oro",
            3 => "diamante",
            4 => "platino",
            _ => "bronce",
        }
    }

    fn validate_metadata_base_uri(base_uri: &String) {
        let len = base_uri.len() as usize;
        if len == 0 {
            panic!("La URI base de metadata no puede estar vacía");
        }
        if len > MAX_METADATA_BASE_URI_LEN {
            panic!("La URI base de metadata es demasiado larga");
        }

        let mut buffer = [0u8; MAX_METADATA_BASE_URI_LEN];
        base_uri.copy_into_slice(&mut buffer[..len]);
        if buffer[len - 1] != b'/' {
            panic!("La URI base de metadata debe terminar en '/'");
        }
    }

    fn build_token_uri(env: &Env, base_uri: &String, tier_name: &str) -> String {
        Self::validate_metadata_base_uri(base_uri);

        let len = base_uri.len() as usize;
        let mut buffer = [0u8; MAX_METADATA_BASE_URI_LEN];
        base_uri.copy_into_slice(&mut buffer[..len]);

        let mut bytes = Bytes::from_slice(env, &buffer[..len]);
        bytes.extend_from_slice(tier_name.as_bytes());
        bytes.extend_from_slice(b".json");

        String::from_bytes(env, &bytes.to_alloc_vec())
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
        env.storage()
            .persistent()
            .get(&DataKey::Tier(user))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    fn setup() -> (Env, VinculoSBTClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, VinculoSBT);
        let client = VinculoSBTClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.init(&admin);
        (env, client, admin)
    }

    #[test]
    fn defaults_to_project_metadata_for_every_tier() {
        let (env, client, admin) = setup();

        let cases = [
            (
                0u32,
                "https://raw.githubusercontent.com/Kalebtron1/Project-Vyn/main/metadata/bronce.json",
            ),
            (
                1,
                "https://raw.githubusercontent.com/Kalebtron1/Project-Vyn/main/metadata/plata.json",
            ),
            (
                2,
                "https://raw.githubusercontent.com/Kalebtron1/Project-Vyn/main/metadata/oro.json",
            ),
            (
                3,
                "https://raw.githubusercontent.com/Kalebtron1/Project-Vyn/main/metadata/diamante.json",
            ),
            (
                4,
                "https://raw.githubusercontent.com/Kalebtron1/Project-Vyn/main/metadata/platino.json",
            ),
        ];

        assert_eq!(
            client.get_metadata_base_uri(),
            String::from_str(&env, DEFAULT_METADATA_BASE_URI)
        );

        for (tier, expected) in cases {
            let user = Address::generate(&env);
            if tier != 0 {
                client.mint(&admin, &user, &tier);
            }
            assert_eq!(
                client.token_uri(&user),
                String::from_str(&env, expected),
                "unexpected URI for tier {tier}"
            );
        }
    }

    #[test]
    fn admin_can_update_metadata_base_uri() {
        let (env, client, admin) = setup();
        let user = Address::generate(&env);
        client.mint(&admin, &user, &2);

        let base = String::from_str(&env, "https://cdn.example.com/vyn/metadata/");
        client.set_metadata_base_uri(&admin, &base);

        assert_eq!(client.get_metadata_base_uri(), base);
        assert_eq!(
            client.token_uri(&user),
            String::from_str(&env, "https://cdn.example.com/vyn/metadata/oro.json")
        );
    }

    #[test]
    fn non_admin_cannot_update_metadata_base_uri() {
        let (env, client, _admin) = setup();
        let outsider = Address::generate(&env);

        let result = client
            .try_set_metadata_base_uri(&outsider, &String::from_str(&env, "https://evil.example/"));

        assert!(result.is_err());
        assert_eq!(
            client.get_metadata_base_uri(),
            String::from_str(&env, DEFAULT_METADATA_BASE_URI)
        );
    }

    #[test]
    fn invalid_base_uris_are_rejected() {
        let (env, client, admin) = setup();

        assert!(client
            .try_set_metadata_base_uri(&admin, &String::from_str(&env, ""))
            .is_err());
        assert!(client
            .try_set_metadata_base_uri(
                &admin,
                &String::from_str(&env, "https://cdn.example.com/metadata")
            )
            .is_err());

        assert_eq!(
            client.get_metadata_base_uri(),
            String::from_str(&env, DEFAULT_METADATA_BASE_URI)
        );
    }

    #[test]
    fn token_uri_falls_back_to_default_before_init() {
        let env = Env::default();
        let contract_id = env.register_contract(None, VinculoSBT);
        let client = VinculoSBTClient::new(&env, &contract_id);
        let user = Address::generate(&env);

        assert_eq!(
            client.token_uri(&user),
            String::from_str(
                &env,
                "https://raw.githubusercontent.com/Kalebtron1/Project-Vyn/main/metadata/bronce.json"
            )
        );
    }
}
