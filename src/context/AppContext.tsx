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

interface AppState {
  balance: number;
  deposits: Deposit[];
  depositsCount: number;
  requiredDeposits: number;
  isUnlocked: boolean;
  creditAmount: number;
  creditWithdrawn: boolean;
  withdrawals: Withdrawal[];
}

interface AppContextType extends AppState {
  addDeposit: (amount: number) => void;
  // -> simulateWeek eliminada
  withdrawCredit: () => void;
  addWithdrawal: (amount: number, txHash: string) => void;
  showSuccess: boolean;
  setShowSuccess: (v: boolean) => void;
  showUnlockCelebration: boolean;
  setShowUnlockCelebration: (v: boolean) => void;
  scoreAnomaly: boolean;
  setScoreAnomaly: (v: boolean) => void;
}

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

  return (
    <AppContext.Provider
      value={{
        ...state,
        addDeposit,
        // -> simulateWeek eliminada del Provider
        withdrawCredit,
        addWithdrawal,
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