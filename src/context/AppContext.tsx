import React, { createContext, useContext, useState, useCallback } from "react";
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Transaction status — every deposit/withdrawal must end in a terminal state.
// ---------------------------------------------------------------------------
export type TxStatus = "pending" | "success" | "failed";

export interface Deposit {
  id: string;
  amount: number;
  date: Date;
  label: string;
  daysAgo: number;
  status: TxStatus;
  txHash?: string;
}

export interface Withdrawal {
  id: string;
  amount: number;
  date: Date;
  txHash: string;
  status: TxStatus;
}

export interface StakePosition {
  id: string;
  amount: number;
  months: number;
  apy: number;
  startDate: Date;
  endDate: Date;
  status: "active" | "completed";
}

interface AppState {
  balance: number;
  deposits: Deposit[];
  depositsCount: number;
  requiredDeposits: number;
  isUnlocked: boolean;
  creditAmount: number;
  creditWithdrawn: boolean;
  withdrawals: Withdrawal[];
  stakes: StakePosition[];
}

interface AppContextType extends AppState {
  /** Optimistically adds a deposit record with status="pending". Returns the new id. */
  addDeposit: (amount: number) => string;
  /** Promotes a pending deposit to status="success" once the chain confirms it. */
  confirmDeposit: (id: string, txHash: string) => void;
  /** Marks a pending deposit as status="failed" and rolls back the unlock state. */
  failDeposit: (id: string) => void;
  withdrawCredit: () => void;
  addWithdrawal: (amount: number, txHash: string) => void;
  addStake: (amount: number, months: number) => void;
  showSuccess: boolean;
  setShowSuccess: (v: boolean) => void;
  showUnlockCelebration: boolean;
  setShowUnlockCelebration: (v: boolean) => void;
}

const STAKING_APY: Record<number, number> = {
  1: 4,
  3: 7,
  6: 11,
  12: 18,
};

const AppContext = createContext<AppContextType | null>(null);

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>({
    balance: 0,
    deposits: [],
    depositsCount: 0,
    requiredDeposits: 3,
    isUnlocked: false,
    creditAmount: 300,
    creditWithdrawn: false,
    withdrawals: [],
    stakes: [],
  });
  const [showSuccess, setShowSuccess] = useState(false);
  const [showUnlockCelebration, setShowUnlockCelebration] = useState(false);

  /**
   * Optimistically adds a deposit with status="pending".
   * The count increments immediately so the progress bar is responsive,
   * but isUnlocked only flips once confirmDeposit() is called.
   */
  const addDeposit = useCallback((amount: number): string => {
    const id = uuidv4();
    setState((prev) => {
      const newCount = prev.depositsCount + 1;
      return {
        ...prev,
        depositsCount: newCount,
        deposits: [
          {
            id,
            amount,
            date: new Date(),
            label: `Depósito on-chain`,
            daysAgo: 0,
            status: "pending",
          },
          ...prev.deposits,
        ],
      };
    });
    return id;
  }, []);

  /**
   * Called once the RPC confirms the transaction landed on-chain.
   * At this point we flip isUnlocked if the threshold was crossed.
   */
  const confirmDeposit = useCallback((id: string, txHash: string) => {
    setState((prev) => {
      const updatedDeposits = prev.deposits.map((d) =>
        d.id === id ? { ...d, status: "success" as TxStatus, txHash } : d
      );
      // Re-derive the real confirmed count from "success" records only.
      const confirmedCount = updatedDeposits.filter((d) => d.status === "success").length;
      const willUnlock = confirmedCount >= prev.requiredDeposits;
      const wasLocked = !prev.isUnlocked;

      if (wasLocked && willUnlock) {
        setTimeout(() => setShowUnlockCelebration(true), 400);
      }

      return {
        ...prev,
        deposits: updatedDeposits,
        depositsCount: confirmedCount,
        isUnlocked: willUnlock,
      };
    });
    setShowSuccess(true);
  }, []);

  /**
   * Called when a deposit transaction fails or times out.
   * Rolls back the optimistic count increment.
   */
  const failDeposit = useCallback((id: string) => {
    setState((prev) => {
      const updatedDeposits = prev.deposits.map((d) =>
        d.id === id ? { ...d, status: "failed" as TxStatus } : d
      );
      // Recalculate count from confirmed successes only.
      const confirmedCount = updatedDeposits.filter((d) => d.status === "success").length;
      return {
        ...prev,
        deposits: updatedDeposits,
        depositsCount: confirmedCount,
        isUnlocked: confirmedCount >= prev.requiredDeposits,
      };
    });
  }, []);

  const withdrawCredit = useCallback(() => {
    setState((prev) => ({ ...prev, creditWithdrawn: true }));
  }, []);

  const addWithdrawal = useCallback((amount: number, txHash: string) => {
    setState((prev) => ({
      ...prev,
      balance: Math.max(0, prev.balance - amount),
      withdrawals: [
        {
          id: uuidv4(),
          amount,
          date: new Date(),
          txHash,
          status: "success" as TxStatus,
        },
        ...prev.withdrawals,
      ],
    }));
  }, []);

  const addStake = useCallback((amount: number, months: number) => {
    const apy = STAKING_APY[months] || 4;
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + months);
    setState((prev) => ({
      ...prev,
      balance: Math.max(0, prev.balance - amount),
      stakes: [
        {
          id: uuidv4(),
          amount,
          months,
          apy,
          startDate,
          endDate,
          status: "active",
        },
        ...prev.stakes,
      ],
    }));
  }, []);

  return (
    <AppContext.Provider
      value={{
        ...state,
        addDeposit,
        confirmDeposit,
        failDeposit,
        withdrawCredit,
        addWithdrawal,
        addStake,
        showSuccess,
        setShowSuccess,
        showUnlockCelebration,
        setShowUnlockCelebration,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};