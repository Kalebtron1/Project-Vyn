import { rpc, TransactionBuilder, Networks, Operation, BASE_FEE, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { createLogger } from "./_logger.js";

const CONTRACT_ID = "CAIYBGMKSA5V5EYUFKGD5OCWWS5M34YC7MKUKE3BOQE2WZP3R7A4S2D2";
const RPC_URL = "https://soroban-testnet.stellar.org";

export default async function handler(req, res) {
  const log = createLogger(req);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { address } = req.query;

  if (!address) {
    return res.status(400).json({ error: 'Falta la dirección de la wallet' });
  }

  log.info("get_user_data.start", { address });

  try {
    const server = new rpc.Server(RPC_URL);
    
    let account;
    try {
      account = await server.getAccount(address);
    } catch (e) {
      log.warn("get_user_data.account_not_found", { address });
      return res.status(200).json({ totalXlmDeposited: 0, depositCount: 0, nftLevel: 0 });
    }

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: CONTRACT_ID,
          function: "get_balance",
          args: [nativeToScVal(address, { type: "address" })],
        })
      )
      .setTimeout(30)
      .build();

    const response = await server.simulateTransaction(transaction);

    let balanceXLM = 0;
    if (rpc.Api.isSimulationSuccess(response) && response.result) {
      const balanceInStroops = scValToNative(response.result.retval);
      balanceXLM = Number(balanceInStroops) / 10000000;
    }

    let nftLevel = 0;
    if (balanceXLM >= 50) nftLevel = 1;
    if (balanceXLM >= 150) nftLevel = 2;
    if (balanceXLM >= 500) nftLevel = 3;
    if (balanceXLM >= 1000) nftLevel = 4;

    let depositCount = balanceXLM > 0 ? 1 : 0;
    if (balanceXLM >= 150) depositCount = 3; 
    if (balanceXLM >= 500) depositCount = 10;

    log.info("get_user_data.done", { address, balanceXLM, nftLevel, depositCount });

    return res.status(200).json({
      totalXlmDeposited: balanceXLM,
      depositCount,
      nftLevel,
    });

  } catch (error) {
    log.error("get_user_data.error", { address, err: error.message });
    return res.status(500).json({ error: 'Error al comunicarse con Soroban' });
  }
}
