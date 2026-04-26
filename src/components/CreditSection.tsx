import { Lock, Sparkles, ArrowDownToLine, Loader2, Activity, ArrowUpFromLine, CalendarClock, TrendingUp, AlertCircle } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { useWallet } from "@/hooks/useWallet";
import { useState, useEffect } from "react";
import confetti from "canvas-confetti";

// 🚀 IMPORTACIONES WEB3
import { 
  rpc, 
  Contract, 
  Networks, 
  Address, 
  nativeToScVal, 
  TransactionBuilder 
} from "@stellar/stellar-sdk";
import { requestAccess, signTransaction } from "@stellar/freighter-api";

const LENDING_CONTRACT_ID =
  import.meta.env.VITE_LENDING_CONTRACT_ID ||
  "CDNF6NGNB7RG7QLZYPMWROVSV3VRVWX2FRZQTNT3Y2GRBNWJP3GEBONV";

const CreditSection = () => {
  const { creditWithdrawn, withdrawCredit, deposits } = useApp();
  const { wallet } = useWallet();
  const [loadingTx, setLoadingTx] = useState(false); 
  const [loadingCredit, setLoadingCredit] = useState(true);
  
  // 💅 ESTADO PARA ERRORES ESTÉTICOS (Reemplaza al alert)
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 🔐 CANDADO DE SEGURIDAD PARA FREIGHTER
  const [registeredWallet, setRegisteredWallet] = useState<string | null>(null);

  // ⏱️ ESTADOS PARA LA SIMULACIÓN DE MOROSIDAD (1 Mes = 60 Segundos)
  const [timeLeft, setTimeLeft] = useState(60);
  const [isDefaulted, setIsDefaulted] = useState(false);
  
  const [creditData, setCreditData] = useState({
    limit: 0,
    tierName: "Bronce",
    tier: 0,
    isUnlocked: false
  });

  // Tracks the amount at the time of withdrawal so a tier change mid-loan
  // doesn't silently alter the displayed debt or repayment amount.
  const [withdrawnAmount, setWithdrawnAmount] = useState<number>(0);

  const toFriendlyWithdrawError = (error: any) => {
    const raw = String(error?.message || "").toLowerCase();

    // El contrato llega a consultar balance() y luego revierte en request_loan.
    // Eso normalmente significa falta de liquidez en el pool de préstamos.
    if (
      raw.includes("request_loan") &&
      raw.includes("balance") &&
      (raw.includes("hosterror") || raw.includes("invalidaction") || raw.includes("unreachablecodereached"))
    ) {
      return "No hay liquidez suficiente en el pool para desembolsar este monto ahora. Intenta más tarde o retira un monto menor.";
    }

    if (raw.includes("active loan") || raw.includes("no active loan")) {
      return "Ya tienes un préstamo activo. Debes pagarlo antes de solicitar uno nuevo.";
    }

    if (raw.includes("tier") || raw.includes("sbt")) {
      return "Tu NFT actual no habilita este crédito todavía. Actualiza tu nivel e intenta nuevamente.";
    }

    if (raw.includes("cancelada") || raw.includes("cancelled")) {
      return "Cancelaste la firma en Freighter. No se realizó el retiro.";
    }

    return "No pudimos procesar el retiro ahora. Intenta nuevamente en unos segundos.";
  };

  // Use the locked withdrawn amount when a loan is active so a tier change
  // mid-loan doesn't silently change the displayed debt.
  const loanPrincipal = creditWithdrawn ? withdrawnAmount : creditData.limit;
  const totalToPay = loanPrincipal * 1.05;

  // 📡 Sincronización con el Backend/Soroban usando wallet de localStorage
  useEffect(() => {
    let isMounted = true;

    const fetchBlockchainCredit = async () => {
      try {
        if (!wallet) {
          // Esperamos a que la wallet del contexto esté disponible.
          if (isMounted) setLoadingCredit(true);
          return;
        }

        if (isMounted) setLoadingCredit(true);

        // Guardamos la wallet real del usuario
        setRegisteredWallet(wallet);

        const response = await fetch(`/api/get-available-credit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userAddress: wallet })
        });
        
        const data = await response.json();
        
        if (data.success && isMounted) {
          setCreditData({
            limit: data.availableCredit, 
            tierName: data.tierName,
            tier: data.tier,
            isUnlocked: data.tier >= 1 
          });
        } else if (!data.success && isMounted) {
          // Contract lookup failed — keep existing creditData but surface the error
          // so the user knows this is a transient failure, not a real Bronce state.
          console.warn("get-available-credit returned success:false —", data.error);
        }
        
      } catch (error) {
        console.error("Error cargando crédito on-chain:", error);
      } finally {
        if (isMounted) setLoadingCredit(false);
      }
    };

    fetchBlockchainCredit();
    const intervalId = setInterval(() => fetchBlockchainCredit(), 8000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [wallet, deposits]);

  // ⏳ TEMPORIZADOR DE COBRO (Se activa solo si hay un préstamo activo)
  useEffect(() => {
    let timer: NodeJS.Timeout;
    
    if (creditWithdrawn && timeLeft > 0 && !isDefaulted) {
      timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (creditWithdrawn && timeLeft <= 0) {
      setIsDefaulted(true); // ¡Cae en mora!
    }

    return () => clearInterval(timer);
  }, [creditWithdrawn, timeLeft, isDefaulted]);

  // 📥 FUNCION: RETIRAR CRÉDITO
  const handleWithdraw = async () => {
    setLoadingTx(true);
    setErrorMsg(null); // Limpiamos errores previos
    try {
      const accessResponse = await requestAccess();
      const userAddress = accessResponse.address;
      if (!userAddress) throw new Error("Debes conectar tu billetera Freighter");

      // 🛡️ CANDADO: Validamos que use la cuenta correcta
      if (registeredWallet && userAddress !== registeredWallet) {
        const shortWallet = `${registeredWallet.substring(0, 4)}...${registeredWallet.substring(52)}`;
        throw new Error(`Cuenta incorrecta. Cambia en Freighter a: ${shortWallet}`);
      }

      const server = new rpc.Server("https://soroban-testnet.stellar.org");
      const networkPassphrase = Networks.TESTNET;

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
      const tx = new TransactionBuilder(account, { fee: "100000", networkPassphrase })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const preparedTx = await server.prepareTransaction(tx);
      const signResponse = await signTransaction(preparedTx.toXDR(), { networkPassphrase });
      
      if (signResponse.error || !signResponse.signedTxXdr) {
         throw new Error("Transacción cancelada en Freighter.");
      }

      const signedTx = TransactionBuilder.fromXDR(signResponse.signedTxXdr, networkPassphrase);
      await server.sendTransaction(signedTx);
      
      // Reiniciamos los estados del timer
      setTimeLeft(60);
      setIsDefaulted(false);
      setWithdrawnAmount(creditData.limit); // Lock the debt amount at withdrawal time
      withdrawCredit(); 
      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#10b981', '#34d399', '#ffffff'] });

    } catch (error: any) {
      console.error("❌ Error al retirar:", error);
      setErrorMsg(toFriendlyWithdrawError(error));
    } finally {
      setLoadingTx(false);
    }
  };

  // 📤 FUNCION: PAGAR CRÉDITO
  const handleRepay = async () => {
    setLoadingTx(true);
    setErrorMsg(null); // Limpiamos errores previos
    try {
      const accessResponse = await requestAccess();
      const userAddress = accessResponse.address;
      if (!userAddress) throw new Error("Debes conectar tu billetera Freighter");

      // 🛡️ CANDADO: Validamos que use la cuenta correcta para pagar
      if (registeredWallet && userAddress !== registeredWallet) {
        const shortWallet = `${registeredWallet.substring(0, 4)}...${registeredWallet.substring(52)}`;
        throw new Error(`Cuenta incorrecta. Cambia en Freighter a: ${shortWallet}`);
      }

      const server = new rpc.Server("https://soroban-testnet.stellar.org");
      const networkPassphrase = Networks.TESTNET;

      // Usamos el totalToPay para cubrir el principal + 5%
      const amountToRepay = BigInt(Math.ceil(totalToPay * 10_000_000));

      const contract = new Contract(LENDING_CONTRACT_ID);
      const operation = contract.call(
        "repay",
        new Address(userAddress).toScVal(),
        nativeToScVal(amountToRepay, { type: "i128" })
      );

      const account = await server.getAccount(userAddress);
      const tx = new TransactionBuilder(account, { fee: "100000", networkPassphrase })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const preparedTx = await server.prepareTransaction(tx);
      const signResponse = await signTransaction(preparedTx.toXDR(), { networkPassphrase });
      
      if (signResponse.error || !signResponse.signedTxXdr) {
         throw new Error("Transacción cancelada en Freighter.");
      }

      const signedTx = TransactionBuilder.fromXDR(signResponse.signedTxXdr, networkPassphrase);
      await server.sendTransaction(signedTx);
      
      window.location.reload(); 

    } catch (error: any) {
      console.error("❌ Error al pagar:", error);
      setErrorMsg(error?.message || "No se pudo realizar el pago. Revisa tus fondos.");
    } finally {
      setLoadingTx(false);
    }
  };

  // ⏳ PANTALLAS DE CARGA Y BLOQUEO
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
            Tu nivel actual es <span className="text-foreground font-bold">{creditData.tierName}</span>. 
            Reclama tu NFT para desbloquear.
          </p>
        </div>
      </div>
    );
  }

  // ✅ ESTADO DESBLOQUEADO
  return (
    <div className="card-elevated p-6 border-2 border-primary/20 bg-gradient-to-br from-card to-primary/5 transition-all duration-700 min-h-[220px] flex flex-col">
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
          // 🚨 REVISAMOS SI ESTÁ EN MORA
          isDefaulted ? (
            <div className="py-4 text-center animate-fade-in flex flex-col h-full justify-between">
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Lock className="w-6 h-6 text-red-500" />
                </div>
                <p className="text-lg font-bold text-red-500">¡CUENTA CONGELADA!</p>
                <p className="text-xs text-red-400 mt-2">
                  Tu plazo de pago ha expirado. Deuda pendiente: <strong>{totalToPay.toFixed(2)} XLM</strong>.
                </p>
              </div>
              <button
                disabled
                className="w-full mt-4 flex items-center justify-center gap-3 py-3 text-sm font-bold rounded-xl bg-secondary text-muted-foreground cursor-not-allowed opacity-50"
              >
                Contactar a Soporte
              </button>
            </div>
          ) : (
            // 🟢 ESTADO NORMAL: PRÉSTAMO ACTIVO
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
                
                {/* ⏱️ UI DEL TEMPORIZADOR */}
                <div className={`flex items-center justify-center gap-2 mt-4 mb-4 text-sm py-2 px-3 rounded-lg font-bold transition-colors ${
                  timeLeft <= 15 ? "text-red-500 bg-red-500/10 animate-pulse" : "text-amber-600 bg-amber-500/10"
                }`}>
                  <CalendarClock className="w-4 h-4" />
                  <span>Vence en: {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')} min</span>
                </div>
              </div>

              {/* 🛑 BANNER DE ERROR AMIGABLE */}
              {errorMsg && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2 text-destructive text-xs text-left animate-fade-in">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>{errorMsg}</p>
                </div>
              )}
              
              <button
                onClick={handleRepay}
                disabled={loadingTx}
                className="w-full flex items-center justify-center gap-3 py-3 text-sm font-bold rounded-xl border-2 border-primary text-primary hover:bg-primary/10 transition-all disabled:opacity-50"
              >
                {loadingTx ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Procesando...
                  </>
                ) : (
                  <>
                    <ArrowUpFromLine className="w-4 h-4" /> Pagar {totalToPay.toFixed(2)} XLM
                  </>
                )}
              </button>
            </div>
          )
        ) : (
          // 🔵 ESTADO INICIAL: BOTÓN DE RETIRO
          <div className="py-2 flex flex-col items-center justify-center">
            <div className="flex items-baseline gap-1 mt-1 mb-1">
              <span className="text-4xl font-extrabold text-foreground tabular-nums tracking-tight">
                {creditData.limit}
              </span>
              <span className="text-lg font-bold text-muted-foreground">XLM</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">Límite de crédito disponible según tu SBT</p>
            
            {/* 🛑 BANNER DE ERROR AMIGABLE */}
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
              {loadingTx ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" /> Autorizando...
                </>
              ) : (
                <>
                  <ArrowDownToLine className="w-5 h-5" /> Retirar a mi Wallet
                </>
              )}
            </button>
            <div className="text-[10px] text-center text-muted-foreground mt-4 space-y-1">
              <p>El retiro genera una transacción en la red Testnet de Stellar.</p>
              <p className="font-semibold text-amber-500/80">
                Total a pagar al vencer (1 mes): {totalToPay.toFixed(2)} XLM (Incluye 5% interés)
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const CheckCircle2 = ({ className }: { className?: string }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
);

export default CreditSection;