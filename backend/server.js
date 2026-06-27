const path = require("path");
const express = require("express");
const cors = require("cors");
// El frontend (Vite) lee .env.local; el server Express debe leer EL MISMO archivo o
// quedaría con un STAKING_CONTRACT_ID distinto (o sin él) y mostraría historial de
// otro contrato. Resolvemos las rutas vía __dirname para no depender del cwd desde el
// que se lanza `node backend/server.js`. dotenv NO sobreescribe claves ya definidas,
// así que .env.local tiene prioridad sobre .env.
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
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
// staking_pool (DeFindex). Debe coincidir con VITE_STAKING_CONTRACT_ID del frontend.
const STAKING_CONTRACT_ID = process.env.STAKING_CONTRACT_ID;

// Núcleo de scoring compartido con api/calculate-score.js (única fuente de verdad).
// Es ESM y este server es CommonJS, así que se carga con import() dinámico, cacheado.
let scoringCorePromise;
function loadScoringCore() {
  if (!scoringCorePromise) {
    scoringCorePromise = import("../api/_scoring-core.mjs");
  }
  return scoringCorePromise;
}

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  return res.status(200).json({
    status: 'ok',
    endpoint: '/api/health',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/readiness', (req, res) => {
  return res.status(200).json({
    status: 'ready',
    endpoint: '/api/readiness',
    timestamp: new Date().toISOString()
  });
});

const RPC_URL = "https://soroban-testnet.stellar.org";
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

// El scoring (depósitos / retención / actividad) y la elegibilidad por historial
// viven en api/_scoring-core.mjs y se leen de los contadores ON-CHAIN del staking_pool
// (get_total_deposited / get_total_withdrawn / get_position / get_tx_count).
//
// Se eliminó el antiguo lector de Horizon (weightedMean / meanAbsoluteDeviation /
// computeScoreAndTier / getUserBlockchainHistory): contaba interacciones con CUALQUIER
// contrato de la cuenta y fabricaba 1 tx cuando no había ninguna, por lo que un
// contrato recién desplegado seguía mostrando "1/3" de historial viejo.

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
  const { address } = req.body || {};
  // `totalDeposited` del body se ignora a propósito: la fuente de verdad es el contrato.

  if (!address) return res.status(400).json({ error: "Falta wallet" });
  if (!STAKING_CONTRACT_ID) {
    console.error("[DEBUG] 💥 calculate-score: STAKING_CONTRACT_ID no configurado");
    return res.status(500).json({ error: "Falta la variable de entorno STAKING_CONTRACT_ID" });
  }

  try {
    const { computeFinancialReputation, getOnChainAggregates } = await loadScoringCore();
    const aggregates = await getOnChainAggregates(address, { contractId: STAKING_CONTRACT_ID });
    console.log(`[DEBUG] 📊 calculate-score address=${address} contract=${STAKING_CONTRACT_ID}`, aggregates);
    const result = computeFinancialReputation(aggregates);
    return res.json(result);
  } catch (error) {
    console.error("[DEBUG] 💥 Error en /calculate-score:", error.message);
    return res.status(500).json({ error: error.message });
  }
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

    // Elegibilidad y tier desde los contadores ON-CHAIN del staking_pool (misma
    // fuente que /api/calculate-score). Reemplaza el antiguo cálculo por Horizon.
    if (!STAKING_CONTRACT_ID) {
      return res.status(500).json({ success: false, error: 'Falta la variable de entorno STAKING_CONTRACT_ID' });
    }
    const { computeFinancialReputation, getOnChainAggregates } = await loadScoringCore();
    const aggregates = await getOnChainAggregates(address, { contractId: STAKING_CONTRACT_ID });
    const scoreResult = computeFinancialReputation(aggregates);
    const { tier, tierName } = scoreResult;
    console.log('[DEBUG] evaluate-and-mint score:', { address, contract: STAKING_CONTRACT_ID, ...aggregates, tier, tierName });

    if (!scoreResult.eligibility.isHistoryEligible) {
      return res.json({ success: false, error: 'Not eligible by history', eligibility: scoreResult.eligibility });
    }

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
  // Logueamos los contratos cargados para detectar de un vistazo un env desfasado
  // (la causa de que un contrato nuevo mostrara historial viejo).
  console.log(`   STAKING_CONTRACT_ID = ${STAKING_CONTRACT_ID || "(no configurado)"}`);
  console.log(`   NFT_CONTRACT_ID     = ${process.env.NFT_CONTRACT_ID || "(no configurado)"}`);
});