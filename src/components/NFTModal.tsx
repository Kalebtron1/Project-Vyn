import { X, ExternalLink, Award, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { tierLabel, tierNumberFromName } from "@/lib/tier";

interface NFTModalProps {
  open: boolean;
  onClose: () => void;
  walletAddress: string;
  level: string; // "Bronce", "Plata", "Oro", "Diamante", "Platino"
  depositsCount: number;
  totalVolume: number;
  txHash?: string;
}

// Imágenes por nombre de nivel (identidad interna). La etiqueta visible se traduce.
const LEVEL_IMAGE: Record<string, string> = {
  Bronce: "/images/bronce.png",
  Plata: "/images/plata.png",
  Oro: "/images/oro.png",
  Diamante: "/images/diamante.png",
  Platino: "/images/platino.png",
};

const NFTModal = ({ open, onClose, walletAddress, level, depositsCount, totalVolume, txHash }: NFTModalProps) => {
  const { t } = useTranslation();
  if (!open) return null;

  const truncate = (addr: string) =>
    addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;

  const currentLevel = LEVEL_IMAGE[level] ? level : "Bronce";
  const imageUrl = LEVEL_IMAGE[currentLevel];
  const levelLabel = tierLabel(t, tierNumberFromName(currentLevel));

  // Mapeo de colores para el borde brillante según el nivel
  const levelColors: Record<string, string> = {
    "Bronce": "from-amber-700 via-amber-600 to-amber-800",
    "Plata": "from-slate-400 via-slate-200 to-slate-400",
    "Oro": "from-yellow-500 via-yellow-200 to-yellow-500",
    "Diamante": "from-cyan-500 via-cyan-200 to-cyan-500",
    "Platino": "from-purple-500 via-purple-300 to-purple-500",
    "default": "from-primary via-accent to-primary"
  };

  const gradientColor = levelColors[level] || levelColors["default"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-sm bg-card rounded-3xl shadow-2xl overflow-hidden animate-fade-up z-10">
        {/* Header glow */}
        <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-primary/20 to-transparent pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-secondary flex items-center justify-center z-10 hover:bg-secondary/80 transition-colors"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>

        <div className="px-6 pt-8 pb-6 flex flex-col items-center text-center">
          
          {/* EL VISUAL DEL NFT */}
          <div className="relative w-48 h-48 mb-5 group">
            {/* Borde brillante dinámico */}
            <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${gradientColor} shadow-lg animate-pulse`} />
            
            <div className="absolute inset-[3px] rounded-2xl bg-card flex flex-col items-center justify-center gap-2 overflow-hidden">
              
              {/* Cargando la imagen desde GitHub */}
              <img
                src={imageUrl}
                alt={t("nft_modal.nft_alt", { level: levelLabel })}
                className="w-full h-full object-cover rounded-xl drop-shadow-md group-hover:scale-110 transition-transform duration-500"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                }}
              />
              
              {/* Fallback si la imagen no está disponible. */}
              <div className="hidden flex-col items-center justify-center">
                <Award className="w-14 h-14 text-primary" />
                <p className="text-lg font-extrabold text-foreground tracking-tight leading-none mt-2">{t("nft_modal.fallback_level", { level: levelLabel })}</p>
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-widest mt-1">{t("nft_modal.fallback_brand")}</p>
              </div>

            </div>
          </div>

          {/* Badge */}
          <div className="flex items-center gap-1.5 bg-primary/10 text-primary rounded-full px-3 py-1 mb-3">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="text-xs font-bold">{t("nft_modal.badge")}</span>
          </div>

          <h2 className="text-xl font-extrabold text-foreground mb-1">{t("nft_modal.title")}</h2>
          <p className="text-sm text-muted-foreground mb-5">
            {t("nft_modal.subtitle")}
          </p>

          {/* Metadata On-Screen */}
          <div className="w-full bg-secondary rounded-xl p-4 space-y-2.5 text-left mb-5">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">{t("nft_modal.meta_level")}</span>
              <span className="text-xs font-bold text-foreground">{levelLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">{t("nft_modal.meta_deposits")}</span>
              <span className="text-xs font-bold text-foreground">{depositsCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">{t("nft_modal.meta_volume")}</span>
              <span className="text-xs font-bold text-foreground">{totalVolume.toFixed(2)} USDC</span>
            </div>
            <div className="flex items-center justify-between border-t border-border/50 pt-2 mt-2">
              <span className="text-xs text-muted-foreground">{t("nft_modal.meta_owner")}</span>
              <span className="text-xs font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                {truncate(walletAddress)}
              </span>
            </div>
          </div>

          {/* Explorer Link Dinámico */}
          {txHash && (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 hover:underline mb-4 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {t("nft_modal.explorer_link")}
            </a>
          )}

          <button
            onClick={onClose}
            className="w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-bold shadow-sm hover:bg-primary/90 active:scale-[0.97] transition-all"
          >
            {t("nft_modal.accept_button")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NFTModal;