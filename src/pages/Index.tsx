import { useState } from "react";
import { Plus, LogOut, User, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import logoVin from "@/assets/logo-vin.png";
import BalanceCard from "@/components/BalanceCard";
import ProgressRing from "@/components/ProgressRing";
import CreditSection from "@/components/CreditSection";
import ActivityList from "@/components/ActivityList";
import DepositModal from "@/components/DepositModal";
import BottomNav from "@/components/BottomNav";
import { useWallet } from "@/hooks/useWallet";

const Index = () => {
  const { shortWallet, disconnect, walletStatus } = useWallet();
  const [depositOpen, setDepositOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={logoVin} alt={t("common.app_name")} className="w-9 h-9 object-contain" />
          <div>
            <h1 className="text-xl font-extrabold text-foreground tracking-tight">{t("common.app_name")}</h1>
            <div className="flex items-center gap-1.5 mt-0.5 text-muted-foreground">
              <User className="w-3 h-3 text-emerald-500" />
              <p className="text-[10px] font-mono font-bold tracking-wider uppercase">
                {shortWallet || t("home.loading_wallet")}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={disconnect}
            className="flex items-center justify-center p-2 text-muted-foreground hover:text-destructive bg-secondary/50 rounded-full transition-colors active:scale-95 border border-transparent hover:border-destructive/20"
            title={t("common.logout")}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Disconnected wallet banner */}
      {walletStatus === "disconnected" && (
        <div className="mx-5 mb-2 flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-amber-700">{t("home.wallet_disconnected_title")}</p>
            <p className="text-[11px] text-amber-800/70">
              {t("home.wallet_disconnected_description")}
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="text-[11px] font-bold text-amber-700 hover:underline flex-shrink-0"
          >
            {t("home.reconnect")}
          </button>
        </div>
      )}

      {/* Content Main */}
      <main className="px-5 space-y-4 max-w-md mx-auto mt-2">
        <section className="space-y-4 opacity-0 animate-fade-up" style={{ animationDelay: "100ms", animationFillMode: "forwards" }}>
          
          <BalanceCard />
          
          <button
            onClick={() => setDepositOpen(true)}
            className="btn-emerald w-full flex items-center justify-center gap-2 py-4 text-base font-bold shadow-lg shadow-emerald-500/10"
          >
            <Plus className="w-5 h-5" />
            {t("home.deposit_button")}
          </button>

          <ProgressRing />

        </section>

        <section className="opacity-0 animate-fade-up" style={{ animationDelay: "250ms", animationFillMode: "forwards" }}>
          <CreditSection />
        </section>

        <section className="opacity-0 animate-fade-up" style={{ animationDelay: "400ms", animationFillMode: "forwards" }}>
          <ActivityList />
        </section>
      </main>

      <BottomNav />
      
      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
    </div>
  );
};

export default Index;