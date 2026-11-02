#![no_std]
//! StakingPool — "apartado" con rendimiento REAL vía un vault de DeFindex.
//!
//! El usuario deposita un token (USDC) y el contrato lo coloca en un vault de
//! DeFindex. El contrato es el custodio de los dfTokens y lleva un libro interno
//! de shares propias del pool, independientes de las del vault: así, cambiar de
//! vault solo mueve el saldo total, sin tocar la posición de cada usuario.
//!
//! El rendimiento es real: proviene de la apreciación de los dfTokens, no de una
//! fórmula de APY sintética. `get_position(user)` calcula el valor en vivo.
//!
//! El contrato de crédito (rol `lending`) puede bloquear shares como colateral y
//! cobrar de ellas si un préstamo vence. Lo bloqueado sigue generando rendimiento,
//! pero no se puede retirar.
//!
//! `get_stats` expone el historial que usa la reputación. Su saldo ponderado por
//! tiempo exige capital durante un plazo: muchas transacciones pequeñas no suman.

use soroban_sdk::auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation};
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, token, vec, Address, BytesN, Env, IntoVal, String, Symbol, Val, Vec,
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

/// Saldos virtuales de la conversión shares ↔ activos. Hacen que el primer
/// depósito no pueda fijar un precio de share abusivo (ataque de inflación).
const VIRTUAL_SHARES: i128 = 1_000;
const VIRTUAL_ASSETS: i128 = 1;

// ─── Cliente del vault DeFindex ────────────────────────────────────────────────
//
// Espejo mínimo de `paltalabs/defindex` (`apps/contracts/vault/src/interface.rs`)
// con solo las funciones que usamos. `deposit` devuelve una tupla compleja en el
// vault real; aquí la recibimos como `Val` (siempre decodifica) y obtenemos las
// shares minteadas por diferencia de balance del dfToken (SEP-41) del vault, que
// es la vía más robusta frente a la codificación exacta del retorno.

#[contracttype]
#[derive(Clone)]
pub struct VaultStrategy {
    pub address: Address,
    pub name: String,
    pub paused: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct VaultAsset {
    pub address: Address,
    pub strategies: Vec<VaultStrategy>,
}

#[contractclient(name = "VaultClient")]
pub trait VaultInterface {
    fn deposit(
        e: Env,
        amounts_desired: Vec<i128>,
        amounts_min: Vec<i128>,
        from: Address,
        invest: bool,
    ) -> Val;

    fn withdraw(e: Env, df_amount: i128, min_amounts_out: Vec<i128>, from: Address) -> Vec<i128>;

    fn get_asset_amounts_per_shares(e: Env, vault_shares: i128) -> Vec<i128>;

    fn get_assets(e: Env) -> Vec<VaultAsset>;

    /// dfToken (shares) balance — el vault es un token SEP-41.
    fn balance(e: Env, id: Address) -> i128;
}

// ─── Errores ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    InvalidAmount = 3,
    InsufficientPosition = 4,
    SlippageExceeded = 5,
    InvalidVault = 6,
    MigrationLoss = 7,
}

// ─── Storage ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Token subyacente (USDC SAC).
    Token,
    /// Dirección del vault DeFindex (constructor y `migrate_vault`).
    Vault,
    /// Monto mínimo para que un depósito cuente en `valid_deposits`.
    MinCountedDeposit,
    /// Suma de las shares de todos los usuarios.
    TotalShares,
    /// Shares del pool que pertenecen al usuario.
    Shares(Address),
    /// Parte de `Shares(user)` bloqueada como colateral.
    Locked(Address),
    /// Historial del usuario para la reputación.
    Stats(Address),
}

/// Historial de un usuario. Los campos que se agreguen en una versión futura
/// deben ser `Option` para poder leer las entradas ya guardadas.
#[contracttype]
#[derive(Clone, Default, Debug, Eq, PartialEq)]
pub struct UserStats {
    /// Depositado menos retirado, sin rendimiento. Nunca baja de cero.
    pub net_balance: i128,
    /// `net_balance` acumulado por segundo: saldo ponderado por tiempo.
    pub balance_seconds: i128,
    pub last_update: u64,
    pub first_deposit: u64,
    /// Depósitos de al menos `MinCountedDeposit`.
    pub valid_deposits: u32,
    pub total_deposited: i128,
    pub total_withdrawn: i128,
    pub tx_count: u32,
}

// ─── Eventos ───────────────────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposited {
    #[topic]
    pub user: Address,
    pub amount: i128,
    pub shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Withdrawn {
    #[topic]
    pub user: Address,
    pub to: Address,
    pub amount: i128,
    pub shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CollateralLocked {
    #[topic]
    pub user: Address,
    pub shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CollateralUnlocked {
    #[topic]
    pub user: Address,
    pub shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CollateralSeized {
    #[topic]
    pub user: Address,
    pub amount: i128,
    pub shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultMigrated {
    pub old_vault: Address,
    pub new_vault: Address,
    pub assets: i128,
}

#[contract]
pub struct StakingContract;

#[contractimpl]
impl StakingContract {
    /// El deploy y la inicialización ocurren en la misma transacción, así que
    /// nadie puede adelantarse a fijar el admin, el token o el vault.
    pub fn __constructor(
        env: Env,
        admin: Address,
        pauser: Address,
        token: Address,
        vault: Address,
        min_counted_deposit: i128,
    ) {
        if min_counted_deposit <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if let Err(error) = Self::check_vault(&env, &vault, &token) {
            panic_with_error!(&env, error);
        }
        access_control::set_admin(&env, &admin);
        access_control::grant_role_no_auth(&env, &pauser, &Symbol::new(&env, "pauser"), &admin);
        let storage = env.storage().instance();
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::Vault, &vault);
        storage.set(&DataKey::MinCountedDeposit, &min_counted_deposit);
        Self::extend_instance(&env);
    }

    /// Mueve todo el saldo a otro vault del mismo token. Solo el admin. Las
    /// shares de los usuarios no cambian. Revierte si después de mover el valor
    /// total queda por debajo de `min_assets`.
    #[only_admin]
    pub fn migrate_vault(env: Env, new_vault: Address, min_assets: i128) -> Result<i128, Error> {
        let token_addr = Self::read_token(&env)?;
        let old_vault = Self::read_vault(&env)?;
        Self::check_vault(&env, &new_vault, &token_addr)?;
        if new_vault == old_vault {
            return Err(Error::InvalidVault);
        }

        let this = env.current_contract_address();
        let df_total = VaultClient::new(&env, &old_vault).balance(&this);
        if df_total > 0 {
            let moved = Self::redeem(&env, &old_vault, &token_addr, df_total, 0);
            if moved <= 0 {
                return Err(Error::MigrationLoss);
            }
            Self::vault_deposit(&env, &new_vault, &token_addr, moved);
        }
        env.storage().instance().set(&DataKey::Vault, &new_vault);

        let assets = Self::total_assets(&env)?;
        if assets < min_assets {
            return Err(Error::MigrationLoss);
        }
        Self::extend_instance(&env);
        VaultMigrated {
            old_vault,
            new_vault,
            assets,
        }
        .publish(&env);
        Ok(assets)
    }

    /// Cambia el monto mínimo para que un depósito cuente en la reputación.
    #[only_admin]
    pub fn set_min_counted_deposit(env: Env, amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        env.storage()
            .instance()
            .set(&DataKey::MinCountedDeposit, &amount);
        Self::extend_instance(&env);
        Ok(())
    }

    /// Vault DeFindex actualmente configurado.
    pub fn get_vault(env: Env) -> Result<Address, Error> {
        Self::read_vault(&env)
    }

    /// Token subyacente del pool.
    pub fn get_token(env: Env) -> Result<Address, Error> {
        Self::read_token(&env)
    }

    /// Deposita `amount` del token en el vault y acredita shares del pool al
    /// usuario según el valor que entró. Devuelve esas shares. Se bloquea durante
    /// la pausa.
    #[when_not_paused]
    pub fn deposit(env: Env, user: Address, amount: i128) -> Result<i128, Error> {
        user.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let token_addr = Self::read_token(&env)?;
        let vault_addr = Self::read_vault(&env)?;
        let this = env.current_contract_address();
        let assets_before = Self::total_assets(&env)?;
        let total_shares = Self::read_total_shares(&env);

        token::Client::new(&env, &token_addr).transfer(&user, &this, &amount);
        Self::vault_deposit(&env, &vault_addr, &token_addr, amount);

        // Se acredita lo que el vault reconoce, no lo que se pidió depositar.
        let value = Self::total_assets(&env)? - assets_before;
        let minted = Self::floor_shares(value, assets_before, total_shares);
        if minted <= 0 {
            return Err(Error::InvalidAmount);
        }

        Self::write_shares(&env, &user, Self::read_shares(&env, &user) + minted);
        Self::write_total_shares(&env, total_shares + minted);

        let min_counted: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MinCountedDeposit)
            .ok_or(Error::NotInitialized)?;
        let mut stats = Self::accrued_stats(&env, &user);
        if stats.first_deposit == 0 {
            stats.first_deposit = env.ledger().timestamp();
        }
        if amount >= min_counted {
            stats.valid_deposits += 1;
        }
        stats.net_balance += amount;
        stats.total_deposited += amount;
        stats.tx_count += 1;
        Self::write_stats(&env, &user, &stats);
        Self::extend_instance(&env);
        Deposited {
            user,
            amount,
            shares: minted,
        }
        .publish(&env);

        Ok(minted)
    }

    /// Retira hasta `amount` del token hacia el usuario. Si `amount` supera lo
    /// libre, retira todo lo libre; lo bloqueado como colateral no se puede sacar.
    /// Revierte si el vault entrega menos de `min_out`. Devuelve lo entregado.
    /// Nunca se pausa: el usuario siempre puede sacar su dinero libre.
    pub fn withdraw(env: Env, user: Address, amount: i128, min_out: i128) -> Result<i128, Error> {
        user.require_auth();
        Self::withdraw_internal(&env, &user, amount, min_out, &user)
    }

    /// Igual que `withdraw`, pero entrega el token a otra cuenta (p. ej. la de
    /// payout SPEI). El usuario firma el destino.
    pub fn withdraw_to(
        env: Env,
        user: Address,
        amount: i128,
        min_out: i128,
        to: Address,
    ) -> Result<i128, Error> {
        user.require_auth();
        Self::withdraw_internal(&env, &user, amount, min_out, &to)
    }

    /// Bloquea como colateral las shares que valen `assets`, redondeando a favor
    /// del pool. Solo el contrato de crédito. Devuelve las shares bloqueadas.
    #[when_not_paused]
    #[only_role(caller, "lending")]
    pub fn lock(env: Env, caller: Address, user: Address, assets: i128) -> Result<i128, Error> {
        if assets <= 0 {
            return Err(Error::InvalidAmount);
        }
        let total_assets = Self::total_assets(&env)?;
        let total_shares = Self::read_total_shares(&env);
        let shares = Self::ceil_shares(assets, total_assets, total_shares)?;
        let locked = Self::read_locked(&env, &user);
        if Self::read_shares(&env, &user) - locked < shares {
            return Err(Error::InsufficientPosition);
        }
        Self::write_locked(&env, &user, locked + shares);
        Self::extend_instance(&env);
        CollateralLocked { user, shares }.publish(&env);
        Ok(shares)
    }

    /// Libera shares bloqueadas. Solo el contrato de crédito. Sigue disponible
    /// durante la pausa, para que pagar un préstamo siempre devuelva el colateral.
    #[only_role(caller, "lending")]
    pub fn unlock(env: Env, caller: Address, user: Address, shares: i128) -> Result<(), Error> {
        let locked = Self::read_locked(&env, &user);
        if shares <= 0 || shares > locked {
            return Err(Error::InvalidAmount);
        }
        Self::write_locked(&env, &user, locked - shares);
        Self::extend_instance(&env);
        CollateralUnlocked { user, shares }.publish(&env);
        Ok(())
    }

    /// Cobra `assets` de las shares bloqueadas del usuario y entrega el token a
    /// `to`. Solo el contrato de crédito, que valida el vencimiento. Nunca toma
    /// más que lo bloqueado. Devuelve lo que entregó el vault y las shares
    /// quemadas, porque el colateral podría no alcanzar para cubrir `assets`.
    #[when_not_paused]
    #[only_role(caller, "lending")]
    pub fn seize(
        env: Env,
        caller: Address,
        user: Address,
        assets: i128,
        to: Address,
    ) -> Result<(i128, i128), Error> {
        if assets <= 0 {
            return Err(Error::InvalidAmount);
        }
        let total_assets = Self::total_assets(&env)?;
        let total_shares = Self::read_total_shares(&env);
        let locked = Self::read_locked(&env, &user);
        let burn = Self::ceil_shares(assets, total_assets, total_shares)?.min(locked);
        if burn <= 0 {
            return Err(Error::InsufficientPosition);
        }
        Self::write_locked(&env, &user, locked - burn);
        let received = Self::burn_and_pay(&env, &user, burn, 0, &to, true)?;
        CollateralSeized {
            user,
            amount: received,
            shares: burn,
        }
        .publish(&env);
        Ok((received, burn))
    }

    /// Valor redimible en vivo (token subyacente) de la posición del usuario,
    /// incluyendo el rendimiento y lo bloqueado.
    pub fn get_position(env: Env, user: Address) -> Result<i128, Error> {
        Self::shares_value(&env, Self::read_shares(&env, &user))
    }

    /// Valor de lo que el usuario puede retirar o bloquear ahora.
    pub fn get_free_position(env: Env, user: Address) -> Result<i128, Error> {
        let free = Self::read_shares(&env, &user) - Self::read_locked(&env, &user);
        Self::shares_value(&env, free)
    }

    /// Shares del pool del usuario, incluidas las bloqueadas.
    pub fn get_shares(env: Env, user: Address) -> i128 {
        Self::read_shares(&env, &user)
    }

    /// Shares del usuario bloqueadas como colateral.
    pub fn get_locked(env: Env, user: Address) -> i128 {
        Self::read_locked(&env, &user)
    }

    /// Suma de las shares de todos los usuarios.
    pub fn get_total_shares(env: Env) -> i128 {
        Self::read_total_shares(&env)
    }

    /// Valor total del pool en el vault.
    pub fn get_total_assets(env: Env) -> Result<i128, Error> {
        Self::total_assets(&env)
    }

    /// Historial del usuario con el saldo ponderado actualizado a este momento.
    pub fn get_stats(env: Env, user: Address) -> UserStats {
        Self::accrued_stats(&env, &user)
    }

    /// Ingreso acumulado del usuario (para scoring).
    pub fn get_total_deposited(env: Env, user: Address) -> i128 {
        Self::read_stats(&env, &user).total_deposited
    }

    /// Retiro acumulado del usuario (para scoring).
    pub fn get_total_withdrawn(env: Env, user: Address) -> i128 {
        Self::read_stats(&env, &user).total_withdrawn
    }

    /// Conteo de operaciones del usuario (para scoring de actividad).
    pub fn get_tx_count(env: Env, user: Address) -> u32 {
        Self::read_stats(&env, &user).tx_count
    }

    // ─── Helpers internos ──────────────────────────────────────────────────────

    fn withdraw_internal(
        env: &Env,
        user: &Address,
        amount: i128,
        min_out: i128,
        to: &Address,
    ) -> Result<i128, Error> {
        if amount <= 0 || min_out < 0 {
            return Err(Error::InvalidAmount);
        }
        let free = Self::read_shares(env, user) - Self::read_locked(env, user);
        if free <= 0 {
            return Err(Error::InsufficientPosition);
        }
        let burn = if amount >= Self::shares_value(env, free)? {
            free
        } else {
            let total_assets = Self::total_assets(env)?;
            let total_shares = Self::read_total_shares(env);
            Self::ceil_shares(amount, total_assets, total_shares)?.min(free)
        };
        Self::burn_and_pay(env, user, burn, min_out, to, false)
    }

    /// Quema shares del usuario, redime su parte de dfTokens y entrega el token.
    /// `round_up` es para cobrar colateral: evita que el redondeo deje sin cubrir
    /// una fracción de la deuda. Un retiro normal redondea a favor del pool.
    fn burn_and_pay(
        env: &Env,
        user: &Address,
        burn: i128,
        min_out: i128,
        to: &Address,
        round_up: bool,
    ) -> Result<i128, Error> {
        let token_addr = Self::read_token(env)?;
        let vault_addr = Self::read_vault(env)?;
        let this = env.current_contract_address();
        let total_shares = Self::read_total_shares(env);

        // Si se queman todas las shares del pool, salen todos los dfTokens.
        let df_total = VaultClient::new(env, &vault_addr).balance(&this);
        let numerator = burn * df_total + if round_up { total_shares - 1 } else { 0 };
        let df_amount = (numerator / total_shares).min(df_total);
        if df_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let received = Self::redeem(env, &vault_addr, &token_addr, df_amount, min_out);
        if received < min_out {
            return Err(Error::SlippageExceeded);
        }
        token::Client::new(env, &token_addr).transfer(&this, to, &received);

        Self::write_shares(env, user, Self::read_shares(env, user) - burn);
        Self::write_total_shares(env, total_shares - burn);

        let mut stats = Self::accrued_stats(env, user);
        stats.net_balance = (stats.net_balance - received).max(0);
        stats.total_withdrawn += received;
        stats.tx_count += 1;
        Self::write_stats(env, user, &stats);
        Self::extend_instance(env);
        Withdrawn {
            user: user.clone(),
            to: to.clone(),
            amount: received,
            shares: burn,
        }
        .publish(env);

        Ok(received)
    }

    /// El vault debe manejar un solo activo y que sea el token del pool.
    fn check_vault(env: &Env, vault: &Address, token: &Address) -> Result<(), Error> {
        let assets = VaultClient::new(env, vault).get_assets();
        match assets.get(0) {
            Some(asset) if assets.len() == 1 && asset.address == *token => Ok(()),
            _ => Err(Error::InvalidVault),
        }
    }

    fn vault_deposit(env: &Env, vault_addr: &Address, token_addr: &Address, amount: i128) {
        let this = env.current_contract_address();
        let vault = VaultClient::new(env, vault_addr);

        // El vault hará `token.transfer(this -> vault, amount)` dos niveles abajo;
        // autorizamos ese sub-invoke en nombre del contrato.
        // `authorize_as_current_contract` solo aplica a la PRÓXIMA llamada de
        // contrato: no puede haber ninguna otra entre esta autorización y
        // `vault.deposit`, o la auth se consumiría y la transferencia anidada
        // fallaría con Error(Auth, InvalidAction).
        let transfer_args: Vec<Val> = (this.clone(), vault_addr.clone(), amount).into_val(env);
        env.authorize_as_current_contract(vec![
            env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: token_addr.clone(),
                    fn_name: Symbol::new(env, "transfer"),
                    args: transfer_args,
                },
                sub_invocations: vec![env],
            }),
        ]);

        vault.deposit(&vec![env, amount], &vec![env, amount], &this, &true);
    }

    /// Redime dfTokens y devuelve el token que realmente recibió el contrato.
    fn redeem(
        env: &Env,
        vault_addr: &Address,
        token_addr: &Address,
        df_amount: i128,
        min_out: i128,
    ) -> i128 {
        let this = env.current_contract_address();
        let token_client = token::Client::new(env, token_addr);
        let before = token_client.balance(&this);
        VaultClient::new(env, vault_addr).withdraw(&df_amount, &vec![env, min_out], &this);
        token_client.balance(&this) - before
    }

    fn total_assets(env: &Env) -> Result<i128, Error> {
        let vault = VaultClient::new(env, &Self::read_vault(env)?);
        let df_total = vault.balance(&env.current_contract_address());
        if df_total <= 0 {
            return Ok(0);
        }
        Ok(vault
            .get_asset_amounts_per_shares(&df_total)
            .get(0)
            .unwrap_or(0))
    }

    fn shares_value(env: &Env, shares: i128) -> Result<i128, Error> {
        if shares <= 0 {
            return Ok(0);
        }
        let total_assets = Self::total_assets(env)?;
        let total_shares = Self::read_total_shares(env);
        Ok((shares * total_assets) / total_shares)
    }

    /// Shares a acuñar por un depósito. Solo aquí se usan los saldos virtuales:
    /// el ataque de inflación ocurre al entrar, cuando el pool está casi vacío.
    fn floor_shares(assets: i128, total_assets: i128, total_shares: i128) -> i128 {
        (assets * (total_shares + VIRTUAL_SHARES)) / (total_assets + VIRTUAL_ASSETS)
    }

    /// Shares que valen `assets`, redondeando a favor del pool.
    fn ceil_shares(assets: i128, total_assets: i128, total_shares: i128) -> Result<i128, Error> {
        if total_assets <= 0 || total_shares <= 0 {
            return Err(Error::InsufficientPosition);
        }
        Ok((assets * total_shares + total_assets - 1) / total_assets)
    }

    fn read_token(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)
    }

    fn read_vault(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Vault)
            .ok_or(Error::NotInitialized)
    }

    fn read_total_shares(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0)
    }

    fn write_total_shares(env: &Env, shares: i128) {
        env.storage().instance().set(&DataKey::TotalShares, &shares);
    }

    fn read_shares(env: &Env, user: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Shares(user.clone()))
            .unwrap_or(0)
    }

    fn write_shares(env: &Env, user: &Address, shares: i128) {
        Self::write_persistent(env, &DataKey::Shares(user.clone()), &shares);
    }

    fn read_locked(env: &Env, user: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Locked(user.clone()))
            .unwrap_or(0)
    }

    fn write_locked(env: &Env, user: &Address, shares: i128) {
        Self::write_persistent(env, &DataKey::Locked(user.clone()), &shares);
    }

    fn read_stats(env: &Env, user: &Address) -> UserStats {
        env.storage()
            .persistent()
            .get(&DataKey::Stats(user.clone()))
            .unwrap_or_default()
    }

    /// Lleva el saldo ponderado hasta este momento, con el saldo que hubo hasta ahora.
    fn accrued_stats(env: &Env, user: &Address) -> UserStats {
        let mut stats = Self::read_stats(env, user);
        let now = env.ledger().timestamp();
        if stats.last_update > 0 {
            let elapsed = now.saturating_sub(stats.last_update);
            stats.balance_seconds += stats.net_balance * i128::from(elapsed);
        }
        stats.last_update = now;
        stats
    }

    fn write_stats(env: &Env, user: &Address, stats: &UserStats) {
        Self::write_persistent(env, &DataKey::Stats(user.clone()), stats);
    }

    fn write_persistent<V: IntoVal<Env, Val>>(env: &Env, key: &DataKey, value: &V) {
        let storage = env.storage().persistent();
        storage.set(key, value);
        storage.extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn extend_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

#[contractimpl]
impl Pausable for StakingContract {
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
impl Upgradeable for StakingContract {
    #[only_admin]
    fn upgrade(e: &Env, new_wasm_hash: BytesN<32>, operator: Address) {
        let _ = operator;
        upgradeable::upgrade(e, &new_wasm_hash);
    }
}

#[contractimpl(contracttrait)]
impl AccessControl for StakingContract {}

#[cfg(test)]
mod test;
