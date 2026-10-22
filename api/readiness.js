import { createLogger } from "./_logger.mjs";
import { pingSupabase } from "./_supabase.mjs";

// Listo = las dependencias con estado responden. Hoy solo Supabase (dedup del faucet y
// mapping/liquidación del on-ramp). El workflow `supabase-keepalive` llama aquí cada 6 h
// para que el proyecto Free de Supabase no se pause por inactividad.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let supabase;
  try {
    supabase = await pingSupabase();
  } catch (error) {
    createLogger(req).error("readiness.supabase_error", { err: error.message, status: error.status });
    supabase = "error";
  }
  const ready = supabase !== "error";

  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    endpoint: '/api/readiness',
    timestamp: new Date().toISOString(),
    checks: { supabase },
  });
}
