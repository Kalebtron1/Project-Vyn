// CORS con lista permitida (#94). La app llama a la API desde su mismo dominio, que no
// necesita CORS; esto solo decide qué OTROS orígenes pueden llamarla desde un navegador.
// Con la cookie de sesión, el origen tiene que ser explícito: `*` con credenciales no sirve.
// CORS no protege contra `curl`: eso lo hace la sesión.
//
// Permitidos: ALLOWED_ORIGINS (separados por coma), los dominios del propio despliegue en
// Vercel y, fuera de producción, localhost en cualquier puerto.

const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function allowedOrigins() {
  const list = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  for (const host of [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]) {
    if (host) list.push(`https://${host}`);
  }
  return list;
}

export function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (allowedOrigins().includes(origin)) return true;
  return process.env.VERCEL_ENV !== "production" && LOCALHOST.test(origin);
}

/**
 * Pone los encabezados CORS si el origen está permitido. Responde el preflight (`OPTIONS`)
 * y devuelve true en ese caso, para que el handler termine ahí.
 */
export function applyCors(req, res, methods = "POST, OPTIONS") {
  res.setHeader("Vary", "Origin");
  const origin = req.headers?.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", methods);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}
