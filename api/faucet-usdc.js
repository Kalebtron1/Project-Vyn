// POST /api/faucet-usdc — envía una pequeña cantidad de USDC (testnet) a la wallet del
// usuario para que pueda probar un depósito. Body: { address }. Requiere trustline USDC.
import { sendFaucetUsdc } from "./_faucet-core.mjs";
import { createLogger } from "./_logger.mjs";

export default async function handler(req, res) {
  const log = createLogger(req);
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }
  const address = req.body && req.body.address;
  if (!address || !/^G[A-Z2-7]{55}$/.test(String(address))) {
    return res.status(400).json({ error: "address inválida (dirección Stellar G…)" });
  }
  try {
    const result = await sendFaucetUsdc({ to: address });
    log.info("faucet_usdc.done", { address, ...result });
    return res.status(200).json(result);
  } catch (error) {
    log.error("faucet_usdc.error", { err: error.message });
    return res.status(502).json({ error: error.message || "Error enviando USDC" });
  }
}
