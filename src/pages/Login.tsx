import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Wallet, AlertCircle, ExternalLink, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import logoVin from "@/assets/logo-vin.png";
import { useMobileWallet } from "@/hooks/useMobileWallet";

// Human-readable error messages resolved through i18n
function friendlyError(
  raw: string,
  cancelled: boolean,
  t: (key: string) => string
): string {
  if (cancelled) return t("login.errors.cancelled");
  const lower = raw.toLowerCase();
  if (lower.includes("popup")) return t("login.errors.popup_blocked");
  if (lower.includes("locked") || lower.includes("bloqueada"))
    return t("login.errors.wallet_locked");
  if (lower.includes("network") || lower.includes("fetch"))
    return t("login.errors.no_network");
  return t("login.errors.generic");
}

const Login = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isMobile, isFreighterReady, connect } = useMobileWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already connected, skip straight to the app
  useEffect(() => {
    const wallet = localStorage.getItem("vinculo_wallet");
    const onboarded = localStorage.getItem("vinculo_onboarded");
    if (wallet && onboarded === "1") {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  const connectWallet = async () => {
    setLoading(true);
    setError(null);

    const result = await connect();

    if (!result.ok) {
      setLoading(false);
      setError(friendlyError(result.error, result.cancelled, t));
      return;
    }

    localStorage.setItem("vinculo_wallet", result.address);
    localStorage.setItem("vinculo_onboarded", "1");
    localStorage.setItem("vinculo_wallet_provider", result.provider);

    navigate("/", { replace: true });
  };

  const showFreighterInstallPrompt = !isMobile && !isFreighterReady;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      <div className="mb-10 text-center animate-in fade-in zoom-in duration-500">
        <img src={logoVin} alt={t("common.app_name")} className="w-20 h-20 object-contain mx-auto mb-4" />
        <h1 className="text-2xl font-black text-foreground tracking-tight italic">{t("login.title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("common.app_tagline")}</p>
      </div>

      <div className="w-full max-w-sm space-y-4">

        {/* ── Mobile: Albedo web wallet ──────────────────────────────────── */}
        {isMobile && (
          <div className="space-y-4 animate-in fade-in">
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/15 text-center">
              <Smartphone className="w-5 h-5 text-primary mx-auto mb-1" />
              <p className="text-sm font-bold text-foreground mb-0.5">{t("login.mobile_wallet_title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("login.mobile_wallet_description")}
              </p>
            </div>

            <button
              onClick={connectWallet}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 rounded-2xl bg-primary text-primary-foreground px-5 py-4 text-sm font-bold shadow-lg shadow-primary/20 active:scale-[0.98] transition-all disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wallet className="h-5 w-5" />}
              {t("login.connect_albedo")}
            </button>
          </div>
        )}

        {/* ── Desktop: Freighter ready ───────────────────────────────────── */}
        {!isMobile && isFreighterReady && (
          <button
            onClick={connectWallet}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 rounded-2xl bg-primary text-primary-foreground px-5 py-4 text-sm font-bold shadow-lg shadow-primary/20 active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wallet className="h-5 w-5" />}
            {t("login.connect_freighter")}
          </button>
        )}

        {/* ── Desktop: Freighter not installed ──────────────────────────── */}
        {showFreighterInstallPrompt && (
          <div className="space-y-4 animate-in fade-in">
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
              <p className="text-sm font-bold text-amber-700 mb-1">{t("login.freighter_not_detected_title")}</p>
              <p className="text-xs text-amber-800/80">
                {t("login.freighter_not_detected_description")}
              </p>
            </div>

            <a
              href="https://www.freighter.app/"
              target="_blank"
              rel="noreferrer"
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-secondary text-foreground px-5 py-4 text-sm font-bold active:scale-[0.98] transition-all hover:bg-secondary/80"
            >
              <ExternalLink className="w-4 h-4" />
              Instalar Freighter
            </a>

            <button
              onClick={connectWallet}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-2xl border border-border bg-card text-foreground px-5 py-3.5 text-sm font-semibold active:scale-[0.98] transition-all hover:bg-secondary/60 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
              {t("login.connect_albedo")}
            </button>
          </div>
        )}

        {/* ── Error notification ─────────────────────────────────────────── */}
        {error && (
          <div className="space-y-3 mt-4">
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-[11px] font-bold uppercase text-center animate-shake">
              <AlertCircle className="w-4 h-4 inline mr-2 mb-0.5" />
              {error}
            </div>
            <button
              onClick={connectWallet}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground px-5 py-3 text-sm font-bold shadow-lg shadow-primary/20 active:scale-[0.98] transition-all disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
              {t("common.retry")}
            </button>
          </div>
        )}
      </div>

      <p className="mt-12 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] opacity-30">
        {t("common.footer_stellar")}
      </p>
    </div>
  );
};

export default Login;
