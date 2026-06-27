import { useState, useEffect } from "react";
import { ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWallet } from "@/hooks/useWallet";
import { fetchActivity, type ActivityItem } from "@/stellar/activity";

/** Resumen del periodo (mes en curso) derivado de la actividad real on-chain. */
const PeriodSummaryCard = () => {
  const { t } = useTranslation();
  const { wallet } = useWallet();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!wallet) {
      setLoading(false);
      return;
    }
    let mounted = true;
    const load = async () => {
      try {
        const activity = await fetchActivity(wallet);
        if (mounted) setItems(activity);
      } catch (error) {
        console.error("Error cargando resumen del periodo:", error);
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

  // Filtra al mes en curso.
  const now = new Date();
  const monthItems = items.filter(
    (tx) => tx.date.getMonth() === now.getMonth() && tx.date.getFullYear() === now.getFullYear(),
  );
  const deposits = monthItems.filter((tx) => tx.kind === "deposit");
  const withdrawals = monthItems.filter((tx) => tx.kind === "savings_withdraw");
  const volumeIn = deposits.reduce((s, tx) => s + tx.amount, 0);
  const volumeOut = withdrawals.reduce((s, tx) => s + tx.amount, 0);

  if (loading) {
    return (
      <div className="card-elevated p-6 flex items-center justify-center min-h-[150px]">
        <Loader2 className="w-6 h-6 animate-spin text-primary/50" />
      </div>
    );
  }

  return (
    <div className="card-elevated p-6">
      <h3 className="text-sm font-bold text-foreground mb-5">{t("home.period_title")}</h3>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="p-3 bg-secondary/50 border border-border rounded-2xl flex flex-col items-center text-center">
          <div className="w-8 h-8 rounded-full bg-card text-primary flex items-center justify-center shadow-sm mb-2">
            <ArrowUp className="w-4 h-4" />
          </div>
          <div className="text-xl font-bold text-foreground tabular-nums">{deposits.length}</div>
          <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">{t("home.period_deposits")}</div>
        </div>
        <div className="p-3 bg-secondary/50 border border-border rounded-2xl flex flex-col items-center text-center">
          <div className="w-8 h-8 rounded-full bg-card text-destructive flex items-center justify-center shadow-sm mb-2">
            <ArrowDown className="w-4 h-4" />
          </div>
          <div className="text-xl font-bold text-foreground tabular-nums">{withdrawals.length}</div>
          <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">{t("home.period_withdrawals")}</div>
        </div>
      </div>

      <div className="p-4 bg-secondary/50 border border-border rounded-2xl flex justify-between items-center">
        <div>
          <div className="text-lg font-bold text-primary tabular-nums">
            {volumeIn.toFixed(0)} <span className="text-[10px] text-muted-foreground uppercase">USDC</span>
          </div>
          <div className="text-[10px] text-muted-foreground font-bold uppercase mt-0.5">{t("home.period_volume_in")}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-foreground tabular-nums">
            {volumeOut.toFixed(0)} <span className="text-[10px] text-muted-foreground uppercase">USDC</span>
          </div>
          <div className="text-[10px] text-muted-foreground font-bold uppercase mt-0.5">{t("home.period_volume_out")}</div>
        </div>
      </div>
    </div>
  );
};

export default PeriodSummaryCard;
