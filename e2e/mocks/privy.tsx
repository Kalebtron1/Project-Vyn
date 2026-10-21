/**
 * E2E stub for `@privy-io/react-auth`.
 * Activated via Vite alias when `VITE_E2E=1` so Playwright can boot the app
 * without a real Privy dashboard app id.
 *
 * It behaves like an email session: `login()` authenticates and exposes a Stellar
 * wallet, and the session survives reloads (see `privy-wallet.ts`).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  E2E_PRIVY_AUTH_KEY,
  E2E_PRIVY_EMAIL,
  E2E_PRIVY_READY_DELAY_KEY,
  e2ePrivyKeypair,
  recordPrivyCall,
} from "./privy-wallet";

type PrivyUser = {
  email: { address: string };
  linkedAccounts: Array<{ type: string; chainType: string; address: string }>;
};

type PrivyValue = {
  ready: boolean;
  authenticated: boolean;
  user: PrivyUser | null;
  login: () => void;
  logout: () => Promise<void>;
};

const Ctx = createContext<PrivyValue | null>(null);

export function PrivyProvider({
  children,
}: {
  children: React.ReactNode;
  appId?: string;
  config?: unknown;
}) {
  const readyDelay = Number(localStorage.getItem(E2E_PRIVY_READY_DELAY_KEY) || 0);
  const [ready, setReady] = useState(readyDelay <= 0);
  const [authenticated, setAuthenticated] = useState(
    () => localStorage.getItem(E2E_PRIVY_AUTH_KEY) === "1"
  );

  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setReady(true), readyDelay);
    return () => clearTimeout(timer);
  }, [ready, readyDelay]);

  const login = useCallback(() => {
    recordPrivyCall("login");
    // Privy authenticates asynchronously once the user finishes its modal.
    setTimeout(() => {
      localStorage.setItem(E2E_PRIVY_AUTH_KEY, "1");
      setAuthenticated(true);
    }, 50);
  }, []);

  const logout = useCallback(async () => {
    recordPrivyCall("logout");
    localStorage.removeItem(E2E_PRIVY_AUTH_KEY);
    setAuthenticated(false);
  }, []);

  const user = useMemo<PrivyUser | null>(
    () =>
      authenticated
        ? {
            email: { address: E2E_PRIVY_EMAIL },
            linkedAccounts: [
              { type: "wallet", chainType: "stellar", address: e2ePrivyKeypair().publicKey() },
            ],
          }
        : null,
    [authenticated]
  );

  const value = useMemo<PrivyValue>(
    () => ({ ready, authenticated: ready && authenticated, user: ready ? user : null, login, logout }),
    [ready, authenticated, user, login, logout]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrivy(): PrivyValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("usePrivy must be used within PrivyProvider (E2E stub)");
  }
  return ctx;
}
