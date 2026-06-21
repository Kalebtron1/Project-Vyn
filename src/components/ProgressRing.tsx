import React, { useState, useEffect, useCallback } from "react";
import { useWallet } from "@/hooks/useWallet";
import { fetchContractBalance } from "../stellar/queries";
import { Shield, Star, Crown, Gem, Trophy, Activity, Loader2, ArrowRight, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Level {
  name: string;
  emoji: string;
  icon: React.ElementType;
  minScore: number;
  color: string;
  creditAmount?: number;
}

// Niveles sincronizados con tu Backend (api/get-available-credit)
const LEVELS: Level[] = [
  { name: "Bronce", emoji: "🥉", icon: Shield, minScore: 0, color: "var(--sky)" },
  { name: "Plata", emoji: "🥈", icon: Star, minScore: 50, color: "var(--sky)" },
  { name: "Oro", emoji: "🥇", icon: Crown, minScore: 150, color: "var(--deep)" },
  { name: "Diamante", emoji: "💎", icon: Gem, minScore: 500, color: "var(--grape)" },
  { name: "Platino", emoji: "🏆", icon: Trophy, minScore: 1000, color: "var(--grape)" },
];

export function getCurrentLevel(score: number): Level {
  let current = LEVELS[0];
  for (const level of LEVELS) {
    if (score >= level.minScore) current = level;
  }
  return current;
}

export function getNextLevel(score: number): Level | null {
  for (const level of LEVELS) {
    if (score < level.minScore) return level;
  }
  return null;
}

const ProgressRing = () => {
  const navigate = useNavigate();
  const { wallet: walletAddress } = useWallet();

  const [riskScore, setRiskScore] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [onChainTier, setOnChainTier] = useState(0); 
  const [needsMinting, setNeedsMinting] = useState(false);
  const [levelToMint, setLevelToMint] = useState<Level | null>(null);
  const [historyCount, setHistoryCount] = useState(0);
  const [minHistoryRequired, setMinHistoryRequired] = useState(3);
  const [isHistoryEligible, setIsHistoryEligible] = useState(false);

  // 1. Función de carga envuelta en useCallback para evitar bucles infinitos
  const refreshData = useCallback(async (isInitial = false) => {
    if (!walletAddress) {
      if (isInitial) setIsLoading(false);
      return;
    }

    if (isInitial) setIsLoading(true);

    try {
      // Obtenemos el saldo real del contrato inteligente
      const balance = await fetchContractBalance(walletAddress);

      // Consultamos Tier actual (on-chain) y Score calculado (backend)
      const [onChainRes, scoreRes] = await Promise.all([
        fetch(`/api/get-available-credit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userAddress: walletAddress })
        }),
        fetch(`/api/calculate-score`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: walletAddress,
            totalDeposited: Number(balance),
          })
        })
      ]);

      const onChainData = await onChainRes.json();
      const scoreData = await scoreRes.json();

      // DEBUG: mostrar datos en consola para diagnosticar el Ring Score
      console.debug("[DEBUG] onChainData:", onChainData);
      console.debug("[DEBUG] scoreData:", scoreData);

      const eligibility = scoreData?.eligibility || {};
      const txCount = Number(eligibility?.historyCount) || 0;
      const minRequired = Number(eligibility?.minHistoryRequired) || 3;
      const eligibleByHistory = Boolean(eligibility?.isHistoryEligible);

      setHistoryCount(txCount);
      setMinHistoryRequired(minRequired);
      setIsHistoryEligible(eligibleByHistory);

      // Mapeo de seguridad para que la barra nunca baje si ya tiene un NFT
      const tierToScore: Record<number, number> = { 0: 0, 1: 50, 2: 150, 3: 500, 4: 1000 };
      const blockchainTier = onChainData.tier || 0;
      const baseScoreFromNFT = tierToScore[blockchainTier] || 0;
      const dynamicScore = scoreData.score || 0;

      const finalScore = Math.max(baseScoreFromNFT, dynamicScore);
      
      setRiskScore(finalScore);
      setOnChainTier(blockchainTier);

      // Verificamos si merece un ascenso solo cuando hay historial suficiente.
      const calculatedTier = scoreData.tier || 0;
      if (eligibleByHistory && calculatedTier > blockchainTier && calculatedTier >= 1) {
        setNeedsMinting(true);
        setLevelToMint(LEVELS[calculatedTier] || LEVELS[1]);
      } else {
        setNeedsMinting(false);
      }
    } catch (error) {
      console.error("❌ Error actualizando reputación:", error);
    } finally {
      if (isInitial) setIsLoading(false);
    }
  }, [walletAddress]);

  // 2. Efecto de Polling: Se dispara al inicio y cada 15 segundos
  useEffect(() => {
    refreshData(true);

    const interval = setInterval(() => {
      refreshData(false); // Refresco silencioso (sin spinner)
    }, 15000);

    return () => clearInterval(interval);
  }, [refreshData]);

  const handleManualRefresh = async () => {
    if (!walletAddress || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshData(false);
    } finally {
      setIsRefreshing(false);
    }
  };

  const current = getCurrentLevel(riskScore);
  const next = getNextLevel(riskScore);

  const progress = next
    ? Math.min((riskScore - current.minScore) / (next.minScore - current.minScore), 1)
    : 1;

  const historyProgress = Math.min(historyCount / Math.max(minHistoryRequired, 1), 1);
  const displayProgress = isHistoryEligible ? progress : historyProgress;

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - displayProgress * circumference;
  const Icon = current.icon;

  if (isLoading) {
    return (
      <div className="card-elevated p-5 flex items-center justify-center min-h-[140px]">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!walletAddress) {
    return (
      <div className="card-elevated p-5 flex flex-col items-center justify-center min-h-[140px] text-center gap-2 opacity-70">
        <Shield className="w-8 h-8 text-muted-foreground mb-1" />
        <p className="text-sm font-bold text-foreground">Reputación Vínculo</p>
        <p className="text-xs text-muted-foreground">Conecta tu wallet para ver tu nivel</p>
      </div>
    );
  }

  return (
    <div className="card-elevated p-5 transition-all duration-500 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-wide uppercase text-muted-foreground">Ring Score</span>
        <button
          type="button"
          onClick={handleManualRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-60"
          title="Actualizar Ring Score"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "Actualizando..." : "Refresh"}
        </button>
      </div>

      <div className="flex items-center gap-5">
        <div className="relative w-24 h-24 flex-shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r={radius} fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
            <circle
              cx="50" cy="50" r={radius} fill="none"
              stroke={`hsl(${current.color})`}
              strokeWidth="6" strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-extrabold text-foreground tabular-nums leading-none">
              {isHistoryEligible ? `${Math.round(displayProgress * 100)}%` : "Bloq"}
            </span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-bold tracking-wide uppercase text-muted-foreground">Reputación</span>
          </div>
          
          <p className="text-base font-bold text-foreground text-balance">
            {isHistoryEligible
              ? (next
                ? `Camino al Nivel ${next.name} ${next.emoji}`
                : `¡Nivel ${current.name} Máximo! ${current.emoji}`)
              : "Sigue usando Vyn para desbloquear tu reputación"}
          </p>
          
          <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground font-medium">
            <Activity className="w-3.5 h-3.5 text-primary" />
            {isHistoryEligible ? (
              <>
                Trust Score: <span className="font-bold text-primary">{riskScore.toFixed(1)} pts</span>
              </>
            ) : (
              <>
                Historial: <span className="font-bold text-primary">{historyCount}/{minHistoryRequired} transacciones</span>
              </>
            )}
          </div>

          <div className="flex gap-1.5 mt-3">
            {LEVELS.map((lvl, index) => {
              const isAchieved = index <= onChainTier;
              return (
                <span
                  key={lvl.name}
                  className={`text-xs px-2 py-0.5 rounded-full font-semibold transition-all duration-500 ${
                    isAchieved ? "bg-primary/15 text-primary scale-110" : "bg-secondary text-muted-foreground/30 grayscale"
                  }`}
                >
                  {lvl.emoji}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {needsMinting && levelToMint && (
        <div className="mt-2 pt-3 border-t border-border/50 animate-fade-in">
          <button 
            onClick={() => navigate('/perfil')} 
            className="w-full flex items-center justify-between bg-primary/10 hover:bg-primary/20 text-primary px-4 py-3 rounded-xl transition-all font-semibold text-sm group active:scale-95"
          >
            <div className="flex items-center gap-2">
              <span className="text-base">{levelToMint.emoji}</span>
              <span>Reclamar NFT {levelToMint.name} disponible</span>
            </div>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      )}
    </div>
  );
};

export default ProgressRing;