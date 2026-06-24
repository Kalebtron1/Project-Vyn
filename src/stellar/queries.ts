import { TransactionBuilder, Networks, Operation, BASE_FEE, nativeToScVal, scValToNative, rpc } from "@stellar/stellar-sdk";
import { CONTRACT_ID, RPC_URL } from "./contracts";

// Valor redimible en vivo de la posición del usuario (depósito + rendimiento real
// del vault DeFindex), en unidades del token (USDC, 7 decimales como XLM).
export async function fetchContractBalance(userAddress: string): Promise<number> {
  try {
    const server = new rpc.Server(RPC_URL);

    // 🛡️ PROTECCIÓN 1: Si la cuenta no existe en la red, no puede tener saldo.
    let account;
    try {
      account = await server.getAccount(userAddress);
    } catch (e) {
      console.warn("La cuenta no está fondeada en Testnet. Saldo 0 por defecto.");
      return 0;
    }

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: CONTRACT_ID,
          function: "get_position",
          args: [
            nativeToScVal(userAddress, { type: "address" })
          ],
        })
      )
      .setTimeout(30)
      .build();

    const response = await server.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(response) && response.result) {
      const positionInStroops = scValToNative(response.result.retval);

      // 🛡️ PROTECCIÓN 2: Convertir explícitamente el BigInt a Number antes de operar
      return Number(positionInStroops) / 10000000;
    }
    return 0;
  } catch (error) {
    console.error("Error consultando get_position:", error);
    return 0;
  }
}

// Ingreso acumulado del usuario (para mostrar el rendimiento generado = posición − ingreso neto).
export async function fetchTotalDeposited(userAddress: string): Promise<number> {
  try {
    const server = new rpc.Server(RPC_URL);

    let account;
    try {
      account = await server.getAccount(userAddress);
    } catch (e) {
      return 0;
    }

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: CONTRACT_ID,
          function: "get_total_deposited",
          args: [nativeToScVal(userAddress, { type: "address" })],
        })
      )
      .setTimeout(30)
      .build();

    const response = await server.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(response) && response.result) {
      const depositedInStroops = scValToNative(response.result.retval);
      return Number(depositedInStroops) / 10000000;
    }
    return 0;
  } catch (error) {
    console.error("Error consultando get_total_deposited:", error);
    return 0;
  }
}

// Retiro acumulado del usuario (para estimar el rendimiento neto generado).
export async function fetchTotalWithdrawn(userAddress: string): Promise<number> {
  try {
    const server = new rpc.Server(RPC_URL);

    let account;
    try {
      account = await server.getAccount(userAddress);
    } catch (e) {
      return 0;
    }

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: CONTRACT_ID,
          function: "get_total_withdrawn",
          args: [nativeToScVal(userAddress, { type: "address" })],
        })
      )
      .setTimeout(30)
      .build();

    const response = await server.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(response) && response.result) {
      const withdrawnInStroops = scValToNative(response.result.retval);
      return Number(withdrawnInStroops) / 10000000;
    }
    return 0;
  } catch (error) {
    console.error("Error consultando get_total_withdrawn:", error);
    return 0;
  }
}