import { xdr, nativeToScVal } from "@stellar/stellar-sdk";

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

export const LENDING_APY_BPS = 500;
const MONTHS_PER_YEAR = 12n;
const BPS_DENOMINATOR = 10_000n;
const STROOPS_PER_UNIT = 10_000_000n;

/**
 * Calcula el interés en stroops igual que `vinculo_lending::compute_interest`:
 * `(principal * apy_bps * months).div_ceil(12 * 10_000)`
 */
export function computeLoanInterestStroops(
  principalStroops: bigint,
  months: number,
  apyBps: number = LENDING_APY_BPS
): bigint {
  if (principalStroops <= 0n || months <= 0 || apyBps <= 0) return 0n;
  const num = principalStroops * BigInt(apyBps) * BigInt(months);
  const den = MONTHS_PER_YEAR * BPS_DENOMINATOR;
  return (num + den - 1n) / den;
}

export function computeLoanTotalOwedStroops(
  principalStroops: bigint,
  months: number,
  apyBps: number = LENDING_APY_BPS
): bigint {
  return principalStroops + computeLoanInterestStroops(principalStroops, months, apyBps);
}

export function computeLoanTotalOwed(
  principal: number,
  months: number,
  apyBps: number = LENDING_APY_BPS
): number {
  if (principal <= 0 || months <= 0) return 0;
  const principalStroops = BigInt(Math.round(principal * Number(STROOPS_PER_UNIT)));
  const totalStroops = computeLoanTotalOwedStroops(principalStroops, months, apyBps);
  return Number(totalStroops) / Number(STROOPS_PER_UNIT);
}