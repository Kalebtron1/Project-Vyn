import { 
  Keypair, 
  rpc, 
  TransactionBuilder, 
  Networks, 
  Operation, 
  BASE_FEE, 
  nativeToScVal,
} from "@stellar/stellar-sdk";
import dotenv from "dotenv";
import { createLogger } from "./_logger.js";
import { validateBody, evaluateAndMintBodySchema, reportValidationError } from "./validation.js";

dotenv.config();

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const RPC_URL = "https://soroban-testnet.stellar.org";
const server = new rpc.Server(RPC_URL);

function tierNameFromValue(tier) {
  if (tier === 4) return "Platino";
  if (tier === 3) return "Diamante";
  if (tier === 2) return "Oro";
  if (tier === 1) return "Plata";
  return "Bronce";
}

async function resolveTierFromCanonicalScore(req, log, userAddress, totalVolume) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";

  if (!host) {
    throw new Error("No se pudo resolver host para validar score");
  }

  log.info("evaluate_and_mint.score_request", { userAddress, totalVolume, host });

  const scoreResponse = await fetch(`${proto}://${host}/api/calculate-score`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Propagate request-id so the inner call shares the same trace.
      "x-request-id": log.reqId,
    },
    body: JSON.stringify({
      address: userAddress,
      totalDeposited: Number(totalVolume) || 0,
    }),
  });

  if (!scoreResponse.ok) {
    throw new Error("No se pudo validar score para mintear");
  }

  const scoreData = await scoreResponse.json();
  const tier = Number(scoreData?.tier) || 0;
  const tierName = scoreData?.tierName || tierNameFromValue(tier);

  log.info("evaluate_and_mint.score_resolved", { userAddress, tier, tierName, score: scoreData?.score });

  return { tier, tierName };
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
    log.info("evaluate_and_mint.minted", { userAddress, tier, txHash: submitRes.hash });
    return { success: true, hash: submitRes.hash };

  } catch (error) {
    log.error("evaluate_and_mint.mint_failed", { userAddress, tier, err: error.message });
    return { success: false, error: error.message };
  }
}

export default async function handler(req, res) {
  const log = createLogger(req);

  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let userAddress;
  let deposits;
  let totalVolume;

  try {
    const validated = validateBody(evaluateAndMintBodySchema, req.body || {});
    userAddress = validated.userAddress;
    deposits = validated.deposits;
    totalVolume = validated.totalVolume;
  } catch (error) {
    return reportValidationError(res, error);
  }

  log.info("evaluate_and_mint.start", { userAddress });

  const fallbackVolumeFromDeposits = Array.isArray(deposits)
    ? deposits.reduce((acc, d) => acc + (Number(d?.amount) || 0), 0)
    : 0;

  let effectiveTotalVolume = Number(totalVolume) || fallbackVolumeFromDeposits;

  if (!effectiveTotalVolume || effectiveTotalVolume <= 0) {
    try {
      const resp = await fetch(`${HORIZON_URL}/accounts/${userAddress}`);
      if (resp.ok) {
        const acct = await resp.json();
        const native = (acct.balances || []).find(b => b.asset_type === 'native');
        effectiveTotalVolume = Number(native?.balance) || effectiveTotalVolume;
      }
    } catch (e) {
      log.warn("evaluate_and_mint.balance_fetch_failed", { userAddress, err: e.message });
    }
  }

  const t0 = Date.now();
  let tier;
  let tierName;
  try {
    const tierResult = await resolveTierFromCanonicalScore(req, log, userAddress, effectiveTotalVolume);
    tier = tierResult.tier;
    tierName = tierResult.tierName;
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
