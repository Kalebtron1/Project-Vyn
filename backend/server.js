const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { processScheduledPayments } = require("./jobs/processScheduledPayments");
const { 
  Keypair, 
  rpc, 
  TransactionBuilder, 
  Networks, 
  Operation, 
  BASE_FEE, 
  nativeToScVal, 
  scValToNative 
} = require("@stellar/stellar-sdk");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org"; // <-- Añadido Horizon
const server = new rpc.Server(RPC_URL);

// ─────────────────────────────────────────────
// CONFIGURACIÓN DE CRÉDITO
// ─────────────────────────────────────────────
const CREDIT_LIMITS = {
  0: { name: "Bronce", amount: 0 },
  1: { name: "Plata", amount: 300 },
  2: { name: "Oro", amount: 600 },
  3: { name: "Diamante", amount: 1500 },
  4: { name: "Platino", amount: 5000 }
};

// ─────────────────────────────────────────────
// HELPERS MATEMÁTICOS (Tu Motor de Riesgo)
// ─────────────────────────────────────────────
function weightedMean(deposits = []) {
  if (!deposits || deposits.length === 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const { amount, daysAgo } of deposits) {
    const weight = 1 / (daysAgo + 1);
    weightedSum += (amount || 0) * weight;
    totalWeight += weight;
  }
  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}

function meanAbsoluteDeviation(deposits = []) {
  if (!deposits || deposits.length === 0) return 0;
  const amounts = deposits.map((d) => d.amount || 0);
  const mean = amounts.reduce((acc, v) => acc + v, 0) / amounts.length;
  return amounts.reduce((acc, v) => acc + Math.abs(v - mean), 0) / amounts.length;
}

function computeScoreAndTier(wMean, mad, n) {
  let score = 0;
  if (wMean > 0 && mad <= wMean) {
    score = (wMean * (1 - mad / wMean)) * Math.log(n + 1);
  }

  let tier = 0;
  let tierName = "Bronce";

  if (score >= 1000) { tier = 4; tierName = "Platino"; } 
  else if (score >= 500) { tier = 3; tierName = "Diamante"; } 
  else if (score >= 150) { tier = 2; tierName = "Oro"; } 
  else if (score >= 50) { tier = 1; tierName = "Plata"; }

  return { score: parseFloat(score.toFixed(4)), tier, tierName };
}

// ─────────────────────────────────────────────
// NUEVO: LECTOR DE HISTORIAL BLOCKCHAIN (HORIZON) ⏱️
// ─────────────────────────────────────────────
async function getUserBlockchainHistory(userAddress, totalBalance) {
  try {
    console.log(`[DEBUG] ⏳ Buscando historial en Horizon para: ${userAddress}`);
    
    // 1. Consultamos las últimas 100 operaciones del usuario
    const response = await fetch(`${HORIZON_URL}/accounts/${userAddress}/operations?limit=100&order=desc`);
    
    if (!response.ok) throw new Error("No se pudo leer la API de Horizon");
    
    const data = await response.json();
    let transactionDates = [];

    // 2. Filtramos interacciones con Smart Contracts (invoke_host_function)
    data._embedded.records.forEach(op => {
      if (op.type === 'invoke_host_function' && op.transaction_successful) {
         transactionDates.push(new Date(op.created_at));
      }
    });

    // 3. Limitamos a los últimos 30 movimientos
    transactionDates = transactionDates.slice(0, 30);

    // Fallback: Si no hay historial pero hay saldo (ej. fondeo directo sin contrato)
    if (transactionDates.length === 0) {
      console.log(`[DEBUG] ⚠️ No hay interacciones de contrato. Usando saldo base.`);
      return [{ amount: totalBalance, daysAgo: 0 }];
    }

    // 4. Construimos el array para la matemática
    const averageAmount = totalBalance / transactionDates.length;
    const now = new Date();

    const deposits = transactionDates.map(date => {
      const diffTime = Math.abs(now - date);
      const daysAgo = Math.floor(diffTime / (1000 * 60 * 60 * 24)); // Ms a Días
      
      return {
        amount: averageAmount,
        daysAgo: daysAgo
      };
    });

    console.log(`[DEBUG] 📊 Se generaron ${deposits.length} registros desde Horizon.`);
    return deposits;

  } catch (error) {
    console.error(`[DEBUG] 💥 Error en Horizon:`, error.message);
    return [{ amount: totalBalance, daysAgo: 0 }];
  }
}

// ─────────────────────────────────────────────
// ENDPOINT: CONSULTAR TIER Y CRÉDITO 🔗
// ─────────────────────────────────────────────
app.post("/api/get-available-credit", async (req, res) => {
  const { userAddress } = req.body;
  if (!userAddress) return res.status(400).json({ error: "Falta wallet" });

  try {
    console.log(`[DEBUG] 🔍 Consultando Tier para: ${userAddress}`);

    const adminKeypair = Keypair.fromSecret(process.env.SECRET_KEY_ADMIN);
    const sourceAccount = await server.getAccount(adminKeypair.publicKey());

    const tx = new TransactionBuilder(sourceAccount, { 
      fee: BASE_FEE, 
      networkPassphrase: Networks.TESTNET 
    })
    .addOperation(
      Operation.invokeContractFunction({
        contract: process.env.NFT_CONTRACT_ID,
        function: "get_tier",
        args: [nativeToScVal(userAddress, { type: "address" })]
      })
    )
    .setTimeout(30)
    .build();

    const simulation = await server.simulateTransaction(tx);

    let finalTier = 0;
    if (simulation.result && simulation.result.retval) {
      finalTier = Number(scValToNative(simulation.result.retval)) || 0;
    }

    const config = CREDIT_LIMITS[finalTier] || CREDIT_LIMITS[0];
    
    return res.json({
      success: true,
      tier: finalTier,
      tierName: config.name,
      availableCredit: config.amount,
      currency: "XLM"
    });

  } catch (error) {
    console.error(`[DEBUG] 💥 Error en /get-available-credit:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// FUNCIÓN PARA MINTEAR NFT 🚀
// ─────────────────────────────────────────────
async function mintNftOnChain(userAddress, tier) {
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
    return { success: true, hash: submitRes.hash };

  } catch (error) {
    console.error(`[DEBUG] 💥 Error Mint:`, error.message);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────
// ENDPOINT: CALCULAR SCORE DE RIESGO 🧮
// ─────────────────────────────────────────────
app.post("/api/calculate-score", async (req, res) => {
  const { address, totalDeposited } = req.body;
  
  if (!address) return res.status(400).json({ error: "Falta wallet" });

  // 1. Obtenemos el historial real desde Horizon
  const depositsHistory = await getUserBlockchainHistory(address, Number(totalDeposited) || 0);

  // 2. Calculamos las métricas
  const wMean = weightedMean(depositsHistory);
  const mad = meanAbsoluteDeviation(depositsHistory);
  const result = computeScoreAndTier(wMean, mad, depositsHistory.length);
  
  res.json(result);
});

// ─────────────────────────────────────────────
// ENDPOINT: EVALUAR Y MINTEAR 🏅
// ─────────────────────────────────────────────
app.post('/api/evaluate-and-mint', async (req, res) => {
  const { userAddress, totalVolume } = req.body;
  
  if (!userAddress) return res.status(400).json({ error: "Falta wallet" });

  // 1. Validamos usando datos reales de la blockchain antes de permitir mintear
  const depositsHistory = await getUserBlockchainHistory(userAddress, Number(totalVolume) || 0);
  const wMean = weightedMean(depositsHistory);
  const mad = meanAbsoluteDeviation(depositsHistory);
  
  // 2. Extraemos el Nivel que las matemáticas dictan que merece
  const { tier } = computeScoreAndTier(wMean, mad, depositsHistory.length);
  
  if (tier >= 1) {
    console.log(`[DEBUG] 🚀 Autorizando minteo Nivel ${tier} para ${userAddress}`);
    const mintResult = await mintNftOnChain(userAddress, tier);
    
    if (mintResult.success) {
      return res.json({ txHash: mintResult.hash, status: "minted" });
    } else {
      return res.status(500).json({ message: "Error firmando transacción en Soroban", status: "failed" });
    }
  }
  
  res.json({ message: "Reputación insuficiente para este nivel", status: "pending" });
});

app.listen(PORT, '0.0.0.0', () => { 
  console.log(`\n🚀 SERVIDOR VÍNCULO ACTIVO EN PUERTO ${PORT}`);
});

// ─────────────────────────────────────────────
// SCHEDULED PAYMENTS JOB
// Runs every 60 seconds. The job is idempotent and safe to run concurrently
// because it uses an optimistic 'processing' lock on each row.
// ─────────────────────────────────────────────
const PAYMENT_JOB_INTERVAL_MS = 60_000;

(async () => {
  // Run once immediately on startup, then on the interval.
  await processScheduledPayments();
  setInterval(processScheduledPayments, PAYMENT_JOB_INTERVAL_MS);
  console.log(`[scheduler] Payment job registered — running every ${PAYMENT_JOB_INTERVAL_MS / 1000}s`);
})();