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
    <section className="w-full pt-2">
      <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">{t("home.balance_title")}</h2>

      <div className="flex items-baseline gap-2 mt-2 flex-wrap" aria-busy={isFetching}>
        {loading ? (
          <Skeleton className="h-12 w-32" data-testid="balance-loading" />
        ) : (
          <span
            className={`font-display text-5xl font-extrabold tracking-tight tabular-nums transition-opacity duration-500 ${
              isFetching ? "opacity-60 animate-pulse" : ""
            }`}
            data-testid="balance-amount"
          >
            {formatAmount(balance, { maximumFractionDigits: 2 })}
          </span>
        )}
        <span className="text-base font-semibold text-muted-foreground">USDC</span>
      </div>

      <p className="text-muted-foreground text-sm mt-2">{t("home.balance_caption")}</p>
    </section>
  );
};

export default BalanceCard;
