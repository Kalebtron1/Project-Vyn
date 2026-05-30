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
