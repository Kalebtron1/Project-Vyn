import { TransactionBuilder, Networks, Operation, BASE_FEE, scValToNative, rpc } from "@stellar/stellar-sdk";
import { LENDING_CONTRACT_ID, RPC_URL } from "./contracts";

// Lee un getter i128 del contrato de préstamos (vinculo_lending) vía simulación y
// lo devuelve en unidades del token (XLM, 7 decimales). `sourceAddress` solo se
// usa para construir la transacción de simulación (debe ser una cuenta fondeada).
async function readLendingI128(fnName: string, sourceAddress: string): Promise<number> {
  try {
    const server = new rpc.Server(RPC_URL);

    let account;
    try {
      account = await server.getAccount(sourceAddress);
    } catch (e) {
      return 0;
    }

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: LENDING_CONTRACT_ID,
          function: fnName,
          args: [],
        })
      )
      .setTimeout(30)
      .build();

    const response = await server.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(response) && response.result) {
      return Number(scValToNative(response.result.retval)) / 10000000;
    }
    return 0;
  } catch (error) {
    console.error(`Error consultando ${fnName}:`, error);
    return 0;
  }
}

// Interés acumulado (ganancia del negocio) disponible para retiro por la tesorería.
export function fetchAccruedInterest(sourceAddress: string): Promise<number> {
  return readLendingI128("get_accrued_interest", sourceAddress);
}

// Liquidez total del pool de préstamos (principal + interés aún no retirado).
export function fetchPoolBalance(sourceAddress: string): Promise<number> {
  return readLendingI128("get_pool_balance", sourceAddress);
}
