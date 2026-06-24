import { rpc, TransactionBuilder, Networks, Operation, BASE_FEE, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { createLogger } from "./_logger.js";
import { validateQuery, getUserDataQuerySchema, reportValidationError } from "./validation.js";

const CONTRACT_ID = "CAIYBGMKSA5V5EYUFKGD5OCWWS5M34YC7MKUKE3BOQE2WZP3R7A4S2D2";
const RPC_URL = "https://soroban-testnet.stellar.org";

export default async function handler(req, res) {
  const log = createLogger(req);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  let address;
  try {
    const validated = validateQuery(getUserDataQuerySchema, req.query || {});
    address = validated.address;
  } catch (error) {
    return reportValidationError(res, error);
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

    // Lee un getter del contrato vía simulación y devuelve el valor nativo.
    const readContract = async (fnName) => {
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: CONTRACT_ID,
            function: fnName,
            args: [nativeToScVal(address, { type: "address" })],
          })
        )
        .setTimeout(30)
        .build();

      const response = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationSuccess(response) && response.result) {
        return scValToNative(response.result.retval);
      }
      return 0;
    };

    // Posición real (depósito + rendimiento del vault), ingreso acumulado y nº de operaciones.
    const [positionRaw, depositedRaw, txCountRaw] = await Promise.all([
      readContract("get_position"),
      readContract("get_total_deposited"),
      readContract("get_tx_count"),
    ]);

    const positionXLM = Number(positionRaw) / 10000000;
    const totalDeposited = Number(depositedRaw) / 10000000;
    const depositCount = Number(txCountRaw) || 0;

    // El nivel del NFT se aproxima por la posición real (el score canónico lo refina).
    let nftLevel = 0;
    if (positionXLM >= 50) nftLevel = 1;
    if (positionXLM >= 150) nftLevel = 2;
    if (positionXLM >= 500) nftLevel = 3;
    if (positionXLM >= 1000) nftLevel = 4;

    log.info("get_user_data.done", { address, positionXLM, totalDeposited, nftLevel, depositCount });

    return res.status(200).json({
      totalXlmDeposited: totalDeposited,
      currentPosition: positionXLM,
      depositCount,
      nftLevel,
    });

  } catch (error) {
    log.error("get_user_data.error", { address, err: error.message });
    return res.status(500).json({ error: 'Error al comunicarse con Soroban' });
  }
}
