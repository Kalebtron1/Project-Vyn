import { useState, useEffect } from "react";
import { X, Fingerprint, CheckCircle2, AlertCircle, ExternalLink, Loader2 } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { isConnected, requestAccess, signTransaction } from "@stellar/freighter-api";
import confetti from "canvas-confetti";
import { supabase } from "@/integrations/supabase/client";
import {
  TransactionBuilder,
  Networks,
  Operation,
  BASE_FEE,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { CONTRACT_ID, RPC_URL } from "@/stellar/contracts";
import { pollTransaction } from "@/lib/txPoller";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type DepositStep =
  | "input"      // user enters amount
  | "signing"    // waiting for Freighter signature
  | "submitted"  // tx sent, polling for confirmation
  | "success"    // terminal — confirmed on-chain
  | "error";     // terminal — failed or timed-out

// Maximum consecutive retries the user may attempt in one session.
const MAX_USER_RETRIES = 3;

interface Props {
  open: boolean;
  onClose: () => void;
}

const DepositModal = ({ open, onClose }: Props) => {
  const { addDeposit, confirmDeposit, failDeposit, isUnlocked, setShowUnlockCelebration } = useApp();
  const [amount, setAmount] = useState("50");
  const [step, setStep] = useState<DepositStep>("input");
  const [errorMsg, setErrorMsg] = useState("");
  const [txHash, setTxHash] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  // Track the optimistic deposit id so we can confirm/fail it later.
  const [pendingDepositId, setPendingDepositId] = useState<string | null>(null);

  // Registered wallet guard
  const [registeredWallet, setRegisteredWallet] = useState<string | null>(null);

  // Fetch registered wallet when modal opens
  useEffect(() => {
    let isMounted = true;

    const fetchWallet = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("wallet_address")
          .eq("user_id", user.id)
          .single();

        if (profile?.wallet_address && isMounted) {
          setRegisteredWallet(profile.wallet_address);
        }
      } catch (error) {
        console.error("Error obteniendo la wallet registrada:", error);
      }
    };

    if (open) {
      fetchWallet();
    }

    return () => {
      isMounted = false;
    };
  }, [open]);

  if (!open) return null;

  const reset = () => {
    setStep("input");
    setAmount("50");
    setErrorMsg("");
    setTxHash("");
    setPendingDepositId(null);
    setRetryCount(0);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleConfirm = async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return;

    setStep("signing");
    setErrorMsg("");

    // Optimistically record the deposit — we'll confirm or roll it back below.
    const depositId = addDeposit(val);
    setPendingDepositId(depositId);

    try {
      // 1. Verify Freighter is installed and accessible
      const server = new rpc.Server(RPC_URL);
      const connected = await isConnected();
      if (!connected) throw new Error("Instala la extensión Freighter para continuar.");

      const accessResult = await requestAccess();
      if (accessResult.error || !accessResult.address)
        throw new Error("Acceso denegado. Desbloquea Freighter e intenta de nuevo.");

      const sourcePublicKey = accessResult.address;

      // 2. Wallet-lock guard
      if (registeredWallet && sourcePublicKey !== registeredWallet) {
        const shortWallet = `${registeredWallet.substring(0, 4)}...${registeredWallet.substring(52)}`;
        throw new Error(
          `Cuenta incorrecta en Freighter. Por favor cambia a tu cuenta registrada: ${shortWallet}`
        );
      }

      const account = await server.getAccount(sourcePublicKey);
      const amountInStroops = BigInt(Math.floor(val * 10_000_000));

      // 3. Build transaction
      let transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: CONTRACT_ID,
            function: "deposit",
            args: [
              nativeToScVal(sourcePublicKey, { type: "address" }),
              nativeToScVal(amountInStroops, { type: "i128" }),
            ],
          })
        )
        .setTimeout(30)
        .build();

      // 4. Prepare (footprint + resource estimation)
      transaction = await server.prepareTransaction(transaction);

      // 5. Sign with Freighter
      const signResult = await signTransaction(transaction.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });

      if (signResult.error || !signResult.signedTxXdr) {
        throw new Error("Firma rechazada o cancelada por el usuario.");
      }

      // 6. Submit to network
      setStep("submitted");
      const transactionToSubmit = TransactionBuilder.fromXDR(
        signResult.signedTxXdr,
        Networks.TESTNET
      );
      const submitRes = await server.sendTransaction(transactionToSubmit) as any;

      if (!submitRes?.hash) {
        throw new Error("La red no devolvió un hash. Revisa tu saldo e intenta nuevamente.");
      }

      const submittedHash = submitRes.hash;
      setTxHash(submittedHash);

      // 7. Poll for terminal state (bounded — never hangs indefinitely)
      const pollResult = await pollTransaction(submittedHash);

      if (pollResult.status === "SUCCESS") {
        // Confirm in context (flips isUnlocked if threshold crossed)
        confirmDeposit(depositId, submittedHash);
        setStep("success");
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.65 } });

        const willUnlock = !isUnlocked;
        if (willUnlock) {
          setTimeout(() => setShowUnlockCelebration(true), 800);
        }
      } else {
        // FAILED or TIMEOUT — roll back the optimistic record
        failDeposit(depositId);
        throw new Error(
          pollResult.reason ??
            "La transacción no alcanzó un estado final. Revisa el explorador e intenta de nuevo."
        );
      }
    } catch (err: any) {
      console.error("Deposit Error:", err);
      // If we created an optimistic record and haven't confirmed/failed it yet, fail it now.
      if (depositId && step !== "success") {
        failDeposit(depositId);
      }
      setErrorMsg(err.message || "Error al procesar el depósito. Intenta de nuevo.");
      setStep("error");
    }
  };

  const handleRetry = () => {
    if (retryCount >= MAX_USER_RETRIES) {
      setErrorMsg(
        `Has alcanzado el límite de ${MAX_USER_RETRIES} intentos. Espera unos minutos antes de reintentar.`
      );
      return;
    }
    setRetryCount((c) => c + 1);
    setPendingDepositId(null);
    setStep("input");
    setErrorMsg("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
        onClick={step === "signing" || step === "submitted" ? undefined : handleClose}
      />
      <div className="relative bg-card rounded-t-3xl sm:rounded-2xl w-full max-w-md p-6 pb-8 animate-slide-up z-10">
        {step !== "signing" && step !== "submitted" && (
          <button
            onClick={handleClose}
            className="absolute right-4 top-4 p-2 rounded-full hover:bg-secondary active:scale-95 transition-all"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        )}

        {/* ── INPUT ── */}
        {step === "input" && (
          <>
            <h2 className="text-xl font-bold text-foreground mb-1">Depositar Ganancias</h2>
            {retryCount > 0 && (
              <p className="text-xs text-amber-500 mb-4">
                Intento {retryCount}/{MAX_USER_RETRIES}
              </p>
            )}
            <div className="mb-6 mt-4">
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                Monto (XLM)
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full text-3xl font-bold text-foreground bg-secondary rounded-xl px-4 py-4 outline-none focus:ring-2 focus:ring-primary/20 transition-shadow tabular-nums"
                min="1"
              />
            </div>

            <div className="flex gap-2 mb-6">
              {[25, 50, 100].map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(String(v))}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95 ${
                    amount === String(v)
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground"
                  }`}
                >
                  {v} XLM
                </button>
              ))}
            </div>

            <button
              onClick={handleConfirm}
              className="btn-emerald w-full flex items-center justify-center gap-2 py-4 text-base"
            >
              <Fingerprint className="w-5 h-5" />
              Confirmar con Freighter
            </button>
          </>
        )}

        {/* ── SIGNING ── */}
        {step === "signing" && (
          <div className="flex flex-col items-center py-10">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-5">
              <Fingerprint className="w-8 h-8 text-primary animate-pulse" />
            </div>
            <p className="text-lg font-bold text-foreground mb-1">Preparando contrato...</p>
            <p className="text-sm text-muted-foreground text-center max-w-[260px]">
              Calculando recursos y esperando confirmación en Freighter.
            </p>
          </div>
        )}

        {/* ── SUBMITTED / POLLING ── */}
        {step === "submitted" && (
          <div className="flex flex-col items-center py-10">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-5">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
            <p className="text-lg font-bold text-foreground mb-1">Confirmando en la red...</p>
            <p className="text-sm text-muted-foreground text-center max-w-[260px]">
              Tu transacción fue enviada. Esperando confirmación on-chain (puede tomar hasta 60&nbsp;s).
            </p>
            {txHash && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Ver en el explorador
              </a>
            )}
          </div>
        )}

        {/* ── SUCCESS ── */}
        {step === "success" && (
          <div className="flex flex-col items-center py-8 animate-scale-up">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-10 h-10 text-primary" />
            </div>
            <p className="text-xl font-bold text-foreground mb-1">¡Depósito confirmado! 🎉</p>
            <p className="text-sm text-muted-foreground mb-4">
              Se depositaron <span className="font-bold text-foreground">{amount} XLM</span>{" "}
              y fueron verificados en la red.
            </p>

            {txHash && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline mb-6"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Ver en el explorador
              </a>
            )}

            <button
              onClick={handleClose}
              className="w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-semibold shadow-sm hover:bg-primary/90 active:scale-[0.97] transition-all"
            >
              Listo
            </button>
          </div>
        )}

        {/* ── ERROR ── */}
        {step === "error" && (
          <div className="flex flex-col items-center py-8 animate-scale-up">
            <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mb-5">
              <AlertCircle className="w-10 h-10 text-destructive" />
            </div>
            <p className="text-lg font-bold text-foreground mb-2">Error en el depósito</p>
            <p className="text-sm text-muted-foreground text-center max-w-[280px] mb-2">{errorMsg}</p>

            {retryCount >= MAX_USER_RETRIES ? (
              <p className="text-xs text-destructive text-center mb-6">
                Límite de reintentos alcanzado. Espera unos minutos antes de volver a intentarlo.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground text-center mb-6">
                Reintento {retryCount}/{MAX_USER_RETRIES} disponibles.
              </p>
            )}

            {txHash && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline mb-4"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Inspeccionar en el explorador
              </a>
            )}

            <div className="w-full flex gap-3">
              <button
                onClick={handleClose}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors active:scale-[0.97]"
              >
                Cancelar
              </button>
              <button
                onClick={handleRetry}
                disabled={retryCount >= MAX_USER_RETRIES}
                className="flex-1 rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-semibold shadow-sm hover:bg-primary/90 active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DepositModal;