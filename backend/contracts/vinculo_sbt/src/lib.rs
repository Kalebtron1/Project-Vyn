#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, BytesN, Env,
    String, Symbol, Vec,
};
use stellar_access::access_control::{self as access_control, AccessControl};
use stellar_contract_utils::{
    pausable::{self as pausable, Pausable},
    upgradeable::{self as upgradeable, Upgradeable},
};
use stellar_macros::{only_admin, only_role, when_not_paused};

const DAY_IN_LEDGERS: u32 = 17_280;
pub const TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
pub const TTL_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;

/// Bronce (0), Plata (1), Oro (2), Diamante (3) y Platino (4).
const TIER_COUNT: u32 = 5;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidTier = 1,
    TierUnchanged = 2,
    InvalidMetadata = 3,
}

#[contracttype]
pub enum DataKey {
    Tier(Address),
    Name,
    Symbol,
    /// Una URI de metadata por tier, indexada por tier.
    Uris,
}

#[contract]
pub struct VinculoSBT;

#[contractimpl]
impl VinculoSBT {
    /// El deploy y la inicialización ocurren en la misma transacción, así que
    /// nadie puede adelantarse a fijar el admin.
    pub fn __constructor(
        e: &Env,
        admin: Address,
        pauser: Address,
        minter: Address,
        uris: Vec<String>,
    ) {
        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(e, &pauser, &Symbol::new(e, "pauser"), &admin);
        access_control::grant_role_no_auth(e, &minter, &Symbol::new(e, "minter"), &admin);

        write_uris(e, &uris);
        let storage = e.storage().instance();
        storage.set(&DataKey::Name, &String::from_str(e, "Vyn Credito SBT"));
        storage.set(&DataKey::Symbol, &String::from_str(e, "VYN"));
        extend_instance(e);
    }

    pub fn name(e: &Env) -> String {
        e.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(e: &Env) -> String {
        e.storage().instance().get(&DataKey::Symbol).unwrap()
    }

    pub fn token_uri(e: &Env, user: Address) -> String {
        let uris: Vec<String> = e.storage().instance().get(&DataKey::Uris).unwrap();
        uris.get(Self::get_tier(e, user)).unwrap()
    }

    /// Cambia las URIs de metadata de todos los tiers. Solo el admin.
    #[only_admin]
    pub fn set_metadata_uris(e: &Env, uris: Vec<String>) {
        write_uris(e, &uris);
        extend_instance(e);
    }

    #[when_not_paused]
    #[only_role(caller, "minter")]
    pub fn mint(e: &Env, caller: Address, user: Address, tier: u32) {
        if tier >= TIER_COUNT {
            panic_with_error!(e, Error::InvalidTier);
        }
        if Self::get_tier(e, user.clone()) == tier {
            panic_with_error!(e, Error::TierUnchanged);
        }
        write_tier(e, user, tier);
    }

    /// Sigue disponible durante la pausa: quitar un tier nunca agrega riesgo.
    #[only_role(caller, "minter")]
    pub fn revoke(e: &Env, caller: Address, user: Address) {
        write_tier(e, user, 0);
    }

    pub fn get_tier(e: &Env, user: Address) -> u32 {
        e.storage()
            .persistent()
            .get(&DataKey::Tier(user))
            .unwrap_or(0)
    }
}

#[contractimpl]
impl Pausable for VinculoSBT {
    fn paused(e: &Env) -> bool {
        pausable::paused(e)
    }

    #[only_role(caller, "pauser")]
    fn pause(e: &Env, caller: Address) {
        pausable::pause(e);
    }

    /// Despausar es del admin: una llave de pausa robada no puede reanudar.
    #[only_admin]
    fn unpause(e: &Env, caller: Address) {
        let _ = caller;
        pausable::unpause(e);
    }
}

#[contractimpl]
impl Upgradeable for VinculoSBT {
    #[only_admin]
    fn upgrade(e: &Env, new_wasm_hash: BytesN<32>, operator: Address) {
        let _ = operator;
        upgradeable::upgrade(e, &new_wasm_hash);
    }
}

#[contractimpl(contracttrait)]
impl AccessControl for VinculoSBT {}

fn write_uris(e: &Env, uris: &Vec<String>) {
    if uris.len() != TIER_COUNT {
        panic_with_error!(e, Error::InvalidMetadata);
    }
    e.storage().instance().set(&DataKey::Uris, uris);
}

fn write_tier(e: &Env, user: Address, tier: u32) {
    let key = DataKey::Tier(user);
    let storage = e.storage().persistent();
    storage.set(&key, &tier);
    storage.extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    extend_instance(e);
}

fn extend_instance(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

#[cfg(test)]
mod test;
