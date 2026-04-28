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

// ---------------------------------------------------------------------------
// Credit configuration — indexed by SBT tier
// ---------------------------------------------------------------------------
const CREDIT_LIMITS = {
  0: { name: "Bronce",   amount: 0    },
  1: { name: "Plata",    amount: 300  },
  2: { name: "Oro",      amount: 600  },
  3: { name: "Diamante", amount: 1500 },
  4: { name: "Platino",  amount: 5000 },
};

const RPC_URL = "https://soroban-testnet.stellar.org";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { userAddress } = req.body;
  if (!userAddress) {
    return res.status(400).json({ success: false, error: "Falta wallet" });
  }

  // Validate environment secrets are present before hitting the chain
  if (!process.env.SECRET_KEY_ADMIN) {
    console.error("[get-available-credit] SECRET_KEY_ADMIN not set");
    return res.status(500).json({
      success: false,
      error: "Configuración del servidor incompleta. Contacta al administrador.",
    });
  }

  if (!process.env.NFT_CONTRACT_ID) {
    console.error("[get-available-credit] NFT_CONTRACT_ID not set");
    return res.status(500).json({
      success: false,
      error: "Configuración del servidor incompleta. Contacta al administrador.",
    });
  }

  try {
    const server = new rpc.Server(RPC_URL);
    const adminKeypair = Keypair.fromSecret(process.env.SECRET_KEY_ADMIN);
    const sourceAccount = await server.getAccount(adminKeypair.publicKey());

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: process.env.NFT_CONTRACT_ID,
          function: "get_tier",
          args: [nativeToScVal(userAddress, { type: "address" })],
        })
      )
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);

    // Surface RPC-level simulation errors so callers can react appropriately
    if (simulation.error) {
      console.error("[get-available-credit] Simulation error:", simulation.error);
      return res.status(502).json({
        success: false,
        error: "Error al consultar el contrato NFT. Intenta nuevamente en unos segundos.",
      });
    }

    let finalTier = 0;
    if (simulation.result && simulation.result.retval) {
      finalTier = Number(scValToNative(simulation.result.retval)) || 0;
    }

    const config = CREDIT_LIMITS[finalTier] ?? CREDIT_LIMITS[0];

    return res.status(200).json({
      success: true,
      tier: finalTier,
      tierName: config.name,
      availableCredit: config.amount,
      currency: "XLM",
    });
  } catch (error) {
    console.error("[get-available-credit] Unhandled error:", error.message);

    // Classify transient vs. permanent errors so the frontend can decide
    // whether to surface a hard error or silently retry.
    const isTransient =
      error.message?.includes("timeout") ||
      error.message?.includes("ECONNRESET") ||
      error.message?.includes("503") ||
      error.message?.includes("network");

    return res.status(isTransient ? 503 : 500).json({
      success: false,
      transient: isTransient,
      error: isTransient
        ? "La red Stellar no está respondiendo. Intenta en unos segundos."
        : "Error al obtener el crédito disponible. Contacta al administrador si persiste.",
    });
  }
}