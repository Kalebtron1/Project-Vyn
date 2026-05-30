import { 
  Keypair, 
  rpc, 
  TransactionBuilder, 
  Networks, 
  Operation, 
  BASE_FEE, 
  nativeToScVal,
  Transaction
} from "@stellar/stellar-sdk";
import dotenv from "dotenv";

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

async function resolveTierFromCanonicalScore(req, userAddress, totalVolume) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";

  if (!host) {
    throw new Error("No se pudo resolver host para validar score");
  }

  const scoreResponse = await fetch(`${proto}://${host}/api/calculate-score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const anomaly = scoreData?.anomaly === true;

  if (anomaly) {
    console.warn(`[ANOMALY] Flagged score during evaluate-and-mint for ${userAddress}. Minting blocked.`);
  }

  return { tier, tierName, anomaly };
}

async function mintNftOnChain(userAddress, tier) {
  try {
    const adminKeypair = Keypair.fromSecret(process.env.SECRET_KEY_ADMIN);
    const account = await server.getAccount(adminKeypair.publicKey());
    
    let transaction = new TransactionBuilder(account, { 
        fee: BASE_FEE, 
        networkPassphrase: Networks.TESTNET 
    })
      .addOperation(
        Operation.invokeContractFunction({ // ✅ Nombre estándar
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userAddress, deposits, totalVolume } = req.body || {};

  if (!userAddress) {
    return res.status(400).json({ error: 'userAddress es requerido', status: 'error' });
  }

  const fallbackVolumeFromDeposits = Array.isArray(deposits)
    ? deposits.reduce((acc, d) => acc + (Number(d?.amount) || 0), 0)
    : 0;

  let effectiveTotalVolume = Number(totalVolume) || fallbackVolumeFromDeposits;

  // Si el cliente no provee un volumen válido, intentamos leer el saldo on-chain como fuente de verdad
  if (!effectiveTotalVolume || effectiveTotalVolume <= 0) {
    try {
      const resp = await fetch(`${HORIZON_URL}/accounts/${userAddress}`);
      if (resp.ok) {
        const acct = await resp.json();
        const native = (acct.balances || []).find(b => b.asset_type === 'native');
        effectiveTotalVolume = Number(native?.balance) || effectiveTotalVolume;
      }
    } catch (e) {
      // Si falla la consulta on-chain, usamos el fallback calculado desde 'deposits'
    }
  }

  let tier;
  let tierName;
  let anomaly = false;
  try {
    const tierResult = await resolveTierFromCanonicalScore(req, userAddress, effectiveTotalVolume);
    tier = tierResult.tier;
    tierName = tierResult.tierName;
    anomaly = tierResult.anomaly || false;
  } catch (scoreError) {
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
    const mintResult = await mintNftOnChain(userAddress, tier);
    if (mintResult.success) {
      return res.json({ txHash: mintResult.hash, tier, tierName, status: "minted" });
    }

    return res.status(500).json({
      status: "error",
      tier,
      tierName,
      message: mintResult.error || "No se pudo mintear el NFT",
    });
  }

  return res.json({
    message: "Nivel insuficiente",
    tier,
    tierName,
    status: "pending",
  });
}