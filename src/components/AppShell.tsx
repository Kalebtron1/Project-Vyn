import { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell, HelpCircle, LogOut, Wallet, AlertTriangle, Loader2 } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import { getNavItems } from "@/components/navItems";
import { useWallet } from "@/hooks/useWallet";
import { useChainSyncing } from "@/lib/chainData";

interface AppShellProps {
  title: string;
  subtitle?: string;
  /** Inicio: el saldo ya abre la pantalla; el título queda solo para lectores de pantalla. */
  hideTitle?: boolean;
  children: ReactNode;
}

const Wordmark = ({ label, className }: { label: string; className: string }) => (
  <span className={`font-display font-extrabold tracking-tighter lowercase ${className}`}>{label}</span>
);

/**
 * Layout compartido: sidebar lateral en escritorio (lg+) y bottom nav en móvil.
 * Mantiene un header superior con título de página, chip de wallet y accesos
 * (tema, idioma, notificaciones). Las páginas solo renderizan su contenido.
 */
const AppShell = ({ title, subtitle, hideTitle = false, children }: AppShellProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { wallet, shortWallet, walletStatus, disconnect, walletMismatch, activeAddress } =
    useWallet();

  // Aviso de lectura on-chain en curso (al entrar o tras una acción).
  const syncing = useChainSyncing();

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
    <div className="min-h-screen flex text-foreground">
      {/* ─── Sidebar (escritorio) ─────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 sticky top-0 h-screen bg-card border-r border-border">
        <button
          onClick={() => navigate("/")}
          className="h-20 flex items-center gap-3 px-6 hover:opacity-80 transition-opacity"
          aria-label={t("common.app_name")}
        >
          <Wordmark label={t("common.app_name")} className="text-3xl" />
        </button>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {navItems.map(({ icon: Icon, labelKey, path }) => {
            const isActive = location.pathname === path;
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all ${
                  isActive
                    ? "text-primary bg-secondary"
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

        <div className="px-4 pb-5 mt-auto">
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
        <header className="px-4 md:px-8 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Logo solo en móvil (en escritorio ya está en el sidebar). Lleva al inicio. */}
            <button
              onClick={() => navigate("/")}
              className="lg:hidden shrink-0 hover:opacity-80 transition-opacity min-h-11"
              aria-label={t("common.app_name")}
            >
              <Wordmark label={t("common.app_name")} className="text-[26px]" />
            </button>
            <div className="min-w-0">
              <h1 className={hideTitle ? "sr-only" : "text-lg md:text-2xl font-bold tracking-tight truncate"}>{title}</h1>
              {syncing ? (
                <p className="text-xs text-primary font-semibold flex items-center gap-1.5" role="status" data-testid="chain-syncing">
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                  <span className="truncate">{t("common.syncing")}</span>
                </p>
              ) : (
                subtitle && !hideTitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
            {/* En móvil, tema e idioma viven en Perfil para no saturar el encabezado. */}
            <div className="hidden md:block"><ThemeToggle /></div>
            <div className="hidden md:block"><LanguageToggle /></div>

            <button
              onClick={() => navigate("/notificaciones")}
              className="flex items-center justify-center w-11 h-11 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title={t("profile.menu_notifications")}
              aria-label={t("profile.menu_notifications")}
            >
              <Bell className="w-5 h-5" />
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
              className="md:hidden flex items-center justify-center w-11 h-11 rounded-full bg-card border border-border text-foreground text-xs font-bold"
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
