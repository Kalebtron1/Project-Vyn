// Supabase — store mínimo del mapping de on-ramp (usuario ↔ receiver/blockchain wallet
// de BlindPay). Reintroduce Supabase SOLO para esto (no vuelve la auth). Usa la REST API
// de PostgREST con la service-role key (solo backend, nunca en el bundle Vite).
//
// Si SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no están configuradas, cae a un Map en
// memoria (igual que los nonces de dev) para no bloquear el flujo local. En producción
// lanza error: cada instancia tendría su propia memoria y se podría pagar dos veces.
//
// El esquema está en supabase/migrations.

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function isSupabaseConfigured() {
  return getConfig() !== null;
}

// El código `supabase_unavailable` permite responder 503: no se movió dinero y se puede reintentar.
function unavailable(message) {
  const err = new Error(message);
  err.code = "supabase_unavailable";
  return err;
}

// ── Fallback en memoria (dev sin Supabase) ──────────────────────────────────
const customerMemory = new Map(); // wallet_address -> row
const payinMemory = new Map(); // payin_id -> row

function usesMemory() {
  if (isSupabaseConfigured()) return false;
  if (process.env.VERCEL_ENV === "production") {
    throw unavailable("Supabase no está configurado en producción");
  }
  return true;
}

async function sbFetch(path, { method = "GET", body, headers = {}, signal } = {}) {
  const cfg = getConfig();
  let res;
  try {
    res = await fetch(`${cfg.url}/rest/v1/${path}`, {
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
  } catch (error) {
    throw unavailable(error?.message || "Supabase no responde");
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = data && (data.message || data.error || data.hint);
    const err = unavailable(detail || `Supabase respondió ${res.status}`);
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

// ── On-ramp: wallet ↔ BlindPay y payins ligados a su wallet ─────────────────

/** Busca el mapping por dirección de wallet (identidad estable del usuario Privy). */
export async function getRampCustomer(walletAddress) {
  if (usesMemory()) return customerMemory.get(walletAddress) || null;
  const rows = await sbFetch(
    `ramp_customers?wallet_address=eq.${encodeURIComponent(walletAddress)}&select=*&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** Mapping en la tabla vieja: cubre wallets registradas después del último backfill. */
export async function getLegacyOnrampUser(walletAddress) {
  if (usesMemory()) return null;
  const rows = await sbFetch(
    `onramp_users?wallet_address=eq.${encodeURIComponent(walletAddress)}&select=blindpay_receiver_id,blindpay_blockchain_wallet_id&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** Inserta/actualiza el mapping (upsert por wallet_address). */
export async function upsertRampCustomer(row) {
  if (usesMemory()) {
    customerMemory.set(row.wallet_address, row);
    return;
  }
  await sbFetch("ramp_customers?on_conflict=wallet_address", {
    method: "POST",
    body: [row],
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  });
}

/** Guarda un payin con su wallet y montos. `settle` solo acepta payins de esta tabla. */
export async function saveRampPayin(row) {
  if (usesMemory()) {
    payinMemory.set(row.payin_id, row);
    return;
  }
  await sbFetch("ramp_payins", { method: "POST", body: [row], headers: { Prefer: "return=minimal" } });
}

export async function getRampPayin(payinId) {
  if (usesMemory()) return payinMemory.get(payinId) || null;
  const rows = await sbFetch(`ramp_payins?payin_id=eq.${encodeURIComponent(payinId)}&select=*&limit=1`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function updateRampPayinStatus(payinId, status) {
  if (usesMemory()) {
    const row = payinMemory.get(payinId);
    if (row) row.status = status;
    return;
  }
  await sbFetch(`ramp_payins?payin_id=eq.${encodeURIComponent(payinId)}`, {
    method: "PATCH",
    body: { status, updated_at: new Date().toISOString() },
    headers: { Prefer: "return=minimal" },
  });
}

/** Estado de la liquidación de un payin, o null si no hay. */
export async function getSettlementStatus(payinId) {
  const rows = await sbFetch(`ramp_settlements?payin_id=eq.${encodeURIComponent(payinId)}&select=status,tx_hash&limit=1`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// ── Faucet de USDC ──────────────────────────────────────────────────────────

/** ¿Esta wallet aparece en la tabla vieja? Cubre reclamos posteriores al último backfill. */
export async function hasClaimedFaucet(walletAddress) {
  if (usesMemory()) return false;
  const rows = await sbFetch(
    `faucet_claims?wallet_address=eq.${encodeURIComponent(walletAddress)}&select=wallet_address&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0;
}

// ── Funciones atómicas (supabase/migrations/0002_ramp_schema.sql) ───────────
// Sin fallback en memoria: el límite que protegen no existiría entre instancias.

function rpc(name, args) {
  if (!isSupabaseConfigured()) throw unavailable("Supabase no está configurado");
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
