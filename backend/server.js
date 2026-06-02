const express = require("express");
const cors = require("cors");
require("dotenv").config();
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

app.get('/api/health', (req, res) => {
  return res.status(200).json({
    status: 'ok',
    endpoint: '/api/health'
  });
});

app.get('/api/readiness', (req, res) => {
  return res.status(200).json({
    status: 'ready',
    endpoint: '/api/readiness'
  });
});

const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org"; // <-- Añadido Horizon
const server = new rpc.Server(RPC_URL);

// Simple store en memoria de nonces (dev)
const nonces = new Map();
function generateNonce() {
  return require('crypto').randomBytes(16).toString('hex');
}

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

// Umbral mínimo de transacciones para testnet (ajustable)
const MIN_TX_REQUIRED = 3;

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

    // 3. Limitamos a los últimos movimientos necesarios
    transactionDates = transactionDates.slice(0, MIN_TX_REQUIRED);

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
    if (!process.env.SECRET_KEY_ADMIN) {
      const msg = 'Missing SECRET_KEY_ADMIN env var';
      console.error('[DEBUG] 💥 Error Mint:', msg);
      return { success: false, error: msg };
    }
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
    console.error(`[DEBUG] 💥 Error Mint:`, error);
    return { success: false, error: error.message || String(error) };
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
  // Añadimos información de elegibilidad para la UI (ProgressRing)
  const eligibility = {
    minHistoryRequired: MIN_TX_REQUIRED,
    historyCount: depositsHistory.length,
    isHistoryEligible: depositsHistory.length >= MIN_TX_REQUIRED,
    remainingForUnlock: Math.max(0, MIN_TX_REQUIRED - depositsHistory.length)
  };

  const response = {
    ...result,
    eligibility,
    metrics: {
      weightedMean: wMean,
      mad,
      depositsCount: depositsHistory.length
    }
  };

  res.json(response);
});

// ─────────────────────────────────────────────
// ENDPOINT: NONCE (DEV) — para evitar 404 desde frontend en dev
// ─────────────────────────────────────────────
app.post('/api/nonce', (req, res) => {
  const { address } = req.body || {};
  if (!address) return res.status(400).json({ error: 'address required' });
  const nonce = generateNonce();
  const expires = Date.now() + 5 * 60 * 1000; // 5 minutos
  nonces.set(address, { nonce, expires });
  return res.json({ success: true, nonce, expires });
});

function consumeNonce(address, nonce) {
  const entry = nonces.get(address);
  if (!entry) return false;
  if (entry.expires < Date.now()) {
    nonces.delete(address);
    return false;
  }
  if (entry.nonce !== nonce) return false;
  nonces.delete(address);
  return true;
}

// ─────────────────────────────────────────────
// ENDPOINT: EVALUATE AND MINT (DEV)
// ─────────────────────────────────────────────
app.post('/api/evaluate-and-mint', async (req, res) => {
  try {
    console.log('[DEBUG] /api/evaluate-and-mint body:', req.body);
    const { address: maybeAddress, userAddress, signedTxXdr, nonce } = req.body || {};
    const address = maybeAddress || userAddress;
    if (!address) return res.status(400).json({ error: 'address required' });

    // Verify nonce
    if (!consumeNonce(address, nonce)) {
      return res.status(400).json({ success: false, error: 'Invalid or expired nonce' });
    }

    // Compute eligibility using on-chain history. Prefer client-supplied totalVolume for matching score calc.
    const totalVolume = Number(req.body.totalVolume) || 0;
    const depositsHistory = await getUserBlockchainHistory(address, totalVolume);
    const isHistoryEligible = depositsHistory.length >= MIN_TX_REQUIRED;

    if (!isHistoryEligible) {
      return res.json({ success: false, error: 'Not eligible by history', eligibility: { minHistoryRequired: MIN_TX_REQUIRED, historyCount: depositsHistory.length } });
    }

    // Compute tier and mint
    const wMean = weightedMean(depositsHistory);
    const mad = meanAbsoluteDeviation(depositsHistory);
    console.log('[DEBUG] Computed wMean/mad/len for evaluate-and-mint:', { wMean, mad, len: depositsHistory.length });
    const { tier, tierName } = computeScoreAndTier(wMean, mad, depositsHistory.length);

    // Check current on-chain tier to avoid panics in the contract (same-level mint)
    try {
      if (!process.env.SECRET_KEY_ADMIN) {
        console.warn('[DEBUG] SECRET_KEY_ADMIN not set; skipping on-chain tier check');
      } else {
        const adminKeypair = Keypair.fromSecret(process.env.SECRET_KEY_ADMIN);
        const sourceAccount = await server.getAccount(adminKeypair.publicKey());
        const checkTx = new TransactionBuilder(sourceAccount, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
          .addOperation(
            Operation.invokeContractFunction({
              contract: process.env.NFT_CONTRACT_ID,
              function: 'get_tier',
              args: [nativeToScVal(address, { type: 'address' })]
            })
          )
          .setTimeout(30)
          .build();

        const sim = await server.simulateTransaction(checkTx);
        let currentTier = 0;
        if (sim.result && sim.result.retval) {
          currentTier = Number(scValToNative(sim.result.retval)) || 0;
        }

        if (currentTier === tier) {
          return res.status(400).json({ success: false, message: 'Usuario ya posee este nivel exacto', tier: currentTier, tierName });
        }
      }
    } catch (err) {
      console.warn('[DEBUG] Could not read current on-chain tier:', err && err.message || err);
      // proceed — we still try to mint, but the mint may fail with the contract panic which will be handled below
    }

    const mintRes = await mintNftOnChain(address, tier);
    if (!mintRes.success) {
      console.error('[DEBUG] mintNftOnChain failed:', mintRes);
      return res.status(500).json({ success: false, error: mintRes.error });
    }

    return res.json({ status: 'minted', txHash: mintRes.hash, tier, tierName });
  } catch (error) {
    console.error('[DEBUG] 💥 Error en /evaluate-and-mint:', error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
});
// Inicia servidor
app.listen(PORT, '0.0.0.0', () => { 
  console.log(`\n🚀 SERVIDOR VÍNCULO ACTIVO EN PUERTO ${PORT}`);
});