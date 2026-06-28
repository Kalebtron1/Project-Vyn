/**
 * PrivyBridge — componente invisible dentro de `<PrivyProvider>` que:
 *  1. Garantiza que el usuario autenticado tenga una wallet Stellar embebida de Privy
 *     (la busca en `linkedAccounts`; si no hay, la crea con `useCreateWallet`).
 *  2. Registra en `privyBridge` la función de firma: construye el hash de la tx Stellar,
 *     lo firma con `useSignRawHash` (Ed25519) y adjunta la firma al XDR.
 *  3. Publica el evento de conexión para que Login abra la sesión de la app.
 */

import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignRawHash, useCreateWallet } from "@privy-io/react-auth/extended-chains";
import { TransactionBuilder, Keypair } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { NETWORK_PASSPHRASE } from "@/lib/stellarWalletsKit";
import { registerPrivySigner, notifyPrivyConnected } from "@/lib/privyBridge";

/** hex (con o sin 0x) → Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function findStellarAddress(user: unknown): string | undefined {
  const accounts = (user as { linkedAccounts?: Array<Record<string, unknown>> })?.linkedAccounts || [];
  const acc = accounts.find((a) => a.type === "wallet" && a.chainType === "stellar");
  return acc?.address as string | undefined;
}

const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";

// La wallet de Privy nace vacía y SIN crear on-chain (0 XLM). Para que el usuario de
// correo pueda operar (reservas, fees, trustlines), la creamos con Friendbot en testnet.
// Idempotente: si ya existe, no hace nada. En mainnet esto lo haría la tesorería.
async function ensureFundedTestnet(address: string): Promise<void> {
  try {
    const res = await fetch(`${HORIZON_TESTNET}/accounts/${address}`);
    if (res.status === 404) {
      await fetch(`${FRIENDBOT}/?addr=${encodeURIComponent(address)}`);
    }
  } catch {
    /* la red puede fallar; se reintenta en el próximo login */
  }
}

export function PrivyBridge() {
  const { ready, authenticated, user } = usePrivy();
  const { signRawHash } = useSignRawHash();
  const { createWallet } = useCreateWallet();
  const addrRef = useRef<string | null>(null);

  // Asegura wallet Stellar + registra firma + notifica conexión.
  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    let cancelled = false;

    (async () => {
      let address = findStellarAddress(user);
      if (!address) {
        try {
          const { wallet } = await createWallet({ chainType: "stellar" });
          address = wallet.address;
        } catch {
          // Pudo crearse en paralelo: re-leer del usuario.
          address = findStellarAddress(user);
        }
      }
      if (cancelled || !address) return;
      addRefAndRegister(address);
      // Fondea la cuenta nueva en testnet (en segundo plano, no bloquea el ingreso).
      void ensureFundedTestnet(address);
    })();

    function addRefAndRegister(address: string) {
      addrRef.current = address;
      const email = (user as { email?: { address?: string } })?.email?.address;

      registerPrivySigner(async (xdr: string) => {
        const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
        // Stellar firma el SHA-256 del signature base; `tx.hash()` ya es ese hash de 32 bytes.
        const txHash = tx.hash();
        const hashHex = ("0x" + txHash.toString("hex")) as `0x${string}`;
        const { signature } = await signRawHash({ address, chainType: "stellar", hash: hashHex });
        // `signature` es la firma Ed25519 (hex). Verificamos LOCALMENTE que valide sobre el
        // hash antes de enviarla; si no, fallamos claro (evita un confuso tx_bad_auth de Horizon).
        const sigBytes = hexToBytes(signature);
        const kp = Keypair.fromPublicKey(address);
        if (!kp.verify(txHash, Buffer.from(sigBytes))) {
          throw new Error(
            "La firma de Privy no valida sobre el hash de la transacción. " +
            "Suele indicar que el servicio de wallet de Privy no respondió bien " +
            "(revisa bloqueadores/red o la config de embedded wallets en el dashboard)."
          );
        }
        tx.addSignature(address, bytesToBase64(sigBytes));
        return tx.toXDR();
      });

      notifyPrivyConnected({ stellarAddress: address, email });
    }

    return () => { cancelled = true; };
  }, [ready, authenticated, user, createWallet, signRawHash]);

  // Limpia la firma al cerrar sesión.
  useEffect(() => {
    if (ready && !authenticated) {
      registerPrivySigner(null);
      addrRef.current = null;
    }
  }, [ready, authenticated]);

  return null;
}
