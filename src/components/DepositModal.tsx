import { useState, useEffect } from "react";
import { X, Fingerprint, CheckCircle2, AlertCircle, ExternalLink, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp } from "@/context/AppContext";
import { useMobileWallet } from "@/hooks/useMobileWallet";
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

interface Props {
  open: boolean;
  onClose: () => void;
}

// Map raw errors to user-friendly messages
function friendlyDepositError(msg: string, cancelled: boolean): string {
  if (cancelled) return "Firma cancelada. Puedes intentarlo de nuevo.";
  if (msg.includes("Cuenta incorrecta")) return msg; // already friendly
  if (msg.includes("popup")) return "El popup fue bloqueado. Permite ventanas emergentes e intenta de nuevo.";
  if (msg.includes("Instala") || msg.includes("not installed")) return "Wallet no disponible. Conecta tu wallet primero.";
  if (msg.includes("Acceso denegado") || msg.includes("rejected")) return "Acceso denegado. Aprueba la solicitud en tu wallet.";
  if (msg.includes("insufficient")) return "Saldo insuficiente para cubrir la transacción y las comisiones.";
  return msg || "Error al procesar el depósito. Intenta de nuevo.";
}

const DepositModal = ({ open, onClose }: Props) => {
  const { addDeposit, depositsCount, requiredDeposits, isUnlocked, setShowUnlockCelebration } = useApp();
  const { isMobile, provider, connect, sign } = useMobileWallet();
  const { t } = useTranslation();
  const [amount, setAmount] = useState("50");
  const [step, setStep] = useState<"input" | "signing" | "success" | "error">("input");
  const [errorMsg, setErrorMsg] = useState("");
  const [txHash, setTxHash] = useState("");
  const [registeredWallet, setRegisteredWallet] = useState<string | null>(null);

  // Fetch the wallet address registered in Supabase for security validation
  useEffect(() => {
    let mounted = true;
    const fetchWallet = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("wallet_address")
          .eq("user_id", user.id)
          .single();
        if (profile?.wallet_address && mounted) {
          setRegisteredWallet(profile.wallet_address);
        }
      } catch (e) {
        console.error("Error obteniendo wallet registrada:", e);
      }
    };
    if (open) fetchWallet();
    return () => { mounted = false; };
  }, [open]);

  if (!open) return null;

  const reset = () => {
    setStep("input");
    setAmount("50");
    setErrorMsg("");
    setTxHash("");
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

    try {
      const server = new rpc.Server(RPC_URL);
      // 1. Ensure we have a connected wallet address
      const connectResult = await connect();
      if (!connectResult.ok) {
        throw Object.assign(new Error(connectResult.error), { cancelled: connectResult.cancelled });
      }
      const sourcePublicKey = connectResult.address;

      // 2. Security: validate against registered wallet
      if (registeredWallet && sourcePublicKey !== registeredWallet) {
        const short = `${registeredWallet.substring(0, 4)}...${registeredWallet.substring(52)}`;
        throw new Error(`Cuenta incorrecta. Usa tu cuenta registrada: ${short}`);
      }

      // 3. Fetch account and build transaction
      const account = await server.getAccount(sourcePublicKey);
      const amountInStroops = BigInt(Math.floor(val * 10_000_000));

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

      // 4. Prepare (calculates Soroban footprint + gas)
      transaction = await server.prepareTransaction(transaction);

      // 5. Sign via the appropriate provider (Freighter on desktop, Albedo on mobile)
      const signResult = await sign(transaction.toXDR());
      if (!signResult.ok) {
        throw Object.assign(new Error(signResult.error), { cancelled: signResult.cancelled });
      }

      // 6. Submit
      const txToSubmit = TransactionBuilder.fromXDR(signResult.signedXdr, Networks.TESTNET);
      const submitRes = await server.sendTransaction(txToSubmit) as rpc.Api.SendTransactionResponse & { errorResultXdr?: string };
      const status = (submitRes.status ?? "").toUpperCase();

      if (status !== "PENDING" && status !== "SUCCESS") {
        throw new Error(submitRes.errorResultXdr || "La transacción fue rechazada por la red.");
      }

      setTxHash(submitRes.hash);

      const wasLocked = !isUnlocked;
      const willUnlock = depositsCount + 1 >= requiredDeposits;
      addDeposit(val);
      setStep("success");
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.65 } });

      if (wasLocked && willUnlock) {
        setTimeout(() => setShowUnlockCelebration(true), 800);
      }
    } catch (err) {
      const e = err as { message?: string; cancelled?: boolean };
      console.error("Deposit error:", e);
      setErrorMsg(friendlyDepositError(e.message ?? "", !!e.cancelled));
      setStep("error");
    }
  };

  const providerLabel = provider === "albedo" ? "Albedo" : "Freighter";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
        onClick={step === "signing" ? undefined : handleClose}
      />
      <div className="relative bg-card rounded-t-3xl sm:rounded-2xl w-full max-w-md p-6 pb-8 animate-slide-up z-10">
        {step !== "signing" && (
          <button
            onClick={handleClose}
            className="absolute right-4 top-4 p-2 rounded-full hover:bg-secondary active:scale-95 transition-all"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        )}

        {/* INPUT */}
        {step === "input" && (
          <>
            <h2 className="text-xl font-bold text-foreground mb-6">{t("deposit.title")}</h2>
            {isMobile && (
              <div className="flex items-center gap-1.5 mb-4 text-xs text-muted-foreground">
                <Smartphone className="w-3.5 h-3.5" />
                <span>{t("deposit.sign_with", { provider: providerLabel })}</span>
              </div>
            )}
            <div className="mb-6">
              <label className="text-sm font-medium text-muted-foreground mb-2 block">{t("deposit.amount_label")}</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full text-3xl font-bold text-foreground bg-secondary rounded-xl px-4 py-4 outline-none focus:ring-2 focus:ring-primary/20 transition-shadow tabular-nums"
                min="1"
                inputMode="decimal"
              />
            </div>

            <div className="flex gap-2 mb-6">
              {[25, 50, 100].map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(String(v))}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95 ${
                    amount === String(v) ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                  }`}
                >
                  {v} {t("common.usdc")}
                </button>
              ))}
            </div>

            <button
              onClick={handleConfirm}
              className="btn-emerald w-full flex items-center justify-center gap-2 py-4 text-base"
            >
              <Fingerprint className="w-5 h-5" />
              {t("deposit.confirm_button")}
            </button>
          </>
        )}

        {/* SIGNING */}
        {step === "signing" && (
          <div className="flex flex-col items-center py-10">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-5">
              {isMobile
                ? <Smartphone className="w-8 h-8 text-primary animate-pulse" />
                : <Fingerprint className="w-8 h-8 text-primary animate-pulse" />}
            </div>
            <p className="text-lg font-bold text-foreground mb-1">{t("deposit.signing_title")}</p>
            <p className="text-sm text-muted-foreground text-center max-w-[260px]">
              {t("deposit.signing_description")}
            </p>
          </div>
        )}

        {/* SUCCESS */}
        {step === "success" && (
          <div className="flex flex-col items-center py-8 animate-scale-up">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-10 h-10 text-primary" />
            </div>
            <p className="text-xl font-bold text-foreground mb-1">{t("deposit.success_title")}</p>
            <p className="text-sm text-muted-foreground mb-4">
              {t("deposit.success_description", { amount })}
            </p>
            {txHash && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline mb-6"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {t("deposit.view_explorer")}
              </a>
            )}
            <button
              onClick={handleClose}
              className="w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-semibold shadow-sm hover:bg-primary/90 active:scale-[0.97] transition-all"
            >
              {t("common.done")}
            </button>
          </div>
        )}

        {/* ERROR */}
        {step === "error" && (
          <div className="flex flex-col items-center py-8 animate-scale-up">
            <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mb-5">
              <AlertCircle className="w-10 h-10 text-destructive" />
            </div>
            <p className="text-lg font-bold text-foreground mb-2">{t("common.error")}</p>
            <p className="text-sm text-muted-foreground text-center max-w-[280px] mb-6">{errorMsg}</p>
            <div className="w-full flex gap-3">
              <button
                onClick={handleClose}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors active:scale-[0.97]"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => setStep("input")}
                className="flex-1 rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-semibold shadow-sm hover:bg-primary/90 active:scale-[0.97] transition-all"
              >
                {t("common.retry")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DepositModal;
