import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getNavItems } from "@/components/navItems";

const BottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const tabs = getNavItems();

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/90 backdrop-blur-lg border-t border-border">
      <div className="max-w-md mx-auto flex items-center justify-around py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {tabs.map(({ icon: Icon, labelKey, path }) => {
          const isActive = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-colors active:scale-95 ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10px] font-semibold">{t(labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
