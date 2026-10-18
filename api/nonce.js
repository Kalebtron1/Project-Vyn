import crypto from "crypto";
import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";

// Simple store en memoria de nonces: address -> { nonce, expires }
const nonces = new Map();

export function resetNoncesForTests() {
  nonces.clear();
}

export function generateNonce() {
  return crypto.randomBytes(16).toString("hex");
}

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { address } = req.body || {};
  if (!address) return res.status(400).json({ error: "address required" });

  const nonce = generateNonce();
  const expires = Date.now() + 5 * 60 * 1000; // 5 minutes
  nonces.set(address, { nonce, expires });

  return res.json({ success: true, nonce, expires });
}

// Helper for other modules
export function consumeNonce(address, nonce) {
  const entry = nonces.get(address);
  if (!entry) return false;
  if (entry.expires < Date.now()) {
    nonces.delete(address);
    return false;
  }
  if (entry.nonce !== nonce) return false;
  nonces.delete(address);
  return true;
}

/**
 * Construye una transacción de reto estilo SEP-10 (secuencia 0, no ejecutable en red)
 * que vincula `address` y `nonce` mediante una operación `manageData`.
 */
export function buildChallengeTxXdr(
  address,
  nonce,
  networkPassphrase = Networks.TESTNET
) {
  const account = new Account(address, "0");
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.manageData({
        name: "vyn_auth_nonce",
        value: Buffer.from(String(nonce), "utf8"),
      })
    )
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

function decodeSignatureBytes(sig) {
  const trimmed = String(sig || "").trim();
  if (/^[0-9a-fA-F]{128}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  return Buffer.from(trimmed, "base64");
}

/**
 * Verifica criptográficamente que `signature` haya sido firmada por la clave privada
 * de `address` sobre el `nonce` activo y consume el `nonce` para impedir replay.
 * Soporta tanto una transacción de reto XDR firmada (WalletAdapter.signChallenge)
 * como una firma Ed25519 directa sobre el nonce (signMessage).
 */
export function verifySignedChallenge({
  address,
  nonce,
  signature,
  networkPassphrase = Networks.TESTNET,
}) {
  if (!address || !nonce || !signature) {
    return {
      ok: false,
      error: "Falta nonce o firma de verificación de la wallet",
    };
  }

  let kp;
  try {
    kp = Keypair.fromPublicKey(address);
  } catch {
    return { ok: false, error: "Dirección Stellar inválida" };
  }

  let signatureValid = false;

  // Intento 1: ¿Es una transacción Stellar XDR firmada (SEP-10 style challenge)?
  try {
    const tx = TransactionBuilder.fromXDR(String(signature).trim(), networkPassphrase);
    if (tx.source === address) {
      const hasMatchingNonceOp = (tx.operations || []).some(
        (op) =>
          op.type === "manageData" &&
          op.name === "vyn_auth_nonce" &&
          op.value &&
          Buffer.from(op.value).toString("utf8") === String(nonce)
      );
      if (hasMatchingNonceOp && Array.isArray(tx.signatures) && tx.signatures.length > 0) {
        const txHash = tx.hash();
        signatureValid = tx.signatures.some((decorated) => {
          try {
            return kp.verify(txHash, decorated.signature());
          } catch {
            return false;
          }
        });
      }
    }
  } catch {
    // No es XDR válido; probamos firma Ed25519 directa (signMessage)
  }

  // Intento 2: Firma Ed25519 directa (base64 o hex) sobre el nonce o mensaje canónico
  if (!signatureValid) {
    try {
      const sigBytes = decodeSignatureBytes(signature);
      if (sigBytes.length === 64) {
        const rawNonceBuf = Buffer.from(String(nonce), "utf8");
        const canonicalBuf = Buffer.from(`vyn_auth:${address}:${nonce}`, "utf8");
        signatureValid =
          kp.verify(rawNonceBuf, sigBytes) || kp.verify(canonicalBuf, sigBytes);
      }
    } catch {
      signatureValid = false;
    }
  }

  if (!signatureValid) {
    return { ok: false, error: "Firma de wallet inválida para el reto solicitado" };
  }

  // Consumimos el nonce solo después de verificar la firma (o validamos que esté vigente)
  if (!consumeNonce(address, nonce)) {
    return { ok: false, error: "Invalid or expired nonce" };
  }

  return { ok: true };
}
