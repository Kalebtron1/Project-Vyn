//! VinculoLending — préstamos según tier del SBT (`vinculo_sbt`).
//!
//! Vive en `backend/contracts/vinculo_lending/` junto a `vinculo_sbt` y `staking_pool`.
//! Consulta on-chain el nivel con `VinculoSBTClient::get_tier` (alineado al `vinculo_sbt` actual).
//!
//! Modo demo (hackathon): 1 "mes" de plazo = 60 segundos de ledger, igual que `staking_pool`.

#![no_std]

use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, token, Address, BytesN, Env, Symbol, Vec,
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

// Interfaz mínima del SBT. No se depende del crate `vinculo_sbt` porque eso
// exporta sus funciones (`init`, `mint`, `revoke`...) dentro de este Wasm.
#[contractclient(name = "VinculoSBTClient")]
pub trait SbtInterface {
    fn get_tier(e: Env, user: Address) -> u32;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token,
    Sbt,
    Loan(Address),
    /// Wallet de tesorería: única autorizada a retirar el interés acumulado.
    Treasury,
    /// Interés acumulado (ganancia del negocio) disponible para retiro.
    AccruedInterest,
}

#[contracttype]
#[derive(Clone, Default)]
pub struct Loan {
    /// Principal desembolsado (sin intereses).
    pub principal: i128,
    /// Principal + intereses pendientes de pago.
    pub total_owed: i128,
    pub due_timestamp: u64,
    pub months: u64,
    pub apy_bps: u64,
}

#[contract]
pub struct VinculoLending;

#[contractimpl]
impl VinculoLending {
    /// El deploy y la inicialización ocurren en la misma transacción, así que
    /// nadie puede adelantarse a fijar el admin, el token, el SBT o la tesorería.
    pub fn __constructor(
        env: Env,
        admin: Address,
        pauser: Address,
        token: Address,
        sbt: Address,
        treasury: Address,
    ) {
        access_control::set_admin(&env, &admin);
        access_control::grant_role_no_auth(&env, &pauser, &Symbol::new(&env, "pauser"), &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Sbt, &sbt);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        extend_instance(&env);
    }

    /// Cambia la tesorería. Firman el admin y la cuenta nueva, para que un error
    /// de dedo no deje las ganancias en una dirección que nadie controla.
    #[only_admin]
    pub fn set_treasury(env: Env, new_treasury: Address) {
        new_treasury.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Treasury, &new_treasury);
        extend_instance(&env);
    }

    /// Aporta liquidez al pool de préstamos (el `from` transfiere al contrato).
    pub fn fund_pool(env: Env, from: Address, amount: i128) {
        from.require_auth();
        assert!(amount > 0, "amount must be > 0");

        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("init not called");
        let client = token::Client::new(&env, &token_addr);
        client.transfer(&from, env.current_contract_address(), &amount);
        extend_instance(&env);
    }

    /// Solicita préstamo: lee tier en `vinculo_sbt`, valida tope y liquidez, transfiere al usuario.
    #[when_not_paused]
    pub fn request_loan(env: Env, user: Address, amount: i128, months: u64) {
        user.require_auth();
        assert!(amount > 0, "amount must be > 0");
        assert!(
            months == 1 || months == 3 || months == 6 || months == 12,
            "invalid term (months)"
        );

        // OPT: read Token and Sbt in a single storage access chain — avoids a second
        // instance-storage round-trip that was previously a separate .get() call
        let storage = env.storage().instance();
        let token_addr: Address = storage.get(&DataKey::Token).expect("init not called");
        let sbt_addr: Address = storage.get(&DataKey::Sbt).expect("init not called");

        let sbt_client = VinculoSBTClient::new(&env, &sbt_addr);
        let tier = sbt_client.get_tier(&user);
        assert!((1..=4).contains(&tier), "no valid SBT tier for credit");

        // OPT: build loan key once — eliminates 3 redundant user.clone() calls
        let loan_key = DataKey::Loan(user.clone());
        let existing: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .unwrap_or_default();
        assert!(existing.total_owed == 0, "active loan exists");

        let max = max_principal_for_tier(tier);
        assert!(amount <= max, "amount exceeds tier limit");

        let interest = (amount * 5) / 100;
        let total_owed = amount + interest;

        let token_client = token::Client::new(&env, &token_addr);
        let this = env.current_contract_address();
        // El interés acumulado es de la tesorería: no se puede prestar.
        let accrued: i128 = storage.get(&DataKey::AccruedInterest).unwrap_or(0);
        let free_liquidity = token_client.balance(&this) - accrued;
        assert!(free_liquidity >= amount, "insufficient pool liquidity");

        token_client.transfer(&this, &user, &amount);

        let loan = Loan {
            principal: amount,
            total_owed,
            due_timestamp: env.ledger().timestamp() + months * 60,
            months,
            apy_bps: 500,
        };
        write_loan(&env, &loan_key, &loan);
    }

    /// Abona al préstamo (total o parcial). El excedente no se acepta.
    pub fn repay(env: Env, user: Address, amount: i128) {
        user.require_auth();
        assert!(amount > 0, "amount must be > 0");

        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("init not called");

        // OPT: build loan key once — eliminates redundant user.clone()
        let loan_key = DataKey::Loan(user.clone());
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .unwrap_or_default();
        assert!(loan.total_owed > 0, "no active loan");

        let pay = amount.min(loan.total_owed);
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&user, env.current_contract_address(), &pay);

        loan.total_owed -= pay;
        if loan.total_owed == 0 {
            // Préstamo saldado: el interés (principal·5/100, igual que en
            // `request_loan`) pasa a ganancia retirable por la tesorería. El
            // principal permanece como liquidez del pool para seguir prestando.
            let interest = (loan.principal * 5) / 100;
            let storage = env.storage().instance();
            let accrued: i128 = storage.get(&DataKey::AccruedInterest).unwrap_or(0);
            storage.set(&DataKey::AccruedInterest, &(accrued + interest));
            loan = Loan::default();
        }
        write_loan(&env, &loan_key, &loan);
    }

    /// Retira ganancia (interés acumulado) hacia la wallet de tesorería.
    /// Solo la tesorería puede llamarla (`treasury.require_auth()`). Nunca retira
    /// más que el interés acumulado ni más que el balance disponible, de modo que
    /// el principal del pool permanece intacto para seguir otorgando préstamos.
    /// Devuelve el monto efectivamente retirado.
    #[when_not_paused]
    pub fn withdraw_interest(env: Env, amount: i128) -> i128 {
        assert!(amount > 0, "amount must be > 0");

        let storage = env.storage().instance();
        let treasury: Address = storage.get(&DataKey::Treasury).expect("init not called");
        treasury.require_auth();

        let accrued: i128 = storage.get(&DataKey::AccruedInterest).unwrap_or(0);
        assert!(accrued > 0, "no interest accrued");

        let token_addr: Address = storage.get(&DataKey::Token).expect("init not called");
        let token_client = token::Client::new(&env, &token_addr);
        let this = env.current_contract_address();
        let balance = token_client.balance(&this);

        // Tope doble: ni más que lo acumulado ni más que el balance disponible.
        let withdrawable = amount.min(accrued).min(balance);
        assert!(withdrawable > 0, "nothing to withdraw");

        token_client.transfer(&this, &treasury, &withdrawable);
        storage.set(&DataKey::AccruedInterest, &(accrued - withdrawable));
        extend_instance(&env);
        withdrawable
    }

    /// Retira liquidez (principal) del pool hacia la tesorería. A diferencia de
    /// `withdraw_interest`, esta saca el capital destinado a préstamos: sirve para
    /// no dejar dinero muerto si la app deja de usarse. Nunca toca el interés
    /// acumulado (que se retira con `withdraw_interest`): el tope es el balance
    /// LIBRE = balance del contrato menos el interés aún no retirado, de modo que
    /// el balance nunca cae por debajo del interés reservado a la tesorería.
    /// Solo la tesorería puede llamarla (`treasury.require_auth()`).
    /// Devuelve el monto efectivamente retirado.
    #[when_not_paused]
    pub fn withdraw_pool(env: Env, amount: i128) -> i128 {
        assert!(amount > 0, "amount must be > 0");

        let storage = env.storage().instance();
        let treasury: Address = storage.get(&DataKey::Treasury).expect("init not called");
        treasury.require_auth();

        let token_addr: Address = storage.get(&DataKey::Token).expect("init not called");
        let token_client = token::Client::new(&env, &token_addr);
        let this = env.current_contract_address();
        let balance = token_client.balance(&this);
        let accrued: i128 = storage.get(&DataKey::AccruedInterest).unwrap_or(0);

        // Liquidez libre = balance − interés acumulado (el interés se retira aparte).
        let free = balance - accrued;
        let withdrawable = amount.min(free);
        assert!(withdrawable > 0, "nothing to withdraw");

        token_client.transfer(&this, &treasury, &withdrawable);
        extend_instance(&env);
        withdrawable
    }

    /// Interés acumulado (ganancia) disponible para que la tesorería retire.
    pub fn get_accrued_interest(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::AccruedInterest)
            .unwrap_or(0)
    }

    /// Wallet de tesorería configurada en el deploy.
    pub fn get_treasury(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Treasury)
            .expect("init not called")
    }

    pub fn get_loan(env: Env, user: Address) -> Loan {
        env.storage()
            .persistent()
            .get(&DataKey::Loan(user))
            .unwrap_or_default()
    }

    /// Saldo del token en custodia del contrato (liquidez disponible para desembolsos).
    pub fn get_pool_balance(env: Env) -> i128 {
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("init not called");
        let token_client = token::Client::new(&env, &token_addr);
        token_client.balance(&env.current_contract_address())
    }
}

#[contractimpl]
impl Pausable for VinculoLending {
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
impl Upgradeable for VinculoLending {
    #[only_admin]
    fn upgrade(e: &Env, new_wasm_hash: BytesN<32>, operator: Address) {
        let _ = operator;
        upgradeable::upgrade(e, &new_wasm_hash);
    }
}

#[contractimpl(contracttrait)]
impl AccessControl for VinculoLending {}

fn write_loan(env: &Env, key: &DataKey, loan: &Loan) {
    let storage = env.storage().persistent();
    storage.set(key, loan);
    storage.extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    extend_instance(env);
}

fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn max_principal_for_tier(tier: u32) -> i128 {
    match tier {
        1 => 3_000_000_000,  // Plata: 300 unidades (7 decimales)
        2 => 6_000_000_000,  // Oro: 600
        3 => 15_000_000_000, // Diamante: 1,500
        4 => 50_000_000_000, // Platino: 5,000
        _ => 0,
    }
}

#[cfg(test)]
mod test;
