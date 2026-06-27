import { useState, useEffect, useCallback } from "react";
import { fetchContractBalance, fetchTotalDeposited, fetchTotalWithdrawn } from "@/stellar/queries";

interface YieldData {
  /** Posición real en vivo (principal + rendimiento del vault DeFindex). */
  realBalance: number;
  /** Principal neto aportado (depositado − retirado). */
  netPrincipal: number;
  /** Rendimiento generado = max(0, posición − principal neto). */
  yieldEarned: number;
  loading: boolean;
}

/**
 * Lee la posición real del vault y deriva el rendimiento generado.
 * Misma lógica que tenía Retiros.tsx; centralizada para reusar en el Dashboard.
 */
export function useYield(walletAddress: string | null, intervalMs = 8000): YieldData {
  const [realBalance, setRealBalance] = useState(0);
  const [netPrincipal, setNetPrincipal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (address: string) => {
    try {
      const [position, deposited, withdrawn] = await Promise.all([
        fetchContractBalance(address),
        fetchTotalDeposited(address),
        fetchTotalWithdrawn(address),
      ]);
      setRealBalance(position);
      setNetPrincipal(Math.max(0, deposited - withdrawn));
    } catch (error) {
      console.error("Error al cargar rendimiento:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!walletAddress) {
      setLoading(false);
      return;
    }
    load(walletAddress);
    const id = setInterval(() => load(walletAddress), intervalMs);
    return () => clearInterval(id);
  }, [walletAddress, intervalMs, load]);

  return {
    realBalance,
    netPrincipal,
    yieldEarned: Math.max(0, realBalance - netPrincipal),
    loading,
  };
}
