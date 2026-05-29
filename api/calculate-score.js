import { validateBody, calculateScoreBodySchema, reportValidationError } from "./validation.js";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
// Para entornos de testnet reducimos el requisito para facilitar pruebas
const MIN_TX_REQUIRED = 3;
// Límite máximo de registros históricos a analizar (mejora estabilidad del score)
const HISTORY_LIMIT = 30;

// --- MOTOR DE REPUTACIÓN CALIBRADO (3000 XLM = 50 PTS) ---
function computeFinancialReputation(history, totalBalance) {
  if (history.length < MIN_TX_REQUIRED) {
    return {
      score: 0,
      tier: 0,
      tierName: "Bronce",
      eligibility: {
        minHistoryRequired: MIN_TX_REQUIRED,
        historyCount: history.length,
        isHistoryEligible: false,
        remainingForUnlock: MIN_TX_REQUIRED - history.length,
      },
    };
  }

  let totalDeposited = 0;
  let totalWithdrawn = 0;
  let weightedVolume = 0;
  const now = new Date();

  history.forEach((tx) => {
    // Factor de tiempo: transacciones de hace 1 mes valen menos que las de hoy
    const daysAgo = Math.floor((now - tx.date) / (1000 * 60 * 60 * 24));
    const timeWeight = 1 / (daysAgo + 1);

    if (tx.type === "deposit") {
      totalDeposited += tx.amount;
      weightedVolume += tx.amount * timeWeight;
    } else {
      totalWithdrawn += tx.amount;
    }
  });

  // 1. Tasa de Retención (Mide qué tanto dinero se queda en el protocolo)
  const retentionRate = totalDeposited > 0 ? (totalBalance / totalDeposited) : 0;

  // 2. Factor de Actividad (Logarítmico para premiar número de operaciones sin explotar)
  const activityFactor = Math.log10(history.length + 1);

  // 3. CÁLCULO FINAL CALIBRADO
  // Dividimos entre 60 para que 3000 XLM ≈ 50 Puntos (Nivel Plata)
  // Esto hace que el préstamo de 300 XLM sea el 10% del balance necesario.
  const SENSITIVITY_FACTOR = 60; 
  let score = (weightedVolume * retentionRate * activityFactor) / SENSITIVITY_FACTOR;

  // 4. Penalización por vaciado de cuenta (Seguridad extra)
  if (totalBalance < (totalDeposited * 0.1)) {
    score = score * 0.2; // Si tiene menos del 10% de lo que ingresó, el score cae 80%
  }

  // --- MAPEO DE TIERS (Mantenemos tus rangos) ---
  let tier = 0;
  let tierName = "Bronce";

  if (score >= 1000) { tier = 4; tierName = "Platino"; }
  else if (score >= 500) { tier = 3; tierName = "Diamante"; }
  else if (score >= 150) { tier = 2; tierName = "Oro"; }
  else if (score >= 50) { tier = 1; tierName = "Plata"; }

  return { 
    score: parseFloat(score.toFixed(2)), 
    tier, 
    tierName,
    eligibility: {
      minHistoryRequired: MIN_TX_REQUIRED,
      historyCount: history.length,
      isHistoryEligible: true,
      remainingForUnlock: 0,
    },
    metrics: {
      retention: parseFloat(retentionRate.toFixed(2)),
      activity: parseFloat(activityFactor.toFixed(2)),
      volumeIn: totalDeposited,
      volumeOut: totalWithdrawn
    }
  };
}

// --- LECTOR DE 30 REGISTROS REALES ---
async function getCleanHistory(userAddress) {
  try {
    // Leemos efectos y mapeamos account_credited/account_debited a deposit/withdrawal.
    const response = await fetch(`${HORIZON_URL}/accounts/${userAddress}/effects?limit=${HISTORY_LIMIT}&order=desc`);
    if (!response.ok) return [];

    const data = await response.json();

    return (data._embedded.records || [])
      .filter((op) => (op.type === 'account_debited' || op.type === 'account_credited' || op.type === 'contract_credited') && Number(op.amount) > 0)
      .map((op) => ({
        amount: parseFloat(op.amount),
        // account_credited or contract_credited => deposit; account_debited => withdrawal
        type: (op.type === 'account_credited' || op.type === 'contract_credited') ? 'deposit' : 'withdrawal',
        date: new Date(op.created_at),
      }))
      .slice(0, HISTORY_LIMIT);
  } catch (e) {
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let address;
  let clientTotalDeposited;

  try {
    const validated = validateBody(calculateScoreBodySchema, req.body || {});
    address = validated.address;
    clientTotalDeposited = validated.totalDeposited;
  } catch (error) {
    return reportValidationError(res, error);
  }

  try {
    const history = await getCleanHistory(address);

    // Preferimos usar el total enviado por cliente; si no, intentamos leer on-chain.
    let effectiveTotal = Number(clientTotalDeposited) || 0;
    if (!effectiveTotal || effectiveTotal <= 0) {
      try {
        const resp = await fetch(`${HORIZON_URL}/accounts/${address}`);
        if (resp.ok) {
          const acct = await resp.json();
          const native = (acct.balances || []).find((b) => b.asset_type === 'native');
          effectiveTotal = Number(native?.balance) || effectiveTotal;
        }
      } catch (e) {
        // fallback a 0
      }
    }

    // Clamp a 0 para evitar valores negativos que corrompan retentionRate
    const result = computeFinancialReputation(history, Math.max(0, Number(effectiveTotal) || 0));
    
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}