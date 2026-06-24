import { useState, useEffect, useCallback } from "react";
import { walletAdapter } from "@/wallet";
import { fetchContractBalance } from "../stellar/queries"; 
import { Wallet, RefreshCw } from "lucide-react";

const BalanceCard = () => {
  const [realBalance, setRealBalance] = useState<number | string>("...");
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // NUEVO: Guardamos la dirección de la wallet para no pedirla a cada rato
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  // 1. PASO UNO: Pedir acceso a Freighter SOLO UNA VEZ al montar el componente
  useEffect(() => {
    const initWallet = async () => {
      try {
        if (await walletAdapter.isConnected()) {
          const address = await walletAdapter.connect();
          setWalletAddress(address);
        } else {
          setRealBalance(0);
        }
      } catch (error) {
        console.error("Error conectando Freighter al inicio:", error);
        setRealBalance(0);
      }
    };
    initWallet();
  }, []); // <-- El array vacío garantiza que esto pase SOLO UNA VEZ

  // 2. PASO DOS: Consultar el saldo usando la dirección ya guardada
  const loadBalance = useCallback(async (address: string, silent = false) => {
    if (!silent) setIsRefreshing(true);
    
    try {
      // Ya no llamamos a requestAccess() aquí, solo vamos directo a Soroban
      const balance = await fetchContractBalance(address);
      setRealBalance(balance);
    } catch (error) {
      console.error("❌ Error consultando el saldo:", error);
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }, []);

  // 3. PASO TRES: El Polling (Magia en tiempo real)
  useEffect(() => {
    // Si todavía no tenemos la dirección, no hacemos nada
    if (!walletAddress) return;

    // Carga inicial inmediata
    loadBalance(walletAddress, false);

    // Preguntamos a Soroban cada 5 segundos (silenciosamente)
    const intervalId = setInterval(() => {
      loadBalance(walletAddress, true); 
    }, 5000);

    // Limpieza
    return () => clearInterval(intervalId);
  }, [walletAddress, loadBalance]); // <-- Depende de walletAddress

  return (
    <div className="bg-primary rounded-2xl p-6 text-primary-foreground shadow-lg w-full relative overflow-hidden">
      <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>

      <div className="flex items-center justify-between mb-6 relative z-10">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 opacity-80" />
          <span className="text-sm font-semibold tracking-wider opacity-90">MI AHORRO</span>
        </div>
        
        <button 
          onClick={() => walletAddress && loadBalance(walletAddress, false)} 
          disabled={isRefreshing || !walletAddress}
          className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-all active:scale-95 disabled:opacity-50"
          title="Actualizar saldo"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex items-baseline gap-2 relative z-10">
        <span className="text-5xl font-extrabold tracking-tight tabular-nums transition-all duration-500">
          {realBalance}
        </span>
        <span className="text-xl font-medium opacity-80">USDC</span>
      </div>

      <p className="text-primary-foreground/70 text-sm mt-2 relative z-10">
        Saldo disponible en contrato
      </p>
    </div>
  );
};

export default BalanceCard;