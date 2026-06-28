import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Wallet, AlertCircle, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePrivy } from "@privy-io/react-auth";
import logoVin from "@/assets/logo-vin.png";
import { useMobileWallet } from "@/hooks/useMobileWallet";
import { useWalletSession } from "@/context/WalletSessionContext";
import { PRIVY_PROVIDER, onPrivyConnected, type PrivyConnectedWallet } from "@/lib/privyBridge";

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
  const { connect } = useMobileWallet();
  const { login, authenticated } = usePrivy();
  const { address, onboarded, ready, setSession } = useWalletSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // true mientras el usuario está completando el login con correo (Privy).
  const [privyPending, setPrivyPending] = useState(false);

  // If already connected, skip straight to the app
  useEffect(() => {
    if (ready && address && onboarded) {
      navigate("/", { replace: true });
    }
  }, [ready, address, onboarded, navigate]);

  // Entrar a la app cuando Privy entrega la wallet Stellar. `PrivyBridge` (en el root)
  // asegura/crea la wallet tras autenticar y publica el evento; aquí lo escuchamos.
  // Idempotente (enteredRef) para no entrar dos veces.
  const enteredRef = useRef(false);
  const enterWithPrivy = useCallback(
    (w: PrivyConnectedWallet) => {
      if (enteredRef.current) return;
      enteredRef.current = true;
      setSession(w.stellarAddress, PRIVY_PROVIDER);
      setPrivyPending(false);
      // Mapping usuario ↔ blockchain wallet de BlindPay (atribución de depósitos SPEI).
      void fetch("/api/onramp-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: w.stellarAddress, email: w.email }),
      }).catch(() => {});
      navigate("/", { replace: true });
    },
    [setSession, navigate]
  );

  useEffect(() => onPrivyConnected(enterWithPrivy), [enterWithPrivy]);

  const loginWithPrivy = () => {
    setError(null);
    setPrivyPending(true);
    try {
      login();
    } catch (err: any) {
      setError(err?.message ?? t("login.errors.generic"));
      setPrivyPending(false);
    }
  };

  // Spinner mientras Privy autentica y crea/asegura la wallet Stellar.
  const privyLoading = privyPending || (authenticated && !enteredRef.current);

  const connectWallet = async () => {
    setLoading(true);
    setError(null);

    const result = await connect();

    if (!result.ok) {
      setLoading(false);
      setError(friendlyError(result.error, result.cancelled, t));
      return;
    }

    // Persiste (localStorage + cookie) y actualiza el estado en memoria.
    setSession(result.address, result.provider);

    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      <div className="mb-10 text-center animate-in fade-in zoom-in duration-500">
        <img src={logoVin} alt={t("common.app_name")} className="w-20 h-20 object-contain mx-auto mb-4" />
        <h1 className="text-2xl font-black text-foreground tracking-tight italic">{t("login.title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("common.app_tagline")}</p>
      </div>

      <div className="w-full max-w-sm space-y-4">

        {/* ── Entrar con correo (Privy: Google/Apple/email → wallet Stellar sin seed) ── */}
        <button
          onClick={loginWithPrivy}
          disabled={privyLoading || loading}
          className="w-full flex items-center justify-center gap-3 rounded-2xl bg-foreground text-background px-5 py-4 text-sm font-bold shadow-lg active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {privyLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mail className="h-5 w-5" />}
          {privyLoading ? t("login.accesly_creating") : t("login.accesly_cta")}
        </button>
        {privyPending ? (
          <p className="text-center text-[11px] font-semibold text-primary animate-pulse">
            {t("login.accesly_popup_hint")}
          </p>
        ) : (
          <p className="text-center text-[11px] text-muted-foreground">
            {t("login.accesly_hint")}
          </p>
        )}

        {/* ── Separador ── */}
        <div className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("login.or_divider")}
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* ── Conectar wallet (modal multi-wallet de Stellar Wallets Kit) ── */}
        <div className="p-4 rounded-xl bg-primary/5 border border-primary/15 text-center">
          <Wallet className="w-5 h-5 text-primary mx-auto mb-1" />
          <p className="text-sm font-bold text-foreground mb-0.5">{t("login.wallet_picker_title")}</p>
          <p className="text-xs text-muted-foreground">
            {t("login.wallet_picker_description")}
          </p>
        </div>

        <button
          onClick={connectWallet}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 rounded-2xl bg-primary text-primary-foreground px-5 py-4 text-sm font-bold shadow-lg shadow-primary/20 active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wallet className="h-5 w-5" />}
          {t("login.connect_wallet")}
        </button>

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
