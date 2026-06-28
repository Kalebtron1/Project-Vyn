// Supabase — store mínimo del mapping de on-ramp (usuario ↔ receiver/blockchain wallet
// de BlindPay). Reintroduce Supabase SOLO para esto (no vuelve la auth). Usa la REST API
// de PostgREST con la service-role key (solo backend, nunca en el bundle Vite).
//
// Si SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no están configuradas, cae a un Map en
// memoria (igual que los nonces de dev) para no bloquear el flujo local; la persistencia
// y la atribución entre sesiones requieren Supabase configurado.
//
// Tabla esperada (crear una vez):
//   create table if not exists onramp_users (
//     wallet_address text primary key,
//     email text,
//     blindpay_receiver_id text,
//     blindpay_blockchain_wallet_id text,
//     created_at timestamptz default now()
//   );

const TABLE = "onramp_users";

function getConfig() {
  const url = process.env.SUPABASE_URL;
  // service_role (ideal en prod) o anon/publishable key (demo, con policy RLS permisiva).
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function isSupabaseConfigured() {
  return getConfig() !== null;
}

// ── Fallback en memoria (dev sin Supabase) ──────────────────────────────────
const memory = new Map(); // wallet_address -> row

async function sbFetch(path, { method = "GET", body, headers = {} } = {}) {
  const cfg = getConfig();
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = data && (data.message || data.error || data.hint);
    const err = new Error(detail || `Supabase respondió ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Busca el mapping por dirección de wallet (identidad estable del usuario Accesly). */
export async function getOnrampUserByWallet(walletAddress) {
  if (!isSupabaseConfigured()) return memory.get(walletAddress) || null;
  const rows = await sbFetch(
    `${TABLE}?wallet_address=eq.${encodeURIComponent(walletAddress)}&select=*&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// ── Faucet de USDC: una sola vez por wallet ─────────────────────────────────
const faucetMemory = new Set(); // fallback dev: wallets que ya reclamaron

/** ¿Esta wallet ya reclamó el faucet de USDC? */
export async function hasClaimedFaucet(walletAddress) {
  if (!isSupabaseConfigured()) return faucetMemory.has(walletAddress);
  const rows = await sbFetch(
    `faucet_claims?wallet_address=eq.${encodeURIComponent(walletAddress)}&select=wallet_address&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** Registra que esta wallet reclamó el faucet (idempotente). */
export async function recordFaucetClaim(walletAddress) {
  if (!isSupabaseConfigured()) {
    faucetMemory.add(walletAddress);
    return;
  }
  await sbFetch(`faucet_claims?on_conflict=wallet_address`, {
    method: "POST",
    body: [{ wallet_address: walletAddress }],
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
  });
}

// ── Liquidación on-ramp: una USDC por payin (idempotencia) ──────────────────
const settlementMemory = new Set();

/** ¿Este payin ya fue liquidado (USDC enviado al usuario)? */
export async function hasSettledPayin(payinId) {
  if (!isSupabaseConfigured()) return settlementMemory.has(payinId);
  const rows = await sbFetch(
    `onramp_settlements?payin_id=eq.${encodeURIComponent(payinId)}&select=payin_id&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** Registra la liquidación de un payin (idempotente). */
export async function recordSettlement(payinId, { walletAddress, amountUsd, hash }) {
  if (!isSupabaseConfigured()) {
    settlementMemory.add(payinId);
    return;
  }
  await sbFetch(`onramp_settlements?on_conflict=payin_id`, {
    method: "POST",
    body: [{ payin_id: payinId, wallet_address: walletAddress, amount_usd: amountUsd, hash }],
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
  });
}

/** Inserta/actualiza el mapping (upsert por wallet_address). */
export async function upsertOnrampUser(row) {
  if (!isSupabaseConfigured()) {
    const existing = memory.get(row.wallet_address) || {};
    const merged = { ...existing, ...row };
    memory.set(row.wallet_address, merged);
    return merged;
  }
  const rows = await sbFetch(`${TABLE}?on_conflict=wallet_address`, {
    method: "POST",
    body: [row],
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  });
  return Array.isArray(rows) && rows.length ? rows[0] : row;
}
