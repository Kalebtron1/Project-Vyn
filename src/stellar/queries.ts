import { Account, TransactionBuilder, Networks, Operation, BASE_FEE, nativeToScVal, scValToNative, rpc } from "@stellar/stellar-sdk";
import { CONTRACT_ID, RPC_URL } from "./contracts";

// Simula un getter `fn(user) -> i128` del staking_pool y lo devuelve en unidades del
// token (USDC, 7 decimales como XLM). Un fallo de la simulación (p. ej. sin posición)
// cuenta como 0; un fallo de red se propaga.
async function readUserGetter(
  server: rpc.Server,
  account: Account,
  fn: string,
  userAddress: string
): Promise<number> {
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: CONTRACT_ID,
        function: fn,
        args: [nativeToScVal(userAddress, { type: "address" })],
      })
    )
    .setTimeout(30)
    .build();

  const response = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationSuccess(response) && response.result) {
    // Convertir explícitamente el BigInt a Number antes de operar.
    return Number(scValToNative(response.result.retval)) / 10000000;
  }
  return 0;
}

/** La cuenta del usuario, o null si aún no existe en la red (sin fondear). */
async function loadAccount(server: rpc.Server, userAddress: string): Promise<Account | null> {
  try {
    return await server.getAccount(userAddress);
  } catch {
    return null;
  }
}

async function readOne(userAddress: string, fn: string): Promise<number> {
  try {
    const server = new rpc.Server(RPC_URL);
    const account = await loadAccount(server, userAddress);
    if (!account) return 0;
    return await readUserGetter(server, account, fn, userAddress);
  } catch (error) {
    console.error(`Error consultando ${fn}:`, error);
    return 0;
  }
}

export interface SavingsSnapshot {
  /** Valor redimible en vivo (depósito + rendimiento real del vault DeFindex). */
  position: number;
  /** Ingreso acumulado. */
  deposited: number;
  /** Retiro acumulado. */
  withdrawn: number;
}

/**
 * Lee de una vez la posición y los acumulados del usuario: una sola lectura de la
 * cuenta y las tres simulaciones en paralelo (antes, 3 × (cuenta + simulación)).
 * Una cuenta sin fondear no tiene posición (todo 0); un fallo de red lanza error para
 * que la caché conserve el último dato bueno en vez de mostrar 0.
 */
export async function readSavingsSnapshot(userAddress: string): Promise<SavingsSnapshot> {
  const server = new rpc.Server(RPC_URL);
  const account = await loadAccount(server, userAddress);
  if (!account) return { position: 0, deposited: 0, withdrawn: 0 };
  const [position, deposited, withdrawn] = await Promise.all([
    readUserGetter(server, account, "get_position", userAddress),
    readUserGetter(server, account, "get_total_deposited", userAddress),
    readUserGetter(server, account, "get_total_withdrawn", userAddress),
  ]);
  return { position, deposited, withdrawn };
}

// Valor redimible en vivo de la posición del usuario (depósito + rendimiento real
// del vault DeFindex), en unidades del token (USDC, 7 decimales como XLM).
export function fetchContractBalance(userAddress: string): Promise<number> {
  return readOne(userAddress, "get_position");
}

// Ingreso acumulado del usuario (para mostrar el rendimiento generado = posición − ingreso neto).
export function fetchTotalDeposited(userAddress: string): Promise<number> {
  return readOne(userAddress, "get_total_deposited");
}

// Retiro acumulado del usuario (para estimar el rendimiento neto generado).
export function fetchTotalWithdrawn(userAddress: string): Promise<number> {
  return readOne(userAddress, "get_total_withdrawn");
}
