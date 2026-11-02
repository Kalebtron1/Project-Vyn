import type { LucideIcon } from "lucide-react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BellOff,
  Check,
  Coins,
  HandCoins,
  Loader2,
  Medal,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import AppShell from "@/components/AppShell";
import { useWallet } from "@/hooks/useWallet";
import { useNotifications } from "@/hooks/useNotifications";
import { useFormatters } from "@/lib/format";
import type { AppNotification } from "@/lib/notifications";

const KIND_META: Record<AppNotification["kind"], { icon: LucideIcon; key: string }> = {
  deposit: { icon: Coins, key: "deposit" },
  savings_withdraw: { icon: ArrowDownToLine, key: "withdraw" },
  loan: { icon: HandCoins, key: "loan" },
  repay: { icon: ArrowUpFromLine, key: "repay" },
  mint: { icon: Medal, key: "mint" },
};

const Notificaciones = () => {
  const { t } = useTranslation();
  const { formatAmount, formatDate } = useFormatters();
  const { wallet } = useWallet();
  const { notifications, unreadCount, loading, failed, retry, markRead, markAllRead, dismiss, dismissAll } =
    useNotifications(wallet);

  const clearAll = () => {
    if (window.confirm(t("notifications.confirm_clear_all"))) dismissAll();
  };

  // Sin una lectura completa no se puede afirmar que el usuario esté al día.
  const upToDate = !loading && !failed;
  const subtitle =
    unreadCount > 0
      ? t("notifications.subtitle_unread", { count: unreadCount })
      : upToDate
        ? t("notifications.subtitle_read")
        : undefined;

  return (
    <AppShell title={t("notifications.title")} subtitle={subtitle}>
      <div className="max-w-2xl mx-auto">
        {notifications.length > 0 && (
          <div className="flex items-center justify-between gap-3 mb-4">
            <button
              onClick={markAllRead}
              disabled={unreadCount === 0}
              className="min-h-11 px-4 rounded-2xl bg-secondary text-sm font-semibold text-foreground flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              <Check className="w-4 h-4" /> {t("notifications.mark_all_read")}
            </button>
            <button
              onClick={clearAll}
              aria-label={t("notifications.clear_all")}
              title={t("notifications.clear_all")}
              className="w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        )}

        {failed && (
          <div role="alert" className="card-elevated p-5 mb-4 flex items-start gap-3" data-testid="notifications-error">
            <TriangleAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground">{t("notifications.error_title")}</p>
              <p className="text-sm text-muted-foreground mt-1">{t("notifications.error_description")}</p>
              <button onClick={retry} className="min-h-11 text-sm font-bold text-primary">
                {t("notifications.retry")}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-primary/50" />
          </div>
        ) : notifications.length === 0 ? (
          !failed && (
            <div className="flex flex-col items-center py-20 text-center" data-testid="notifications-empty">
              <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center mb-4">
                <BellOff className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-base font-bold text-foreground">{t("notifications.empty_title")}</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">{t("notifications.empty_description")}</p>
            </div>
          )
        ) : (
          <ul className="space-y-3">
            {notifications.map((n) => {
              const { icon: Icon, key } = KIND_META[n.kind];
              return (
                <li
                  key={n.id}
                  data-testid="notification"
                  data-unread={!n.read}
                  className={`card-elevated flex items-start ${n.read ? "" : "ring-1 ring-primary/50"}`}
                >
                  <button
                    onClick={() => markRead(n.id)}
                    className="flex-1 min-w-0 flex items-start gap-4 p-4 text-left rounded-2xl"
                  >
                    <span className="w-10 h-10 shrink-0 rounded-2xl bg-secondary flex items-center justify-center text-primary">
                      <Icon className="w-5 h-5" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2">
                        <span className={`text-sm truncate ${n.read ? "font-semibold" : "font-bold"}`}>
                          {t(`notifications.${key}_title`)}
                        </span>
                        {!n.read && (
                          <span className="w-2 h-2 shrink-0 rounded-full bg-primary">
                            <span className="sr-only">{t("notifications.unread_label")}</span>
                          </span>
                        )}
                      </span>
                      <span className="block text-sm text-muted-foreground mt-1">
                        {t(`notifications.${key}_message`, {
                          amount: formatAmount(n.amount),
                          currency: n.currency,
                          level: n.level,
                        })}
                      </span>
                      <span className="block text-xs text-muted-foreground mt-2">
                        {formatDate(n.date, { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => dismiss(n.id)}
                    aria-label={t("notifications.delete")}
                    title={t("notifications.delete")}
                    className="w-11 h-11 shrink-0 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
};

export default Notificaciones;
