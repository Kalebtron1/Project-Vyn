import { TrendingUp, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWallet } from "@/hooks/useWallet";
import { useYield } from "@/hooks/useYield";

/** Rendimiento real generado en el vault DeFindex (dato on-chain). */
const YieldCard = () => {
  const { t } = useTranslation();
  const { wallet } = useWallet();
  const { yieldEarned } = useYield(wallet);

  return (
    <div className="card-elevated p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-accent" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground truncate">{t("home.yield_title")}</p>
            <p className="text-xs text-muted-foreground truncate">{t("home.yield_subtitle")}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-emerald-500 tabular-nums">+{yieldEarned.toFixed(2)} USDC</p>
          <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider flex items-center gap-1 justify-end">
            <Sparkles className="w-3 h-3 text-accent" /> {t("withdrawals.yield_label")}
          </p>
        </div>
      </div>
    </div>
  );
};

export default YieldCard;
