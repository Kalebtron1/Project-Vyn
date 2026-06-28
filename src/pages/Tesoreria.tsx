import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import {
  Landmark, Fingerprint, CheckCircle2, X, Coins, Wallet, Smartphone, ArrowDownToLine, PlusCircle,
} from "lucide-react";
import confetti from "canvas-confetti";
import BottomNav from "@/components/BottomNav";
import logoVin from "@/assets/logo-vin.png";
import { useMobileWallet } from "@/hooks/useMobileWallet";

import { TransactionBuilder, Networks, Operation, BASE_FEE, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { LENDING_CONTRACT_ID, TREASURY_ADDRESS, RPC_URL } from "@/stellar/contracts";
import { fetchAccruedInterest, fetchPoolBalance } from "@/stellar/treasury";

// Acciones que la tesorería puede ejecutar contra vinculo_lending desde este panel:
//  - interest: withdraw_interest → retira la ganancia (interés acumulado).
//  - pool:     withdraw_pool     → retira capital/liquidez libre del pool.
//  - fund:     fund_pool         → aporta XLM propio al pool para poder prestar.
type TreasuryAction = "interest" | "pool" | "fund";

const ACTION_META: Record<TreasuryAction, { title: string; fn: string; cta: string }> = {
  interest: { title: "Retirar ganancia", fn: "withdraw_interest", cta: "Confirmar retiro" },
  pool: { title: "Retirar capital del pool", fn: "withdraw_pool", cta: "Confirmar retiro" },
  fund: { title: "Fondear pool", fn: "fund_pool", cta: "Confirmar aporte" },
};

// Panel privado de tesorería: visible solo para la wallet dueña (VITE_TREASURY_ADDRESS).
// El gating de UI es cosmético; la seguridad real la impone el contrato, que exige
// `treasury.require_auth()` en withdraw_interest / withdraw_pool. Textos en español.
const Tesoreria = () => {
  const { isMobile, provider, connect, sign } = useMobileWallet();

  const savedWallet = (localStorage.getItem("vinculo_wallet") || "").trim();
  const isTreasury = !!TREASURY_ADDRESS && savedWallet === TREASURY_ADDRESS.trim();

  const [accrued, setAccrued] = useState<number>(0);
  const [poolBalance, setPoolBalance] = useState<number>(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [action, setAction] = useState<TreasuryAction>("interest");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"input" | "signing" | "success" | "error">("input");
  const [errorMsg, setErrorMsg] = useState("");

  // Liquidez libre = balance del pool − interés acumulado (lo único retirable como
  // capital; el interés se retira aparte con withdraw_interest).
  const freeLiquidity = Math.max(0, poolBalance - accrued);

  const loadData = useCallback(async (address: string) => {
    try {
      const [interest, pool] = await Promise.all([
        fetchAccruedInterest(address),
        fetchPoolBalance(address),
      ]);
      setAccrued(interest);
      setPoolBalance(pool);
    } catch (error) {
      console.error("Error al cargar datos de tesorería:", error);
    }
  }, []);

  useEffect(() => {
    if (!isTreasury || !savedWallet) return;
    loadData(savedWallet);
    const intervalId = setInterval(() => loadData(savedWallet), 5000);
    return () => clearInterval(intervalId);
  }, [isTreasury, savedWallet, loadData]);

  // Acceso restringido: cualquier wallet que no sea la tesorería se redirige al inicio.
  if (!isTreasury) return <Navigate to="/" replace />;

  const openModal = (a: TreasuryAction) => {
    setAction(a); setStep("input"); setAmount(""); setErrorMsg("");
    setModalOpen(true);
  };

  const handleClose = () => {
    setStep("input"); setAmount(""); setErrorMsg("");
    setModalOpen(false);
    loadData(savedWallet);
  };

  // Pipeline genérico de firma+envío: arma la operación con la función indicada,
  // la prepara, la firma con la wallet y hace polling hasta confirmar.
  const processTx = async (fnName: string, args: xdr.ScVal[]) => {
    try {
      const server = new rpc.Server(RPC_URL);

      let sourceAddress = savedWallet;
      if (!sourceAddress) {
        const connectResult = await connect();
        if (!connectResult.ok) {
          throw new Error(connectResult.cancelled ? "Conexión cancelada. Intenta de nuevo." : connectResult.error);
        }
        sourceAddress = connectResult.address;
      }

      const account = await server.getAccount(sourceAddress);

      let transaction = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.invokeContractFunction({ contract: LENDING_CONTRACT_ID, function: fnName, args }))
        .setTimeout(30).build();

      transaction = await server.prepareTransaction(transaction);

      const signResult = await sign(transaction.toXDR());
      if (!signResult.ok) {
        throw new Error(signResult.cancelled ? "Firma cancelada. Puedes intentarlo de nuevo." : signResult.error);
      }

      const txToSubmit = TransactionBuilder.fromXDR(signResult.signedXdr, Networks.TESTNET);
      const submitRes = await server.sendTransaction(txToSubmit);
      const currentStatus = (submitRes.status ?? "").toUpperCase();
      if (currentStatus !== "PENDING" && currentStatus !== "SUCCESS") {
        throw new Error("Transacción rechazada por la red.");
      }

      let txStatus = currentStatus;
      while (txStatus === "PENDING" || txStatus === "NOT_FOUND") {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const res = await server.getTransaction(submitRes.hash);
        txStatus = res.status.toUpperCase();
      }

      if (txStatus === "SUCCESS") {
        loadData(savedWallet);
        setStep("success");
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.65 } });
      } else {
        throw new Error("Transacción fallida en el contrato.");
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  };

  // Tope del campo según la acción (fund no tiene tope de contrato: lo limita el
  // saldo XLM de la propia wallet de tesorería).
  const maxAmount = action === "interest" ? accrued : action === "pool" ? freeLiquidity : Infinity;
  const availLabel = action === "interest"
    ? `Disponible: ${accrued.toFixed(2)} XLM`
    : action === "pool"
      ? `Liquidez libre: ${freeLiquidity.toFixed(2)} XLM`
      : "Aportas XLM desde tu wallet de tesorería";

  const handleConfirm = async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) {
      setErrorMsg("Monto inválido."); setStep("error"); return;
    }
    if (Number.isFinite(maxAmount) && val > maxAmount) {
      setErrorMsg("El monto supera el disponible."); setStep("error"); return;
    }
    setStep("signing");
    const valStroops = BigInt(Math.floor(val * 10000000));
    const meta = ACTION_META[action];
    if (action === "fund") {
      // fund_pool(from, amount): la tesorería (from) aporta capital al pool.
      await processTx(meta.fn, [
        nativeToScVal(savedWallet, { type: "address" }),
        nativeToScVal(valStroops, { type: "i128" }),
      ]);
    } else {
      // withdraw_interest(amount) / withdraw_pool(amount).
      await processTx(meta.fn, [nativeToScVal(valStroops, { type: "i128" })]);
    }
  };

  const successText = action === "fund" ? "¡Pool fondeado!" : "¡Retiro completado!";

  return (
    <div className="min-h-screen bg-background pb-24 font-nunito">
      <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-4 flex items-center gap-3">
        <img src={logoVin} alt="Vyn" className="w-7 h-7 object-contain" />
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Tesorería</h1>
          <p className="text-xs text-muted-foreground">Ganancias y liquidez de préstamos</p>
        </div>
      </header>

      <main className="px-5 max-w-md md:max-w-2xl mx-auto space-y-4">
        {/* Interés acumulado disponible para retiro */}
        <div className="bg-primary rounded-2xl p-6 text-primary-foreground shadow-lg w-full relative overflow-hidden animate-fade-up">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
          <div className="flex items-center gap-2 mb-6 relative z-10">
            <Coins className="w-5 h-5 opacity-80" />
            <span className="text-sm font-semibold tracking-wider opacity-90">GANANCIA DISPONIBLE</span>
          </div>
          <div className="flex items-baseline gap-2 relative z-10">
            <span className="text-5xl font-extrabold tracking-tight tabular-nums">{accrued.toFixed(2)}</span>
            <span className="text-xl font-medium opacity-80">XLM</span>
          </div>
          <p className="text-primary-foreground/70 text-sm mt-2 relative z-10">Interés acumulado de préstamos saldados</p>

          <button
            onClick={() => openModal("interest")}
            disabled={accrued <= 0}
            className="mt-5 w-full bg-white/15 hover:bg-white/25 rounded-xl py-3 font-bold flex items-center justify-center gap-2 transition-colors active:scale-95 disabled:opacity-40 relative z-10"
          >
            <Landmark className="w-4 h-4" /> Retirar a tesorería
          </button>
        </div>

        {/* Liquidez del pool + gestión de capital */}
        <div className="card-elevated p-5 animate-fade-up" style={{ animationDelay: "80ms" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                <Wallet className="w-5 h-5 text-accent" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Liquidez del pool</p>
                <p className="text-xs text-muted-foreground">Capital disponible para prestar</p>
              </div>
            </div>
            <p className="text-lg font-extrabold text-foreground tabular-nums">{poolBalance.toFixed(2)} <span className="text-xs font-medium text-muted-foreground">XLM</span></p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => openModal("pool")}
              disabled={freeLiquidity <= 0}
              className="py-2.5 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground text-sm font-bold flex items-center justify-center gap-1.5 transition-colors active:scale-95 disabled:opacity-40"
            >
              <ArrowDownToLine className="w-4 h-4" /> Retirar capital
            </button>
            <button
              onClick={() => openModal("fund")}
              className="py-2.5 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent text-sm font-bold flex items-center justify-center gap-1.5 transition-colors active:scale-95"
            >
              <PlusCircle className="w-4 h-4" /> Fondear pool
            </button>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground text-center px-4">
          La ganancia (interés) se retira aparte y no afecta el capital. «Retirar capital» solo toca la liquidez
          libre del pool (para no dejar dinero muerto si la app deja de usarse); «Fondear» aporta XLM al pool para prestar.
        </p>
      </main>

      <BottomNav />

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={step === "signing" ? undefined : handleClose} />
          <div className="relative bg-card rounded-t-3xl sm:rounded-2xl w-full max-w-md p-6 pb-8 animate-slide-up z-10">
            {step !== "signing" && <button onClick={handleClose} className="absolute right-4 top-4 p-2 rounded-full hover:bg-secondary"><X className="w-5 h-5 text-muted-foreground" /></button>}

            {step === "input" && (
              <>
                <h2 className="text-xl font-bold text-foreground mb-1">{ACTION_META[action].title}</h2>
                <p className="text-xs text-muted-foreground mb-6">{availLabel}</p>

                <div className="mb-4">
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full text-3xl font-bold bg-secondary rounded-xl px-4 py-4 outline-none tabular-nums" />
                </div>

                {action !== "fund" && (
                  <div className="flex gap-2 mb-6">
                    <button
                      onClick={() => setAmount(maxAmount.toString())}
                      className="flex-1 py-2 rounded-lg bg-primary/10 text-primary text-sm font-bold border border-primary/20 hover:bg-primary/20 transition-colors"
                    >
                      {action === "interest" ? "Retirar todo" : "Retirar todo el libre"}
                    </button>
                  </div>
                )}

                {errorMsg && <p className="text-xs text-red-500 font-semibold mb-4 text-center">{errorMsg}</p>}

                <button
                  onClick={handleConfirm}
                  disabled={!parseFloat(amount) || (Number.isFinite(maxAmount) && parseFloat(amount) > maxAmount)}
                  className="btn-emerald w-full py-4 font-bold disabled:opacity-50 active:scale-95 transition-transform"
                >
                  {ACTION_META[action].cta}
                </button>
              </>
            )}

            {step === "signing" && (
              <div className="flex flex-col items-center py-10">
                {isMobile
                  ? <Smartphone className="w-12 h-12 text-primary animate-pulse mb-4" />
                  : <Fingerprint className="w-12 h-12 text-primary animate-pulse mb-4" />}
                <p className="font-bold">Firmando…</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {isMobile ? `Aprueba en ${provider === "albedo" ? "Albedo" : "tu wallet"}` : "Firmar transacción"}
                </p>
              </div>
            )}

            {step === "success" && (
              <div className="flex flex-col items-center py-8"><CheckCircle2 className="w-16 h-16 text-emerald-500 mb-4" /><p className="font-bold text-xl">{successText}</p><button onClick={handleClose} className="mt-6 w-full btn-emerald py-3 rounded-xl font-bold">Listo</button></div>
            )}

            {step === "error" && (
              <div className="flex flex-col items-center py-8">
                <X className="w-16 h-16 text-red-500 mb-4" />
                <p className="font-bold text-xl mb-2">No se pudo completar</p>
                {errorMsg && <p className="text-xs text-muted-foreground text-center mb-4">{errorMsg}</p>}
                <button onClick={() => setStep("input")} className="mt-2 w-full btn-emerald py-3 rounded-xl font-bold">Reintentar</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Tesoreria;
