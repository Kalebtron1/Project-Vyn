import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWalletSession } from "@/context/WalletSessionContext";
import onboardingSave from "@/assets/onboarding-save.png";
import onboardingReputation from "@/assets/onboarding-reputation.png";
import onboardingCredit from "@/assets/onboarding-credit.png";

const Onboarding = () => {
  const [current, setCurrent] = useState(0);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { completeOnboarding } = useWalletSession();

  const steps = [
    {
      image: onboardingSave,
      title: t("onboarding.steps.save.title"),
      description: t("onboarding.steps.save.description"),
      bg: "from-blue-50 to-white",
    },
    {
      image: onboardingReputation,
      title: t("onboarding.steps.reputation.title"),
      description: t("onboarding.steps.reputation.description"),
      bg: "from-indigo-50 to-white",
    },
    {
      image: onboardingCredit,
      title: t("onboarding.steps.credit.title"),
      description: t("onboarding.steps.credit.description"),
      bg: "from-purple-50 to-white",
    },
  ];

  const isLast = current === steps.length - 1;
  const step = steps[current];

  const next = () => {
    if (isLast) {
      completeOnboarding();
      navigate("/login", { replace: true });
    } else {
      setCurrent((p) => p + 1);
    }
  };

  const skip = () => {
    completeOnboarding();
    navigate("/login", { replace: true });
  };

  return (
    <div className={`min-h-screen bg-gradient-to-b ${step.bg} flex flex-col`}>
      {/* Skip button */}
      <div className="flex justify-end px-6 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          onClick={skip}
          className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
        >
          {t("onboarding.cta_skip")}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <img
          key={current}
          src={step.image}
          alt={step.title}
          className="w-64 h-64 object-contain mb-8 animate-in fade-in zoom-in duration-500"
        />
        <h2
          key={`title-${current}`}
          className="text-2xl font-extrabold text-foreground mb-3 animate-in fade-in slide-in-from-bottom-4 duration-400"
        >
          {step.title}
        </h2>
        <p
          key={`desc-${current}`}
          className="text-sm text-muted-foreground leading-relaxed max-w-xs animate-in fade-in slide-in-from-bottom-4 duration-500"
        >
          {step.description}
        </p>
      </div>

      {/* Dots */}
      <div className="flex justify-center gap-2 mb-6">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`h-2 rounded-full transition-all duration-300 ${
              i === current ? "w-6 bg-primary" : "w-2 bg-primary/20"
            }`}
          />
        ))}
      </div>

      {/* CTA */}
      <div className="px-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <button
          onClick={next}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground px-5 py-4 text-sm font-bold shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
        >
          {isLast ? (
            <>
              <Sparkles className="w-4 h-4" />
              {t("onboarding.cta_start")}
            </>
          ) : (
            <>
              {t("onboarding.cta_next")}
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default Onboarding;
