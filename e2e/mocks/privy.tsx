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
  E2E_PRIVY_LOGIN_FAILURE_KEY,
  E2E_PRIVY_PASSKEY_KEY,
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
  linkPasskey: () => void;
};

const Ctx = createContext<PrivyValue | null>(null);
const ModalCtx = createContext(false);

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

  const [modalOpen, setModalOpen] = useState(false);
  const [passkeyLinked, setPasskeyLinked] = useState(
    () => localStorage.getItem(E2E_PRIVY_PASSKEY_KEY) === "1"
  );

  const linkPasskey = useCallback(() => {
    recordPrivyCall("linkPasskey");
    // Privy shows its modal, the OS asks for the fingerprint, then the user updates.
    setTimeout(() => {
      localStorage.setItem(E2E_PRIVY_PASSKEY_KEY, "1");
      setPasskeyLinked(true);
    }, 50);
  }, []);

  useEffect(() => {
    const w = window as unknown as { __e2ePrivyCloseModal?: () => void };
    w.__e2ePrivyCloseModal = () => setModalOpen(false);
  }, []);

  const login = useCallback(() => {
    recordPrivyCall("login");
    setModalOpen(true);
    const failure = localStorage.getItem(E2E_PRIVY_LOGIN_FAILURE_KEY);
    if (failure) {
      // Like Privy's Google/Apple buttons when its API rejects the OAuth init:
      // an unhandled rejection with a Privy error, and the modal stays open.
      const error = Object.assign(new Error(failure), { type: "invalid_data", privyErrorCode: undefined });
      setTimeout(() => { void Promise.reject(error); }, 50);
      return;
    }
    // Privy authenticates asynchronously once the user finishes its modal.
    setTimeout(() => {
      localStorage.setItem(E2E_PRIVY_AUTH_KEY, "1");
      setAuthenticated(true);
      setModalOpen(false);
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
              ...(passkeyLinked ? [{ type: "passkey", chainType: "", address: "" }] : []),
            ],
          }
        : null,
    [authenticated, passkeyLinked]
  );

  const value = useMemo<PrivyValue>(
    () => ({ ready, authenticated: ready && authenticated, user: ready ? user : null, login, logout, linkPasskey }),
    [ready, authenticated, user, login, logout, linkPasskey]
  );

  return (
    <ModalCtx.Provider value={modalOpen}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </ModalCtx.Provider>
  );
}

export function useModalStatus(): { isOpen: boolean } {
  return { isOpen: useContext(ModalCtx) };
}

export function usePrivy(): PrivyValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("usePrivy must be used within PrivyProvider (E2E stub)");
  }
  return ctx;
}
