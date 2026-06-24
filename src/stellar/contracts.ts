import { xdr, nativeToScVal } from "@stellar/stellar-sdk";

// staking_pool respaldado por DeFindex. Actualizar tras el redeploy de testnet.
export const CONTRACT_ID = "CAIYBGMKSA5V5EYUFKGD5OCWWS5M34YC7MKUKE3BOQE2WZP3R7A4S2D2";
// Vault USDC de DeFindex en testnet (referencia; el contrato lo guarda vía init).
export const VAULT_ID = "CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN";
export const RPC_URL = "https://soroban-testnet.stellar.org";