import { randomUUID } from "crypto";

/**
 * Minimal structured logger for Vercel serverless functions.
 * Outputs newline-delimited JSON so log aggregators can parse fields directly.
 * In local dev the output is still readable via `JSON.parse` or `jq`.
 */

function write(level, reqId, event, data) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    reqId,
    event,
    ...data,
  };
  // Use process.stderr for errors so they surface in Vercel's error stream.
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(JSON.stringify(entry) + "\n");
}

export function createLogger(req) {
  // Honour any upstream request-id header (e.g. from Vercel's edge layer).
  const reqId =
    req?.headers?.["x-request-id"] ||
    req?.headers?.["x-vercel-id"] ||
    randomUUID();

  return {
    reqId,
    info: (event, data = {}) => write("info", reqId, event, data),
    warn: (event, data = {}) => write("warn", reqId, event, data),
    error: (event, data = {}) => write("error", reqId, event, data),
  };
}

/**
 * Checks whether a request Origin header is permitted by ALLOWED_ORIGINS
 * (or localhost in non-production environments).
 */
export function isOriginAllowed(origin, env = process.env) {
  if (!origin || typeof origin !== "string") return false;
  const normalized = origin.trim().replace(/\/+$/, "");
  if (!normalized || normalized === "*") return false;

  const configured = String(env?.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  if (configured.includes(normalized)) {
    return true;
  }

  if (env?.VERCEL_URL) {
    const vercelOrigin = `https://${String(env.VERCEL_URL).trim().replace(/\/+$/, "")}`;
    if (normalized === vercelOrigin) return true;
  }

  const isProd = env?.NODE_ENV === "production";
  if (!isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)) {
    return true;
  }

  return false;
}

/**
 * Applies strict CORS headers for configured origins and handles OPTIONS preflight.
 * Returns true if the request was an OPTIONS preflight and has been ended.
 */
export function applyCors(
  req,
  res,
  {
    methods = "POST,OPTIONS",
    headers = "Content-Type, X-Requested-With, Accept",
    env = process.env,
  } = {}
) {
  const origin = req?.headers?.origin;
  res.setHeader("Vary", "Origin");

  if (origin && isOriginAllowed(origin, env)) {
    res.setHeader("Access-Control-Allow-Origin", origin.trim().replace(/\/+$/, ""));
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", methods);
    res.setHeader("Access-Control-Allow-Headers", headers);
  }

  if (req?.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}

