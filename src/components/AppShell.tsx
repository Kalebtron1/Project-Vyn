import { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell, HelpCircle, LogOut, Wallet, Sparkles, AlertTriangle } from "lucide-react";
import logoVin from "@/assets/logo-vin.png";
import BottomNav from "@/components/BottomNav";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import { getNavItems } from "@/components/navItems";
import { useWallet } from "@/hooks/useWallet";

interface AppShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/**
 * Layout compartido: sidebar lateral en escritorio (lg+) y bottom nav en móvil.
 * Mantiene un header superior con título de página, chip de wallet y accesos
 * (tema, idioma, notificaciones). Las páginas solo renderizan su contenido.
 */
const AppShell = ({ title, subtitle, children }: AppShellProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { wallet, shortWallet, walletStatus, disconnect, walletMismatch, activeAddress } =
    useWallet();

  const navItems = getNavItems();
  const initials = shortWallet ? shortWallet.slice(0, 2).toUpperCase() : "WL";
  const isConnected = walletStatus === "connected";

  const shortExpected = wallet
    ? `${wallet.substring(0, 5)}...${wallet.substring(wallet.length - 4)}`
    : "";
  const shortActive = activeAddress
    ? `${activeAddress.substring(0, 5)}...${activeAddress.substring(activeAddress.length - 4)}`
    : "";

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* ─── Sidebar (escritorio) ─────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 sticky top-0 h-screen bg-card border-r border-border">
        <div className="h-20 flex items-center gap-3 px-6">
          <img src={logoVin} alt={t("common.app_name")} className="w-9 h-9 object-contain" />
          <span className="text-xl font-extrabold tracking-tight">{t("common.app_name")}</span>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {navItems.map(({ icon: Icon, labelKey, path }) => {
            const isActive = location.pathname === path;
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all ${
                  isActive
                    ? "text-primary-foreground bg-gradient-to-r from-primary to-sky shadow-md"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" strokeWidth={isActive ? 2.2 : 1.9} />
                {t(labelKey)}
              </button>
            );
          })}

          <div className="py-3 px-4">
            <div className="h-px bg-border w-full" />
          </div>

          <button
            onClick={() => navigate("/ayuda")}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
          >
            <HelpCircle className="w-5 h-5 shrink-0" />
            {t("profile.menu_help")}
          </button>
        </nav>

        {/* Promo: subir límites depositando */}
        <div className="p-4">
          <div className="card-navy p-5 text-center relative overflow-hidden">
            <Sparkles className="w-5 h-5 mx-auto mb-2 opacity-90" />
            <h4 className="text-xs font-bold mb-1">{t("shell.promo_title")}</h4>
            <p className="text-[10px] opacity-80 leading-relaxed mb-3">{t("shell.promo_description")}</p>
            <button
              onClick={() => navigate("/depositar")}
              className="w-full bg-white/20 hover:bg-white/30 text-white text-xs font-bold py-2 rounded-xl transition-colors"
            >
              {t("shell.promo_cta")}
            </button>
          </div>
        </div>

        <div className="px-4 pb-5">
          <button
            onClick={disconnect}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold text-destructive hover:bg-destructive/10 transition-all"
          >
            <LogOut className="w-4 h-4" /> {t("common.logout")}
          </button>
        </div>
      </aside>

      {/* ─── Área principal ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg px-4 md:px-8 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Logo solo en móvil (en escritorio ya está en el sidebar) */}
            <img src={logoVin} alt={t("common.app_name")} className="w-8 h-8 object-contain lg:hidden shrink-0" />
            <div className="min-w-0">
              <h1 className="text-xl md:text-2xl font-extrabold tracking-tight truncate">{title}</h1>
              {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
            </div>
          </div>

          <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
            <ThemeToggle />
            <div className="hidden sm:block"><LanguageToggle /></div>

            <button
              onClick={() => navigate("/notificaciones")}
              className="relative flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title={t("profile.menu_notifications")}
              aria-label={t("profile.menu_notifications")}
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-destructive rounded-full" />
            </button>

            {/* Chip de wallet (escritorio) */}
            <button
              onClick={() => navigate("/perfil")}
              className="hidden md:flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full bg-card border border-border hover:bg-secondary transition-colors"
            >
              <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold font-mono">
                {initials}
              </span>
              <span className="text-left">
                <span className="block text-[11px] font-bold font-mono leading-none">{shortWallet || "—"}</span>
                <span className="flex items-center gap-1 mt-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-emerald-400" : "bg-amber-400"}`} />
                  <span className="text-[9px] text-muted-foreground">
                    {isConnected ? t("common.wallet_connected") : t("common.wallet_not_connected")}
                  </span>
                </span>
              </span>
            </button>

            {/* Avatar compacto (móvil) */}
            <button
              onClick={() => navigate("/perfil")}
              className="md:hidden flex items-center justify-center w-9 h-9 rounded-full bg-primary text-primary-foreground text-[10px] font-bold font-mono"
              aria-label={t("profile.title")}
            >
              {walletStatus === "loading" ? <Wallet className="w-4 h-4" /> : initials}
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 md:px-8 pb-24 lg:pb-10 pt-2">
          {/* Aviso: se cambió de cuenta en Freighter (escritorio). No se pierde
              la sesión; se pide volver a la wallet original para continuar. */}
          {walletMismatch && (
            <div className="max-w-[1400px] mx-auto mb-4 flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-amber-700">
                  {t("shell.wallet_mismatch_title")}
                </p>
                <p className="text-[11px] text-amber-800/70">
                  {t("shell.wallet_mismatch_description", {
                    expected: shortExpected,
                    active: shortActive,
                  })}
                </p>
              </div>
            </div>
          )}
          {children}
        </main>
      </div>

      {/* Bottom nav (móvil) */}
      <BottomNav />
    </div>
  );
};

export default AppShell;
