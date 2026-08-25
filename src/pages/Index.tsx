import { useState } from "react";
import { Plus, AlertTriangle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import AppShell from "@/components/AppShell";
import BalanceCard from "@/components/BalanceCard";
import ProgressRing from "@/components/ProgressRing";
import CreditSection from "@/components/CreditSection";
import ActivityList from "@/components/ActivityList";
import DepositModal from "@/components/DepositModal";
import YieldCard from "@/components/dashboard/YieldCard";
import NftLevelCard from "@/components/dashboard/NftLevelCard";
import PeriodSummaryCard from "@/components/dashboard/PeriodSummaryCard";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "@/hooks/use-toast";

const Index = () => {
  const { walletStatus, reconnect, isExpired, sessionError } = useWallet();
  const [depositOpen, setDepositOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const { t } = useTranslation();

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      const res = await reconnect();
      if (!res.ok && res.error) {
        toast({
          title: t("common.error"),
          description: res.error,
          variant: "destructive",
        });
      }
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <AppShell title={t("home.welcome_title")} subtitle={t("home.dashboard_subtitle")}>
      {/* Banner de wallet desconectada / sesión expirada */}
      {walletStatus === "disconnected" && (
        <div className="max-w-[1400px] mx-auto mb-4 flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-amber-700">
              {isExpired ? t("wallet_errors.session_expired") : t("home.wallet_disconnected_title")}
            </p>
            <p className="text-[11px] text-amber-800/70">
              {sessionError || t("home.wallet_disconnected_description")}
            </p>
          </div>
          <button
            onClick={handleReconnect}
            disabled={reconnecting}
            className="text-[11px] font-bold text-amber-700 hover:underline flex-shrink-0 flex items-center gap-1 disabled:opacity-50"
          >
            {reconnecting && <Loader2 className="w-3 h-3 animate-spin" />}
            {t("home.reconnect")}
          </button>
        </div>
      )}

      <div className="max-w-[1400px] mx-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 items-start">
        {/* Columna 1: ahorro + depositar + reputación + rendimiento */}
        <div className="flex flex-col gap-5 opacity-0 animate-fade-up" style={{ animationDelay: "80ms", animationFillMode: "forwards" }}>
          <BalanceCard />
          <button
            onClick={() => setDepositOpen(true)}
            className="btn-emerald w-full flex items-center justify-center gap-2 py-4 text-base font-bold shadow-lg shadow-emerald-500/10"
          >
            <Plus className="w-5 h-5" />
            {t("home.deposit_button")}
          </button>
          <ProgressRing />
          <YieldCard />
        </div>

        {/* Columna 2: crédito + actividad */}
        <div className="flex flex-col gap-5 opacity-0 animate-fade-up" style={{ animationDelay: "200ms", animationFillMode: "forwards" }}>
          <CreditSection />
          <ActivityList />
        </div>

        {/* Columna 3: nivel NFT + resumen del periodo */}
        <div className="flex flex-col gap-5 opacity-0 animate-fade-up md:col-span-2 xl:col-span-1" style={{ animationDelay: "320ms", animationFillMode: "forwards" }}>
          <NftLevelCard />
          <PeriodSummaryCard />
        </div>
      </div>

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
    </AppShell>
  );
};

export default Index;
