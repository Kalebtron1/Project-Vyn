/**
 * Depositar (on-ramp SPEI) — el usuario que entró con correo (Accesly) deposita MXN por
 * SPEI y, tras confirmarse, el USDC sube a su saldo. La UI habla en MXN (lo que paga) y
 * USDC (lo que recibe); el USDB es un artefacto invisible de testnet (igual que el off-ramp).
 *
 * Flujo: input monto → cotización en vivo (/api/onramp-quote) → generar CLABE
 * (/api/onramp-payin) → polling (/api/onramp-status) hasta que BlindPay confirma el SPEI.
 * La liquidación on-chain (USDB→tesorería→USDC→vault) la hace el backend (Fase 6).
 */

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownToLine, Loader2, Copy, CheckCircle2, Building2, Clock, Mail, AlertCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePrivy } from "@privy-io/react-auth";
import confetti from "canvas-confetti";
import AppShell from "@/components/AppShell";
import { useWalletSession } from "@/context/WalletSessionContext";
import { PRIVY_PROVIDER } from "@/lib/privyBridge";

type Step = "input" | "generating" | "clabe" | "success" | "error";

interface Quote {
  receiverUsd: number;
  rateMxnPerUsd: number;
  flatFeeUsd: number;
  partnerFeeUsd: number;
}

const Depositar = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { address, provider } = useWalletSession();
  const { user } = usePrivy();
  const email = user?.email?.address;

  const [amount, setAmount] = useState("500"); // MXN
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [step, setStep] = useState<Step>("input");
  const [error, setError] = useState("");
  const [payin, setPayin] = useState<null | { payinId: string; clabe: string; receiverUsd: number }>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isPrivy = provider === PRIVY_PROVIDER;

  // Cotización en vivo mientras el usuario teclea el monto en MXN.
  useEffect(() => {
    if (step !== "input") return;
    const val = parseFloat(amount);
    if (!val || val < 5 || !address) { setQuote(null); return; }
    let cancelled = false;
    setQuoteLoading(true);
    const handle = setTimeout(async () => {
      try {
        const r = await fetch("/api/onramp-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress: address, amountMxn: val, email }),
        });
        const data = await r.json();
        if (cancelled) return;
        setQuote(r.ok ? {
          receiverUsd: data.receiverUsd,
          rateMxnPerUsd: data.rateMxnPerUsd,
          flatFeeUsd: data.flatFeeUsd,
          partnerFeeUsd: data.partnerFeeUsd ?? 0,
        } : null);
      } catch {
        if (!cancelled) setQuote(null);
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [amount, step, address, email]);

  const generate = async () => {
    const val = parseFloat(amount);
    if (!val || val < 5) { setError(t("deposit_spei.min_error")); setStep("error"); return; }
    if (!address) { setError(t("deposit_spei.no_wallet")); setStep("error"); return; }
    setError("");
    setStep("generating");
    try {
      const r = await fetch("/api/onramp-payin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address, amountMxn: val, email }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || t("deposit_spei.generic_error"));
      setPayin({ payinId: data.payinId, clabe: data.clabe, receiverUsd: data.receiverUsd ?? quote?.receiverUsd ?? 0 });
      setStep("clabe");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  };

  // Polling del estado del payin: BlindPay confirma el SPEI (en dev, ~30s).
  useEffect(() => {
    if (step !== "clabe" || !payin) return;
    const poll = async () => {
      try {
        const r = await fetch(`/api/onramp-status?id=${encodeURIComponent(payin.payinId)}`);
        const data = await r.json();
        const confirmed = r.ok && (data.status === "completed" || data?.payment?.step === "completed");
        if (confirmed) {
          setStep("success");
          confetti({ particleCount: 120, spread: 75, origin: { y: 0.6 } });
        }
      } catch { /* reintenta en el próximo tick */ }
    };
    pollRef.current = setInterval(poll, 4000);
    poll();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, payin]);

  const copyClabe = async () => {
    if (!payin) return;
    try {
      await navigator.clipboard.writeText(payin.clabe);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard no disponible */ }
  };

  const reset = () => {
    setStep("input");
    setPayin(null);
    setError("");
    setQuote(null);
  };

  return (
    <AppShell>
      <div className="px-5 py-6 max-w-md mx-auto w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center">
            <ArrowDownToLine className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-black text-foreground">{t("deposit_spei.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("deposit_spei.subtitle")}</p>
          </div>
        </div>

        {/* ── Paso: input + cotización ── */}
        {step === "input" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border p-4">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {t("deposit_spei.amount_label")}
              </label>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min={5}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 bg-transparent text-3xl font-black text-foreground outline-none"
                  placeholder="500"
                />
                <span className="text-lg font-bold text-muted-foreground">MXN</span>
              </div>
            </div>

            <div className="rounded-xl bg-secondary/60 p-4 text-sm">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2">
                <span>{t("deposit_spei.quote_rate")}</span>
                <span className="tabular-nums">{quote ? `1 USDC ≈ ${quote.rateMxnPerUsd.toFixed(2)} MXN` : "—"}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-3">
                <span>{t("deposit_spei.quote_fee")}</span>
                <span className="tabular-nums">{quote ? `${quote.flatFeeUsd.toFixed(2)} USDC` : "—"}</span>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-border">
                <span className="font-bold text-foreground">{t("deposit_spei.quote_receive")}</span>
                <span className="font-extrabold text-lg text-foreground tabular-nums">
                  {quoteLoading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : quote ? `${quote.receiverUsd.toFixed(2)} USDC` : "—"}
                </span>
              </div>
            </div>

            {!isPrivy && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[11px]">
                <Mail className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{t("deposit_spei.accesly_hint")}</span>
              </div>
            )}

            <button
              onClick={generate}
              disabled={!quote || quoteLoading}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground px-5 py-4 text-sm font-bold shadow-lg shadow-primary/20 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <Building2 className="w-5 h-5" />
              {t("deposit_spei.generate_cta")}
            </button>
          </div>
        )}

        {/* ── Paso: generando ── */}
        {step === "generating" && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
            <p className="text-sm font-bold text-foreground">{t("deposit_spei.generating")}</p>
          </div>
        )}

        {/* ── Paso: CLABE generada, esperando pago ── */}
        {step === "clabe" && payin && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                {t("deposit_spei.clabe_label")}
              </p>
              <div className="flex items-center justify-between gap-3">
                <span className="text-2xl font-black tracking-wide text-foreground tabular-nums">{payin.clabe}</span>
                <button
                  onClick={copyClabe}
                  className="shrink-0 flex items-center gap-1 rounded-lg bg-primary/10 text-primary px-3 py-2 text-xs font-bold active:scale-95 transition"
                >
                  {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? t("deposit_spei.copied") : t("common.copy")}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-3">{t("deposit_spei.clabe_single_use")}</p>
            </div>

            <div className="rounded-xl bg-secondary/60 p-4 text-sm flex items-center justify-between">
              <span className="text-muted-foreground">{t("deposit_spei.you_send")}</span>
              <span className="font-bold tabular-nums">{parseFloat(amount).toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN</span>
            </div>

            <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground py-2">
              <Clock className="w-4 h-4 animate-pulse" />
              {t("deposit_spei.waiting_payment")}
            </div>
          </div>
        )}

        {/* ── Paso: éxito ── */}
        {step === "success" && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-9 h-9 text-green-500" />
            </div>
            <p className="text-lg font-black text-foreground">{t("deposit_spei.success_title")}</p>
            <p className="text-sm text-muted-foreground mt-1 mb-6">
              {t("deposit_spei.success_desc", { usd: (payin?.receiverUsd ?? 0).toFixed(2) })}
            </p>
            <button
              onClick={() => navigate("/")}
              className="w-full max-w-xs rounded-2xl bg-primary text-primary-foreground px-5 py-3.5 text-sm font-bold shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
            >
              {t("deposit_spei.go_home")}
            </button>
          </div>
        )}

        {/* ── Paso: error ── */}
        {step === "error" && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-destructive/15 flex items-center justify-center mb-4">
              <AlertCircle className="w-9 h-9 text-destructive" />
            </div>
            <p className="text-sm font-bold text-destructive mb-6">{error || t("deposit_spei.generic_error")}</p>
            <button
              onClick={reset}
              className="w-full max-w-xs rounded-2xl bg-primary text-primary-foreground px-5 py-3.5 text-sm font-bold active:scale-[0.98] transition-all"
            >
              {t("common.retry")}
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default Depositar;
