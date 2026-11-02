import type { LucideIcon } from "lucide-react";
import { ArrowDownToLine, CircleDollarSign, Clock, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

interface ActionButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

const ActionButton = ({ icon: Icon, label, onClick }: ActionButtonProps) => (
  <button
    onClick={onClick}
    className="flex flex-col items-center gap-2 min-w-0 text-[13px] font-semibold text-foreground transition-transform active:scale-95"
  >
    <span className="w-14 h-14 rounded-[20px] flex items-center justify-center bg-card border border-border">
      <Icon className="w-6 h-6" strokeWidth={2} />
    </span>
    <span className="w-full text-center leading-tight">{label}</span>
  </button>
);

/** Fila de acciones bajo el saldo. La principal es depositar. */
const QuickActions = ({ onDeposit, creditSectionId }: { onDeposit: () => void; creditSectionId: string }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const goToCredit = () => {
    document.getElementById(creditSectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="grid grid-cols-4 gap-2">
      <button
        onClick={onDeposit}
        data-testid="open-deposit"
        className="flex flex-col items-center gap-2 min-w-0 text-[13px] font-semibold text-foreground transition-transform active:scale-95"
      >
        <span className="btn-emerald w-14 h-14 !p-0 !rounded-[20px] flex items-center justify-center">
          <Plus className="w-6 h-6" strokeWidth={2.2} />
        </span>
        <span className="w-full text-center leading-tight">{t("home.deposit_button")}</span>
      </button>
      <ActionButton icon={ArrowDownToLine} label={t("home.action_withdraw")} onClick={() => navigate("/retiros")} />
      <ActionButton icon={CircleDollarSign} label={t("home.action_credit")} onClick={goToCredit} />
      <ActionButton icon={Clock} label={t("home.action_history")} onClick={() => navigate("/historial")} />
    </div>
  );
};

export default QuickActions;
