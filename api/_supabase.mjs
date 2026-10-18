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

// ── Faucet de USDC: una sola vez por wallet + rate limit diario ─────────────
const faucetMemory = new Set(); // wallets que ya reclamaron
const faucetClaimsLog = []; // [{ walletAddress, ip, ts }]

const DAY_MS = 24 * 60 * 60 * 1000;

function pruneClaimsLog(now = Date.now()) {
  const cutoff = now - DAY_MS;
  while (faucetClaimsLog.length > 0 && faucetClaimsLog[0].ts < cutoff) {
    faucetClaimsLog.shift();
  }
}

export function resetFaucetMemoryForTests() {
  faucetMemory.clear();
  faucetClaimsLog.length = 0;
}

/** ¿Esta wallet ya reclamó el faucet de USDC? (Fail-closed si Supabase falla). */
export async function hasClaimedFaucet(walletAddress) {
  if (faucetMemory.has(walletAddress)) return true;
  if (!isSupabaseConfigured()) return false;
  const rows = await sbFetch(
    `faucet_claims?wallet_address=eq.${encodeURIComponent(walletAddress)}&select=wallet_address&limit=1`
  );
  if (Array.isArray(rows) && rows.length > 0) {
    faucetMemory.add(walletAddress);
    return true;
  }
  return false;
}

/**
 * Verifica límites diarios por IP y global en las últimas 24h.
 * Devuelve { allowed: true } o { allowed: false, scope: "ip" | "global" }.
 */
export async function checkFaucetRateLimit({
  ip = "unknown",
  ipDailyLimit = 3,
  globalDailyLimit = 50,
  now = Date.now(),
} = {}) {
  pruneClaimsLog(now);
  const normalizedIp = String(ip || "unknown").trim() || "unknown";

  const memGlobalCount = faucetClaimsLog.length;
  const memIpCount = faucetClaimsLog.filter((c) => c.ip === normalizedIp).length;

  if (memIpCount >= ipDailyLimit) {
    return { allowed: false, scope: "ip" };
  }
  if (memGlobalCount >= globalDailyLimit) {
    return { allowed: false, scope: "global" };
  }

  if (!isSupabaseConfigured()) {
    return { allowed: true };
  }

  const sinceIso = new Date(now - DAY_MS).toISOString();
  const rows = await sbFetch(
    `faucet_claims?created_at=gte.${encodeURIComponent(sinceIso)}&select=wallet_address,ip_address,created_at`
  );
  if (Array.isArray(rows)) {
    if (rows.length >= globalDailyLimit) {
      return { allowed: false, scope: "global" };
    }
    const ipCount = rows.filter((r) => r.ip_address === normalizedIp).length;
    if (ipCount >= ipDailyLimit) {
      return { allowed: false, scope: "ip" };
    }
  }
  return { allowed: true };
}

/** Registra que esta wallet reclamó el faucet (idempotente). */
export async function recordFaucetClaim(walletAddress, { ip = "unknown", now = Date.now() } = {}) {
  const normalizedIp = String(ip || "unknown").trim() || "unknown";
  faucetMemory.add(walletAddress);
  pruneClaimsLog(now);
  faucetClaimsLog.push({ walletAddress, ip: normalizedIp, ts: now });

  if (!isSupabaseConfigured()) {
    return;
  }
  await sbFetch(`faucet_claims?on_conflict=wallet_address`, {
    method: "POST",
    body: [{ wallet_address: walletAddress, ip_address: normalizedIp }],
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
