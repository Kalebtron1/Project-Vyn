import { useState, useEffect } from "react";
import { useWallet } from "@/hooks/useWallet";
import {
  ArrowUpRight, ArrowDownLeft, ArrowUpFromLine, Banknote, Award,
  PiggyBank, Loader2, ExternalLink,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchActivity, type ActivityItem, type ActivityKind } from "@/stellar/activity";

// Estética por tipo de acción. Depósito/retiro de ahorro = USDC; préstamo/pago = XLM;
// mint = nivel (sin moneda).
const KIND_META: Record<
  ActivityKind,
  { icon: typeof ArrowUpRight; labelKey: string; iconBg: string; iconColor: string; amountColor: string }
> = {
  deposit: { icon: ArrowUpRight, labelKey: "activity.tx_deposit", iconBg: "bg-primary/10", iconColor: "text-primary", amountColor: "text-primary" },
  savings_withdraw: { icon: ArrowDownLeft, labelKey: "activity.tx_savings_withdraw", iconBg: "bg-emerald-500/10", iconColor: "text-emerald-500", amountColor: "text-emerald-500" },
  loan: { icon: Banknote, labelKey: "activity.tx_loan", iconBg: "bg-amber-500/10", iconColor: "text-amber-500", amountColor: "text-amber-600" },
  repay: { icon: ArrowUpFromLine, labelKey: "activity.tx_repay", iconBg: "bg-sky-500/10", iconColor: "text-sky-500", amountColor: "text-foreground" },
  mint: { icon: Award, labelKey: "activity.tx_mint", iconBg: "bg-purple-500/10", iconColor: "text-purple-500", amountColor: "text-primary" },
};

const ActivityList = () => {
  const { wallet: walletAddress } = useWallet();
  const [movements, setMovements] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    if (!walletAddress) {
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const items = await fetchActivity(walletAddress);
        setMovements(items.slice(0, 5));
      } catch (error) {
        console.error("Error cargando actividad:", error);
      } finally {
        setLoading(false);
      }
    };

    load();
    // Refresco silencioso para reflejar nuevas acciones sin recargar la página.
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [walletAddress]);

  if (loading) {
    return (
      <div className="card-elevated p-8 flex flex-col items-center justify-center min-h-[200px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary/50" />
      </div>
    );
  }

  if (movements.length === 0) {
    return (
      <div className="card-elevated p-8 flex flex-col items-center text-center animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-3">
          <PiggyBank className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="text-sm font-bold text-foreground mb-0.5">
          {walletAddress ? t("activity.empty_title_no_activity") : t("activity.empty_title_no_wallet")}
        </p>
        <p className="text-xs text-muted-foreground">
          {walletAddress ? t("activity.empty_description_no_activity") : t("activity.empty_description_no_wallet")}
        </p>
      </div>
    );
  }

  return (
    <div className="card-elevated divide-y divide-border">
      <div className="px-5 py-3 flex items-center justify-between">
        <span className="text-xs font-bold tracking-wide uppercase text-muted-foreground">{t("activity.header")}</span>
        <span className="text-[10px] font-semibold bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">
          {t("common.stellar_testnet")}
        </span>
      </div>

      {movements.map((d, i) => {
        const meta = KIND_META[d.kind];
        const Icon = meta.icon;
        return (
          <div
            key={d.id}
            className="flex items-center gap-3 px-5 py-3.5 opacity-0 animate-fade-up hover:bg-secondary/30 transition-colors"
            style={{ animationDelay: `${i * 80}ms`, animationFillMode: "forwards" }}
          >
            <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${meta.iconBg}`}>
              <Icon className={`w-4 h-4 ${meta.iconColor}`} />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {d.kind === "mint" ? t("activity.tx_mint", { level: d.level }) : t(meta.labelKey)}
              </p>
              <p className="text-xs text-muted-foreground">
                {d.date.toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>

            <div className="text-right">
              {d.kind === "mint" ? (
                <span className="text-sm font-bold text-primary">{d.level}</span>
              ) : (
                <span className={`text-sm font-bold tabular-nums ${meta.amountColor}`}>
                  {d.sign}{d.amount.toFixed(2)} {d.currency}
                </span>
              )}
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${d.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="block text-[9px] font-medium text-muted-foreground mt-0.5 hover:text-foreground transition-colors flex items-center justify-end gap-0.5"
              >
                {t("common.view_on_network")} <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ActivityList;
