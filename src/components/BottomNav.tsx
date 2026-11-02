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
      <div className="max-w-md mx-auto flex items-stretch justify-around gap-0.5 px-1 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {tabs.map(({ icon: Icon, labelKey, path }) => {
          const isActive = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              aria-current={isActive ? "page" : undefined}
              className={`flex-1 min-w-0 min-h-12 flex flex-col items-center justify-center gap-1 px-1 py-1 rounded-xl transition-colors active:scale-95 ${
                isActive ? "text-primary font-bold" : "text-muted-foreground font-semibold"
              }`}
            >
              <Icon className="w-[22px] h-[22px] shrink-0" strokeWidth={isActive ? 2.2 : 1.9} />
              <span className="w-full text-xs leading-tight text-center break-words hyphens-auto">
                {t(labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
