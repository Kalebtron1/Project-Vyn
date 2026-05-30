import { Globe } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";

const LABELS: Record<string, string> = {
  es: "Español",
  en: "English",
};

const LanguageSelector = () => {
  const { language, supportedLanguages, changeLanguage } = useLanguage();

  return (
    <div className="flex items-center gap-2">
      <Globe className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <div className="flex gap-1">
        {supportedLanguages.map((lang) => (
          <button
            key={lang}
            onClick={() => changeLanguage(lang)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 ${
              language === lang
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:bg-secondary/80"
            }`}
          >
            {LABELS[lang] ?? lang.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
};

export default LanguageSelector;
