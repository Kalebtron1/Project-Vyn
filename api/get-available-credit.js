import { Account, rpc, TransactionBuilder, Networks, Operation, BASE_FEE, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { applyCors } from "./_cors.mjs";
import { createLogger } from "./_logger.mjs";
import { validateBody, getAvailableCreditBodySchema, reportValidationError } from "./validation.mjs";

const CREDIT_LIMITS = {
  0: { name: "Bronce", amount: 0 },
  1: { name: "Plata", amount: 300 },
  2: { name: "Oro", amount: 600 },
  3: { name: "Diamante", amount: 1500 },
  4: { name: "Platino", amount: 5000 }
};

const RPC_URL = "https://soroban-testnet.stellar.org";

// Lee el tier del SBT simulando `get_tier`. Una simulación no se firma ni se envía, así que
// no necesita la llave admin: basta con la cuenta del propio usuario como origen.
async function readTier(userAddress) {
  const server = new rpc.Server(RPC_URL);
  const contractId = process.env.NFT_CONTRACT_ID;
  if (!contractId) throw new Error("Falta la variable de entorno NFT_CONTRACT_ID");

  let source;
  try {
    source = await server.getAccount(userAddress);
  } catch {
    // Cuenta sin fondear: la simulación no necesita su secuencia real.
    source = new Account(userAddress, "0");
  }

  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        function: "get_tier",
        args: [nativeToScVal(userAddress, { type: "address" })]
      })
    )
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new Error(simulation.error || "La simulación de get_tier falló");
  }
  return simulation.result?.retval ? Number(scValToNative(simulation.result.retval)) || 0 : 0;
}

export default async function handler(req, res) {
  const log = createLogger(req);

  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let userAddress;

  try {
    const validated = validateBody(getAvailableCreditBodySchema, req.body || {});
    userAddress = validated.userAddress;
  } catch (error) {
    return reportValidationError(res, error);
  }

  log.info("get_available_credit.start", { userAddress });

  const t0 = Date.now();
  try {
    const finalTier = await readTier(userAddress);
    const config = CREDIT_LIMITS[finalTier] || CREDIT_LIMITS[0];

    log.info("get_available_credit.done", {
      userAddress,
      tier: finalTier,
      tierName: config.name,
      availableCredit: config.amount,
    });
    const latencyMs = Date.now() - t0;
    // METRIC: get-available-credit latency and resolved tier
    console.log(`[metric] get-available-credit latency=${latencyMs}ms tier=${finalTier} credit=${config.amount}XLM`);

    return res.status(200).json({
      success: true,
      tier: finalTier,
      tierName: config.name,
      availableCredit: config.amount,
      currency: "XLM"
    });

  } catch (error) {
    log.error("get_available_credit.error", { userAddress, err: error.message });
    const latencyMs = Date.now() - t0;
    // METRIC: get-available-credit contract simulation failure
    console.log(`[metric] get-available-credit latency=${latencyMs}ms error="${error.message}"`);
    // Una caída no debe parecer "sin crédito" (#96): el cliente ve un error, no tier 0.
    return res.status(502).json({ error: "No se pudo leer el nivel on-chain" });
  }
}
