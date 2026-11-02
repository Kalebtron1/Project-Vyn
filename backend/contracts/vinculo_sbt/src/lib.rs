#![no_std]
//! VinculoSBT — nivel de reputación soulbound, calculado por el contrato.
//!
//! Nadie asigna niveles: el tier sale del historial de ahorro (`staking_pool`) y
//! de pagos (`vinculo_lending`). `refresh_tier` lo guarda y cualquiera puede
//! llamarla, porque el resultado no depende de quién llama. No hay transferencias.
//!
//! El crédito pregunta el tier con `compute_tier`, pasando su propio historial:
//! Soroban no permite que un contrato vuelva a entrar a otro que sigue en la
//! pila de llamadas, y así el crédito siempre usa el nivel vigente, aunque nadie
//! haya llamado `refresh_tier` después de un retiro o un incumplimiento.
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, Address, BytesN, Env, String, Symbol, Vec,
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
    InvalidMetadata = 3,
    InvalidConfig = 4,
    LendingNotSet = 5,
}

// Espejos de lo que devuelven los otros contratos. No se depende de sus crates
// porque eso exporta sus funciones dentro de este Wasm.

#[contracttype]
#[derive(Clone, Default, Debug, Eq, PartialEq)]
pub struct UserStats {
    pub net_balance: i128,
    pub balance_seconds: i128,
    pub last_update: u64,
    pub first_deposit: u64,
    pub valid_deposits: u32,
    pub total_deposited: i128,
    pub total_withdrawn: i128,
    pub tx_count: u32,
}

#[contracttype]
#[derive(Clone, Default, Debug, Eq, PartialEq)]
pub struct LoanHistory {
    pub repaid_on_time: u32,
    pub repaid_late: u32,
    pub defaults: u32,
    pub last_default_at: u64,
    pub unpaid_debt: i128,
}

#[contractclient(name = "SavingsClient")]
pub trait SavingsInterface {
    fn get_stats(e: Env, user: Address) -> UserStats;
}

#[contractclient(name = "LendingClient")]
pub trait LendingInterface {
    fn get_history(e: Env, user: Address) -> LoanHistory;
}

/// Lo que exige un nivel. El saldo promedio se mide como saldo por tiempo, y
/// además el saldo actual debe seguir alcanzando: retirar puede bajar el nivel.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TierRule {
    pub min_balance: i128,
    pub min_seconds: u64,
    pub min_valid_deposits: u32,
    pub min_repaid_on_time: u32,
    /// Si es `false`, un solo incumplimiento en el historial cierra este nivel.
    pub allow_defaults: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationConfig {
    pub plata: TierRule,
    pub oro: TierRule,
    pub diamante: TierRule,
    pub platino: TierRule,
    /// Tiempo en Bronce después de un incumplimiento.
    pub default_cooldown: u64,
}

#[contracttype]
pub enum DataKey {
    Tier(Address),
    Name,
    Symbol,
    /// Una URI de metadata por tier, indexada por tier.
    Uris,
    Savings,
    Lending,
    Config,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TierUpdated {
    #[topic]
    pub user: Address,
    pub previous: u32,
    pub tier: u32,
}

#[contract]
pub struct VinculoSBT;

#[contractimpl]
impl VinculoSBT {
    /// El deploy y la inicialización ocurren en la misma transacción, así que
    /// nadie puede adelantarse a fijar el admin o las reglas. El crédito necesita
    /// la dirección de este contrato, así que la suya se fija con `set_lending`.
    pub fn __constructor(
        e: &Env,
        admin: Address,
        pauser: Address,
        savings: Address,
        config: ReputationConfig,
        uris: Vec<String>,
    ) {
        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(e, &pauser, &Symbol::new(e, "pauser"), &admin);

        write_uris(e, &uris);
        write_config(e, &config);
        let storage = e.storage().instance();
        storage.set(&DataKey::Savings, &savings);
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

    /// Fija el contrato de crédito que aporta el historial de pagos. Solo el admin.
    #[only_admin]
    pub fn set_lending(e: &Env, lending: Address) {
        e.storage().instance().set(&DataKey::Lending, &lending);
        extend_instance(e);
    }

    /// Cambia las reglas de todos los usuarios. Solo el admin.
    #[only_admin]
    pub fn set_config(e: &Env, config: ReputationConfig) {
        write_config(e, &config);
        extend_instance(e);
    }

    pub fn get_config(e: &Env) -> ReputationConfig {
        e.storage().instance().get(&DataKey::Config).unwrap()
    }

    /// Cambia las URIs de metadata de todos los tiers. Solo el admin.
    #[only_admin]
    pub fn set_metadata_uris(e: &Env, uris: Vec<String>) {
        write_uris(e, &uris);
        extend_instance(e);
    }

    /// Recalcula y guarda el nivel del usuario. Puede bajar: refleja su estado real.
    #[when_not_paused]
    pub fn refresh_tier(e: &Env, user: Address) -> u32 {
        let tier = Self::preview_tier(e, user.clone());
        let previous = Self::get_tier(e, user.clone());
        if tier != previous {
            write_tier(e, &user, tier);
            TierUpdated {
                user,
                previous,
                tier,
            }
            .publish(e);
        }
        tier
    }

    /// Nivel que resultaría ahora, sin guardar nada ni pedir firma.
    pub fn preview_tier(e: &Env, user: Address) -> u32 {
        let lending: Address = e
            .storage()
            .instance()
            .get(&DataKey::Lending)
            .unwrap_or_else(|| panic_with_error!(e, Error::LendingNotSet));
        let history = LendingClient::new(e, &lending).get_history(&user);
        Self::compute_tier(e, user, history)
    }

    /// Calcula el nivel con el historial que le pasa quien llama. El crédito lo
    /// usa con el suyo; como solo es lectura, un historial falso no cambia nada.
    pub fn compute_tier(e: &Env, user: Address, history: LoanHistory) -> u32 {
        let savings: Address = e.storage().instance().get(&DataKey::Savings).unwrap();
        let stats = SavingsClient::new(e, &savings).get_stats(&user);
        tier_for(
            e.ledger().timestamp(),
            &Self::get_config(e),
            &stats,
            &history,
        )
    }

    /// Último nivel guardado por `refresh_tier`.
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

/// Regla pura: mismo historial y mismo momento, mismo nivel.
fn tier_for(now: u64, config: &ReputationConfig, stats: &UserStats, history: &LoanHistory) -> u32 {
    let in_cooldown =
        history.defaults > 0 && now < history.last_default_at + config.default_cooldown;
    if history.unpaid_debt > 0 || in_cooldown {
        return 0;
    }
    let rules = [
        (4, &config.platino),
        (3, &config.diamante),
        (2, &config.oro),
        (1, &config.plata),
    ];
    for (tier, rule) in rules {
        if meets(now, rule, stats, history) {
            return tier;
        }
    }
    0
}

fn meets(now: u64, rule: &TierRule, stats: &UserStats, history: &LoanHistory) -> bool {
    if stats.first_deposit == 0 {
        return false;
    }
    let saved_for = now.saturating_sub(stats.first_deposit);
    let required_balance_seconds = rule.min_balance * i128::from(rule.min_seconds);
    saved_for >= rule.min_seconds
        && stats.net_balance >= rule.min_balance
        && stats.balance_seconds >= required_balance_seconds
        && stats.valid_deposits >= rule.min_valid_deposits
        && history.repaid_on_time >= rule.min_repaid_on_time
        && (rule.allow_defaults || history.defaults == 0)
}

/// Subir de nivel nunca debe exigir menos que el nivel anterior.
fn write_config(e: &Env, config: &ReputationConfig) {
    let rules = [
        &config.plata,
        &config.oro,
        &config.diamante,
        &config.platino,
    ];
    let mut previous: Option<&TierRule> = None;
    for rule in rules {
        let positive = rule.min_balance > 0 && rule.min_seconds > 0;
        let ordered = previous.is_none_or(|lower| {
            rule.min_balance >= lower.min_balance
                && rule.min_seconds >= lower.min_seconds
                && rule.min_repaid_on_time >= lower.min_repaid_on_time
        });
        if !positive || !ordered {
            panic_with_error!(e, Error::InvalidConfig);
        }
        previous = Some(rule);
    }
    e.storage().instance().set(&DataKey::Config, config);
}

fn write_uris(e: &Env, uris: &Vec<String>) {
    if uris.len() != TIER_COUNT {
        panic_with_error!(e, Error::InvalidMetadata);
    }
    e.storage().instance().set(&DataKey::Uris, uris);
}

fn write_tier(e: &Env, user: &Address, tier: u32) {
    let key = DataKey::Tier(user.clone());
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
