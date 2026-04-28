import {
  Lock,
  Sparkles,
  ArrowDownToLine,
  Loader2,
  Activity,
  ArrowUpFromLine,
  CalendarClock,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useWallet } from "@/hooks/useWallet";
import { useState, useEffect } from "react";
import confetti from "canvas-confetti";

// Stellar SDK
import {
  rpc,
  Contract,
  Networks,
  Address,
  nativeToScVal,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { requestAccess, signTransaction } from "@stellar/freighter-api";
import { pollTransaction } from "@/lib/txPoller";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const LENDING_CONTRACT_ID =
  import.meta.env.VITE_LENDING_CONTRACT_ID ||
  "CDNF6NGNB7RG7QLZYPMWROVSV3VRVWX2FRZQTNT3Y2GRBNWJP3GEBONV";

const RPC_URL = "https://soroban-testnet.stellar.org";

// Withdraw/repay retry cap — prevents accidental double-execution.
const MAX_TX_RETRIES = 2;

// ---------------------------------------------------------------------------
// Friendly error mapping for withdraw/repay
// ---------------------------------------------------------------------------
const toFriendlyTxError = (error: any): string => {
  const raw = String(error?.message || "").toLowerCase();

  if (
    raw.includes("request_loan") &&
    raw.includes("balance") &&
    (raw.includes("hosterror") ||
      raw.includes("invalidaction") ||
      raw.includes("unreachablecodereached"))
  ) {
    return "No hay liquidez suficiente en el pool ahora. Intenta con un monto menor o vuelve más tarde.";
  }

  if (raw.includes("active loan") || raw.includes("no active loan")) {
    return "Ya tienes un préstamo activo. Págalo antes de solicitar uno nuevo.";
  }

  if (raw.includes("tier") || raw.includes("sbt")) {
    return "Tu NFT actual no habilita este crédito. Actualiza tu nivel e intenta nuevamente.";
  }

  if (raw.includes("cancelada") || raw.includes("cancelled") || raw.includes("rechazada")) {
    return "Cancelaste la firma en Freighter. No se realizó ninguna operación.";
  }

  if (raw.includes("timeout") || raw.includes("tiempo")) {
    return "No se pudo confirmar la transacción a tiempo. Revisa el explorador antes de reintentar.";
  }

  return "No pudimos procesar la operación. Revisa tu conexión e intenta de nuevo.";
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const CreditSection = () => {
  const { creditWithdrawn, withdrawCredit, deposits } = useApp();
  const { wallet } = useWallet();

  // ── Loading / credit state ──
  const [loadingCredit, setLoadingCredit] = useState(true);
  const [creditData, setCreditData] = useState({
    limit: 0,
    tierName: "Bronce",
    tier: 0,
    isUnlocked: false,
  });

  // ── Transaction flow ──
  // "idle" | "signing" | "submitted" | "confirmed" | "failed"
  type TxPhase = "idle" | "signing" | "submitted" | "confirmed" | "failed";
  const [withdrawPhase, setWithdrawPhase] = useState<TxPhase>("idle");
  const [repayPhase, setRepayPhase] = useState<TxPhase>("idle");
  const [withdrawHash, setWithdrawHash] = useState("");
  const [repayHash, setRepayHash] = useState("");
  const [withdrawRetries, setWithdrawRetries] = useState(0);
  const [repayRetries, setRepayRetries] = useState(0);

  // ── Error messages ──
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Registered wallet guard ──
  const [registeredWallet, setRegisteredWallet] = useState<string | null>(null);

  // ── Delinquency simulation (1 month = 60 s) ──
  const [timeLeft, setTimeLeft] = useState(60);
  const [isDefaulted, setIsDefaulted] = useState(false);

  // Derived
  const totalToPay = creditData.limit * 1.05;
  const loadingTx =
    withdrawPhase === "signing" ||
    withdrawPhase === "submitted" ||
    repayPhase === "signing" ||
    repayPhase === "submitted";

  // ---------------------------------------------------------------------------
  // Fetch on-chain credit (with explicit error surface)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let isMounted = true;

    const fetchBlockchainCredit = async () => {
      if (!wallet) {
        if (isMounted) setLoadingCredit(true);
        return;
      }

      if (isMounted) setLoadingCredit(true);
      setRegisteredWallet(wallet);

      try {
        const response = await fetch(`/api/get-available-credit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userAddress: wallet }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.success && isMounted) {
          setCreditData({
            limit: data.availableCredit,
            tierName: data.tierName,
            tier: data.tier,
            isUnlocked: data.tier >= 1,
          });
        } else if (!data.success && isMounted) {
          console.warn("[CreditSection] API returned success=false:", data);
        }
      } catch (error) {
        console.error("[CreditSection] Error cargando crédito on-chain:", error);
        // Don't silently swallow — leave previous creditData unchanged so the
        // UI doesn't regress to Bronce on a transient network hiccup.
      } finally {
        if (isMounted) setLoadingCredit(false);
      }
    };

    fetchBlockchainCredit();
    const intervalId = setInterval(fetchBlockchainCredit, 8_000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [wallet, deposits]);

  // ---------------------------------------------------------------------------
  // Delinquency timer (only active while credit is withdrawn)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    if (creditWithdrawn && timeLeft > 0 && !isDefaulted) {
      timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1_000);
    } else if (creditWithdrawn && timeLeft <= 0) {
      setIsDefaulted(true);
    }

    return () => clearInterval(timer);
  }, [creditWithdrawn, timeLeft, isDefaulted]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const buildServer = () => new rpc.Server(RPC_URL);

  async function getVerifiedSigner(): Promise<string> {
    const accessResponse = await requestAccess();
    const userAddress = accessResponse.address;
    if (!userAddress) throw new Error("Debes conectar tu billetera Freighter.");

    if (registeredWallet && userAddress !== registeredWallet) {
      const shortWallet = `${registeredWallet.substring(0, 4)}...${registeredWallet.substring(52)}`;
      throw new Error(`Cuenta incorrecta. Cambia en Freighter a: ${shortWallet}`);
    }

    return userAddress;
  }

  // ---------------------------------------------------------------------------
  // WITHDRAW (request_loan)
  // ---------------------------------------------------------------------------
  const handleWithdraw = async () => {
    if (withdrawPhase !== "idle" && withdrawPhase !== "failed") return;
    if (withdrawRetries >= MAX_TX_RETRIES && withdrawPhase === "failed") {
      setErrorMsg(
        `Límite de ${MAX_TX_RETRIES} reintentos alcanzado. Espera unos minutos antes de volver a intentarlo.`
      );
      return;
    }

    setWithdrawPhase("signing");
    setErrorMsg(null);

    try {
      const server = buildServer();
      const userAddress = await getVerifiedSigner();

      const amountInStroops = BigInt(creditData.limit) * BigInt(10_000_000);
      const months = 1;

      const contract = new Contract(LENDING_CONTRACT_ID);
      const operation = contract.call(
        "request_loan",
        new Address(userAddress).toScVal(),
        nativeToScVal(amountInStroops, { type: "i128" }),
        nativeToScVal(months, { type: "u64" })
      );

      const account = await server.getAccount(userAddress);
      const tx = new TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const preparedTx = await server.prepareTransaction(tx);
      const signResponse = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });

      if (signResponse.error || !signResponse.signedTxXdr) {
        throw new Error("Transacción cancelada en Freighter.");
      }

      setWithdrawPhase("submitted");

      const signedTx = TransactionBuilder.fromXDR(
        signResponse.signedTxXdr,
        Networks.TESTNET
      );
      const submitRes = await server.sendTransaction(signedTx) as any;

      if (!submitRes?.hash) {
        throw new Error("La red no devolvió un hash. Verifica tu saldo e intenta de nuevo.");
      }

      setWithdrawHash(submitRes.hash);

      // Poll for terminal state
      const pollResult = await pollTransaction(submitRes.hash);

      if (pollResult.status === "SUCCESS") {
        setWithdrawPhase("confirmed");
        setTimeLeft(60);
        setIsDefaulted(false);
        withdrawCredit();
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ["#10b981", "#34d399", "#ffffff"],
        });
      } else {
        setWithdrawRetries((c) => c + 1);
        throw new Error(
          pollResult.reason ?? "La transacción no alcanzó un estado final. Intenta de nuevo."
        );
      }
    } catch (error: any) {
      console.error("❌ Error al retirar:", error);
      setErrorMsg(toFriendlyTxError(error));
      setWithdrawPhase("failed");
    }
  };

  // ---------------------------------------------------------------------------
  // REPAY
  // ---------------------------------------------------------------------------
  const handleRepay = async () => {
    if (repayPhase !== "idle" && repayPhase !== "failed") return;
    if (repayRetries >= MAX_TX_RETRIES && repayPhase === "failed") {
      setErrorMsg(
        `Límite de ${MAX_TX_RETRIES} reintentos alcanzado. Espera unos minutos antes de volver a intentarlo.`
      );
      return;
    }

    setRepayPhase("signing");
    setErrorMsg(null);

    try {
      const server = buildServer();
      const userAddress = await getVerifiedSigner();

      const amountToRepay = BigInt(Math.ceil(totalToPay * 10_000_000));

      const contract = new Contract(LENDING_CONTRACT_ID);
      const operation = contract.call(
        "repay",
        new Address(userAddress).toScVal(),
        nativeToScVal(amountToRepay, { type: "i128" })
      );

      const account = await server.getAccount(userAddress);
      const tx = new TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const preparedTx = await server.prepareTransaction(tx);
      const signResponse = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });

      if (signResponse.error || !signResponse.signedTxXdr) {
        throw new Error("Transacción cancelada en Freighter.");
      }

      setRepayPhase("submitted");

      const signedTx = TransactionBuilder.fromXDR(
        signResponse.signedTxXdr,
        Networks.TESTNET
      );
      const submitRes = await server.sendTransaction(signedTx) as any;

      if (!submitRes?.hash) {
        throw new Error("La red no devolvió un hash. Verifica tu saldo e intenta de nuevo.");
      }

      setRepayHash(submitRes.hash);

      // Poll until confirmed — only reload after on-chain success
      const pollResult = await pollTransaction(submitRes.hash);

      if (pollResult.status === "SUCCESS") {
        setRepayPhase("confirmed");
        // Small delay so the user sees the confirmed state before reload
        setTimeout(() => window.location.reload(), 1_500);
      } else {
        setRepayRetries((c) => c + 1);
        throw new Error(
          pollResult.reason ?? "La transacción no alcanzó un estado final. Intenta de nuevo."
        );
      }
    } catch (error: any) {
      console.error("❌ Error al pagar:", error);
      setErrorMsg(toFriendlyTxError(error));
      setRepayPhase("failed");
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  const withdrawLabel = () => {
    if (withdrawPhase === "signing") return <><Loader2 className="w-5 h-5 animate-spin" /> Firmando...</>;
    if (withdrawPhase === "submitted") return <><Loader2 className="w-5 h-5 animate-spin" /> Confirmando on-chain...</>;
    if (withdrawPhase === "confirmed") return <><CheckCircle2 className="w-5 h-5" /> Retirado</>;
    return <><ArrowDownToLine className="w-5 h-5" /> Retirar a mi Wallet</>;
  };

  const repayLabel = () => {
    if (repayPhase === "signing") return <><Loader2 className="w-4 h-4 animate-spin" /> Firmando...</>;
    if (repayPhase === "submitted") return <><Loader2 className="w-4 h-4 animate-spin" /> Confirmando on-chain...</>;
    if (repayPhase === "confirmed") return <><CheckCircle2 className="w-4 h-4" /> Pago confirmado</>;
    return <><ArrowUpFromLine className="w-4 h-4" /> Pagar {totalToPay.toFixed(2)} XLM</>;
  };

  // ---------------------------------------------------------------------------
  // Loading / locked screens
  // ---------------------------------------------------------------------------
  if (loadingCredit) {
    return (
      <div className="card-elevated p-10 flex flex-col items-center justify-center min-h-[220px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
        <p className="text-xs text-muted-foreground font-medium">Sincronizando con Soroban...</p>
      </div>
    );
  }

  if (!creditData.isUnlocked) {
    return (
      <div className="card-elevated p-6 relative overflow-hidden min-h-[220px] flex flex-col justify-center">
        <div className="absolute inset-0 bg-secondary/40 backdrop-blur-[1px]" />
        <div className="relative flex flex-col items-center text-center py-4">
          <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-3 border border-border">
            <Lock className="w-5 h-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-bold text-foreground mb-1">Crédito Bloqueado 🔒</p>
          <p className="text-sm text-muted-foreground max-w-[260px]">
            Tu nivel actual es{" "}
            <span className="text-foreground font-bold">{creditData.tierName}</span>. Reclama tu
            NFT para desbloquear.
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Unlocked UI
  // ---------------------------------------------------------------------------
  return (
    <div className="card-elevated p-6 border-2 border-primary/20 bg-gradient-to-br from-card to-primary/5 transition-all duration-700 min-h-[220px] flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-start mb-1">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold tracking-wide uppercase text-primary">
            Crédito — Nivel {creditData.tierName}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
          <Activity className="w-3 h-3 animate-pulse" />
          ON-CHAIN
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        {creditWithdrawn ? (
          isDefaulted ? (
            /* ── DEFAULTED ── */
            <div className="py-4 text-center animate-fade-in flex flex-col h-full justify-between">
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Lock className="w-6 h-6 text-red-500" />
                </div>
                <p className="text-lg font-bold text-red-500">¡CUENTA CONGELADA!</p>
                <p className="text-xs text-red-400 mt-2">
                  Tu plazo de pago ha expirado. Deuda pendiente:{" "}
                  <strong>{totalToPay.toFixed(2)} XLM</strong>.
                </p>
              </div>
              <button
                disabled
                className="w-full mt-4 flex items-center justify-center gap-3 py-3 text-sm font-bold rounded-xl bg-secondary text-muted-foreground cursor-not-allowed opacity-50"
              >
                Contactar a Soporte
              </button>
            </div>
          ) : repayPhase === "confirmed" ? (
            /* ── REPAY CONFIRMED ── */
            <div className="py-4 text-center animate-fade-in flex flex-col h-full justify-center gap-3">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <p className="text-base font-bold text-foreground">¡Pago confirmado on-chain! 🎉</p>
              <p className="text-xs text-muted-foreground">Recargando la aplicación...</p>
              {repayHash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${repayHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 text-xs text-primary font-semibold hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Ver en explorador
                </a>
              )}
            </div>
          ) : (
            /* ── ACTIVE LOAN ── */
            <div className="py-2 text-center animate-fade-in flex flex-col h-full justify-between">
              <div>
                <p className="text-sm font-bold text-foreground">Deuda Total a Pagar:</p>

                <div className="flex items-center justify-center gap-2 mt-1">
                  <TrendingUp className="w-5 h-5 text-amber-500" />
                  <span className="text-4xl font-extrabold text-amber-500 tabular-nums">
                    {totalToPay.toFixed(2)}
                  </span>
                  <span className="text-lg font-bold text-amber-500/70">XLM</span>
                </div>

                {/* Timer */}
                <div
                  className={`flex items-center justify-center gap-2 mt-4 mb-4 text-sm py-2 px-3 rounded-lg font-bold transition-colors ${
                    timeLeft <= 15
                      ? "text-red-500 bg-red-500/10 animate-pulse"
                      : "text-amber-600 bg-amber-500/10"
                  }`}
                >
                  <CalendarClock className="w-4 h-4" />
                  <span>
                    Vence en: {Math.floor(timeLeft / 60)}:
                    {(timeLeft % 60).toString().padStart(2, "0")} min
                  </span>
                </div>

                {/* Repay submission status */}
                {(repayPhase === "submitted") && (
                  <div className="mb-3 p-2 bg-primary/10 border border-primary/20 rounded-lg text-xs text-primary text-center animate-pulse">
                    Esperando confirmación on-chain...{" "}
                    {repayHash && (
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${repayHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline font-semibold"
                      >
                        Ver tx
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Error banner */}
              {errorMsg && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2 text-destructive text-xs text-left animate-fade-in">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>{errorMsg}</p>
                </div>
              )}

              <button
                onClick={handleRepay}
                disabled={loadingTx || repayPhase === "confirmed"}
                className="w-full flex items-center justify-center gap-3 py-3 text-sm font-bold rounded-xl border-2 border-primary text-primary hover:bg-primary/10 transition-all disabled:opacity-50"
              >
                {repayLabel()}
              </button>

              {repayPhase === "failed" && repayRetries < MAX_TX_RETRIES && (
                <p className="text-xs text-center text-muted-foreground mt-2">
                  Puedes reintentar el pago ({MAX_TX_RETRIES - repayRetries} intento(s) restante(s)).
                </p>
              )}
            </div>
          )
        ) : withdrawPhase === "confirmed" ? (
          /* ── WITHDRAW CONFIRMED (before credit state updates) ── */
          <div className="py-4 text-center animate-fade-in flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <p className="text-base font-bold text-foreground">¡Retiro confirmado on-chain! 🎉</p>
            {withdrawHash && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${withdrawHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Ver en explorador
              </a>
            )}
          </div>
        ) : (
          /* ── INITIAL: WITHDRAW BUTTON ── */
          <div className="py-2 flex flex-col items-center justify-center">
            <div className="flex items-baseline gap-1 mt-1 mb-1">
              <span className="text-4xl font-extrabold text-foreground tabular-nums tracking-tight">
                {creditData.limit}
              </span>
              <span className="text-lg font-bold text-muted-foreground">XLM</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Límite de crédito disponible según tu SBT
            </p>

            {/* Submission progress */}
            {withdrawPhase === "submitted" && (
              <div className="w-full mb-4 p-2 bg-primary/10 border border-primary/20 rounded-lg text-xs text-primary text-center animate-pulse">
                Esperando confirmación on-chain...{" "}
                {withdrawHash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${withdrawHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-semibold"
                  >
                    Ver tx
                  </a>
                )}
              </div>
            )}

            {/* Error banner */}
            {errorMsg && (
              <div className="w-full mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2 text-destructive text-xs text-left animate-fade-in">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>{errorMsg}</p>
              </div>
            )}

            <button
              onClick={handleWithdraw}
              disabled={loadingTx}
              className="btn-emerald w-full flex items-center justify-center gap-3 py-4 text-base font-bold shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {withdrawLabel()}
            </button>

            {withdrawPhase === "failed" && withdrawRetries < MAX_TX_RETRIES && (
              <p className="text-xs text-center text-muted-foreground mt-2">
                Puedes reintentar ({MAX_TX_RETRIES - withdrawRetries} intento(s) restante(s)).
              </p>
            )}

            <div className="text-[10px] text-center text-muted-foreground mt-4 space-y-1">
              <p>El retiro genera una transacción en la red Testnet de Stellar.</p>
              <p className="font-semibold text-amber-500/80">
                Total a pagar al vencer (1 mes): {totalToPay.toFixed(2)} XLM (incluye 5% interés)
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CreditSection;