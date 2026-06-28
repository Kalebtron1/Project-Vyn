import { useState, useEffect, useCallback, useRef } from "react";
import {
  ArrowDownToLine, Fingerprint, CheckCircle2,
  X, TrendingUp, Sparkles, Smartphone,
  Building2, Store, Globe, CircleCheck,
  ShieldCheck, Loader2, Lock, Star, Wallet, Fuel,
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
  const [usdcAddress, setUsdcAddress] = useState("");
  const [step, setStep] = useState<"input" | "signing" | "success" | "error">("input");
  const [errorMsg, setErrorMsg] = useState("");

  // Método seleccionado (USDC on-chain vs SPEI off-ramp).
  const [selectedMethod, setSelectedMethod] = useState<"usdc" | "spei">("usdc");

  // Flujo SPEI (off-ramp): la UI maneja USDC; el USDB→SPEI lo hace el backend.
  const DEMO_CLABE = "646180157000000004";
  const [speiOpen, setSpeiOpen] = useState(false);
  const [speiStep, setSpeiStep] = useState<"kyc" | "input" | "signing" | "success" | "error">("kyc");
  const [kycDone, setKycDone] = useState(false);
  const [kycPhase, setKycPhase] = useState<"idle" | "verifying" | "done">("idle");
  const [speiAmount, setSpeiAmount] = useState("25");
  const [quote, setQuote] = useState<null | { receiverMxn: number; rateMxnPerUsd: number; flatFeeUsd: number; partnerFeeUsd: number }>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [speiError, setSpeiError] = useState("");
  const [speiSigningLabel, setSpeiSigningLabel] = useState("");
  const [speiResult, setSpeiResult] = useState<null | { mxn: number; provider: string }>(null);
  const kycTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

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

  // Firma y envía una invocación de contrato; devuelve el resultado sin tocar la UI,
  // para que tanto el retiro USDC como la pata on-chain del flujo SPEI lo reutilicen.
  const submitContractCall = async (
    functionName: string,
    args: xdr.ScVal[]
  ): Promise<{ ok: boolean; hash?: string; error?: string }> => {
    try {
      const server = new rpc.Server(RPC_URL);

      // Resolve wallet address — prefer cached, otherwise prompt
      let sourceAddress = walletAddress;
      if (!sourceAddress) {
        const connectResult = await connect();
        if (!connectResult.ok) {
          return { ok: false, error: connectResult.cancelled ? "Conexión cancelada. Intenta de nuevo." : connectResult.error };
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
        return { ok: false, error: signResult.cancelled ? "Firma cancelada. Puedes intentarlo de nuevo." : signResult.error };
      }

      const txToSubmit = TransactionBuilder.fromXDR(signResult.signedXdr, Networks.TESTNET);
      const submitRes = await server.sendTransaction(txToSubmit);
      const currentStatus = (submitRes.status ?? "").toUpperCase();
      if (currentStatus !== "PENDING" && currentStatus !== "SUCCESS") {
        return { ok: false, error: "Transacción rechazada por la red." };
      }

      // Poll until final status
      let txStatus = currentStatus;
      while (txStatus === "PENDING" || txStatus === "NOT_FOUND") {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const res = await server.getTransaction(submitRes.hash);
        txStatus = res.status.toUpperCase();
      }

      if (txStatus === "SUCCESS") return { ok: true, hash: submitRes.hash };
      return { ok: false, error: "Transacción fallida en el contrato." };
    } catch (err) {
      console.error(err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const handleWithdraw = async () => {
    const val = parseFloat(amount);
    if (!val || val < 1) { setErrorMsg(t("withdrawals.min_wallet_error")); setStep("error"); return; }
    if (val > realBalance) { setErrorMsg(t("withdrawals.error_insufficient")); setStep("error"); return; }
    setStep("signing");
    const valStroops = BigInt(Math.floor(val * 10000000));
    const res = await submitContractCall("withdraw", [
      nativeToScVal(walletAddress, { type: "address" }),
      nativeToScVal(valStroops, { type: "i128" }),
    ]);
    if (res.ok) {
      if (walletAddress) loadData(walletAddress);
      addWithdrawal(val, res.hash);
      setStep("success");
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.65 } });
    } else {
      setErrorMsg(res.error || ""); setStep("error");
    }
  };

  // Cotiza el off-ramp (USDC → MXN) para mostrarlo en vivo mientras el usuario teclea.
  useEffect(() => {
    if (!speiOpen || speiStep !== "input") return;
    const val = parseFloat(speiAmount);
    if (!val || val < 10) { setQuote(null); return; }
    let cancelled = false;
    setQuoteLoading(true);
    const handle = setTimeout(async () => {
      try {
        const r = await fetch("/api/blindpay?action=quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: val }),
        });
        const data = await r.json();
        if (cancelled) return;
        setQuote(r.ok ? { receiverMxn: data.receiverMxn, rateMxnPerUsd: data.rateMxnPerUsd, flatFeeUsd: data.flatFeeUsd, partnerFeeUsd: data.partnerFeeUsd ?? 0 } : null);
      } catch {
        if (!cancelled) setQuote(null);
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [speiAmount, speiOpen, speiStep, realBalance]);

  // Flujo SPEI: (1) withdraw REAL del vault (baja el saldo) → (2) payout USDB→SPEI en backend.
  const handleSpeiWithdraw = async () => {
    const val = parseFloat(speiAmount);
    if (!val || val < 10 || val > realBalance) {
      setSpeiError(val && val < 10 ? t("withdrawals.spei.min_error") : t("withdrawals.error_insufficient"));
      setSpeiStep("error");
      return;
    }
    setSpeiError("");
    setSpeiStep("signing");
    setSpeiSigningLabel(t("withdrawals.spei.signing_withdraw"));

    const valStroops = BigInt(Math.floor(val * 10000000));
    const res = await submitContractCall("withdraw", [
      nativeToScVal(walletAddress, { type: "address" }),
      nativeToScVal(valStroops, { type: "i128" }),
    ]);
    if (!res.ok) { setSpeiError(res.error || ""); setSpeiStep("error"); return; }
    if (walletAddress) loadData(walletAddress);
    addWithdrawal(val, res.hash);

    setSpeiSigningLabel(t("withdrawals.spei.sending"));
    try {
      const r = await fetch("/api/blindpay?action=payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: val }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Error al enviar el SPEI");
      setSpeiResult({ mxn: data.quote?.receiverMxn ?? 0, provider: data.payment?.provider_name || "BlindPay" });
      setSpeiStep("success");
      confetti({ particleCount: 120, spread: 75, origin: { y: 0.6 } });
    } catch (e) {
      setSpeiError(e instanceof Error ? e.message : String(e));
      setSpeiStep("error");
    }
  };

  const openWithdraw = () => {
    if (selectedMethod === "spei") {
      setSpeiStep(kycDone ? "input" : "kyc");
      setKycPhase("idle");
      setSpeiError("");
      setQuote(null);
      setSpeiOpen(true);
    } else {
      setUsdcAddress(walletAddress ?? "");
      setModalOpen(true);
    }
  };

  // Dispara la animación de KYC simulado: cargando (~2.5s) → completado (~1s) → input.
  const startKycSimulation = () => {
    setKycPhase("verifying");
    kycTimers.current.push(setTimeout(() => {
      setKycPhase("done");
      kycTimers.current.push(setTimeout(() => {
        setKycDone(true);
        setSpeiStep("input");
        setKycPhase("idle");
      }, 1000));
    }, 2500));
  };

  const handleSpeiClose = () => {
    kycTimers.current.forEach(clearTimeout);
    kycTimers.current = [];
    setSpeiOpen(false);
    setSpeiStep(kycDone ? "input" : "kyc");
    setKycPhase("idle");
    setSpeiAmount("25");
    setSpeiError("");
    setQuote(null);
    setSpeiResult(null);
    if (walletAddress) loadData(walletAddress);
  };

  // Rendimiento real generado (posición − principal neto aportado).
  const yieldEarned = Math.max(0, realBalance - netPrincipal);

  // Métodos de retiro: USDC real + roadmap MXN (próximamente).
  const methods = [
    { id: "usdc", title: t("withdrawals.method_usdc_title"), desc: t("withdrawals.method_usdc_desc"), icon: ArrowDownToLine, available: true },
    { id: "spei", title: t("withdrawals.method_spei_title"), desc: t("withdrawals.method_spei_desc"), icon: Building2, available: true },
    { id: "moneygram", title: t("withdrawals.method_moneygram_title"), desc: t("withdrawals.method_moneygram_desc"), icon: Store, available: false },
  ];

  return (
    <AppShell title={t("withdrawals.title")} subtitle={t("withdrawals.subtitle")}>
      <div className="max-w-[1100px] mx-auto grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* Columna principal */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          {/* Balance + botón retirar */}
          <div className="card-elevated p-5 flex flex-col md:flex-row md:items-center justify-between gap-5 animate-fade-up">
            <div className="flex items-center justify-between md:justify-start gap-5">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-0.5">{t("withdrawals.available_balance")}</p>
                <p className="text-2xl font-extrabold text-foreground tabular-nums">{realBalance.toFixed(2)} <span className="text-sm font-medium text-muted-foreground">USDC</span></p>
              </div>
              <button onClick={openWithdraw} disabled={realBalance <= 0} className="btn-emerald flex items-center gap-2 px-5 py-3 text-sm disabled:opacity-40 md:hidden">
                <ArrowDownToLine className="w-4 h-4" /> {t("withdrawals.withdraw_button")}
              </button>
            </div>

            {/* Límite diario — decorativo (roadmap) */}
            <div className="md:max-w-[230px] w-full md:border-l md:border-border md:pl-5">
              <div className="flex justify-between items-end mb-1.5">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{t("withdrawals.limit_label")}</p>
                <p className="text-[11px] font-bold text-foreground tabular-nums">0.00 / 5,000.00 <span className="font-normal text-muted-foreground">USDC</span></p>
              </div>
              <div className="w-full bg-secondary rounded-full h-1.5 mb-2.5"><div className="bg-primary/40 h-1.5 rounded-full" style={{ width: "0%" }} /></div>
              <button disabled className="w-full bg-primary/10 text-primary/60 text-[11px] font-bold py-1.5 px-3 rounded-lg cursor-not-allowed inline-flex items-center justify-center gap-1.5">
                {t("withdrawals.limit_increase")} <span className="text-[8px] uppercase tracking-wider bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{t("withdrawals.limit_soon")}</span>
              </button>
            </div>

            <button onClick={openWithdraw} disabled={realBalance <= 0} className="btn-emerald hidden md:flex items-center gap-2 px-5 py-3 text-sm disabled:opacity-40">
              <ArrowDownToLine className="w-4 h-4" /> {t("withdrawals.withdraw_button")}
            </button>
          </div>

          {/* Selector de método de retiro */}
          <div className="card-elevated p-5 md:p-6 animate-fade-up" style={{ animationDelay: "60ms" }}>
            <h3 className="text-sm font-bold text-foreground mb-4">{t("withdrawals.method_step_title")}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {methods.map((m) => {
                const Icon = m.icon;
                const isSelected = m.available && selectedMethod === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={m.available ? () => setSelectedMethod(m.id as "usdc" | "spei") : undefined}
                    className={`relative rounded-2xl p-4 border-2 transition-all ${
                      !m.available
                        ? "border-border bg-secondary/40 opacity-60 cursor-not-allowed"
                        : isSelected
                          ? "border-primary bg-primary/5 cursor-pointer -translate-y-0.5 shadow-sm"
                          : "border-border bg-card cursor-pointer hover:-translate-y-0.5"
                    }`}
                  >
                    {!m.available ? (
                      <span className="absolute top-3 right-3 text-[8px] font-bold uppercase tracking-wider bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                        {t("withdrawals.coming_soon")}
                      </span>
                    ) : isSelected ? (
                      <CircleCheck className="absolute top-3 right-3 w-4 h-4 text-primary" />
                    ) : null}
                    <Icon className={`w-7 h-7 mb-3 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                    <div className={`font-bold text-sm ${isSelected ? "text-primary" : "text-foreground"}`}>{m.title}</div>
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
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold text-foreground">{t("withdrawals.info_network_title")}</h4>
                    <span className="text-[8px] font-bold uppercase tracking-wider bg-accent/10 text-accent px-1.5 py-0.5 rounded">Testnet</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{t("withdrawals.info_network_desc")}</p>
                </div>
              </li>
            </ul>
          </div>

          {/* Direcciones guardadas — atenuado / próximamente */}
          <div className="card-elevated p-6 animate-fade-up opacity-60" style={{ animationDelay: "140ms" }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-muted-foreground">{t("withdrawals.saved_addr_title")}</h3>
              <span className="text-[8px] font-bold uppercase tracking-wider bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{t("withdrawals.saved_addr_soon")}</span>
            </div>
            <div className="bg-secondary/50 border border-border rounded-2xl p-6 text-center">
              <div className="w-12 h-12 bg-card rounded-full mx-auto flex items-center justify-center shadow-sm mb-3 text-muted-foreground border border-border">
                <Star className="w-5 h-5" />
              </div>
              <p className="text-[11px] text-muted-foreground font-medium leading-relaxed">{t("withdrawals.saved_addr_empty")}</p>
            </div>
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
                <p className="text-xs text-muted-foreground mb-5">{t("withdrawals.modal_withdraw_subtitle")}</p>

                {/* Dirección de destino — autollenada con la wallet conectada (informativa) */}
                <div className="mb-4">
                  <div className="flex justify-between items-end mb-1.5">
                    <label className="text-[11px] font-bold text-muted-foreground">{t("withdrawals.modal_address_label")}</label>
                    <button
                      type="button"
                      onClick={() => setUsdcAddress(walletAddress ?? "")}
                      disabled={!walletAddress}
                      className="text-[11px] text-primary font-bold hover:underline disabled:opacity-40 inline-flex items-center gap-1"
                    >
                      <Wallet className="w-3 h-3" /> {t("withdrawals.modal_address_use_current")}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={usdcAddress}
                    onChange={(e) => setUsdcAddress(e.target.value)}
                    placeholder="G..."
                    className="w-full text-xs font-mono bg-secondary rounded-xl px-4 py-3 outline-none text-foreground focus:ring-2 focus:ring-primary/30 transition-shadow break-all"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1.5">{t("withdrawals.modal_address_note")}</p>
                </div>

                <div className="mb-3">
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full text-3xl font-bold bg-secondary rounded-xl px-4 py-4 outline-none tabular-nums text-foreground" />
                </div>

                <div className="flex gap-2 mb-4">
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

                <p className="text-[11px] text-muted-foreground mb-4">{t("withdrawals.min_hint_wallet")}</p>

                {/* La tarifa de red real se muestra al firmar en la wallet */}
                <div className="flex items-start gap-2 mb-5 rounded-xl bg-secondary/60 px-3 py-2.5">
                  <Fuel className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                  <p className="text-[11px] text-muted-foreground">{t("withdrawals.modal_network_fee_note")}</p>
                </div>

                {errorMsg && <p className="text-xs text-red-500 font-semibold mb-4 text-center">{errorMsg}</p>}

                <button
                  onClick={handleWithdraw}
                  disabled={!parseFloat(amount) || parseFloat(amount) < 1 || parseFloat(amount) > realBalance}
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
                  {isMobile ? `Aprueba en ${provider === "albedo" ? "Albedo" : "tu wallet"}` : "Firmar transacción"}
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

      {/* MODAL SPEI (OFF-RAMP) — la UI maneja USDC; el USDB→SPEI lo hace el backend */}
      {speiOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={speiStep === "signing" ? undefined : handleSpeiClose} />
          <div className="relative bg-card rounded-t-3xl sm:rounded-2xl w-full max-w-md p-6 pb-8 animate-slide-up z-10">
            {speiStep !== "signing" && <button onClick={handleSpeiClose} className="absolute right-4 top-4 p-2 rounded-full hover:bg-secondary"><X className="w-5 h-5 text-muted-foreground" /></button>}

            {/* KYC — idle: explicación + botón; verifying: spinner; done: check */}
            {speiStep === "kyc" && kycPhase === "idle" && (
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-5">
                  <ShieldCheck className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-xl font-bold text-foreground mb-2">{t("withdrawals.spei.kyc_title")}</h2>
                <p className="text-sm text-muted-foreground max-w-[300px] mb-6">{t("withdrawals.spei.kyc_desc")}</p>
                <button onClick={startKycSimulation} className="btn-emerald w-full py-4 font-bold flex items-center justify-center gap-2">
                  <Fingerprint className="w-5 h-5" /> {t("withdrawals.spei.kyc_button")}
                </button>
                <p className="text-[11px] text-muted-foreground mt-4">{t("withdrawals.spei.demo_note")}</p>
              </div>
            )}

            {speiStep === "kyc" && kycPhase === "verifying" && (
              <div className="flex flex-col items-center text-center py-10">
                <div className="relative w-20 h-20 mb-6 flex items-center justify-center">
                  <Loader2 className="w-20 h-20 text-primary/30 animate-spin absolute" />
                  <ShieldCheck className="w-8 h-8 text-primary" />
                </div>
                <p className="font-bold text-foreground">{t("withdrawals.spei.kyc_verifying")}</p>
                <p className="text-[11px] text-muted-foreground mt-2 max-w-[260px]">{t("withdrawals.spei.demo_note")}</p>
              </div>
            )}

            {speiStep === "kyc" && kycPhase === "done" && (
              <div className="flex flex-col items-center text-center py-10 animate-scale-up">
                <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mb-6">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                </div>
                <p className="font-bold text-xl text-foreground">{t("withdrawals.spei.kyc_completed")}</p>
              </div>
            )}

            {/* INPUT + COTIZACIÓN */}
            {speiStep === "input" && (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-xl font-bold text-foreground">{t("withdrawals.spei.modal_title")}</h2>
                  {kycDone && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                      <CircleCheck className="w-3 h-3" /> {t("withdrawals.spei.kyc_done")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-5">{t("withdrawals.spei.modal_subtitle")}</p>

                <div className="mb-4">
                  <input type="number" value={speiAmount} onChange={(e) => setSpeiAmount(e.target.value)} className="w-full text-3xl font-bold bg-secondary rounded-xl px-4 py-4 outline-none tabular-nums text-foreground" inputMode="decimal" min="10" />
                </div>

                <div className="flex gap-2 mb-4">
                  {[10, 25, 50].map((v) => (
                    <button key={v} onClick={() => setSpeiAmount(String(Math.min(v, Math.floor(realBalance))))} className="flex-1 py-2 rounded-lg bg-secondary text-sm font-semibold hover:bg-secondary/80 transition-colors">{v} USDC</button>
                  ))}
                  <button onClick={() => setSpeiAmount(realBalance.toString())} className="flex-1 py-2 rounded-lg bg-primary/10 text-primary text-sm font-bold border border-primary/20 hover:bg-primary/20 transition-colors">{t("withdrawals.modal_all_button")}</button>
                </div>

                <p className="text-[11px] text-muted-foreground mb-4">{t("withdrawals.spei.min_hint")}</p>

                {/* CLABE destino — predefinida y bloqueada (simulación) */}
                <div className="mb-4">
                  <label className="text-[11px] font-bold text-muted-foreground mb-1.5 block">{t("withdrawals.spei.clabe_locked_label")}</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={DEMO_CLABE}
                      readOnly
                      className="w-full text-sm font-mono bg-secondary/70 text-muted-foreground rounded-xl pl-4 pr-10 py-3 outline-none cursor-not-allowed select-none"
                    />
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  </div>
                </div>

                {/* Desglose de cotización: tipo de cambio + comisiones (USDC) → total MXN */}
                <div className="rounded-xl bg-secondary/60 p-4 mb-4 text-sm">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2">
                    <span>{t("withdrawals.spei.quote_rate")}</span>
                    <span className="tabular-nums">{quote ? `1 USDC ≈ ${quote.rateMxnPerUsd.toFixed(2)} MXN` : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2">
                    <span>{t("withdrawals.spei.quote_blindpay_fee")}</span>
                    <span className="tabular-nums">{quote ? `${quote.flatFeeUsd.toFixed(2)} USDC` : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-3">
                    <span>{t("withdrawals.spei.quote_platform_fee")}</span>
                    <span className="tabular-nums">{quote ? `${quote.partnerFeeUsd.toFixed(2)} USDC` : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-border">
                    <span className="font-bold text-foreground">{t("withdrawals.spei.quote_total_receive")}</span>
                    <span className="font-extrabold text-lg text-foreground tabular-nums">
                      {quoteLoading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : quote ? `${quote.receiverMxn.toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN` : "—"}
                    </span>
                  </div>
                </div>

                {speiError && <p className="text-xs text-red-500 font-semibold mb-3 text-center">{speiError}</p>}

                <button onClick={handleSpeiWithdraw} disabled={!quote || quoteLoading || parseFloat(speiAmount) > realBalance} className="btn-emerald w-full py-4 font-bold disabled:opacity-50 active:scale-95 transition-transform flex items-center justify-center gap-2">
                  <Building2 className="w-5 h-5" /> {t("withdrawals.spei.confirm_button")}
                </button>
              </>
            )}

            {/* SIGNING */}
            {speiStep === "signing" && (
              <div className="flex flex-col items-center py-10 text-center">
                {speiSigningLabel === t("withdrawals.spei.sending")
                  ? <Building2 className="w-12 h-12 text-primary animate-pulse mb-4" />
                  : (isMobile ? <Smartphone className="w-12 h-12 text-primary animate-pulse mb-4" /> : <Fingerprint className="w-12 h-12 text-primary animate-pulse mb-4" />)}
                <p className="font-bold">{speiSigningLabel}</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[260px]">{t("withdrawals.spei.demo_note")}</p>
              </div>
            )}

            {/* SUCCESS */}
            {speiStep === "success" && (
              <div className="flex flex-col items-center py-8 text-center animate-scale-up">
                <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-5">
                  <CheckCircle2 className="w-10 h-10 text-primary" />
                </div>
                <p className="text-xl font-bold text-foreground mb-1">{t("withdrawals.spei.success_title")}</p>
                <p className="text-sm text-muted-foreground mb-1">{t("withdrawals.spei.success_desc", { mxn: (speiResult?.mxn ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2 }) })}</p>
                <p className="text-[11px] text-muted-foreground mb-6">{t("withdrawals.spei.success_eta", { provider: speiResult?.provider ?? "BlindPay" })}</p>
                <button onClick={handleSpeiClose} className="w-full btn-emerald py-3 rounded-xl font-bold">{t("common.done")}</button>
              </div>
            )}

            {/* ERROR */}
            {speiStep === "error" && (
              <div className="flex flex-col items-center py-8 text-center">
                <X className="w-16 h-16 text-red-500 mb-4" />
                <p className="font-bold text-xl mb-2">{t("withdrawals.spei.error_title")}</p>
                {speiError && <p className="text-xs text-muted-foreground mb-4 max-w-[280px]">{speiError}</p>}
                <button onClick={() => setSpeiStep("input")} className="w-full btn-emerald py-3 rounded-xl font-bold">{t("common.retry")}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
};

export default Retiros;
