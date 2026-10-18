/**
 * E2E stub for `@privy-io/react-auth`.
 * Activated via Vite alias when `VITE_E2E=1` so Playwright can boot the app
 * without a real Privy dashboard app id.
 */
import React, { createContext, useContext, useMemo } from "react";

type PrivyValue = {
  ready: boolean;
  authenticated: boolean;
  user: null;
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
  const value = useMemo<PrivyValue>(
    () => ({
      ready: true,
      authenticated: false,
      user: null,
      login: () => {
        /* no-op in E2E — wallet session is seeded via localStorage */
      },
      logout: async () => {
        /* no-op */
      },
    }),
    []
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
