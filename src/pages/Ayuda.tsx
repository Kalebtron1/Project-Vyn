import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, FlaskConical, Globe, MessageCircle, Search, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AppShell from "@/components/AppShell";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useWallet } from "@/hooks/useWallet";
import { searchHelp, type HelpCategory } from "@/lib/helpSearch";

// Canal provisional: Vyn aún no tiene correo propio.
const SUPPORT_URL = "https://github.com/Kalebtron1/Project-Vyn/issues/new";

const Ayuda = () => {
  const { t } = useTranslation();
  const { wallet } = useWallet();
  const [query, setQuery] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const categories = t("help.categories", { returnObjects: true }) as HelpCategory[];
  const results = useMemo(() => searchHelp(categories, query), [categories, query]);
  const searching = query.trim().length > 0;

  const copyDetails = async () => {
    const details = [`Wallet: ${wallet || "-"}`, "Red: Stellar Testnet", `Página: ${window.location.origin}`].join("\n");
    try {
      await navigator.clipboard.writeText(details);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <AppShell title={t("help.title")} subtitle={t("help.subtitle")}>
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="card-elevated p-4 flex items-start gap-3" data-testid="help-testnet-notice">
          <FlaskConical className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold">{t("help.testnet_title")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("help.testnet_description")}</p>
          </div>
        </div>

        <div className="relative">
          <Search className="w-5 h-5 text-muted-foreground absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("help.search_label")}
            placeholder={t("help.search_placeholder")}
            className="w-full h-12 pl-12 pr-4 rounded-2xl bg-card border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {results.length === 0 ? (
          <div className="text-center py-8" role="status" data-testid="help-no-results">
            <p className="text-base font-bold">{t("help.no_results_title")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("help.no_results_description")}</p>
          </div>
        ) : (
          results.map((category) => (
            <section key={category.id} data-testid="help-category">
              <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-2 px-1">
                {category.title}
              </h2>
              <div className="card-elevated overflow-hidden">
                {/* Al buscar, los resultados se abren para leerlos sin más toques. */}
                <Accordion
                  key={searching ? `${category.id}-search` : category.id}
                  type="multiple"
                  defaultValue={searching ? category.items.map((item) => item.q) : []}
                >
                  {category.items.map((item) => (
                    <AccordionItem key={item.q} value={item.q} className="last:border-b-0 px-4">
                      <AccordionTrigger className="text-sm font-semibold text-left min-h-12 hover:no-underline">
                        {item.q}
                      </AccordionTrigger>
                      <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                        <p>{item.a}</p>
                        {item.link && (
                          <Link to={item.link} className="inline-flex items-center min-h-11 font-bold text-primary">
                            {item.link_label}
                          </Link>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            </section>
          ))
        )}

        <section className="card-elevated p-5" data-testid="help-contact">
          <h2 className="text-base font-bold">{t("help.contact_title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t("help.contact_description")}</p>
          <div className="flex flex-wrap gap-2 mt-4">
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-emerald min-h-11 !py-2 inline-flex items-center gap-2 text-sm"
            >
              <MessageCircle className="w-4 h-4" /> {t("help.contact_cta")}
            </a>
            <button
              onClick={copyDetails}
              className="min-h-11 px-4 rounded-2xl bg-secondary text-sm font-semibold inline-flex items-center gap-2"
            >
              {copyState === "copied" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copyState === "copied"
                ? t("help.copied_details")
                : copyState === "failed"
                  ? t("help.copy_failed")
                  : t("help.copy_details")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">{t("help.details_hint")}</p>
        </section>

        <section>
          <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-2 px-1">
            {t("help.resources_section_label")}
          </h2>
          <div className="card-elevated divide-y divide-border">
            <a
              href={wallet ? `https://stellar.expert/explorer/testnet/account/${wallet}` : "https://stellar.expert/explorer/testnet/"}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-5 py-4 hover:bg-secondary/50 transition-colors"
            >
              <Globe className="w-5 h-5 text-muted-foreground shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold">{t("help.stellar_expert_title")}</span>
                <span className="block text-xs text-muted-foreground">{t("help.stellar_expert_subtitle")}</span>
              </span>
              <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
            </a>
            <a
              href="https://www.freighter.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-5 py-4 hover:bg-secondary/50 transition-colors"
            >
              <ShieldCheck className="w-5 h-5 text-muted-foreground shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold">{t("help.freighter_title")}</span>
                <span className="block text-xs text-muted-foreground">{t("help.freighter_subtitle")}</span>
              </span>
              <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
            </a>
          </div>
        </section>
      </div>
    </AppShell>
  );
};

export default Ayuda;
