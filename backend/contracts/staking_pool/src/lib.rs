#![no_std]
//! StakingPool — "apartado" con rendimiento REAL vía un vault de DeFindex.
//!
//! El usuario deposita un token (USDC en testnet) y el contrato lo coloca en un
//! vault de DeFindex configurable. El contrato es el custodio: deposita al vault
//! como `from = current_contract_address()` y mantiene un libro interno
//! `Shares(user)` con las shares (dfTokens) que le corresponden a cada usuario.
//!
//! El rendimiento es real: proviene de la apreciación de las shares del vault, no
//! de una fórmula de APY sintética. `get_position(user)` devuelve el valor
//! redimible en vivo consultando `get_asset_amounts_per_shares` del vault.
//!
//! Además expone contadores de ingreso/actividad (`TotalDeposited`,
//! `TotalWithdrawn`, `TxCount`) para que el motor de reputación off-chain pueda
//! seguir midiendo el comportamiento del usuario y habilitar el minteo del SBT.

use soroban_sdk::auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation};
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, token, vec, Address,
    BytesN, Env, IntoVal, Symbol, Val, Vec,
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

// ─── Cliente del vault DeFindex ────────────────────────────────────────────────
//
// Espejo mínimo de `paltalabs/defindex` (`apps/contracts/vault/src/interface.rs`)
// con solo las funciones que usamos. `deposit` devuelve una tupla compleja en el
// vault real; aquí la recibimos como `Val` (siempre decodifica) y obtenemos las
// shares minteadas por diferencia de balance del dfToken (SEP-41) del vault, que
// es la vía más robusta frente a la codificación exacta del retorno.

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
}

// ─── Storage ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Token subyacente (USDC SAC).
    Token,
    /// Dirección del vault DeFindex (configurable vía constructor y `set_vault`).
    Vault,
    /// Shares (dfTokens) del usuario custodiadas por el contrato.
    Shares(Address),
    /// Ingreso acumulado del usuario (para scoring de reputación).
    TotalDeposited(Address),
    /// Retiro acumulado del usuario (para scoring de reputación).
    TotalWithdrawn(Address),
    /// Conteo de operaciones (depósitos + retiros) del usuario.
    TxCount(Address),
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
    ) {
        access_control::set_admin(&env, &admin);
        access_control::grant_role_no_auth(&env, &pauser, &Symbol::new(&env, "pauser"), &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Vault, &vault);
        Self::extend_instance(&env);
    }

    /// Migra el vault DeFindex que respalda el apartado. Solo el admin.
    /// Pensado para cuando la dirección del vault cambia (reset de testnet,
    /// nueva estrategia) sin necesidad de redeploy ni nuevo contract id.
    ///
    /// AVISO: las `Shares(user)` existentes corresponden a los dfTokens del vault
    /// ANTERIOR. Cámbialo solo cuando no haya posiciones vivas (o migra los
    /// fondos por separado), o `get_position` consultaría shares de un vault que
    /// ya no las reconoce.
    #[only_admin]
    pub fn set_vault(env: Env, new_vault: Address) {
        env.storage().instance().set(&DataKey::Vault, &new_vault);
        Self::extend_instance(&env);
    }

    /// Vault DeFindex actualmente configurado.
    pub fn get_vault(env: Env) -> Result<Address, Error> {
        Self::read_vault(&env)
    }

    /// Deposita `amount` del token en el vault y acredita las shares al usuario.
    /// Devuelve las shares (dfTokens) minteadas. Se bloquea durante la pausa.
    #[when_not_paused]
    pub fn deposit(env: Env, user: Address, amount: i128) -> Result<i128, Error> {
        user.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let token_addr = Self::read_token(&env)?;
        let vault_addr = Self::read_vault(&env)?;
        let this = env.current_contract_address();

        // 1. El usuario transfiere el token al contrato.
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&user, &this, &amount);

        // 2. El contrato deposita al vault como custodio e invierte para generar yield.
        //    El vault hará `token.transfer(this -> vault, amount)` dos niveles abajo;
        //    autorizamos ese sub-invoke en nombre del contrato (la `require_auth` del
        //    propio `deposit` la cubre la auth de invocador por ser el llamador directo).
        let vault = VaultClient::new(&env, &vault_addr);
        let amounts_desired = vec![&env, amount];
        let amounts_min = vec![&env, amount];

        // Medimos las shares ANTES de autorizar: `balance` es una llamada de contrato y
        // `authorize_as_current_contract` solo aplica a la PRÓXIMA llamada de contrato.
        // No puede haber ninguna otra llamada de contrato entre la autorización y
        // `vault.deposit`, o la auth se consumiría y la transferencia anidada fallaría
        // con Error(Auth, InvalidAction).
        let shares_before = vault.balance(&this);

        let transfer_args: Vec<Val> = (this.clone(), vault_addr.clone(), amount).into_val(&env);
        env.authorize_as_current_contract(vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: token_addr.clone(),
                    fn_name: Symbol::new(&env, "transfer"),
                    args: transfer_args,
                },
                sub_invocations: vec![&env],
            }),
        ]);

        vault.deposit(&amounts_desired, &amounts_min, &this, &true);
        let shares_after = vault.balance(&this);
        let minted = shares_after - shares_before;

        // 3. Contabilidad interna por usuario.
        let shares_key = DataKey::Shares(user.clone());
        let prev_shares: i128 = env.storage().persistent().get(&shares_key).unwrap_or(0);
        Self::write_persistent(&env, &shares_key, &(prev_shares + minted));

        Self::bump_counter(&env, &DataKey::TotalDeposited(user.clone()), amount);
        Self::increment_tx(&env, &user);
        Self::extend_instance(&env);

        Ok(minted)
    }

    /// Retira hasta `amount` del token redimiendo shares del vault.
    /// Si `amount` supera la posición, retira todo. Devuelve el monto realmente
    /// entregado al usuario (puede diferir levemente por redondeo del vault).
    /// Nunca se pausa: el usuario siempre puede sacar su dinero.
    pub fn withdraw(env: Env, user: Address, amount: i128) -> Result<i128, Error> {
        user.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let token_addr = Self::read_token(&env)?;
        let vault_addr = Self::read_vault(&env)?;
        let this = env.current_contract_address();

        let shares_key = DataKey::Shares(user.clone());
        let user_shares: i128 = env.storage().persistent().get(&shares_key).unwrap_or(0);
        if user_shares <= 0 {
            return Err(Error::InsufficientPosition);
        }

        let vault = VaultClient::new(&env, &vault_addr);
        let position = vault
            .get_asset_amounts_per_shares(&user_shares)
            .get(0)
            .unwrap_or(0);
        if position <= 0 {
            return Err(Error::InsufficientPosition);
        }

        // Shares a quemar: todas si se pide >= posición, si no proporcional (floor).
        let shares_to_burn = if amount >= position {
            user_shares
        } else {
            (user_shares * amount) / position
        };
        if shares_to_burn <= 0 {
            return Err(Error::InvalidAmount);
        }

        // Redime del vault y mide el token efectivamente recibido.
        let token_client = token::Client::new(&env, &token_addr);
        let token_before = token_client.balance(&this);
        let min_amounts_out = vec![&env, 0i128];
        vault.withdraw(&shares_to_burn, &min_amounts_out, &this);
        let token_after = token_client.balance(&this);
        let received = token_after - token_before;

        // Entrega al usuario y actualiza contabilidad.
        token_client.transfer(&this, &user, &received);
        Self::write_persistent(&env, &shares_key, &(user_shares - shares_to_burn));

        Self::bump_counter(&env, &DataKey::TotalWithdrawn(user.clone()), received);
        Self::increment_tx(&env, &user);
        Self::extend_instance(&env);

        Ok(received)
    }

    /// Valor redimible en vivo (token subyacente) de la posición del usuario,
    /// incluyendo el rendimiento real acumulado. Reemplaza a `get_balance`.
    pub fn get_position(env: Env, user: Address) -> i128 {
        let user_shares: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Shares(user))
            .unwrap_or(0);
        if user_shares <= 0 {
            return 0;
        }
        let Ok(vault_addr) = Self::read_vault(&env) else {
            return 0;
        };
        let vault = VaultClient::new(&env, &vault_addr);
        vault
            .get_asset_amounts_per_shares(&user_shares)
            .get(0)
            .unwrap_or(0)
    }

    /// Shares (dfTokens) del usuario custodiadas por el contrato.
    pub fn get_shares(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Shares(user))
            .unwrap_or(0)
    }

    /// Ingreso acumulado del usuario (para scoring).
    pub fn get_total_deposited(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalDeposited(user))
            .unwrap_or(0)
    }

    /// Retiro acumulado del usuario (para scoring).
    pub fn get_total_withdrawn(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalWithdrawn(user))
            .unwrap_or(0)
    }

    /// Conteo de operaciones del usuario (para scoring de actividad).
    pub fn get_tx_count(env: Env, user: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::TxCount(user))
            .unwrap_or(0)
    }

    // ─── Helpers internos ──────────────────────────────────────────────────────

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

    fn bump_counter(env: &Env, key: &DataKey, delta: i128) {
        let prev: i128 = env.storage().persistent().get(key).unwrap_or(0);
        Self::write_persistent(env, key, &(prev + delta));
    }

    fn increment_tx(env: &Env, user: &Address) {
        let key = DataKey::TxCount(user.clone());
        let prev: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        Self::write_persistent(env, &key, &(prev + 1));
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
