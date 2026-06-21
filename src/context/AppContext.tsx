import React, { createContext, useContext, useState, useCallback } from "react";
import { v4 as uuidv4 } from 'uuid';

export interface Deposit {
  id: string;
  amount: number;
  date: Date;
  label: string;
  daysAgo: number;
}

export interface Withdrawal {
  id: string;
  amount: number;
  date: Date;
  txHash: string;
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
  addDeposit: (amount: number) => void;
  // -> simulateWeek eliminada
  withdrawCredit: () => void;
  addWithdrawal: (amount: number, txHash: string) => void;
  addStake: (amount: number, months: number) => void;
  showSuccess: boolean;
  setShowSuccess: (v: boolean) => void;
  showUnlockCelebration: boolean;
  setShowUnlockCelebration: (v: boolean) => void;
  scoreAnomaly: boolean;
  setScoreAnomaly: (v: boolean) => void;
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
  const [scoreAnomaly, setScoreAnomaly] = useState(false);

  const addDeposit = useCallback((amount: number) => {
    setState((prev) => {
      const newCount = prev.depositsCount + 1;
      const unlocked = newCount >= prev.requiredDeposits;
      const wasLocked = !prev.isUnlocked;
      
      if (wasLocked && unlocked) {
        setTimeout(() => setShowUnlockCelebration(true), 400);
      }

      return {
        ...prev,
        depositsCount: newCount,
        isUnlocked: unlocked,
        deposits: [
          {
            id: uuidv4(),
            amount,
            date: new Date(),
            label: `Depósito on-chain`,
            daysAgo: 0,
          },
          ...prev.deposits,
        ],
      };
    });
    setShowSuccess(true);
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
        // -> simulateWeek eliminada del Provider
        withdrawCredit,
        addWithdrawal,
        addStake,
        showSuccess,
        setShowSuccess,
        showUnlockCelebration,
        setShowUnlockCelebration,
        scoreAnomaly,
        setScoreAnomaly,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};