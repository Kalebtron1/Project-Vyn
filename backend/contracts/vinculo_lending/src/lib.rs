//! VinculoLending — préstamos según tier del SBT (`vinculo_sbt`).
//!
//! Vive en `backend/contracts/vinculo_lending/` junto a `vinculo_sbt` y `staking_pool`.
//! Consulta on-chain el nivel con `VinculoSBTClient::get_tier` (alineado al `vinculo_sbt` actual).
//!
//! Modo demo (hackathon): 1 “mes” de plazo = 60 segundos de ledger, igual que `staking_pool`.

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
    /// Guarda dirección del token (SAC / Soroban token) y del contrato `VinculoSBT`.
    pub fn init_lending(env: Env, token: Address, sbt: Address) {
        // SECURITY-FIX [RISK-04]: guard against re-initialization; prevents an attacker from
        // redirecting the token or SBT addresses after deployment to drain the pool or bypass tiers
        if env.storage().instance().has(&DataKey::Token) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Sbt, &sbt);
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
        // 1. El usuario debe firmar la transacción (Aprobación)
        user.require_auth();
        assert!(amount > 0, "amount must be > 0");
        assert!(
            months == 1 || months == 3 || months == 6 || months == 12,
            "invalid term (months)"
        );

        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("init not called");
        let sbt_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Sbt)
            .expect("init not called");

        // 2. Consultamos la reputación (SBT) del usuario
        let sbt_client = VinculoSBTClient::new(&env, &sbt_addr);
        let tier = sbt_client.get_tier(&user);
        assert!((1..=4).contains(&tier), "no valid SBT tier for credit");

        let existing: Loan = env
            .storage()
            .persistent()
            .get(&DataKey::Loan(user.clone()))
            .unwrap_or_default();
        assert!(existing.total_owed == 0, "active loan exists");

        // 3. Validamos contra el límite máximo de su Nivel (El Guardaespaldas)
        let max = max_principal_for_tier(tier);
        assert!(amount <= max, "amount exceeds tier limit");

        // SECURITY-FIX [RISK-03]: interest was hardcoded to a flat 5% for all tiers and all durations.
        // Now uses per-tier APY (from apy_bps_for_tier) prorated by months, consistent with staking_pool.
        // Formula: (principal * apy_bps * months) / 120_000
        //   apy_bps is annual rate in basis points (e.g. 1200 = 12% p.a.)
        //   dividing by 120_000 = 12 months * 10_000 bps converts to the fractional period charge.
        let apy_bps = apy_bps_for_tier(tier);
        let interest = (amount * apy_bps as i128 * months as i128) / 120_000;
        let total_owed = amount + interest;

        let token_client = token::Client::new(&env, &token_addr);
        let this = env.current_contract_address();
        let pool_balance = token_client.balance(&this);
        assert!(pool_balance >= amount, "insufficient pool liquidity");

        // 4. TRANSFERENCIA DIRECTA: El contrato manda los fondos a la wallet del usuario
        token_client.transfer(&this, &user, &amount);

        let duration_secs = months * 60;
        let due = env.ledger().timestamp() + duration_secs;

        let loan = Loan {
            principal: amount,
            total_owed,
            due_timestamp: due,
            months,
            apy_bps,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Loan(user.clone()), &loan);
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

        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&DataKey::Loan(user.clone()))
            .unwrap_or_default();
        assert!(loan.total_owed > 0, "no active loan");

        let pay = amount.min(loan.total_owed);
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&user, &env.current_contract_address(), &pay);

        loan.total_owed -= pay;
        if loan.total_owed == 0 {
            loan = Loan::default();
        }
        env.storage()
            .persistent()
            .set(&DataKey::Loan(user.clone()), &loan);
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

// 🚀 CAMBIO CLAVE: Sincronizado con el Node.js (CREDIT_LIMITS)
fn max_principal_for_tier(tier: u32) -> i128 {
    match tier {
        1 => 300_000_0000,      // Plata
        2 => 600_000_0000,      // Oro
        3 => 1_500_000_0000,    // Diamante
        4 => 5_000_000_0000,    // Platino
        _ => 0,
    }
}

/// APY anual expresado en “puntos base” sobre 10000 (ej. 1200 = 12 % anual).
/// Interés sobre el plazo: `(principal * apy_bps * months) / 1200` (misma convención que staking).
fn apy_bps_for_tier(tier: u32) -> u64 {
    match tier {
        1 => 1_200, // 12%
        2 => 800,   // 8%
        3 => 500,   // 5%
        4 => 400,   // 4%
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn request_and_repay_loan() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let sbt_id = env.register_contract(None, vinculo_sbt::VinculoSBT);
        let sbt = VinculoSBTClient::new(&env, &sbt_id);
        sbt.init(&admin);
        sbt.mint(&admin, &user, &2);

        let lending_id = env.register_contract(None, VinculoLending);
        let lending = VinculoLendingClient::new(&env, &lending_id);
        lending.init(&token_id, &sbt_id);

        let token = token::Client::new(&env, &token_id);
        token.mint(&lending_id, &10_000);

        // Pedimos 600 porque es el máximo de Nivel 2 (Oro)
        lending.request_loan(&user, &600, &3);
        let loan = lending.get_loan(&user);
        assert!(loan.total_owed > 600);
        assert_eq!(loan.principal, 600);

        token.mint(&user, &loan.total_owed);
        lending.repay(&user, &loan.total_owed);
        assert_eq!(lending.get_loan(&user).total_owed, 0);
    }
}