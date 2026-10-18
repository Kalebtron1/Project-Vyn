import { useState, useEffect, useMemo } from "react";
import { useWallet } from "@/hooks/useWallet";
import {
  ArrowUpRight, ArrowDownLeft, ArrowUpFromLine, Banknote, Award,
  PiggyBank, Calendar, Loader2, ExternalLink, Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import AppShell from "@/components/AppShell";
import { useFormatters } from "@/lib/format";
import { fetchActivity, type ActivityItem, type ActivityKind } from "@/stellar/activity";

// Misma estética por tipo que ActivityList: ahorro USDC, crédito XLM, mint = nivel.
const KIND_META: Record<
  ActivityKind,
  { icon: typeof ArrowUpRight; labelKey: string; iconBg: string; iconColor: string; amountColor: string; dot: string }
> = {
  deposit: { icon: ArrowUpRight, labelKey: "activity.tx_deposit", iconBg: "bg-primary/10", iconColor: "text-primary", amountColor: "text-primary", dot: "bg-primary" },
  savings_withdraw: { icon: ArrowDownLeft, labelKey: "activity.tx_savings_withdraw", iconBg: "bg-emerald-500/10", iconColor: "text-emerald-500", amountColor: "text-emerald-500", dot: "bg-emerald-500" },
  loan: { icon: Banknote, labelKey: "activity.tx_loan", iconBg: "bg-amber-500/10", iconColor: "text-amber-500", amountColor: "text-amber-600", dot: "bg-amber-500" },
  repay: { icon: ArrowUpFromLine, labelKey: "activity.tx_repay", iconBg: "bg-sky-500/10", iconColor: "text-sky-500", amountColor: "text-foreground", dot: "bg-sky-500" },
  mint: { icon: Award, labelKey: "activity.tx_mint", iconBg: "bg-purple-500/10", iconColor: "text-purple-500", amountColor: "text-primary", dot: "bg-purple-500" },
};

type TabId = "all" | "deposits" | "withdrawals" | "loans";

const TABS: { id: TabId; labelKey: string }[] = [
  { id: "all", labelKey: "history.tab_all" },
  { id: "deposits", labelKey: "history.tab_deposits" },
  { id: "withdrawals", labelKey: "history.tab_withdrawals" },
  { id: "loans", labelKey: "history.tab_loans" },
];

const Historial = () => {
  const { wallet: walletAddress } = useWallet();
  const { t } = useTranslation();
  const { formatAmount, formatDate } = useFormatters();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sbtLevel, setSbtLevel] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!walletAddress) {
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const [activity] = await Promise.all([
          fetchActivity(walletAddress),
          fetch(`/api/get-available-credit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userAddress: walletAddress }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d?.success && d.tier >= 1) setSbtLevel(d.tierName);
              else setSbtLevel(null);
            })
            .catch(() => setSbtLevel(null)),
        ]);
        setItems(activity);
      } catch (error) {
        console.error("Error cargando historial:", error);
      } finally {
        setLoading(false);
      }
    };

    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [walletAddress]);

  // Filtrado por pestaña + búsqueda (sobre datos reales).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((tx) => {
      const matchesTab =
        tab === "all" ||
        (tab === "deposits" && tx.kind === "deposit") ||
        (tab === "withdrawals" && tx.kind === "savings_withdraw") ||
        (tab === "loans" && (tx.kind === "loan" || tx.kind === "repay"));
      if (!matchesTab) return false;
      if (!q) return true;
      const label = tx.kind === "mint" ? `${tx.level}` : t(KIND_META[tx.kind].labelKey);
      const hay = `${label} ${tx.amount} ${tx.currency} ${tx.txHash} ${tx.level ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, tab, query, t]);

  // Agrupación por mes (sobre el filtrado).
  const grouped = filtered.reduce<Record<string, ActivityItem[]>>((acc, tx) => {
    const key = formatDate(tx.date, { month: "long", year: "numeric" });
    if (!acc[key]) acc[key] = [];
    acc[key].push(tx);
    return acc;
  }, {});

  // Resumen del ahorro (dominio USDC) — sobre todos los items.
  const deposits = items.filter((tx) => tx.kind === "deposit");
  const savingsWithdrawals = items.filter((tx) => tx.kind === "savings_withdraw");
  const totalSavedVolume = deposits.reduce((sum, tx) => sum + tx.amount, 0);
  const totalWithdrawnVolume = savingsWithdrawals.reduce((sum, tx) => sum + tx.amount, 0);

  // Distribución por tipo (donut) derivada de datos reales.
  const typeCounts = useMemo(() => {
    const counts: Record<ActivityKind, number> = { deposit: 0, savings_withdraw: 0, loan: 0, repay: 0, mint: 0 };
    items.forEach((tx) => { counts[tx.kind] += 1; });
    return counts;
  }, [items]);

  const donutGradient = useMemo(() => {
    const total = items.length || 1;
    const colorByKind: Record<ActivityKind, string> = {
      deposit: "hsl(var(--primary))",
      savings_withdraw: "#10b981",
      loan: "#f59e0b",
      repay: "#0ea5e9",
      mint: "#a855f7",
    };
    let acc = 0;
    const segments = (Object.keys(typeCounts) as ActivityKind[])
      .filter((k) => typeCounts[k] > 0)
      .map((k) => {
        const start = (acc / total) * 100;
        acc += typeCounts[k];
        const end = (acc / total) * 100;
        return `${colorByKind[k]} ${start}% ${end}%`;
      });
    return segments.length ? `conic-gradient(${segments.join(", ")})` : "conic-gradient(hsl(var(--muted)) 0% 100%)";
  }, [typeCounts, items.length]);

  return (
    <AppShell title={t("history.title")} subtitle={t("history.subtitle")}>
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Lista principal */}
        <div className="xl:col-span-8 flex flex-col gap-4">
          {/* SBT level chip */}
          {sbtLevel && (
            <div className="flex justify-end">
              <span className="flex items-center gap-1 text-[11px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full">
                <Award className="w-3.5 h-3.5" /> {t("activity.tx_mint", { level: sbtLevel })}
              </span>
            </div>
          )}

          {/* Tabs + búsqueda */}
          <div className="card-elevated p-4">
            <div className="flex gap-1 mb-3 overflow-x-auto no-scrollbar">
              {TABS.map((tabItem) => (
                <button
                  key={tabItem.id}
                  onClick={() => setTab(tabItem.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-colors ${
                    tab === tabItem.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {t(tabItem.labelKey)}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("history.search_placeholder")}
                className="w-full pl-10 pr-4 py-2.5 bg-secondary rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-primary/30 text-foreground"
              />
            </div>
          </div>

          {loading ? (
            <div className="card-elevated p-10 flex flex-col items-center justify-center min-h-[250px]">
              <Loader2 className="w-8 h-8 animate-spin text-primary/50 mb-4" />
              <p className="text-sm font-semibold text-foreground">{t("history.syncing")}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="card-elevated p-10 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-3">
                <PiggyBank className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-0.5">
                {walletAddress ? t("history.empty_title_no_txs") : t("history.empty_title_no_wallet")}
              </p>
              <p className="text-xs text-muted-foreground">
                {walletAddress ? t("history.empty_description_no_txs") : t("history.empty_description_no_wallet")}
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="card-elevated p-10 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-3">
                <Search className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-0.5">{t("history.empty_filtered_title")}</p>
              <p className="text-xs text-muted-foreground">{t("history.empty_filtered_description")}</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(grouped).map(([month, txs], gi) => (
                <section key={month} className="opacity-0 animate-fade-up" style={{ animationDelay: `${gi * 80}ms`, animationFillMode: "forwards" }}>
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs font-bold tracking-wide uppercase text-muted-foreground capitalize">{month}</span>
                  </div>

                  <div className="card-elevated divide-y divide-border overflow-hidden">
                    {txs.map((tx) => {
                      const meta = KIND_META[tx.kind];
                      const Icon = meta.icon;
                      return (
                        <div key={tx.id} className="flex items-center gap-3 px-5 py-4 hover:bg-secondary/30 transition-colors">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${meta.iconBg}`}>
                            <Icon className={`w-5 h-5 ${meta.iconColor}`} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-foreground truncate">
                              {tx.kind === "mint" ? t("activity.tx_mint", { level: tx.level }) : t(meta.labelKey)}
                            </p>
                            <p className="text-xs font-medium text-muted-foreground mt-0.5">
                              {formatDate(tx.date, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>

                          <div className="text-right flex flex-col items-end">
                            {tx.kind === "mint" ? (
                              <span className="block text-sm font-bold text-primary">{tx.level}</span>
                            ) : (
                              <span className={`block text-sm font-bold tabular-nums ${meta.amountColor}`}>
                                {tx.sign}{formatAmount(tx.amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {tx.currency}
                              </span>
                            )}
                            <a
                              href={`https://stellar.expert/explorer/testnet/tx/${tx.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-end gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground mt-1 hover:text-foreground transition-colors"
                            >
                              {t("common.receipt")} <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Columna lateral: resumen + tipos */}
        <div className="xl:col-span-4 flex flex-col gap-5">
          {items.length > 0 && (
            <>
              <div className="card-navy p-6">
                <p className="text-[10px] font-bold tracking-widest uppercase opacity-60 mb-5 text-center">{t("history.summary_title")}</p>
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4 divide-x divide-white/10">
                    <div className="text-center">
                      <p className="text-2xl font-extrabold tabular-nums text-white mb-1">{deposits.length}</p>
                      <p className="text-[10px] font-semibold opacity-60 uppercase tracking-wide">{t("history.summary_deposits")}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-extrabold tabular-nums text-white mb-1">
                        {formatAmount(totalSavedVolume, { maximumFractionDigits: 0 })} <span className="text-sm font-medium opacity-60 ml-0.5">USDC</span>
                      </p>
                      <p className="text-[10px] font-semibold opacity-60 uppercase tracking-wide">{t("history.summary_volume_in")}</p>
                    </div>
                  </div>
                  <hr className="border-white/10 mx-4" />
                  <div className="grid grid-cols-2 gap-4 divide-x divide-white/10">
                    <div className="text-center">
                      <p className="text-2xl font-extrabold tabular-nums text-emerald-400 mb-1">{savingsWithdrawals.length}</p>
                      <p className="text-[10px] font-semibold opacity-60 uppercase tracking-wide">{t("history.summary_withdrawals")}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-extrabold tabular-nums text-emerald-400 mb-1">
                        {formatAmount(totalWithdrawnVolume, { maximumFractionDigits: 0 })} <span className="text-sm font-medium opacity-60 ml-0.5 text-white">USDC</span>
                      </p>
                      <p className="text-[10px] font-semibold opacity-60 uppercase tracking-wide">{t("history.summary_volume_out")}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Distribución por tipo (derivada de datos reales) */}
              <div className="card-elevated p-6">
                <h3 className="text-sm font-bold text-foreground mb-6">{t("history.types_title")}</h3>
                <div className="flex items-center gap-6">
                  <div className="relative w-24 h-24 shrink-0 rounded-full" style={{ background: donutGradient }}>
                    <div className="absolute inset-[22%] bg-card rounded-full flex items-center justify-center">
                      <div className="text-center">
                        <p className="text-lg font-bold text-foreground leading-tight tabular-nums">{items.length}</p>
                        <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">{t("history.types_total")}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2">
                    {(Object.keys(typeCounts) as ActivityKind[])
                      .filter((k) => typeCounts[k] > 0)
                      .map((k) => (
                        <div key={k} className="flex justify-between items-center text-xs">
                          <div className="flex items-center gap-2 font-semibold">
                            <span className={`w-2.5 h-2.5 rounded-full ${KIND_META[k].dot}`} />
                            <span className="text-foreground">{t(KIND_META[k].labelKey, { level: "" })}</span>
                          </div>
                          <span className="font-bold text-foreground tabular-nums">{typeCounts[k]}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
};

export default Historial;
