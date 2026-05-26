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
    // 1. Inicialización con metadatos base
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("El contrato ya fue inicializado");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        
        // Definimos la identidad global del token
        env.storage().instance().set(&DataKey::Name, &String::from_str(&env, "Vinculo Credito SBT"));
        env.storage().instance().set(&DataKey::Symbol, &String::from_str(&env, "VINC"));
    }

    // --- FUNCIONES ESTÁNDAR PARA WALLETS (INTERFAZ METADATA) ---
    
    pub fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(env: Env) -> String {
        env.storage().instance().get(&DataKey::Symbol).unwrap()
    }

    // La función que las wallets y exploradores usarán para buscar la imagen y los traits
    pub fn token_uri(env: Env, user: Address) -> String {
        let tier = env.storage().persistent().get(&DataKey::Tier(user)).unwrap_or(0u32);
        
        // 🚀 URLs dinámicas apuntando a los archivos JSON en tu repositorio
        match tier {
            1 => String::from_str(&env, "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/plata.json"),
            2 => String::from_str(&env, "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/oro.json"),
            3 => String::from_str(&env, "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/diamante.json"),
            4 => String::from_str(&env, "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/platino.json"),
            // Nivel 0 (Bronce o Revocado)
            _ => String::from_str(&env, "https://raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/main/metadata/bronce.json"),
        }
    }

    // --- LÓGICA DE NEGOCIO Y CONTROL DE ACCESO ---

    pub fn mint(env: Env, admin: Address, user: Address, tier: u32) {
        admin.require_auth();
        
        let saved_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != saved_admin { 
            panic!("Solo el administrador puede mintear NFTs"); 
        }

        // SECURITY-FIX [RISK-02]: enforce monotonic tier increases; mint() cannot downgrade a wallet.
        // Downgrades must be performed explicitly via revoke(). This prevents accidental or malicious
        // tier reductions that would reduce a user's credit limit without their knowledge.
        let current_tier = env.storage().persistent().get(&DataKey::Tier(user.clone())).unwrap_or(0u32);
        if tier == 0 {
            panic!("Usa revoke() para retirar el tier de un usuario");
        }
        if tier <= current_tier {
            panic!("El nuevo tier debe ser mayor al tier actual (usa revoke() para bajar)");
        }

        // Actualizamos o asignamos el nuevo nivel
        env.storage().persistent().set(&DataKey::Tier(user), &tier);
    }

    // Función extra por si un usuario incumple pagos y quieres bajarlo a Bronce (0)
    pub fn revoke(env: Env, admin: Address, user: Address) {
        admin.require_auth();
        let saved_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != saved_admin {
            panic!("Solo el administrador puede revocar");
        }
        env.storage().persistent().set(&DataKey::Tier(user), &0u32);
    }

    pub fn get_tier(env: Env, user: Address) -> u32 {
        env.storage().persistent().get(&DataKey::Tier(user)).unwrap_or(0)
    }
}