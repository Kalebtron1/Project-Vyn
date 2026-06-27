import { CONTRACT_ID, LENDING_CONTRACT_ID } from "./contracts";

// Registro de actividad del usuario, derivado on-chain SOLO de los contratos
// actuales (staking_pool en USDC y vinculo_lending en XLM). Cualquier movimiento
// hacia/desde otro contrato (p.ej. despliegues viejos) se ignora, así el historial
// deja de mostrar transacciones del contrato anterior.

const HORIZON_URL = "https://horizon-testnet.stellar.org";

// deposit / savings_withdraw → USDC (ahorro) · loan / repay → XLM (crédito) · mint → nivel
export type ActivityKind = "deposit" | "savings_withdraw" | "loan" | "repay" | "mint";

export interface ActivityItem {
  id: string;
  txHash: string;
  kind: ActivityKind;
  amount: number;
  currency: "USDC" | "XLM" | "";
  sign: "+" | "-" | "";
  date: Date;
  /** Nivel del SBT, solo para kind === "mint". */
  level?: string;
}

interface BalanceChange {
  type?: string;
  asset_type?: string;
  asset_code?: string;
  from?: string;
  to?: string;
  amount?: string;
}

const SIGN_BY_KIND: Record<ActivityKind, "+" | "-" | ""> = {
  deposit: "+",
  loan: "+",
  savings_withdraw: "-",
  repay: "-",
  mint: "",
};

// Mints registrados localmente al completarse en la app (el mint lo firma el admin,
// por eso no aparece en las operaciones del usuario en Horizon). Ver recordMint().
const MINTS_KEY = "vinculo_activity_mints";

interface StoredMint {
  level: string;
  txHash: string;
  date: string; // ISO
  address: string;
}

export function recordMint(address: string, level: string, txHash: string, dateIso: string): void {
  try {
    const raw = localStorage.getItem(MINTS_KEY);
    const list: StoredMint[] = raw ? JSON.parse(raw) : [];
    // Evita duplicar el mismo mint (mismo tx) si se reintenta el registro.
    if (list.some((m) => m.txHash === txHash)) return;
    list.push({ level, txHash, date: dateIso, address });
    localStorage.setItem(MINTS_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    /* localStorage no disponible: el mint igual queda on-chain, solo no se loguea aquí */
  }
}

function readLocalMints(address: string): ActivityItem[] {
  try {
    const raw = localStorage.getItem(MINTS_KEY);
    if (!raw) return [];
    const list: StoredMint[] = JSON.parse(raw);
    return list
      .filter((m) => m.address === address)
      .map((m) => ({
        id: `mint-${m.txHash}`,
        txHash: m.txHash,
        kind: "mint" as const,
        amount: 0,
        currency: "" as const,
        sign: "" as const,
        date: new Date(m.date),
        level: m.level,
      }));
  } catch {
    return [];
  }
}

function classify(change: BalanceChange, user: string): ActivityItem | null {
  if (change.type !== "transfer") return null;
  const { from, to } = change;
  const involvesUser = from === user || to === user;
  if (!involvesUser) return null;

  const counterparty = from === user ? to : from;
  if (!counterparty) return null;

  let kind: ActivityKind | null = null;
  if (counterparty === CONTRACT_ID) {
    kind = from === user ? "deposit" : "savings_withdraw";
  } else if (counterparty === LENDING_CONTRACT_ID) {
    kind = to === user ? "loan" : "repay";
  }
  if (!kind) return null; // contraparte ajena (contrato viejo / transfer no relacionado)

  const currency = change.asset_type === "native" ? "XLM" : (change.asset_code as "USDC") || "USDC";
  return {
    id: "",
    txHash: "",
    kind,
    amount: change.amount ? parseFloat(change.amount) : 0,
    currency,
    sign: SIGN_BY_KIND[kind],
    date: new Date(),
  };
}

// Devuelve la actividad del usuario (acciones de los contratos actuales) más los
// mints registrados localmente, ordenada de más reciente a más antigua.
export async function fetchActivity(userAddress: string): Promise<ActivityItem[]> {
  if (!userAddress) return [];
  if (!CONTRACT_ID && !LENDING_CONTRACT_ID) return [];

  const items: ActivityItem[] = [];
  try {
    const res = await fetch(
      `${HORIZON_URL}/accounts/${userAddress}/operations?limit=100&order=desc&include_failed=false`
    );
    if (!res.ok) throw new Error("Error leyendo Horizon");
    const data = await res.json();

    for (const op of data._embedded?.records || []) {
      if (op.type !== "invoke_host_function") continue;
      const changes: BalanceChange[] = op.asset_balance_changes || [];
      for (const change of changes) {
        const item = classify(change, userAddress);
        if (!item) continue;
        item.id = op.id;
        item.txHash = op.transaction_hash;
        item.date = op.created_at ? new Date(op.created_at) : new Date();
        items.push(item);
      }
    }
  } catch (error) {
    console.error("Error cargando actividad on-chain:", error);
  }

  items.push(...readLocalMints(userAddress));
  items.sort((a, b) => b.date.getTime() - a.date.getTime());
  return items;
}
