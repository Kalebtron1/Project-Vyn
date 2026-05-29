import { Keypair, rpc, TransactionBuilder, Networks, Operation, BASE_FEE, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";

const CREDIT_LIMITS = {
  0: { name: "Bronce", amount: 0 },
  1: { name: "Plata", amount: 300 },
  2: { name: "Oro", amount: 600 },
  3: { name: "Diamante", amount: 1500 },
  4: { name: "Platino", amount: 5000 }
};

const RPC_URL = "https://soroban-testnet.stellar.org";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { userAddress } = req.body;
  if (!userAddress) return res.status(400).json({ error: "Falta wallet" });

  const t0 = Date.now();
  try {
    const server = new rpc.Server(RPC_URL);
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
    const latencyMs = Date.now() - t0;
    // METRIC: get-available-credit latency and resolved tier
    console.log(`[metric] get-available-credit latency=${latencyMs}ms tier=${finalTier} credit=${config.amount}XLM`);

    return res.status(200).json({
      success: true,
      tier: finalTier,
      tierName: config.name,
      availableCredit: config.amount,
      currency: "XLM"
    });

  } catch (error) {
    const latencyMs = Date.now() - t0;
    // METRIC: get-available-credit contract simulation failure
    console.error("Error get-available-credit:", error.message);
    console.log(`[metric] get-available-credit latency=${latencyMs}ms error="${error.message}"`);
    return res.status(200).json({
      success: true,
      tier: 0,
      tierName: "Bronce",
      availableCredit: 0,
      currency: "XLM"
    });
  }
}