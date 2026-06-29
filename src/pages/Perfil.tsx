import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { useWallet } from "@/hooks/useWallet";
import { fetchContractBalance } from "../stellar/queries";
import { recordMint } from "../stellar/activity";
import { Shield, Wallet, Star, ChevronRight, LogOut, HelpCircle, Bell, Loader2, Award, Lock, Activity, Medal, Globe, CircleCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useExportWallet } from "@privy-io/react-auth/extended-chains";
import AppShell from "@/components/AppShell";
import LanguageToggle from "@/components/LanguageToggle";
import NFTModal from "@/components/NFTModal";
import { toast } from "@/hooks/use-toast";
import { requestAccess } from "@stellar/freighter-api";
import { tierLabel, tierNumberFromName } from "@/lib/tier";
import { useWalletSession } from "@/context/WalletSessionContext";
import { PRIVY_PROVIDER } from "@/lib/privyBridge";
import { useMobileWallet } from "@/hooks/useMobileWallet";
import { hasUsdcTrustline, buildUsdcTrustlineXdr, submitClassicXdr, ensureTestnetAccount } from "@/stellar/trustline";

const Perfil = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const tierFromScore = (score: number) => {
    if (score >= 1000) return 4;
    if (score >= 500) return 3;
    if (score >= 150) return 2;
    if (score >= 50) return 1;
    return 0;
  };

  const getMintFeedback = (rawMessage: string | undefined, currentLevel: string) => {
    const message = (rawMessage || "").toLowerCase();

    if (message.includes("nivel insuficiente")) {
      return {
        title: t("profile.mint_feedback.insufficient_level_title"),
        description: t("profile.mint_feedback.insufficient_level_description"),
        variant: "warning" as const,
      };
    }

    if (
      message.includes("este nivel exacto") ||
      message.includes("unreachablecodereached") ||
      message.includes("invalidaction")
    ) {
      return {
        title: t("profile.mint_feedback.already_minted_title"),
        description: t("profile.mint_feedback.already_minted_description", { level: currentLevel }),
        variant: "warning" as const,
      };
    }

    return {
      title: t("profile.mint_feedback.generic_title"),
      description: t("profile.mint_feedback.generic_description"),
      variant: "destructive" as const,
    };
  };

  const { creditWithdrawn } = useApp();
  const { wallet: walletAddress, shortWallet, disconnect } = useWallet();
  const { provider } = useWalletSession();
  const { exportWallet } = useExportWallet();
  const { sign } = useMobileWallet();
  const isPrivy = provider === PRIVY_PROVIDER;
  const [activatingUsdc, setActivatingUsdc] = useState(false);
  // true si la wallet ya tiene trustline USDC (ya pasó por "Activar USDC"). Persiste entre
  // recargas (se lee on-chain). Se aplica a CUALQUIER wallet, no solo Privy.
  const [usdcActivated, setUsdcActivated] = useState(false);
  // true si la trustline quedó activa pero el faucet de USDC no se entregó: deja el botón
  // accionable para reintentar el faucet SIN volver a firmar la trustline.
  const [faucetFailed, setFaucetFailed] = useState(false);

  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    // Pre-fondea la cuenta (si es nueva, testnet) y checa la trustline EN SEGUNDO PLANO.
    // Así, al pulsar "Activar USDC", el popup de firma (Albedo) se abre de inmediato tras
    // el clic, sin la espera de Friendbot que dispara el bloqueador de ventanas emergentes.
    (async () => {
      try { await ensureTestnetAccount(walletAddress); } catch { /* best-effort */ }
      if (cancelled) return;
      try {
        const has = await hasUsdcTrustline(walletAddress);
        if (!cancelled) setUsdcActivated(has);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [walletAddress]);

  // Activa la trustline USDC firmando con la wallet del usuario (primera prueba real de
  // la firma de Privy). Necesario para que la wallet pueda recibir/depositar USDC.
  const activateUsdc = async () => {
    if (!walletAddress) return;
    setActivatingUsdc(true);
    setFaucetFailed(false);
    try {
      // 1) Trustline USDC (la firma tu wallet). Si ya existe, se omite.
      const already = await hasUsdcTrustline(walletAddress);
      if (!already) {
        // Una wallet externa nueva (Albedo/Freighter) puede no existir on-chain (0 XLM):
        // sin esto, buildUsdcTrustlineXdr daría 404 "Not Found". La fondea con Friendbot.
        await ensureTestnetAccount(walletAddress);
        const xdr = await buildUsdcTrustlineXdr(walletAddress);
        const res = await sign(xdr);
        if (!res.ok) throw new Error(res.error || "No se pudo firmar");
        const hash = await submitClassicXdr(res.signedXdr);
        console.log("USDC trustline tx:", hash);
        // Espera a que Horizon refleje la trustline antes de pedir el faucet. El submit
        // ya se incluyó en un ledger, pero un nodo con lag (frecuente en redes móviles)
        // puede no verla aún → el faucet respondería no_trustline y no enviaría nada.
        for (let i = 0; i < 5; i++) {
          if (await hasUsdcTrustline(walletAddress)) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      setUsdcActivated(true); // la trustline quedó activa

      // 2) Faucet: 2 USDC para probar un depósito (idempotente; si ya tienes, no envía).
      let faucetMsg = "";
      let faucetIssue: { title: string; desc: string } | null = null;
      try {
        const fr = await fetch("/api/faucet-usdc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: walletAddress }),
        });
        const fd = await fr.json().catch(() => ({}));
        if (fr.ok && fd.sent) {
          faucetMsg = ` +${fd.amount} USDC`;
        } else if (fr.ok && fd.reason === "already_claimed") {
          // Ya reclamado: no es un error, el flujo se considera completo.
        } else if (fr.ok && fd.reason === "no_trustline") {
          setFaucetFailed(true);
          faucetIssue = {
            title: t("profile.usdc_faucet_failed_title"),
            desc: t("profile.usdc_faucet_no_trustline"),
          };
        } else {
          // 502 u otro fallo del backend (p. ej. SECRET_KEY_ADMIN). Surface del motivo.
          setFaucetFailed(true);
          faucetIssue = {
            title: t("profile.usdc_faucet_failed_title"),
            desc: fd?.error || t("profile.usdc_faucet_failed_desc"),
          };
        }
      } catch {
        setFaucetFailed(true);
        faucetIssue = {
          title: t("profile.usdc_faucet_failed_title"),
          desc: t("profile.usdc_faucet_failed_desc"),
        };
      }

      if (faucetIssue) {
        toast({ title: faucetIssue.title, description: faucetIssue.desc, variant: "destructive" });
      } else {
        toast({
          title: t("profile.usdc_activated_title"),
          description: t("profile.usdc_activated_desc") + faucetMsg,
        });
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // 404/Not Found = la cuenta aún no existe on-chain (no se pudo fondear). Mensaje claro.
      const isNotFound = /not found|404|resource missing/i.test(raw);
      // Popup de Albedo bloqueado por el navegador: indicar cómo resolverlo.
      const isPopup = /popup|ventana emergente|blocked|pop-up/i.test(raw);
      toast({
        title: t("common.error"),
        description: isPopup
          ? t("profile.usdc_popup_blocked")
          : isNotFound
            ? t("profile.usdc_account_not_funded")
            : raw,
        variant: "destructive",
      });
    } finally {
      setActivatingUsdc(false);
    }
  };

  // "Abrir wallet": para sesiones Privy abre el modal de Privy (ver/exportar la wallet
  // Stellar embebida). Para wallets externas, abre Freighter.
  const openWallet = async () => {
    try {
      if (isPrivy && walletAddress) {
        await exportWallet({ address: walletAddress });
      } else {
        await requestAccess();
      }
    } catch {
      toast({
        title: t("profile.open_wallet"),
        description: t("profile.open_wallet_hint"),
      });
    }
  };

  const [loadingProfile, setLoadingProfile] = useState(true);

  const [isMinting, setIsMinting] = useState(false);
  const [showNFTModal, setShowNFTModal] = useState(false);
  const [nftTxHash, setNftTxHash] = useState<string | undefined>();
  const [lastMintedLevel, setLastMintedLevel] = useState("Bronce");

  // --- ESTADOS ON-CHAIN ACTUALIZADOS ---
  const [onChainUsdc, setOnChainUsdc] = useState<number | string>(0);
  const [availableCredit, setAvailableCredit] = useState(0); // <-- Nueva métrica real
  const [nftTier, setNftTier] = useState("Bronce");
  
  const [riskData, setRiskData] = useState({ 
    score: 0, 
    tier: 0, 
  });
  const [historyGate, setHistoryGate] = useState({
    historyCount: 0,
    minHistoryRequired: 3,
    isHistoryEligible: false,
  });

  const displayName = walletAddress ? shortWallet : "Conecta tu wallet";
  const initials = walletAddress ? walletAddress.slice(0, 2).toUpperCase() : "WL";

  // 1. LECTURA HÍBRIDA (Balance Directo + API de Crédito/Tier)
  useEffect(() => {
    const fetchBlockchainData = async () => {
      if (!walletAddress) {
        setLoadingProfile(false);
        return;
      }

      try {
        setLoadingProfile(true);

        // --- A. OBTENER SALDO DIRECTO (Tu función Queries) ---
        const balance = await fetchContractBalance(walletAddress);
        setOnChainUsdc(balance);
        
        // --- B. OBTENER TIER Y LÍMITE DE CRÉDITO (Tu API de Vercel) ---
        try {
          const tierResponse = await fetch(`/api/get-available-credit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userAddress: walletAddress })
          });

          if (tierResponse.ok) {
            const tierData = await tierResponse.json();
            if (tierData.success) {
              setNftTier(tierData.tierName);
              setAvailableCredit(tierData.availableCredit); // <-- Dato real de tu lógica
              setRiskData(prev => ({ ...prev, tier: tierData.tier }));
            }
          }
        } catch (apiError) {
          console.warn("Error consultando Tier API:", apiError);
        }

      } catch (error) {
        console.error("Error general leyendo blockchain:", error);
      } finally {
        setLoadingProfile(false);
      }
    };

    fetchBlockchainData();
  }, [walletAddress]);

  // 2. MOTOR DE RIESGO (Score basado en balance real)
  useEffect(() => {
    const fetchRiskScore = async () => {
      if (!walletAddress) return;
      try {
        const response = await fetch(`/api/calculate-score`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            address: walletAddress, 
            totalDeposited: Number(onChainUsdc),
            depositCount: Number(onChainUsdc) > 0 ? 1 : 0 // Fallback mínimo
          }) 
        });
        const data = await response.json();
        if (data.score !== undefined) {
          const eligibility = data?.eligibility || {};
          setHistoryGate({
            historyCount: Number(eligibility?.historyCount) || 0,
            minHistoryRequired: Number(eligibility?.minHistoryRequired) || 3,
            isHistoryEligible: Boolean(eligibility?.isHistoryEligible),
          });

          // Sync on-chain tier/credit after computing score so UI matches backend state
          try {
            const tierResponse = await fetch(`/api/get-available-credit`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userAddress: walletAddress })
            });

            let blockchainTier = 0;
            let blockchainTierName = "Bronce";
            let blockchainAvailableCredit = 0;

            if (tierResponse.ok) {
              const tierData = await tierResponse.json();
              if (tierData.success) {
                blockchainTier = Number(tierData.tier) || 0;
                blockchainTierName = tierData.tierName || blockchainTierName;
                blockchainAvailableCredit = tierData.availableCredit || 0;
                setNftTier(blockchainTierName);
                setAvailableCredit(blockchainAvailableCredit);
              }
            }

            // Score en vivo: refleja depósitos/retiros sin piso por tier (el tier
            // on-chain solo gobierna lo ya minteado, no el avance del score).
            const dynamicScore = Number(data.score) || 0;

            setRiskData(prev => ({ ...prev, score: dynamicScore, tier: blockchainTier }));

          } catch (err) {
            console.warn('Error sincronizando tier despues de score:', err);
            // Fallback: set dynamic score
            setRiskData(prev => ({ ...prev, score: data.score }));
          }
        }
      } catch (error) {
        console.error("Error sincronizando matemáticas:", error);
      }
    };
    
    if (!loadingProfile) fetchRiskScore();
  }, [onChainUsdc, walletAddress, loadingProfile]);

  // Lógica de visualización de progreso alineada con ProgressRing:
  // avance dentro del rango del nivel actual hacia el siguiente nivel.
  const tierThresholds: Record<number, { current: number; next: number }> = {
    0: { current: 0, next: 50 },
    1: { current: 50, next: 150 },
    2: { current: 150, next: 500 },
    3: { current: 500, next: 1000 },
    4: { current: 1000, next: 1000 },
  };

  const calculatedTier = tierFromScore(riskData.score);
  const { current: currentThreshold, next: nextThreshold } =
    tierThresholds[calculatedTier] || tierThresholds[0];

  const range = Math.max(1, nextThreshold - currentThreshold);
  const progressInTier = ((riskData.score - currentThreshold) / range) * 100;
  const tierVisualPercentage = Math.min(100, Math.max(0, Math.floor(progressInTier)));
  const historyVisualPercentage = Math.min(
    100,
    Math.floor((historyGate.historyCount / Math.max(historyGate.minHistoryRequired, 1)) * 100),
  );
  const visualPercentage = historyGate.isHistoryEligible ? tierVisualPercentage : historyVisualPercentage;
  const isUnlocked = riskData.tier >= 1; 
  const currentTier = tierNumberFromName(nftTier);
  const isMaxTier = currentTier >= 4;
  const eligibleTier = tierFromScore(riskData.score);
  const canMintUpgrade = eligibleTier > currentTier;
  const mintButtonDisabled = isMinting || !walletAddress || Number(onChainUsdc) === 0 || !canMintUpgrade;

  const claimableTierName = tierLabel(t, eligibleTier);

  const mintButtonText = (() => {
    if (isMinting) return t("profile.mint_button_signing");
    if (!walletAddress) return t("profile.mint_button_no_wallet");
    if (Number(onChainUsdc) === 0) return t("profile.mint_button_no_balance");
    if (!canMintUpgrade && currentTier >= 4) return t("profile.mint_button_max_tier");
    if (!canMintUpgrade) return t("profile.mint_button_already_has", { tier: tierLabel(t, tierNumberFromName(nftTier)) });
    return t("profile.mint_button_default");
  })();

  const handleClaimNFT = async () => {
    if (!walletAddress) return;
    setIsMinting(true);
    try {
      // 1) Solo validamos que la wallet conectada sea la misma en Freighter.
      // Con timeout para que un popup de Freighter que nunca responde no deje el botón colgado.
      const access = await Promise.race([
        requestAccess(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Freighter no respondió a tiempo")), 30000)
        ),
      ]);
      if (!access?.address || access.address !== walletAddress) throw new Error("Conecta la misma wallet en Freighter");

      const response = await fetch(`/api/evaluate-and-mint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          userAddress: walletAddress, 
          totalVolume: Number(onChainUsdc),
          depositCount: Number(onChainUsdc) > 0 ? 1 : 0,
          deposits: [{ amount: Number(onChainUsdc), daysAgo: 0 }]
        })
      });
      const raw = await response.text();
      let data: { status?: string; tierName?: string; tier?: number; txHash?: string; message?: string } | null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        throw new Error(raw || "Respuesta no valida del servidor");
      }
      if (response.ok && data?.status === "minted") {
        const mintedLevel = data.tierName || nftTier;
        const mintedTier = Number(data.tier) || 0;

        setNftTier(mintedLevel);
        setLastMintedLevel(mintedLevel);
        setRiskData(prev => ({ ...prev, tier: mintedTier }));

        // Sincroniza el crédito visual con el nivel recién minteado.
        if (mintedTier === 1) setAvailableCredit(300);
        if (mintedTier === 2) setAvailableCredit(600);
        if (mintedTier === 3) setAvailableCredit(1500);
        if (mintedTier === 4) setAvailableCredit(5000);

        setNftTxHash(data.txHash);
        setShowNFTModal(true);
        // Registra el mint en el historial local (el mint lo firma el admin, por eso
        // no aparece en las operaciones del usuario en Horizon).
        if (data.txHash) recordMint(walletAddress, mintedLevel, data.txHash, new Date().toISOString());
        toast({
          title: t("profile.toast_minted_title"),
          description: t("profile.toast_minted_description", { level: mintedLevel }),
        });
      } else {
        const effectiveLevel = data?.tierName || nftTier;
        const feedback = getMintFeedback(data?.message, effectiveLevel);
        toast({
          title: feedback.title,
          description: feedback.description,
          variant: feedback.variant,
        });
      }
    } catch (error) {
      console.error("Error minteando:", error);
      toast({
        title: t("profile.toast_error_connection_title"),
        description: t("profile.toast_error_connection_description"),
        variant: "destructive",
      });
    } finally {
      setIsMinting(false);
    }
  };

  const handleLogout = () => disconnect();

  const menuItems = [
    { icon: Bell, label: t("profile.menu_notifications"), detail: t("profile.menu_notifications_detail"), action: () => navigate("/notificaciones") },
    { icon: HelpCircle, label: t("profile.menu_help"), detail: "", action: () => navigate("/ayuda") },
    { icon: LogOut, label: t("profile.menu_logout"), detail: "", destructive: true, action: handleLogout },
  ];

  return (
    <AppShell title={t("profile.title")} subtitle={t("profile.subtitle")}>
      <div className="max-w-[1100px] mx-auto grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* Columna principal */}
        <div className="lg:col-span-2 space-y-4">
        {/* Card de Identidad */}
        <div className="card-elevated p-6 flex items-center gap-4 animate-fade-up">
          <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center flex-shrink-0 shadow-inner">
            <span className="text-xl font-bold text-primary-foreground font-mono">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-foreground truncate font-mono">{displayName}</p>
            <span className="text-sm text-muted-foreground truncate flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block"></span>
              {t("common.wallet_connected")}
            </span>
          </div>
        </div>

        {/* STATS RÁPIDAS (Ahora con Crédito) */}
        <div className="grid grid-cols-3 gap-3 animate-fade-up" style={{ animationDelay: "100ms" }}>
          <div className="card-elevated p-4 text-center">
            <Wallet className="w-4 h-4 text-muted-foreground mx-auto mb-1.5" />
            <p className="text-lg font-bold text-foreground tabular-nums">
              {loadingProfile ? "..." : onChainUsdc}
            </p>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{t("profile.stat_savings")}</p>
          </div>
          
          <div className="card-elevated p-4 text-center border-emerald-500/20 bg-emerald-500/5">
            <Star className="w-4 h-4 text-emerald-600 mx-auto mb-1.5" />
            <p className="text-lg font-bold text-emerald-700 tabular-nums">
              {loadingProfile ? "..." : availableCredit}
            </p>
            <p className="text-[10px] text-emerald-600/80 font-bold uppercase tracking-wider">{t("profile.stat_credit")}</p>
            {canMintUpgrade && (
              <div className="mt-2 text-xs font-semibold text-emerald-800">{t("profile.mint_button_default")}</div>
            )}
          </div>

          <div className="card-elevated p-4 text-center bg-primary/5 border border-primary/20">
            <Shield className="w-4 h-4 text-primary mx-auto mb-1.5" />
            <p className="text-lg font-bold text-primary">{loadingProfile ? "..." : tierLabel(t, tierNumberFromName(nftTier))}</p>
            {canMintUpgrade && (
              <p className="text-[11px] text-primary/80 font-medium mt-1">{claimableTierName}</p>
            )}
            <p className="text-[10px] text-primary/80 font-semibold uppercase tracking-wider">{t("profile.stat_nft_level")}</p>
          </div>
        </div>

        {/* Card de Reputación */}
        <div className={`card-elevated p-5 border-2 animate-fade-up ${isUnlocked ? "border-primary/30 bg-primary/5" : "border-transparent"}`} style={{ animationDelay: "200ms" }}>
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <Shield className={`w-4 h-4 ${isUnlocked ? "text-primary" : "text-muted-foreground"}`} />
              <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">{t("profile.reputation_label")}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-primary font-medium bg-primary/10 px-2 py-1 rounded-full">
              <Activity className="w-3 h-3" />
              <span className="font-bold">{riskData.score.toFixed(1)} pts</span>
            </div>
          </div>
          
          <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden mb-2 relative">
            <div
              className={`h-full rounded-full transition-all duration-1000 ease-out ${isUnlocked ? "bg-gradient-to-r from-primary to-emerald-400" : "bg-muted-foreground/40"}`}
              style={{ width: `${isMaxTier ? 100 : visualPercentage}%` }}
            />
          </div>
          
          <div className="flex justify-between items-center text-xs text-muted-foreground mb-4">
            {isUnlocked ? (
              <span className="text-primary font-bold tracking-wide">{t("profile.reputation_unlocked")}</span>
            ) : (
              <span className="flex items-center gap-1 font-medium">
                <Lock className="w-3 h-3" /> {t("profile.reputation_locked")}
              </span>
            )}
            {isMaxTier ? (
              <span className="font-bold text-primary">{t("profile.reputation_max")}</span>
            ) : !historyGate.isHistoryEligible ? (
              <span className="font-bold text-amber-600">
                {t("profile.reputation_activity_gate", { current: historyGate.historyCount, required: historyGate.minHistoryRequired })}
              </span>
            ) : (
              <span className="font-bold">{t("profile.reputation_progress", { percent: visualPercentage })}</span>
            )}
          </div>

          {nftTier !== "Platino" ? (
            <button
              onClick={handleClaimNFT}
              disabled={mintButtonDisabled}
              className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3.5 text-sm font-bold shadow-lg shadow-primary/25 active:scale-95 transition-all disabled:opacity-50"
            >
              {isMinting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Award className="w-5 h-5" />}
              {mintButtonText}
            </button>
          ) : (
              <div className="w-full mt-2 rounded-xl bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 py-3 px-3 text-xs font-bold text-blue-700 text-center uppercase tracking-wider">
                {t("profile.max_tier_badge")}
              </div>
          )}
        </div>
        
        {/* Wallet Address Display */}
        <div className="card-elevated p-5 animate-fade-up" style={{ animationDelay: "300ms" }}>
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">{t("profile.wallet_address_label")}</span>
          </div>
          {loadingProfile ? (
            <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="bg-secondary/50 border border-border rounded-xl px-4 py-3">
              <p className="text-sm font-mono font-medium text-foreground break-all">{walletAddress}</p>
            </div>
          )}
        </div>

        {/* Menú */}
        <div className="card-elevated divide-y divide-border animate-fade-up overflow-hidden" style={{ animationDelay: "400ms" }}>
          {menuItems.map(({ icon: Icon, label, detail, destructive, action }) => (
            <button key={label} onClick={action} className="w-full flex items-center gap-3 px-5 py-4 hover:bg-secondary/50 transition-colors group">
              <Icon className={`w-5 h-5 ${destructive ? "text-destructive" : "text-muted-foreground group-hover:text-foreground"}`} />
              <span className={`flex-1 text-left text-sm font-semibold ${destructive ? "text-destructive" : "text-foreground"}`}>{label}</span>
              {detail && <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{detail}</span>}
              <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
            </button>
          ))}
        </div>
        </div>

        {/* Columna lateral: límites/nivel + preferencias */}
        <div className="flex flex-col gap-5">
          {/* Límites y nivel (datos reales) */}
          <div className="card-elevated p-6 animate-fade-up">
            <h3 className="text-sm font-bold text-foreground mb-5">{t("profile.limits_title")}</h3>

            <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-5 mb-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider">{t("home.nft_rank_label")}</span>
                <span className="text-[9px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                  {t("credit.badge_onchain")}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Medal className="w-7 h-7 text-amber-500" />
                <span className="text-2xl font-bold text-foreground">{loadingProfile ? "..." : tierLabel(t, tierNumberFromName(nftTier))}</span>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("profile.stat_credit")}</p>
                <p className="text-lg font-bold text-foreground tabular-nums">
                  {loadingProfile ? "..." : availableCredit} <span className="text-[11px] text-muted-foreground font-normal">XLM</span>
                </p>
              </div>
              <div className="w-24">
                <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-amber-500 transition-all duration-700" style={{ width: `${isMaxTier ? 100 : visualPercentage}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Tu wallet: ver balances. Accesly abre su panel; otras, su extensión. */}
          <div className="card-elevated p-6 animate-fade-up">
            <div className="flex items-center gap-2 mb-4">
              <Wallet className="w-5 h-5 text-primary" />
              <h3 className="text-sm font-bold text-foreground">{t("profile.wallet_panel_title")}</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">{t("profile.wallet_panel_desc")}</p>
            <button
              onClick={openWallet}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground px-5 py-3.5 text-sm font-bold shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
            >
              <Wallet className="w-5 h-5" />
              {t("profile.open_wallet")}
            </button>
            {walletAddress && (
              <button
                onClick={activateUsdc}
                disabled={activatingUsdc || (usdcActivated && !faucetFailed)}
                className="w-full mt-3 flex items-center justify-center gap-2 rounded-2xl border border-primary/30 text-primary px-5 py-3 text-sm font-bold active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {activatingUsdc ? <Loader2 className="w-5 h-5 animate-spin" /> : <CircleCheck className="w-5 h-5" />}
                {faucetFailed
                  ? t("profile.usdc_retry_faucet")
                  : usdcActivated
                    ? t("profile.usdc_active_label")
                    : t("profile.activate_usdc")}
              </button>
            )}
          </div>

          {/* Preferencias: idioma (accesible también en móvil) */}
          <div className="card-elevated p-6 flex items-center justify-between animate-fade-up" style={{ animationDelay: "100ms" }}>
            <div className="flex items-center gap-3">
              <Globe className="w-5 h-5 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Idioma / Language</span>
            </div>
            <LanguageToggle />
          </div>
        </div>
      </div>

      <p className="text-center text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest pt-6 pb-2">{t("common.footer_version")}</p>

      <NFTModal
        open={showNFTModal}
        onClose={() => setShowNFTModal(false)}
        walletAddress={walletAddress || ""}
        level={lastMintedLevel}
        depositsCount={Number(onChainUsdc) > 0 ? 1 : 0}
        totalVolume={Number(onChainUsdc)}
        txHash={nftTxHash}
      />
    </AppShell>
  );
};

export default Perfil;