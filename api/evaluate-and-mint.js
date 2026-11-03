import {
  Keypair,
  rpc,
  TransactionBuilder,
  Networks,
  Operation,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";
import { applyCors } from "./_cors.mjs";
import { createLogger } from "./_logger.mjs";
import { computeFinancialReputation, getOnChainAggregates, isScoreAnomalous } from "./_scoring-core.mjs";
import { requireSessionFor } from "./_session.mjs";
import { validateBody, evaluateAndMintBodySchema, reportValidationError } from "./validation.mjs";

// El mint encadena el score (RPC Soroban) + prepare + polling de confirmación;
// el default de 10 s del plan hobby lo cortaba (504 → front colgado). 60 s es el máx en hobby.
export const config = { maxDuration: 60 };

const RPC_URL = "https://soroban-testnet.stellar.org";
const server = new rpc.Server(RPC_URL);
// staking_pool respaldado por DeFindex. Se configura vía STAKING_CONTRACT_ID
// (sin fallback hardcodeado; debe definirse en el entorno tras cada redeploy).
const STAKING_CONTRACT_ID = process.env.STAKING_CONTRACT_ID;

// Mismo cálculo que /api/calculate-score, en proceso: sin depender de los encabezados
// Host ni de una segunda llamada HTTP.
async function resolveTier(log, userAddress) {
  const aggregates = await getOnChainAggregates(userAddress, { contractId: STAKING_CONTRACT_ID });
  const result = computeFinancialReputation(aggregates);
  const anomaly = isScoreAnomalous(result);
  log.info("evaluate_and_mint.score_resolved", {
    userAddress,
    tier: result.tier,
    tierName: result.tierName,
    score: result.score,
    anomaly,
  });
  if (anomaly) log.warn("evaluate_and_mint.anomaly_flagged", { userAddress, tier: result.tier, score: result.score });
  return { tier: result.tier, tierName: result.tierName, anomaly };
}

async function mintNftOnChain(log, userAddress, tier) {
  try {
    const adminKeypair = Keypair.fromSecret(process.env.SECRET_KEY_ADMIN);
    const account = await server.getAccount(adminKeypair.publicKey());
    
    let transaction = new TransactionBuilder(account, { 
        fee: BASE_FEE, 
        networkPassphrase: Networks.TESTNET 
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: process.env.NFT_CONTRACT_ID,
          function: "mint", 
          args: [
            nativeToScVal(adminKeypair.publicKey(), { type: "address" }), 
            nativeToScVal(userAddress, { type: "address" }), 
            nativeToScVal(tier, { type: "u32" })                
          ],
        })
      )
      .setTimeout(30).build();

    transaction = await server.prepareTransaction(transaction);
    transaction.sign(adminKeypair);

    const submitRes = await server.sendTransaction(transaction);

    // sendTransaction solo ENCOLA la tx; un status ERROR aquí es rechazo inmediato
    // (p. ej. fee insuficiente o tx mal formada). No es éxito.
    if (submitRes.status === "ERROR") {
      const reason = submitRes.errorResult
        ? JSON.stringify(submitRes.errorResult)
        : "sendTransaction devolvió ERROR";
      log.error("evaluate_and_mint.send_rejected", { userAddress, tier, txHash: submitRes.hash, reason });
      return { success: false, hash: submitRes.hash, error: `La red rechazó el mint: ${reason}` };
    }

    // Confirmamos el resultado real on-chain con polling (antes se devolvía success:true
    // a ciegas y una tx que fallaba al aplicarse dejaba la UI "minteada" sin SBT real).
    const hash = submitRes.hash;
    let getRes = await server.getTransaction(hash);
    const deadline = Date.now() + 45000; // por debajo del maxDuration de la función
    while (getRes.status === rpc.Api.GetTransactionStatus.NOT_FOUND && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      getRes = await server.getTransaction(hash);
    }

    if (getRes.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      log.info("evaluate_and_mint.minted", { userAddress, tier, txHash: hash });
      return { success: true, hash };
    }

    if (getRes.status === rpc.Api.GetTransactionStatus.FAILED) {
      log.error("evaluate_and_mint.mint_reverted", { userAddress, tier, txHash: hash });
      return { success: false, hash, error: "La transacción de mint falló al aplicarse en la red" };
    }

    log.warn("evaluate_and_mint.mint_unconfirmed", { userAddress, tier, txHash: hash, status: getRes.status });
    return { success: false, hash, error: "No se pudo confirmar la transacción de mint a tiempo" };

  } catch (error) {
    log.error("evaluate_and_mint.mint_failed", { userAddress, tier, err: error.message });
    return { success: false, error: error.message };
  }
}

export default async function handler(req, res) {
  const log = createLogger(req);

  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let userAddress;
  try {
    ({ userAddress } = validateBody(evaluateAndMintBodySchema, req.body || {}));
  } catch (error) {
    return reportValidationError(res, error);
  }

  // El admin firma y paga cada mint: solo se actúa para la wallet que probó ser dueña (#89).
  if (!requireSessionFor(req, res, userAddress)) {
    log.info("evaluate_and_mint.unauthorized", { userAddress, status: res.statusCode });
    return;
  }

  if (!STAKING_CONTRACT_ID) {
    log.error("evaluate_and_mint.misconfigured", { reason: "STAKING_CONTRACT_ID no configurado" });
    return res.status(500).json({ error: "Falta la variable de entorno STAKING_CONTRACT_ID" });
  }

  log.info("evaluate_and_mint.start", { userAddress });

  const t0 = Date.now();
  let tier;
  let tierName;
  let anomaly = false;
  try {
    const tierResult = await resolveTier(log, userAddress);
    tier = tierResult.tier;
    tierName = tierResult.tierName;
    anomaly = tierResult.anomaly || false;
  } catch (scoreError) {
    log.error("evaluate_and_mint.score_error", { userAddress, err: scoreError?.message });
    const latencyMs = Date.now() - t0;
    // METRIC: evaluate-and-mint score resolution failure
    console.log(`[metric] evaluate-and-mint latency=${latencyMs}ms score_error="${scoreError?.message}"`);
    return res.status(500).json({
      status: "error",
      message: scoreError?.message || "No se pudo validar el nivel para mintear",
    });
  }

  if (anomaly) {
    return res.status(422).json({
      status: "anomaly",
      tier,
      tierName,
      message: "Score anómalo detectado. Minting bloqueado para revisión.",
    });
  }

  if (tier >= 1) {
    const mintResult = await mintNftOnChain(log, userAddress, tier);
    const latencyMs = Date.now() - t0;
    if (mintResult.success) {
      // METRIC: successful mint conversion
      console.log(`[metric] evaluate-and-mint latency=${latencyMs}ms tier=${tier} status=minted`);
      return res.json({ txHash: mintResult.hash, tier, tierName, status: "minted" });
    }
    // METRIC: mint transaction failure
    console.log(`[metric] evaluate-and-mint latency=${latencyMs}ms tier=${tier} status=tx_failed error="${mintResult.error}"`);
    return res.status(500).json({
      status: "error",
      tier,
      tierName,
      message: mintResult.error || "No se pudo mintear el NFT",
    });
  }

  log.info("evaluate_and_mint.insufficient_tier", { userAddress, tier, tierName });
  const latencyMs = Date.now() - t0;
  // METRIC: user below minimum tier (no conversion)
  console.log(`[metric] evaluate-and-mint latency=${latencyMs}ms tier=${tier} status=pending`);
  return res.json({
    message: "Nivel insuficiente",
    tier,
    tierName,
    status: "pending",
  });
}
