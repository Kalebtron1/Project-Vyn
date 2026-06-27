import { useState } from "react";
import { ArrowLeft, ChevronDown, MessageCircle, ExternalLink, ShieldCheck, Globe } from "lucide-react";
import { useNavigate } from "react-router-dom";

const faqs = [
  {
    q: "¿Qué es Vyn?",
    a: "Vyn (Vínculo) es una plataforma DeFi que construye tu identidad financiera en la blockchain. Al ahorrar en nuestro contrato inteligente, generas un puntaje de reputación que te permite acceder a microcréditos sin burocracia tradicional.",
  },
  {
    q: "¿Cómo subo de nivel?",
    a: "Tu nivel (Bronce, Plata, Oro...) depende de tu Puntaje de Reputación. Este se calcula mediante un algoritmo que premia la constancia de tus depósitos y el tiempo que mantienes tus fondos en el contrato. A mayor puntaje, mayor límite de crédito.",
  },
  {
    q: "¿Qué son los niveles NFT?",
    a: "Cada nivel es un Soulbound Token (SBT). Es un NFT especial vinculado a tu wallet que no se puede transferir ni vender. Es tu 'medalla' de buen pagador y ahorrador en la red Stellar.",
  },
  {
    q: "¿En qué red opera Vyn?",
    a: "Actualmente operamos en Stellar Testnet (Red de Pruebas). Esto permite que pruebes todas las funcionalidades sin usar dinero real mientras terminamos la fase de auditoría.",
  },
  {
    q: "¿Cómo retiro mi crédito?",
    a: "Una vez alcances el Nivel Plata (50 pts de reputación), la opción de 'Retirar Crédito' se habilitará automáticamente en tu perfil. El monto se enviará directo a tu wallet Freighter.",
  },
  {
    q: "¿Mis fondos están seguros?",
    a: "Absolutamente. Vyn utiliza Smart Contracts en Soroban (Stellar). Los fondos están bloqueados bajo reglas criptográficas que solo tú controlas con tu firma digital en Freighter.",
  },
];

const Ayuda = () => {
  const navigate = useNavigate();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-background pb-24 font-nunito">
      <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-4 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center active:scale-90 transition-all"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="text-xl font-bold text-foreground tracking-tight">Centro de Ayuda</h1>
      </header>

      <main className="px-5 max-w-md md:max-w-2xl mx-auto space-y-5">
        {/* Contact Support Card */}
        <div className="card-elevated p-5 bg-primary/5 border border-primary/10 opacity-0 animate-fade-up">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground mb-1">¿Tienes dudas técnicas?</p>
              <p className="text-xs text-muted-foreground mb-3">
                Si tienes problemas con Freighter o con tus transacciones, escríbenos.
              </p>
              <a
                href="mailto:soporte@vyn.app"
                className="inline-flex items-center gap-2 text-xs font-bold text-primary px-3 py-2 bg-primary/10 rounded-lg hover:bg-primary/20 transition-colors"
              >
                soporte@vyn.app
              </a>
            </div>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="opacity-0 animate-fade-up" style={{ animationDelay: "100ms" }}>
          <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-muted-foreground mb-3 px-1">
            Preguntas Frecuentes
          </p>
          <div className="card-elevated divide-y divide-border overflow-hidden">
            {faqs.map((faq, i) => {
              const isOpen = openIndex === i;
              return (
                <div key={i} className="group">
                  <button
                    onClick={() => setOpenIndex(isOpen ? null : i)}
                    className="w-full text-left px-5 py-4 flex items-center justify-between gap-3 hover:bg-secondary/30 transition-colors"
                  >
                    <p className="text-sm font-bold text-foreground pr-4 leading-snug">{faq.q}</p>
                    <ChevronDown
                      className={`w-4 h-4 text-muted-foreground transition-transform duration-500 ${
                        isOpen ? "rotate-180 text-primary" : ""
                      }`}
                    />
                  </button>
                  <div
                    className={`transition-all duration-500 ease-in-out overflow-hidden ${
                      isOpen ? "max-h-60 bg-secondary/20" : "max-h-0"
                    }`}
                  >
                    <div className="px-5 pb-5 pt-1">
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {faq.a}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Resources Section */}
        <div className="opacity-0 animate-fade-up" style={{ animationDelay: "200ms" }}>
          <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-muted-foreground mb-3 px-1">
            Recursos de la Red
          </p>
          <div className="card-elevated divide-y divide-border">
            <a
              href="https://stellar.expert/explorer/testnet/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-5 py-4 hover:bg-secondary/50 transition-colors group"
            >
              <Globe className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              <div className="flex-1">
                <p className="text-sm font-bold text-foreground">Stellar Expert</p>
                <p className="text-[10px] text-muted-foreground">Explorador de la Testnet</p>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/50" />
            </a>
            
            <a
              href="https://www.freighter.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-5 py-4 hover:bg-secondary/50 transition-colors group"
            >
              <ShieldCheck className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              <div className="flex-1">
                <p className="text-sm font-bold text-foreground">Freighter Wallet</p>
                <p className="text-[10px] text-muted-foreground">Centro de ayuda oficial</p>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/50" />
            </a>
          </div>
        </div>

        <p className="text-center text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest pt-4">
          Protocolo Vyn · Descentralizado
        </p>
      </main>
    </div>
  );
};

export default Ayuda;