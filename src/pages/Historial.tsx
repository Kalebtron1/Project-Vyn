import { useState, useEffect } from "react";
import { useWallet } from "@/hooks/useWallet";
import { ArrowUpRight, ArrowDownLeft, PiggyBank, Calendar, Loader2, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import BottomNav from "@/components/BottomNav";
import logoVin from "@/assets/logo-vin.png";

interface Transaction {
  id: string;
  type: "deposit" | "withdrawal";
  amount: number;
  label: string;
  date: Date;
}

const Historial = () => {
  const { wallet: walletAddress } = useWallet();
  const { t } = useTranslation();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!walletAddress) {
      setLoading(false);
      return;
    }

    const fetchHistory = async () => {
      try {
        const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${walletAddress}/effects?limit=150&order=desc`);
        
        if (!res.ok) throw new Error("Error leyendo Horizon");
        
        const data = await res.json();

        const parsedMovements: Transaction[] = data._embedded.records
          .filter((effect: any) => 
            (effect.type === "account_debited" || effect.type === "account_credited") &&
            parseFloat(effect.amount) > 0.05 
          )
          .map((effect: any) => {
            const isDeposit = effect.type === "account_debited";
            return {
              id: effect.id,
              type: isDeposit ? "deposit" : "withdrawal",
              label: isDeposit ? t("history.tx_deposit") : t("history.tx_withdrawal"),
              amount: parseFloat(effect.amount),
              date: new Date(effect.created_at),
            };
          });

        setTransactions(parsedMovements.slice(0, 40));

      } catch (error) {
        console.error("Error cargando historial general:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
    
    const interval = setInterval(fetchHistory, 15000);
    return () => clearInterval(interval);
  }, [walletAddress]);

  // Agrupación por mes
  const grouped = transactions.reduce<Record<string, Transaction[]>>((acc, tx) => {
    const key = tx.date.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
    if (!acc[key]) acc[key] = [];
    acc[key].push(tx);
    return acc;
  }, {});

  // --- 🚀 NUEVOS CÁLCULOS DINÁMICOS PARA EL RESUMEN ---
  const totalDepositsCount = transactions.filter(tx => tx.type === "deposit").length;
  const totalSavedVolume = transactions
    .filter(tx => tx.type === "deposit")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalWithdrawalsCount = transactions.filter(tx => tx.type === "withdrawal").length;
  const totalWithdrawnVolume = transactions
    .filter(tx => tx.type === "withdrawal")
    .reduce((sum, tx) => sum + tx.amount, 0);

  return (
    <div className="min-h-screen bg-background pb-24 font-nunito">
      <header className="px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-4 flex items-center gap-3">
        <img src={logoVin} alt="Vyn" className="w-7 h-7 object-contain" />
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">{t("history.title")}</h1>
          <p className="text-xs text-muted-foreground">{t("history.subtitle")}</p>
        </div>
      </header>

      <main className="px-5 max-w-md mx-auto">
        {loading ? (
          <div className="card-elevated p-10 flex flex-col items-center justify-center min-h-[250px] opacity-0 animate-fade-up" style={{ animationFillMode: "forwards" }}>
            <Loader2 className="w-8 h-8 animate-spin text-primary/50 mb-4" />
            <p className="text-sm font-semibold text-foreground">{t("history.syncing")}</p>
          </div>
        ) : transactions.length === 0 ? (
          <div className="card-elevated p-10 flex flex-col items-center text-center opacity-0 animate-fade-up" style={{ animationFillMode: "forwards" }}>
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-3">
              <PiggyBank className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-0.5">
              {walletAddress ? t("history.empty_title_no_txs") : t("history.empty_title_no_wallet")}
            </p>
            <p className="text-xs text-muted-foreground">
              {walletAddress ? t("history.empty_description_no_txs") : t("history.empty_description_no_wallet")}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([month, txs], gi) => (
              <section
                key={month}
                className="opacity-0 animate-fade-up"
                style={{ animationDelay: `${gi * 100}ms`, animationFillMode: "forwards" }}
              >
                <div className="flex items-center gap-2 mb-3 px-1">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-bold tracking-wide uppercase text-muted-foreground capitalize">{month}</span>
                </div>
                
                <div className="card-elevated divide-y divide-border overflow-hidden">
                  {txs.map((tx) => (
                    <div key={tx.id} className="flex items-center gap-3 px-5 py-4 hover:bg-secondary/30 transition-colors">
                      {/* Icono */}
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                          tx.type === "deposit" ? "bg-primary/10" : "bg-emerald-500/10"
                        }`}
                      >
                        {tx.type === "deposit" ? (
                          <ArrowUpRight className="w-5 h-5 text-primary" />
                        ) : (
                          <ArrowDownLeft className="w-5 h-5 text-emerald-500" />
                        )}
                      </div>
                      
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground truncate">{tx.label}</p>
                        <p className="text-xs font-medium text-muted-foreground mt-0.5">
                          {tx.date.toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      
                      {/* Monto */}
                      <div className="text-right flex flex-col items-end">
                        <span
                          className={`block text-sm font-bold tabular-nums ${
                            tx.type === "deposit" ? "text-primary" : "text-emerald-500"
                          }`}
                        >
                          {tx.type === "deposit" ? "+" : "-"}{tx.amount.toFixed(2)} XLM
                        </span>
                        <a 
                          href={`https://stellar.expert/explorer/testnet/tx/${tx.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-end gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground mt-1 hover:text-foreground transition-colors"
                        >
                          {t("common.receipt")} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* --- 🚀 RESUMEN ACTUALIZADO (DEPÓSITOS Y RETIROS) --- */}
        {transactions.length > 0 && (
          <div className="card-navy p-6 mt-6 mb-4 opacity-0 animate-fade-up" style={{ animationDelay: "300ms", animationFillMode: "forwards" }}>
            <p className="text-[10px] font-bold tracking-widest uppercase opacity-60 mb-5 text-center">{t("history.summary_title")}</p>
            
            <div className="space-y-6">
              {/* Fila 1: Depósitos */}
              <div className="grid grid-cols-2 gap-4 divide-x divide-white/10">
                <div className="text-center">
                  <p className="text-2xl font-extrabold tabular-nums text-white mb-1">{totalDepositsCount}</p>
                  <p className="text-[10px] font-semibold opacity-60 uppercase tracking-wide">{t("history.summary_deposits")}</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-extrabold tabular-nums text-white mb-1">
                    {totalSavedVolume.toFixed(0)} <span className="text-sm font-medium opacity-60 ml-0.5">XLM</span>
                  </p>
                  <p className="text-[10px] font-semibold opacity-60 uppercase tracking-wide">{t("history.summary_volume_in")}</p>
                </div>
              </div>

              {/* Separador sutil */}
              <hr className="border-white/10 mx-4" />

              {/* Fila 2: Retiros */}
              <div className="grid grid-cols-2 gap-4 divide-x divide-white/10">
                <div className="text-center">
                  <p className="text-2xl font-extrabold tabular-nums text-emerald-400 mb-1">{totalWithdrawalsCount}</p>
                  <p className="text-[10px] font-semibold opacity-60 uppercase tracking-wide">{t("history.summary_withdrawals")}</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-extrabold tabular-nums text-emerald-400 mb-1">
                    {totalWithdrawnVolume.toFixed(0)} <span className="text-sm font-medium opacity-60 ml-0.5 text-white">XLM</span>
                  </p>
                  <p className="text-[10px] font-semibold opacity-60 uppercase tracking-wide">{t("history.summary_volume_out")}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
};

export default Historial;