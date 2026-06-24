//! VinculoLending — préstamos según tier del SBT (`vinculo_sbt`).
//!
//! Vive en `backend/contracts/vinculo_lending/` junto a `vinculo_sbt` y `staking_pool`.
//! Consulta on-chain el nivel con `VinculoSBTClient::get_tier` (alineado al `vinculo_sbt` actual).
//!
//! Modo demo (hackathon): 1 "mes" de plazo = 60 segundos de ledger, igual que `staking_pool`.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};
use vinculo_sbt::VinculoSBTClient;

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
    /// Guarda dirección del token (SAC / Soroban token), del contrato `VinculoSBT`
    /// y de la wallet de tesorería (la única que podrá retirar el interés).
    ///
    /// La tesorería se fija aquí, en el deploy, y no en una función aparte: así se
    /// evita un *front-running* en el que un atacante la reclame antes que el dueño.
    pub fn init_lending(env: Env, token: Address, sbt: Address, treasury: Address) {
        // Guard de re-inicialización: sin esto, cualquiera podría volver a llamar
        // `init_lending` y re-apuntar el token, el SBT o la tesorería a uno malicioso
        // (p.ej. un SBT que devuelva tier 4 para el atacante) y drenar el pool vía
        // `request_loan`.
        if env.storage().instance().has(&DataKey::Token) {
            panic!("El contrato ya fue inicializado");
        }
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Sbt, &sbt);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
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
        client.transfer(&from, &env.current_contract_address(), &amount);
    }

    /// Solicita préstamo: lee tier en `vinculo_sbt`, valida tope y liquidez, transfiere al usuario.
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
        let pool_balance = token_client.balance(&this);
        assert!(pool_balance >= amount, "insufficient pool liquidity");

        token_client.transfer(&this, &user, &amount);

        let loan = Loan {
            principal: amount,
            total_owed,
            due_timestamp: env.ledger().timestamp() + months * 60,
            months,
            apy_bps: 500,
        };
        env.storage().persistent().set(&loan_key, &loan);
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
        token_client.transfer(&user, &env.current_contract_address(), &pay);

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
        env.storage().persistent().set(&loan_key, &loan);
    }

    /// Retira ganancia (interés acumulado) hacia la wallet de tesorería.
    /// Solo la tesorería puede llamarla (`treasury.require_auth()`). Nunca retira
    /// más que el interés acumulado ni más que el balance disponible, de modo que
    /// el principal del pool permanece intacto para seguir otorgando préstamos.
    /// Devuelve el monto efectivamente retirado.
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

fn max_principal_for_tier(tier: u32) -> i128 {
    match tier {
        1 => 300_000_0000,   // Plata
        2 => 600_000_0000,   // Oro
        3 => 1_500_000_0000, // Diamante
        4 => 5_000_000_0000, // Platino
        _ => 0,
    }
}
