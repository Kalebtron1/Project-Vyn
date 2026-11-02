import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWallet } from "@/hooks/useWallet";
import { useCredit, useScore } from "@/lib/chainData";
import { getCurrentLevel, getNextLevel } from "@/components/ProgressRing";
import { tierLabel } from "@/lib/tier";

/** Tarjeta dedicada del nivel NFT/SBT con progreso al siguiente nivel (dato real). */
const NftLevelCard = () => {
  const { t } = useTranslation();
  const { wallet } = useWallet();
  // Tier on-chain y score en vivo, compartidos con ProgressRing (una sola lectura).
  const credit = useCredit(wallet);
  const scoreQuery = useScore(wallet);
  const loading = !!wallet && (credit.isPending || scoreQuery.isPending);
  // Score en vivo: sube al depositar, baja al retirar (sin piso por tier).
  const score = Number(scoreQuery.data?.score) || 0;

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
    <div className="card-metal p-6">
      <div className="flex items-center justify-between text-xs font-bold uppercase tracking-widest">
        <span>{t("common.app_name")}</span>
        <span className="card-metal-sub">SBT</span>
      </div>

      <p className="card-metal-sub text-sm font-medium mt-7">{t("home.nft_rank_label")}</p>
      <h3 className="font-display text-3xl font-extrabold tracking-tight mt-1">{tierLabel(t, current.tier)}</h3>

      <div className="w-full rounded-full h-1.5 mt-5 mb-2 overflow-hidden" style={{ backgroundColor: "hsl(var(--metal-sub) / 0.25)" }}>
        <div className="h-1.5 rounded-full transition-all duration-700 bg-current" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="card-metal-sub flex justify-between gap-3 text-xs font-semibold">
        {next ? (
          <>
            <span>{t("home.nft_next_level", { level: tierLabel(t, next.tier) })}</span>
            <span className="tabular-nums shrink-0">{Math.round(score)} / {next.minScore} pts</span>
          </>
        ) : (
          <span>{t("home.nft_max_level")}</span>
        )}
      </div>
    </div>
  );
};

export default NftLevelCard;
