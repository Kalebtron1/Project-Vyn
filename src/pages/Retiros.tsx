import { useState, useEffect, useCallback } from "react";
import {
  ArrowDownToLine, Fingerprint, CheckCircle2,
  X, Lock, TrendingUp, Clock, Sparkles, Unlock, Smartphone
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp } from "@/context/AppContext";
import confetti from "canvas-confetti";
import BottomNav from "@/components/BottomNav";
import logoVin from "@/assets/logo-vin.png";
import { useMobileWallet } from "@/hooks/useMobileWallet";

import { TransactionBuilder, Networks, Operation, BASE_FEE, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { CONTRACT_ID, RPC_URL } from "@/stellar/contracts";
import { fetchContractBalance, fetchStakeInfo } from "@/stellar/queries";

const STAKING_OPTIONS = [
  { months: 1, apy: 4, label: "1 Mes" },
  { months: 3, apy: 7, label: "3 Meses" },
  { months: 6, apy: 11, label: "6 Meses" },
  { months: 12, apy: 18, label: "12 Meses" },
];

const Retiros = () => {
  const { addWithdrawal } = useApp();
  const { isMobile, provider, connect, sign } = useMobileWallet();
  const { t } = useTranslation();

  const [realBalance, setRealBalance] = useState<number>(0);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  
  // Estado real del staking on-chain
  const [onChainStake, setOnChainStake] = useState({ amount: 0, unlockTime: 0, months: 0, apy: 0 });
  const [timeLeftStr, setTimeLeftStr] = useState<string>("");
  const [canUnstake, setCanUnstake] = useState(false);

  // Modal de Retiro Normal
  const [modalOpen, setModalOpen] = useState(false);
  const [amount, setAmount] = useState("25");
  const [step, setStep] = useState<"input" | "signing" | "success" | "error">("input");
  const [errorMsg, setErrorMsg] = useState("");

  // Modal de Staking / Unstaking
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [stakeAmount, setStakeAmount] = useState("50");
  const [selectedMonths, setSelectedMonths] = useState(3);
  const [stakeStep, setStakeStep] = useState<"input" | "signing" | "success" | "unstaking" | "error">("input");

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
      const [balance, stakeData] = await Promise.all([
        fetchContractBalance(address),
        fetchStakeInfo(address)
      ]);
      setRealBalance(balance);
      setOnChainStake(stakeData);
    } catch (error) { console.error("Error al cargar datos:", error); }
  }, []);

  useEffect(() => {
    if (!walletAddress) return;
    loadData(walletAddress);
    const intervalId = setInterval(() => loadData(walletAddress), 5000);
    return () => clearInterval(intervalId);
  }, [walletAddress, loadData]);

  // Reloj regresivo para el Unstake
  useEffect(() => {
    if (onChainStake.amount === 0) return;
    
    const updateTimer = () => {
      const now = Math.floor(Date.now() / 1000);
      const diff = onChainStake.unlockTime - now;
      if (diff <= 0) {
        setTimeLeftStr("¡Listo para retirar!");
        setCanUnstake(true);
      } else {
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        setTimeLeftStr(`${m}m ${s}s restantes`);
        setCanUnstake(false);
      }
    };
    
    updateTimer();
    const t = setInterval(updateTimer, 1000);
    return () => clearInterval(t);
  }, [onChainStake]);

  const handleClose = () => {
    setStep("input"); setAmount("25"); setErrorMsg("");
    setModalOpen(false);
    if (walletAddress) loadData(walletAddress);
  };

  const handleStakeClose = () => {
    setStakeStep("input"); setStakeAmount("50"); setSelectedMonths(3);
    setStakeModalOpen(false);
    if (walletAddress) loadData(walletAddress);
  };

  const processContractCall = async (functionName: string, args: any[], successStep: any) => {
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
      const submitRes = await server.sendTransaction(txToSubmit) as any;
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
        if (functionName === "withdraw") {
          addWithdrawal(parseFloat(amount), submitRes.hash);
          setStep("success");
        } else {
          setStakeStep(successStep);
        }
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.65 } });
      } else {
        throw new Error("Transacción fallida en el contrato.");
      }
    } catch (err: any) {
      console.error(err);
      if (functionName === "withdraw") { setErrorMsg(err.message); setStep("error"); }
      else { alert(err.message); setStakeStep("input"); setStakeModalOpen(false); }
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
    ], "success");
  };

  const handleStakeConfirm = async () => {
    const val = parseFloat(stakeAmount);
    if (!val || val <= 0 || val > realBalance) return;
    setStakeStep("signing");
    const valStroops = BigInt(Math.floor(val * 10000000));
    await processContractCall("stake", [
      nativeToScVal(walletAddress, { type: "address" }),
      nativeToScVal(valStroops, { type: "i128" }),
      nativeToScVal(BigInt(selectedMonths), { type: "u64" })
    ], "success");
  };

  const handleUnstake = async () => {
    setStakeStep("unstaking");
    setStakeModalOpen(true);
    await processContractCall("unstake", [nativeToScVal(walletAddress, { type: "address" })], "success");
  };

  const earnedInterest = onChainStake.amount > 0 ? (onChainStake.amount * (onChainStake.apy / 100) * (onChainStake.months / 12)) : 0;

  return (
    <div className="min-h-screen bg-background pb-24 font-nunito">
      <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-4 flex items-center gap-3">
        <img src={logoVin} alt="Vyn" className="w-7 h-7 object-contain" />
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">{t("withdrawals.title")}</h1>
          <p className="text-xs text-muted-foreground">{t("withdrawals.subtitle")}</p>
        </div>
      </header>

      <main className="px-5 max-w-md mx-auto space-y-4">
        {/* Balance Card */}
        <div className="card-elevated p-5 flex items-center justify-between animate-fade-up">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-0.5">{t("withdrawals.available_balance")}</p>
            <p className="text-2xl font-extrabold text-foreground tabular-nums">{realBalance.toFixed(2)} <span className="text-sm font-medium text-muted-foreground">XLM</span></p>
          </div>
          <button onClick={() => setModalOpen(true)} disabled={realBalance <= 0} className="btn-emerald flex items-center gap-2 px-5 py-3 text-sm disabled:opacity-40">
            <ArrowDownToLine className="w-4 h-4" /> {t("withdrawals.withdraw_button")}
          </button>
        </div>

        {/* STAKING SECTION */}
        <div className="animate-fade-up" style={{ animationDelay: "80ms" }}>
          <div className="flex items-center gap-2 mb-3 px-1">
            <Lock className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-bold text-foreground">{t("withdrawals.staking_section_title")}</h2>
          </div>

          <button 
            onClick={() => { setStakeStep("input"); setStakeModalOpen(true); }} 
            disabled={onChainStake.amount > 0} 
            className={`card-elevated p-5 w-full flex items-center justify-between hover:ring-2 hover:ring-primary/30 active:scale-[0.97] transition-all group mb-3 ${onChainStake.amount > 0 ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-accent" />
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-foreground">{t("withdrawals.staking_card_title")}</p>
                <p className="text-xs text-muted-foreground">{t("withdrawals.staking_card_description")}</p>
              </div>
            </div>
            <Sparkles className="w-5 h-5 text-accent opacity-60 group-hover:opacity-100 transition-opacity" />
          </button>

          {onChainStake.amount > 0 ? (
            <div className="card-elevated divide-y divide-border border border-accent/20 shadow-lg shadow-accent/5">
              <div className="px-4 py-3 flex items-center justify-between bg-accent/5 rounded-t-xl">
                <span className="text-xs font-semibold text-accent uppercase tracking-wide">{t("withdrawals.staking_active_label")}</span>
                <span className="text-xs font-bold text-accent">{onChainStake.amount.toFixed(2)} XLM</span>
              </div>
              <div className="px-4 py-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                      {canUnstake ? <Unlock className="w-4 h-4 text-emerald-500" /> : <Lock className="w-4 h-4 text-accent" />}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground">{t("withdrawals.staking_locked_label", { months: onChainStake.months })}</p>
                      <p className="text-xs text-muted-foreground">{t("withdrawals.staking_apy_label", { apy: onChainStake.apy })}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-500">+{earnedInterest.toFixed(2)} XLM</p>
                    <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{t("withdrawals.staking_earnings_label")}</p>
                  </div>
                </div>
                
                <button 
                  onClick={handleUnstake}
                  disabled={!canUnstake || stakeStep === "unstaking"}
                  className={`w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                    canUnstake 
                      ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 active:scale-95" 
                      : "bg-secondary text-muted-foreground cursor-not-allowed"
                  }`}
                >
                  {canUnstake ? <><Unlock className="w-4 h-4"/> {t("withdrawals.unstake_button")}</> : <><Clock className="w-4 h-4"/> {timeLeftStr}</>}
                </button>
              </div>
            </div>
          ) : (
            <div className="card-elevated p-6 flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-3">
                <Lock className="w-5 h-5 text-accent" />
              </div>
              <p className="text-sm font-bold text-foreground mb-1">{t("withdrawals.staking_empty_title")}</p>
              <p className="text-xs text-muted-foreground">{t("withdrawals.staking_empty_description")}</p>
            </div>
          )}
        </div>
      </main>

      <BottomNav />

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
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full text-3xl font-bold bg-secondary rounded-xl px-4 py-4 outline-none tabular-nums" />
                </div>

                <div className="flex gap-2 mb-6">
                  {[10, 25, 50].map((v) => (
                    <button 
                      key={v} 
                      onClick={() => setAmount(String(Math.min(v, realBalance)))} 
                      className="flex-1 py-2 rounded-lg bg-secondary text-sm font-semibold hover:bg-secondary/80 transition-colors"
                    >
                      {v} XLM
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
          </div>
        </div>
      )}

      {/* MODAL DE STAKING */}
      {stakeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={stakeStep === "signing" || stakeStep === "unstaking" ? undefined : handleStakeClose} />
          <div className="relative bg-card rounded-t-3xl sm:rounded-2xl w-full max-w-md p-6 pb-8 animate-slide-up z-10">
            {(stakeStep !== "signing" && stakeStep !== "unstaking") && <button onClick={handleStakeClose} className="absolute right-4 top-4 p-2"><X className="w-5 h-5 text-muted-foreground" /></button>}

            {stakeStep === "input" && onChainStake.amount === 0 && (
              <>
                <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2"><Lock className="w-5 h-5 text-accent"/> {t("withdrawals.modal_staking_title")}</h2>
                <div className="flex gap-2 mb-5">
                  {STAKING_OPTIONS.map((opt) => (
                    <button key={opt.months} onClick={() => setSelectedMonths(opt.months)} className={`flex-1 py-2.5 rounded-xl text-center transition-all ${selectedMonths === opt.months ? "bg-accent text-white" : "bg-secondary text-muted-foreground hover:bg-secondary/80"}`}>
                      <span className="block text-sm font-bold">{opt.label}</span>
                      <span className={`block text-[10px] ${selectedMonths === opt.months ? "opacity-80" : "opacity-60"}`}>{opt.apy}% APY</span>
                    </button>
                  ))}
                </div>
                <input type="number" value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)} className="w-full text-3xl font-bold bg-secondary rounded-xl px-4 py-4 mb-4" />
                <button onClick={handleStakeConfirm} disabled={parseFloat(stakeAmount) > realBalance || parseFloat(stakeAmount) <= 0} className="w-full rounded-xl bg-accent text-white py-4 font-bold active:scale-95 transition-transform disabled:opacity-50">{t("withdrawals.modal_staking_confirm")}</button>
              </>
            )}

            {(stakeStep === "signing" || stakeStep === "unstaking") && (
              <div className="flex flex-col items-center py-10">
                {isMobile
                  ? <Smartphone className="w-12 h-12 text-accent animate-pulse mb-4" />
                  : <Lock className="w-12 h-12 text-accent animate-pulse mb-4" />}
                <p className="font-bold">{t("withdrawals.modal_staking_signing")}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {isMobile ? `Aprueba en ${provider === "albedo" ? "Albedo" : "tu wallet"}` : t("withdrawals.modal_staking_signing_sub")}
                </p>
              </div>
            )}

            {stakeStep === "success" && (
              <div className="flex flex-col items-center py-8">
                <Sparkles className="w-16 h-16 text-accent mb-4" />
                <p className="font-bold text-xl">{t("withdrawals.modal_staking_success")}</p>
                <button onClick={handleStakeClose} className="mt-6 w-full bg-accent text-white py-3 rounded-xl font-bold">{t("common.done")}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Retiros;