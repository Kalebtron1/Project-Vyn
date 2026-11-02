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
// Contrato de préstamos (vinculo_lending). El apartado de tesorería lee y retira
// desde aquí el interés acumulado (ganancia del negocio, denominada en XLM).
export const LENDING_CONTRACT_ID = import.meta.env.VITE_LENDING_CONTRACT_ID;
// Wallet de tesorería: única que ve y puede operar el apartado de ganancias.
// El gating de UI es cosmético; la autorización real la impone el contrato
// (`withdraw_interest` exige `treasury.require_auth()`).
export const TREASURY_ADDRESS = import.meta.env.VITE_TREASURY_ADDRESS;
export const RPC_URL = "https://soroban-testnet.stellar.org";