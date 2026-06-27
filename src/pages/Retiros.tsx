import { useState, useEffect, useCallback } from "react";
import {
  ArrowDownToLine, Fingerprint, CheckCircle2,
  X, TrendingUp, Sparkles, Smartphone,
  Building2, Store, Clock, Globe, CircleCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp } from "@/context/AppContext";
import confetti from "canvas-confetti";
import AppShell from "@/components/AppShell";
import { useMobileWallet } from "@/hooks/useMobileWallet";

import { TransactionBuilder, Networks, Operation, BASE_FEE, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { CONTRACT_ID, RPC_URL } from "@/stellar/contracts";
import { fetchContractBalance, fetchTotalDeposited, fetchTotalWithdrawn } from "@/stellar/queries";

const Retiros = () => {
  const { addWithdrawal } = useApp();
  const { isMobile, provider, connect, sign } = useMobileWallet();
  const { t } = useTranslation();

  // Posición real en vivo (depósito + rendimiento del vault DeFindex).
  const [realBalance, setRealBalance] = useState<number>(0);
  const [netPrincipal, setNetPrincipal] = useState<number>(0);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  // Modal de Retiro
  const [modalOpen, setModalOpen] = useState(false);
  const [amount, setAmount] = useState("25");
  const [step, setStep] = useState<"input" | "signing" | "success" | "error">("input");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const initWallet = async () => {
      try {
        // Prefer saved wallet from localStorage to avoid prompting on page load
        const saved = localStorage.getItem("vinculo_wallet");
        if (saved) {
          setWalletAddress(saved);
        } else {
          const result = await connect();
          if (result.ok) setWalletAddress(result.address);
        }
      } catch (error) { console.error("Error inicializando wallet:", error); }
    };
    initWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = useCallback(async (address: string) => {
    try {
      const [position, deposited, withdrawn] = await Promise.all([
        fetchContractBalance(address),
        fetchTotalDeposited(address),
        fetchTotalWithdrawn(address),
      ]);
      setRealBalance(position);
      setNetPrincipal(Math.max(0, deposited - withdrawn));
    } catch (error) { console.error("Error al cargar datos:", error); }
  }, []);

  useEffect(() => {
    if (!walletAddress) return;
    loadData(walletAddress);
    const intervalId = setInterval(() => loadData(walletAddress), 5000);
    return () => clearInterval(intervalId);
  }, [walletAddress, loadData]);

  const handleClose = () => {
    setStep("input"); setAmount("25"); setErrorMsg("");
    setModalOpen(false);
    if (walletAddress) loadData(walletAddress);
  };

  const processContractCall = async (functionName: string, args: xdr.ScVal[]) => {
    try {
      const server = new rpc.Server(RPC_URL);

      // Resolve wallet address — prefer cached, otherwise prompt
      let sourceAddress = walletAddress;
      if (!sourceAddress) {
        const connectResult = await connect();
        if (!connectResult.ok) {
          const msg = connectResult.cancelled
            ? "Conexión cancelada. Intenta de nuevo."
            : connectResult.error;
          throw new Error(msg);
        }
        sourceAddress = connectResult.address;
        setWalletAddress(sourceAddress);
      }

      const account = await server.getAccount(sourceAddress);

      let transaction = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.invokeContractFunction({ contract: CONTRACT_ID, function: functionName, args }))
        .setTimeout(30).build();

      transaction = await server.prepareTransaction(transaction);

      // Sign via the correct provider (Freighter desktop / Albedo mobile)
      const signResult = await sign(transaction.toXDR());
      if (!signResult.ok) {
        const msg = signResult.cancelled
          ? "Firma cancelada. Puedes intentarlo de nuevo."
          : signResult.error;
        throw new Error(msg);
      }

      const txToSubmit = TransactionBuilder.fromXDR(signResult.signedXdr, Networks.TESTNET);
      const submitRes = await server.sendTransaction(txToSubmit);
      const currentStatus = (submitRes.status ?? "").toUpperCase();
      if (currentStatus !== "PENDING" && currentStatus !== "SUCCESS") {
        throw new Error("Transacción rechazada por la red.");
      }

      // Poll until final status
      let txStatus = currentStatus;
      while (txStatus === "PENDING" || txStatus === "NOT_FOUND") {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const res = await server.getTransaction(submitRes.hash);
        txStatus = res.status.toUpperCase();
      }

      if (txStatus === "SUCCESS") {
        if (walletAddress) loadData(walletAddress);
        addWithdrawal(parseFloat(amount), submitRes.hash);
        setStep("success");
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.65 } });
      } else {
        throw new Error("Transacción fallida en el contrato.");
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : String(err)); setStep("error");
    }
  };

  const handleWithdraw = async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0 || val > realBalance) { setErrorMsg(t("withdrawals.error_insufficient")); setStep("error"); return; }
    setStep("signing");
    const valStroops = BigInt(Math.floor(val * 10000000));
    await processContractCall("withdraw", [
      nativeToScVal(walletAddress, { type: "address" }),
      nativeToScVal(valStroops, { type: "i128" })
    ]);
  };

  // Rendimiento real generado (posición − principal neto aportado).
  const yieldEarned = Math.max(0, realBalance - netPrincipal);

  // Métodos de retiro: USDC real + roadmap MXN (próximamente).
  const methods = [
    { id: "usdc", title: t("withdrawals.method_usdc_title"), desc: t("withdrawals.method_usdc_desc"), icon: ArrowDownToLine, available: true },
    { id: "spei", title: t("withdrawals.method_spei_title"), desc: t("withdrawals.method_spei_desc"), icon: Building2, available: false },
    { id: "moneygram", title: t("withdrawals.method_moneygram_title"), desc: t("withdrawals.method_moneygram_desc"), icon: Store, available: false },
  ];

  return (
    <AppShell title={t("withdrawals.title")} subtitle={t("withdrawals.subtitle")}>
      <div className="max-w-[1100px] mx-auto grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* Columna principal */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          {/* Balance + botón retirar */}
          <div className="card-elevated p-5 flex items-center justify-between animate-fade-up">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-0.5">{t("withdrawals.available_balance")}</p>
              <p className="text-2xl font-extrabold text-foreground tabular-nums">{realBalance.toFixed(2)} <span className="text-sm font-medium text-muted-foreground">USDC</span></p>
            </div>
            <button onClick={() => setModalOpen(true)} disabled={realBalance <= 0} className="btn-emerald flex items-center gap-2 px-5 py-3 text-sm disabled:opacity-40">
              <ArrowDownToLine className="w-4 h-4" /> {t("withdrawals.withdraw_button")}
            </button>
          </div>

          {/* Selector de método de retiro */}
          <div className="card-elevated p-5 md:p-6 animate-fade-up" style={{ animationDelay: "60ms" }}>
            <h3 className="text-sm font-bold text-foreground mb-4">{t("withdrawals.method_step_title")}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {methods.map((m) => {
                const Icon = m.icon;
                return (
                  <div
                    key={m.id}
                    className={`relative rounded-2xl p-4 border-2 transition-all ${
                      m.available
                        ? "border-primary bg-primary/5 cursor-pointer hover:-translate-y-0.5"
                        : "border-border bg-secondary/40 opacity-60 cursor-not-allowed"
                    }`}
                  >
                    {m.available ? (
                      <CircleCheck className="absolute top-3 right-3 w-4 h-4 text-primary" />
                    ) : (
                      <span className="absolute top-3 right-3 text-[8px] font-bold uppercase tracking-wider bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                        {t("withdrawals.coming_soon")}
                      </span>
                    )}
                    <Icon className={`w-7 h-7 mb-3 ${m.available ? "text-primary" : "text-muted-foreground"}`} />
                    <div className={`font-bold text-sm ${m.available ? "text-primary" : "text-foreground"}`}>{m.title}</div>
                    <div className="text-[11px] font-medium text-muted-foreground mt-0.5">{m.desc}</div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground mt-4 flex items-start gap-2">
              <Globe className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent" />
              {t("withdrawals.roadmap_note")}
            </p>
          </div>

          {/* Rendimiento real del vault DeFindex */}
          <div className="card-elevated p-5 animate-fade-up" style={{ animationDelay: "120ms" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">{t("withdrawals.yield_card_title")}</p>
                  <p className="text-xs text-muted-foreground">{t("withdrawals.yield_card_description")}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-emerald-500">+{yieldEarned.toFixed(2)} USDC</p>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider flex items-center gap-1 justify-end">
                  <Sparkles className="w-3 h-3 text-accent" /> {t("withdrawals.yield_label")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Columna informativa */}
        <div className="flex flex-col gap-5">
          <div className="card-elevated p-6 animate-fade-up" style={{ animationDelay: "80ms" }}>
            <h3 className="text-sm font-bold text-foreground mb-5">{t("withdrawals.info_title")}</h3>
            <ul className="space-y-5">
              <li className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-foreground">{t("withdrawals.info_processing_title")}</h4>
                  <p className="text-[11px] text-muted-foreground mt-1">{t("withdrawals.info_processing_desc")}</p>
                </div>
              </li>
              <li className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-foreground">{t("withdrawals.info_network_title")}</h4>
                  <p className="text-[11px] text-muted-foreground mt-1">{t("withdrawals.info_network_desc")}</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* MODAL DE RETIROS CON OPCIÓN MÁX */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={step === "signing" ? undefined : handleClose} />
          <div className="relative bg-card rounded-t-3xl sm:rounded-2xl w-full max-w-md p-6 pb-8 animate-slide-up z-10">
            {step !== "signing" && <button onClick={handleClose} className="absolute right-4 top-4 p-2 rounded-full hover:bg-secondary"><X className="w-5 h-5 text-muted-foreground" /></button>}

            {step === "input" && (
              <>
                <h2 className="text-xl font-bold text-foreground mb-1">{t("withdrawals.modal_withdraw_title")}</h2>
                <p className="text-xs text-muted-foreground mb-6">{t("withdrawals.modal_withdraw_subtitle")}</p>

                <div className="mb-4">
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full text-3xl font-bold bg-secondary rounded-xl px-4 py-4 outline-none tabular-nums text-foreground" />
                </div>

                <div className="flex gap-2 mb-6">
                  {[10, 25, 50].map((v) => (
                    <button
                      key={v}
                      onClick={() => setAmount(String(Math.min(v, realBalance)))}
                      className="flex-1 py-2 rounded-lg bg-secondary text-sm font-semibold hover:bg-secondary/80 transition-colors"
                    >
                      {v} USDC
                    </button>
                  ))}
                  {/* 🚀 BOTÓN RETIRAR TODO (MÁX) */}
                  <button
                    onClick={() => setAmount(realBalance.toString())}
                    className="flex-1 py-2 rounded-lg bg-primary/10 text-primary text-sm font-bold border border-primary/20 hover:bg-primary/20 transition-colors"
                  >
                    {t("withdrawals.modal_all_button")}
                  </button>
                </div>

                {errorMsg && <p className="text-xs text-red-500 font-semibold mb-4 text-center">{errorMsg}</p>}

                <button
                  onClick={handleWithdraw}
                  disabled={!parseFloat(amount) || parseFloat(amount) > realBalance}
                  className="btn-emerald w-full py-4 font-bold disabled:opacity-50 active:scale-95 transition-transform"
                >
                  {t("withdrawals.modal_confirm_button")}
                </button>
              </>
            )}

            {step === "signing" && (
              <div className="flex flex-col items-center py-10">
                {isMobile
                  ? <Smartphone className="w-12 h-12 text-primary animate-pulse mb-4" />
                  : <Fingerprint className="w-12 h-12 text-primary animate-pulse mb-4" />}
                <p className="font-bold">{t("withdrawals.modal_signing")}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {isMobile ? `Aprueba en ${provider === "albedo" ? "Albedo" : "tu wallet"}` : "Confirma en Freighter"}
                </p>
              </div>
            )}

            {step === "success" && (
              <div className="flex flex-col items-center py-8"><CheckCircle2 className="w-16 h-16 text-emerald-500 mb-4" /><p className="font-bold text-xl">{t("withdrawals.modal_success_title")}</p><button onClick={handleClose} className="mt-6 w-full btn-emerald py-3 rounded-xl font-bold">{t("common.done")}</button></div>
            )}

            {step === "error" && (
              <div className="flex flex-col items-center py-8">
                <X className="w-16 h-16 text-red-500 mb-4" />
                <p className="font-bold text-xl mb-2">{t("withdrawals.modal_error_title")}</p>
                {errorMsg && <p className="text-xs text-muted-foreground text-center mb-4">{errorMsg}</p>}
                <button onClick={() => setStep("input")} className="mt-2 w-full btn-emerald py-3 rounded-xl font-bold">{t("common.retry")}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
};

export default Retiros;
