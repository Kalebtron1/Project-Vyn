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

// Core de BlindPay ON-RAMP (payin SPEI) — ESM; se carga con import() dinámico cacheado.
let onrampCorePromise;
function loadOnrampCore() {
  if (!onrampCorePromise) {
    onrampCorePromise = import("../api/_blindpay-onramp.mjs");
  }
  return onrampCorePromise;
}

// Dispatcher consolidado /api/onramp?action=init|quote|payin|status|settle (incluye Fase 6).
// Reusa EXACTAMENTE el handler serverless api/onramp.js para no duplicar lógica en dev.
let onrampHandlerPromise;
function loadOnrampHandler() {
  if (!onrampHandlerPromise) onrampHandlerPromise = import("../api/onramp.js");
  return onrampHandlerPromise;
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
// ENDPOINTS: SESIÓN DE WALLET Y MINT DEL SBT
// Reusan los handlers serverless: el mint exige la sesión que emite /api/auth (#89).
// ─────────────────────────────────────────────
const handlerPromises = {};
function serveHandler(route, file) {
  app.all(route, async (req, res) => {
    try {
      if (!handlerPromises[file]) handlerPromises[file] = import(file);
      const mod = await handlerPromises[file];
      return mod.default(req, res);
    } catch (error) {
      console.error(`[DEBUG] 💥 ${route}:`, error.message);
      return res.status(502).json({ error: error.message || "Error interno" });
    }
  });
}
serveHandler("/api/auth", "../api/auth.js");
serveHandler("/api/evaluate-and-mint", "../api/evaluate-and-mint.js");

// ─────────────────────────────────────────────
// ENDPOINTS: BLINDPAY OFF-RAMP (SPEI) 💸
// La UI maneja USDC; el USDB→SPEI lo firma la wallet de payout del backend.
// Reusa el handler serverless api/blindpay.js: el payout exige un pago de fondeo verificado (#91).
// ─────────────────────────────────────────────
let blindpayHandlerPromise;
app.all("/api/blindpay", async (req, res) => {
  try {
    if (!blindpayHandlerPromise) blindpayHandlerPromise = import("../api/blindpay.js");
    const mod = await blindpayHandlerPromise;
    return mod.default(req, res);
  } catch (error) {
    console.error("[DEBUG] 💥 /api/blindpay:", error.message);
    return res.status(502).json({ error: error.message || "Error en el retiro a SPEI" });
  }
});

// ─────────────────────────────────────────────
// ENDPOINTS: BLINDPAY ON-RAMP (SPEI → USDC) 💰
// Receiver compartido + 1 blockchain wallet por usuario (su dirección Accesly).
// Mismo handler que api/onramp-*.js (core compartido _blindpay-onramp.mjs).
// ─────────────────────────────────────────────
function onrampWalletAddress(req, res) {
  const addr = req.body && req.body.walletAddress;
  if (typeof addr !== "string" || !/^G[A-Z2-7]{55}$/.test(addr.trim())) {
    res.status(400).json({ error: "walletAddress inválida (dirección Stellar G…)", status: "error" });
    return null;
  }
  return addr.trim();
}

function onrampAmountMxn(req, res) {
  const raw = req.body && req.body.amountMxn;
  const amount = typeof raw === "string" ? Number(raw) : raw;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 5) {
    res.status(400).json({ error: "amountMxn inválido (mínimo 5 MXN)", status: "error" });
    return null;
  }
  return amount;
}

app.post("/api/onramp-init", async (req, res) => {
  const walletAddress = onrampWalletAddress(req, res);
  if (walletAddress === null) return;
  try {
    const { ensureBlockchainWallet } = await loadOnrampCore();
    const result = await ensureBlockchainWallet({ walletAddress, email: req.body && req.body.email });
    return res.json(result);
  } catch (error) {
    console.error("[DEBUG] 💥 /onramp-init:", error.message);
    return res.status(502).json({ error: error.message || "Error al registrar la wallet en BlindPay" });
  }
});

app.post("/api/onramp-quote", async (req, res) => {
  const walletAddress = onrampWalletAddress(req, res);
  if (walletAddress === null) return;
  const amountMxn = onrampAmountMxn(req, res);
  if (amountMxn === null) return;
  try {
    const { ensureBlockchainWallet, createPayinQuote, summarizePayinQuote } = await loadOnrampCore();
    const { blockchainWalletId } = await ensureBlockchainWallet({ walletAddress, email: req.body && req.body.email });
    const quote = await createPayinQuote({ blockchainWalletId, amountCents: Math.round(amountMxn * 100) });
    return res.json(summarizePayinQuote(quote));
  } catch (error) {
    console.error("[DEBUG] 💥 /onramp-quote:", error.message);
    return res.status(502).json({ error: error.message || "Error al cotizar el depósito SPEI" });
  }
});

app.post("/api/onramp-payin", async (req, res) => {
  const walletAddress = onrampWalletAddress(req, res);
  if (walletAddress === null) return;
  const amountMxn = onrampAmountMxn(req, res);
  if (amountMxn === null) return;
  try {
    const { ensureBlockchainWallet, quoteAndPayin, summarizePayinQuote, summarizePayin } = await loadOnrampCore();
    const { blockchainWalletId } = await ensureBlockchainWallet({ walletAddress, email: req.body && req.body.email });
    const { quote, payin } = await quoteAndPayin({ walletAddress, blockchainWalletId, amountCents: Math.round(amountMxn * 100) });
    return res.json({ ...summarizePayin(payin), quote: summarizePayinQuote(quote) });
  } catch (error) {
    console.error("[DEBUG] 💥 /onramp-payin:", error.message);
    return res.status(502).json({ error: error.message || "Error al generar el depósito SPEI" });
  }
});

app.get("/api/onramp-status", async (req, res) => {
  const id = req.query && req.query.id;
  if (!id) return res.status(400).json({ error: "id requerido", status: "error" });
  try {
    const { getPayin, summarizePayin } = await loadOnrampCore();
    const payin = await getPayin(id);
    return res.json(summarizePayin(payin));
  } catch (error) {
    console.error("[DEBUG] 💥 /onramp-status:", error.message);
    return res.status(502).json({ error: error.message || "Error al consultar el depósito" });
  }
});

// ─────────────────────────────────────────────
// ENDPOINT: FAUCET USDC (testnet) 🚰 — manda 2 USDC al usuario para probar depósitos.
// ─────────────────────────────────────────────
let faucetHandlerPromise;
function loadFaucetHandler() {
  if (!faucetHandlerPromise) faucetHandlerPromise = import("../api/faucet-usdc.js");
  return faucetHandlerPromise;
}

// Reusa el handler serverless para no duplicar topes ni códigos de respuesta.
app.post("/api/faucet-usdc", async (req, res) => {
  try {
    const mod = await loadFaucetHandler();
    return mod.default(req, res);
  } catch (error) {
    console.error("[DEBUG] 💥 /faucet-usdc:", error.message);
    return res.status(502).json({ error: error.message || "Error enviando USDC" });
  }
});

// On-ramp consolidado (init/quote/payin/status/settle) — delega al handler serverless.
app.all("/api/onramp", async (req, res) => {
  try {
    const mod = await loadOnrampHandler();
    return mod.default(req, res);
  } catch (error) {
    console.error("[DEBUG] 💥 /api/onramp:", error.message);
    return res.status(502).json({ error: error.message || "Error en on-ramp" });
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