import { xdr, nativeToScVal, scValToNative, rpc, TransactionBuilder, Networks, Operation, BASE_FEE } from "@stellar/stellar-sdk";

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

/** 5% anual en basis points. Igual que `APY_BPS` en `vinculo_lending`. */
export const LOAN_APY_BPS = 500n;
/** Demo: 1 mes de plazo = 60 segundos. Igual que `SECONDS_PER_MONTH`. */
export const LOAN_SECONDS_PER_MONTH = 60;

/**
 * ceil(principal * apy_bps * months / (12 * 10_000)).
 * Redondea a favor del pool, igual que el contrato.
 */
export function loanInterestStroops(principalStroops: bigint, months: bigint): bigint {
  if (principalStroops <= 0n || months <= 0n) return 0n;
  const numer = principalStroops * LOAN_APY_BPS * months;
  const denom = 12n * 10_000n;
  return (numer + denom - 1n) / denom;
}

/** Mínimo aceptado en un retiro: 1% por debajo de lo cotizado. El contrato revierte si el vault paga menos. */
export function minWithdrawOut(amountStroops: bigint): bigint {
  if (amountStroops <= 0n) return 0n;
  return (amountStroops * 99n) / 100n;
}

export type OnchainLoan = {
  principal: number;
  totalOwed: number;
  totalOwedStroops: string;
  dueTimestamp: number;
  months: number;
  interest: number;
  isOverdue: boolean;
};

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string" && value !== "") return BigInt(value);
  return 0n;
}

/** Lee `get_loan`. Devuelve null si no hay deuda o la simulación falla. */
export async function fetchActiveLoan(userAddress: string): Promise<OnchainLoan | null> {
  if (!LENDING_CONTRACT_ID) return null;
  try {
    const server = new rpc.Server(RPC_URL);
    let account;
    try {
      account = await server.getAccount(userAddress);
    } catch {
      return null;
    }

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: LENDING_CONTRACT_ID,
          function: "get_loan",
          args: [nativeToScVal(userAddress, { type: "address" })],
        })
      )
      .setTimeout(30)
      .build();

    const response = await server.simulateTransaction(transaction);
    if (!rpc.Api.isSimulationSuccess(response) || !response.result) return null;

    const raw = scValToNative(response.result.retval) as Record<string, unknown>;
    const totalOwedStroops = asBigInt(raw.total_owed);
    if (totalOwedStroops <= 0n) return null;

    const principalStroops = asBigInt(raw.principal);
    const interestStroops = asBigInt(raw.interest);
    return {
      principal: Number(principalStroops) / 10_000_000,
      totalOwed: Number(totalOwedStroops) / 10_000_000,
      totalOwedStroops: totalOwedStroops.toString(),
      dueTimestamp: Number(asBigInt(raw.due_timestamp)),
      months: Number(asBigInt(raw.months)),
      interest: Number(interestStroops) / 10_000_000,
      isOverdue: Boolean(raw.is_overdue),
    };
  } catch (error) {
    console.error("Error consultando get_loan:", error);
    return null;
  }
}