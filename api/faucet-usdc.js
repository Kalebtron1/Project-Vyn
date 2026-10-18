// POST /api/faucet-usdc — envía una pequeña cantidad de USDC (testnet) a la wallet del
// usuario para que pueda probar un depósito. Body: { address }. Requiere trustline USDC.
import { sendFaucetUsdc } from "./_faucet-core.mjs";
import { createLogger } from "./_logger.mjs";

function extractClientIp(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).trim();
  }
  return req?.socket?.remoteAddress || "unknown";
}

const REASON_MESSAGES = {
  already_claimed: "Esta wallet ya recibió USDC de prueba anteriormente.",
  no_trustline: "Debes activar la línea de confianza (trustline) de USDC primero.",
  rate_limited: "Se alcanzó el límite diario de solicitudes del faucet. Intenta mañana.",
  dedup_unavailable: "El servicio de verificación del faucet no está disponible temporalmente.",
};

export default async function handler(req, res) {
  const log = createLogger(req);
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }
  const address = req.body && req.body.address;
  if (!address || !/^G[A-Z2-7]{55}$/.test(String(address))) {
    return res.status(400).json({ error: "address inválida (dirección Stellar G…)" });
  }

  const ip = extractClientIp(req);

  try {
    const result = await sendFaucetUsdc({ to: address, ip });
    const { statusCode = 200, ...payload } = result;

    if (!result.sent) {
      const message = REASON_MESSAGES[result.reason] || result.error || "Solicitud rechazada";
      log.warn("faucet_usdc.rejected", {
        address,
        ip,
        reason: result.reason,
        limitScope: result.limitScope,
      });
      return res.status(statusCode).json({
        ...payload,
        message,
        ...(statusCode >= 400 ? { error: message } : {}),
      });
    }

    log.info("faucet_usdc.done", { address, ip, ...payload });
    return res.status(200).json(payload);
  } catch (error) {
    log.error("faucet_usdc.error", { address, ip, err: error.message });
    return res.status(502).json({ error: error.message || "Error enviando USDC" });
  }
}
