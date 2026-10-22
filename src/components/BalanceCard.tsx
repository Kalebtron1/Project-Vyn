import { Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWallet } from "@/hooks/useWallet";
import { useSavings } from "@/lib/chainData";
import { useFormatters } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

// Saldo del ahorro (posición en vivo del vault). Se lee al entrar y tras cada acción
// que lo cambia (ver chainData); sin polling.
const BalanceCard = () => {
  const { t } = useTranslation();
  const { formatAmount } = useFormatters();
  const { wallet } = useWallet();
  const { data, isPending, isFetching } = useSavings(wallet);

  const loading = !!wallet && isPending;
  const balance = data?.position ?? 0;

  return (
    <div className="bg-primary rounded-2xl p-6 text-primary-foreground shadow-lg w-full relative overflow-hidden">
      <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>

      <div className="flex items-center justify-between mb-6 relative z-10">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 opacity-80" />
          <span className="text-sm font-semibold tracking-wider opacity-90 uppercase">{t("home.balance_title")}</span>
        </div>
      </div>

      <div className="flex items-baseline gap-2 relative z-10" aria-busy={isFetching}>
        {loading ? (
          <Skeleton className="h-12 w-32 bg-white/20" data-testid="balance-loading" />
        ) : (
          <span
            className={`text-5xl font-extrabold tracking-tight tabular-nums transition-opacity duration-500 ${
              isFetching ? "opacity-60 animate-pulse" : ""
            }`}
            data-testid="balance-amount"
          >
            {formatAmount(balance, { maximumFractionDigits: 2 })}
          </span>
        )}
        <span className="text-xl font-medium opacity-80">USDC</span>
      </div>

      <p className="text-primary-foreground/70 text-sm mt-2 relative z-10">{t("home.balance_caption")}</p>
    </div>
  );
};

export default BalanceCard;
