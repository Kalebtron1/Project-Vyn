const HORIZON_URL = "https://horizon-testnet.stellar.org";
const MIN_TX_REQUIRED = 30;

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
    const response = await fetch(`${HORIZON_URL}/accounts/${userAddress}/effects?limit=120&order=desc`);
    if (!response.ok) return [];
    
    const data = await response.json();
    
    return data._embedded.records
      .filter(op => 
        (op.type === 'account_debited' || op.type === 'account_credited') && 
        parseFloat(op.amount) >= 1.0 // Ignoramos spam/polvo
      )
      .map(op => ({
        amount: parseFloat(op.amount),
        // account_credited = money came IN (deposit); account_debited = money went OUT (withdrawal)
        type: op.type === 'account_credited' ? "deposit" : "withdrawal",
        date: new Date(op.created_at)
      }))
      .slice(0, MIN_TX_REQUIRED); // Leemos exactamente las últimas 30 transacciones relevantes
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

  const { address, totalDeposited } = req.body;
  if (!address) return res.status(400).json({ error: "Wallet requerida" });

  // Validate Stellar public key format (G... 56 chars)
  if (typeof address !== "string" || !/^G[A-Z2-7]{55}$/.test(address)) {
    return res.status(400).json({ error: "Dirección de wallet inválida" });
  }

  // totalDeposited is required for an accurate retention score; warn if missing
  const balance = Number(totalDeposited);
  if (isNaN(balance) || totalDeposited === undefined || totalDeposited === null) {
    return res.status(400).json({ error: "totalDeposited es requerido para calcular el score" });
  }

  try {
    const history = await getCleanHistory(address);
    // Usamos el balance actual que viene del contrato (totalDeposited)
    const result = computeFinancialReputation(history, balance);
    
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}