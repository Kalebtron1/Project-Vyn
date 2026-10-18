import {
  BASE_FEE,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";

// staking_pool respaldado por DeFindex. Se configura vía VITE_STAKING_CONTRACT_ID
// (sin hardcodear el id; cámbialo en .env.local tras cada redeploy de testnet).
export const CONTRACT_ID = import.meta.env.VITE_STAKING_CONTRACT_ID;
if (!CONTRACT_ID) {
  // Sin este id el frontend invocaría un contrato `undefined` y `fetchContractBalance`
  // devolvería saldo 0 en silencio. Avisar evita diagnosticar a ciegas tras un redeploy.
  console.error(
    "[contracts] Falta VITE_STAKING_CONTRACT_ID. Defínelo en .env.local y reinicia Vite."
  );
}
// Vault DeFindex PROPIO (creado vía el factory de DeFindex) respaldado por la
// estrategia fixed_apr — genera rendimiento real y visible en testnet. El
// staking_pool lo guarda vía init y puede migrarlo con set_vault (admin).
// Referencia (el id efectivo lo expone el contrato vía get_vault):
export const VAULT_ID = "CBPO3E7IFJRVP6MVNS4YJOVHEOEMNMUHV7AVAQ47IL53ERVCEJ6UIS76";
// Contrato de préstamos (vinculo_lending). El apartado de tesorería lee y retira
// desde aquí el interés acumulado (ganancia del negocio, denominada en XLM).
export const LENDING_CONTRACT_ID = import.meta.env.VITE_LENDING_CONTRACT_ID;
// Wallet de tesorería: única que ve y puede operar el apartado de ganancias.
// El gating de UI es cosmético; la autorización real la impone el contrato
// (`withdraw_interest` exige `treasury.require_auth()`).
export const TREASURY_ADDRESS = import.meta.env.VITE_TREASURY_ADDRESS;
export const RPC_URL = "https://soroban-testnet.stellar.org";

export interface OnChainLoan {
  principal: number;
  totalOwed: number;
  dueTimestamp: number;
  months: number;
  apyBps: number;
  isOverdue: boolean;
}

export async function fetchOnChainLoan(userAddress: string): Promise<OnChainLoan | null> {
  const contractId = LENDING_CONTRACT_ID?.trim();
  if (!contractId || !userAddress) return null;

  try {
    const server = new rpc.Server(RPC_URL);
    const account = await server.getAccount(userAddress);
    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: "get_loan",
          args: [nativeToScVal(userAddress, { type: "address" })],
        })
      )
      .setTimeout(30)
      .build();

    const response = await server.simulateTransaction(transaction);
    if (!rpc.Api.isSimulationSuccess(response) || !response.result) {
      return null;
    }

    const raw = scValToNative(response.result.retval) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return null;

    const totalOwedStroops = Number(raw.total_owed ?? 0);
    if (!Number.isFinite(totalOwedStroops) || totalOwedStroops <= 0) {
      return null;
    }

    const principal = Number(raw.principal ?? 0) / 10_000_000;
    const totalOwed = totalOwedStroops / 10_000_000;
    const dueTimestamp = Number(raw.due_timestamp ?? 0);
    const months = Number(raw.months ?? 1);
    const apyBps = Number(raw.apy_bps ?? 500);
    const nowSec = Math.floor(Date.now() / 1000);

    return {
      principal,
      totalOwed,
      dueTimestamp,
      months,
      apyBps,
      isOverdue: dueTimestamp > 0 && nowSec >= dueTimestamp,
    };
  } catch {
    return null;
  }
}