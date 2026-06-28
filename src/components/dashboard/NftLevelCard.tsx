import { useState, useEffect } from "react";
import { Medal, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWallet } from "@/hooks/useWallet";
import { fetchContractBalance } from "@/stellar/queries";
import { getCurrentLevel, getNextLevel } from "@/components/ProgressRing";
import { tierLabel } from "@/lib/tier";

/** Tarjeta dedicada del nivel NFT/SBT con progreso al siguiente nivel (dato real). */
const NftLevelCard = () => {
  const { t } = useTranslation();
  const { wallet } = useWallet();
  const [score, setScore] = useState(0);
  const [tier, setTier] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!wallet) {
      setLoading(false);
      return;
    }
    let mounted = true;

    const load = async () => {
      try {
        const balance = await fetchContractBalance(wallet);
        const [creditRes, scoreRes] = await Promise.all([
          fetch("/api/get-available-credit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userAddress: wallet }),
          }),
          fetch("/api/calculate-score", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: wallet, totalDeposited: Number(balance) }),
          }),
        ]);
        const creditData = creditRes.ok ? await creditRes.json() : {};
        const scoreData = scoreRes.ok ? await scoreRes.json() : {};
        const onChainTier = Number(creditData?.tier) || 0;
        const dynamicScore = Number(scoreData?.score) || 0;
        if (!mounted) return;
        setTier(onChainTier);
        // Score en vivo: sube al depositar, baja al retirar (sin piso por tier).
        setScore(dynamicScore);
      } catch (error) {
        console.error("Error cargando nivel NFT:", error);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    const id = setInterval(load, 15000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [wallet]);

  if (loading) {
    return (
      <div className="card-elevated p-6 flex items-center justify-center min-h-[150px]">
        <Loader2 className="w-6 h-6 animate-spin text-primary/50" />
      </div>
    );
  }

  const current = getCurrentLevel(score);
  const next = getNextLevel(score);
  const progress = next
    ? Math.min(Math.max((score - current.minScore) / (next.minScore - current.minScore), 0), 1)
    : 1;

  return (
    <div className="card-elevated p-6">
      <div className="flex items-center gap-2 text-sm font-bold text-foreground mb-5">
        <Medal className="w-4 h-4 text-primary" /> {t("home.nft_card_title")}
      </div>

      <div className="flex items-center gap-4 mb-5">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
          <Medal className="w-7 h-7 text-amber-500" />
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider">{t("home.nft_rank_label")}</p>
          <h3 className="text-xl font-bold text-foreground">{tierLabel(t, current.tier)} {current.emoji}</h3>
        </div>
      </div>

      <div className="w-full bg-secondary rounded-full h-2 mb-2 overflow-hidden">
        <div className="bg-gradient-to-r from-primary to-accent h-2 rounded-full transition-all duration-700" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="flex justify-between text-[11px] font-bold text-muted-foreground">
        {next ? (
          <>
            <span>{t("home.nft_next_level", { level: tierLabel(t, next.tier) })}</span>
            <span className="tabular-nums">{Math.round(score)} / {next.minScore} pts</span>
          </>
        ) : (
          <span className="text-primary">{t("home.nft_max_level")}</span>
        )}
      </div>
    </div>
  );
};

export default NftLevelCard;
