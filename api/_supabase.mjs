// Supabase — store mínimo del mapping de on-ramp (usuario ↔ receiver/blockchain wallet
// de BlindPay). Reintroduce Supabase SOLO para esto (no vuelve la auth). Usa la REST API
// de PostgREST con la service-role key (solo backend, nunca en el bundle Vite).
//
// Si SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no están configuradas, cae a un Map en
// memoria (igual que los nonces de dev) para no bloquear el flujo local. En producción
// lanza error: cada instancia tendría su propia memoria y se podría pagar dos veces.
//
// El esquema está en supabase/migrations.

const TABLE = "onramp_users";

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function isSupabaseConfigured() {
  return getConfig() !== null;
}

// ── Fallback en memoria (dev sin Supabase) ──────────────────────────────────
const memory = new Map(); // wallet_address -> row

function usesMemory() {
  if (isSupabaseConfigured()) return false;
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Supabase no está configurado en producción");
  }
  return true;
}

async function sbFetch(path, { method = "GET", body, headers = {}, signal } = {}) {
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
    signal,
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

// ── Keep-alive / readiness ──────────────────────────────────────────────────
// Supabase pausa los proyectos del plan Free con poca actividad en 7 días. El
// workflow `supabase-keepalive` llama a /api/readiness cada 6 h y esta lectura
// mínima cuenta como actividad (y detecta si Supabase dejó de responder).
const PING_TIMEOUT_MS = 5000;

/** "ok" si Supabase responde, "not_configured" si faltan las variables. Lanza si falla. */
export async function pingSupabase() {
  if (!isSupabaseConfigured()) return "not_configured";
  await sbFetch("faucet_claims?select=claimed_at&limit=1", {
    signal: AbortSignal.timeout(PING_TIMEOUT_MS),
  });
  return "ok";
}

/** Busca el mapping por dirección de wallet (identidad estable del usuario Privy). */
export async function getOnrampUserByWallet(walletAddress) {
  if (usesMemory()) return memory.get(walletAddress) || null;
  const rows = await sbFetch(
    `${TABLE}?wallet_address=eq.${encodeURIComponent(walletAddress)}&select=*&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// ── Faucet de USDC: una sola vez por wallet ─────────────────────────────────
const faucetMemory = new Set(); // fallback dev: wallets que ya reclamaron

/** ¿Esta wallet ya reclamó el faucet de USDC? */
export async function hasClaimedFaucet(walletAddress) {
  if (usesMemory()) return faucetMemory.has(walletAddress);
  const rows = await sbFetch(
    `faucet_claims?wallet_address=eq.${encodeURIComponent(walletAddress)}&select=wallet_address&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** Registra que esta wallet reclamó el faucet (idempotente). */
export async function recordFaucetClaim(walletAddress) {
  if (usesMemory()) {
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
  if (usesMemory()) return settlementMemory.has(payinId);
  const rows = await sbFetch(
    `onramp_settlements?payin_id=eq.${encodeURIComponent(payinId)}&select=payin_id&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** Registra la liquidación de un payin (idempotente). */
export async function recordSettlement(payinId, { walletAddress, amountUsd, hash }) {
  if (usesMemory()) {
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
  if (usesMemory()) {
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

// ── Funciones atómicas (supabase/migrations/0002_ramp_schema.sql) ───────────
// Sin fallback en memoria: el límite que protegen no existiría entre instancias.

function rpc(name, args) {
  if (!isSupabaseConfigured()) throw new Error("Supabase no está configurado");
  return sbFetch(`rpc/${name}`, { method: "POST", body: args });
}

/** Devuelve "reserved" | "already_reserved" | "wallet_cap" | "global_cap". */
export function reserveSettlement({ payinId, walletAddress, amountCents, walletDailyCapCents, globalDailyCapCents }) {
  return rpc("reserve_settlement", {
    p_payin_id: payinId,
    p_wallet: walletAddress,
    p_amount_cents: amountCents,
    p_wallet_daily_cap_cents: walletDailyCapCents,
    p_global_daily_cap_cents: globalDailyCapCents,
  });
}

/** Con txHash queda enviada; sin txHash queda fallida y se puede reintentar. */
export function finishSettlement(payinId, { txHash = null, error = null } = {}) {
  return rpc("finish_settlement", { p_payin_id: payinId, p_tx_hash: txHash, p_error: error });
}

/** Devuelve "reserved" | "already_claimed" | "ip_cap" | "global_cap". */
export function reserveFaucet({ walletAddress, ipHash, amountCents, ipDailyMax, globalDailyCapCents }) {
  return rpc("reserve_faucet", {
    p_wallet: walletAddress,
    p_ip_hash: ipHash,
    p_amount_cents: amountCents,
    p_ip_daily_max: ipDailyMax,
    p_global_daily_cap_cents: globalDailyCapCents,
  });
}

/** Con txHash queda enviado; sin txHash la wallet puede volver a reclamar. */
export function finishFaucet(walletAddress, txHash = null) {
  return rpc("finish_faucet", { p_wallet: walletAddress, p_tx_hash: txHash });
}

/** true si la petición entra en el límite de la ventana. */
export function hitRateLimit(key, windowSeconds, max) {
  return rpc("hit_rate_limit", { p_key: key, p_window_seconds: windowSeconds, p_max: max });
}

/** true la primera vez que se usa el desafío; false si ya se había usado. */
export function consumeAuthChallenge(challengeHash, expiresAt) {
  return rpc("consume_auth_challenge", { p_challenge_hash: challengeHash, p_expires_at: expiresAt });
}
