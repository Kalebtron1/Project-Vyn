import { xdr, nativeToScVal } from "@stellar/stellar-sdk";

// staking_pool respaldado por DeFindex. Se configura vía VITE_STAKING_CONTRACT_ID
// (sin hardcodear el id; cámbialo en .env tras cada redeploy de testnet).
export const CONTRACT_ID = import.meta.env.VITE_STAKING_CONTRACT_ID;
// Vault USDC de DeFindex en testnet (referencia; el contrato lo guarda vía init).
export const VAULT_ID = "CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN";
// Contrato de préstamos (vinculo_lending). El apartado de tesorería lee y retira
// desde aquí el interés acumulado (ganancia del negocio, denominada en XLM).
export const LENDING_CONTRACT_ID = import.meta.env.VITE_LENDING_CONTRACT_ID;
// Wallet de tesorería: única que ve y puede operar el apartado de ganancias.
// El gating de UI es cosmético; la autorización real la impone el contrato
// (`withdraw_interest` exige `treasury.require_auth()`).
export const TREASURY_ADDRESS = import.meta.env.VITE_TREASURY_ADDRESS;
export const RPC_URL = "https://soroban-testnet.stellar.org";