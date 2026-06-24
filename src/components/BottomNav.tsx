import { Home, Clock, ArrowDownToLine, User, Landmark } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TREASURY_ADDRESS } from "@/stellar/contracts";

const BottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // La pestaña de Tesorería solo se muestra a la wallet dueña (gating cosmético;
  // el contrato impone la seguridad real con `treasury.require_auth()`).
  const savedWallet = (localStorage.getItem("vinculo_wallet") || "").trim();
  const isTreasury = !!TREASURY_ADDRESS && savedWallet === TREASURY_ADDRESS.trim();

  const tabs = [
    { icon: Home, label: t("nav.home"), id: "/" },
    { icon: ArrowDownToLine, label: t("nav.withdrawals"), id: "/retiros" },
    { icon: Clock, label: t("nav.history"), id: "/historial" },
    { icon: User, label: t("nav.profile"), id: "/perfil" },
    ...(isTreasury ? [{ icon: Landmark, label: "Tesorería", id: "/tesoreria" }] : []),
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-card/90 backdrop-blur-lg border-t border-border">
      <div className="max-w-md mx-auto flex items-center justify-around py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {tabs.map(({ icon: Icon, label, id }) => {
          const isActive = location.pathname === id;
          return (
            <button
              key={id}
              onClick={() => navigate(id)}
              className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors active:scale-95 ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10px] font-semibold">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
