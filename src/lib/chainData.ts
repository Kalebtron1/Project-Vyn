/**
 * chainData — datos on-chain compartidos entre pantallas (React Query).
 *
 * Cada dato se pide una vez por wallet y se reutiliza en todas las tarjetas que lo
 * muestran (antes cada tarjeta lo pedía por su cuenta y cada 5–15 s). Ver la política
 * de caché en `queryClient.ts`.
 */

import { useCallback } from "react";
import { queryOptions, useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import type { rpc } from "@stellar/stellar-sdk";
import { readSavingsSnapshot, type SavingsSnapshot } from "@/stellar/queries";
import { fetchActivity } from "@/stellar/activity";
import { fetchAccruedInterest, fetchPoolBalance } from "@/stellar/treasury";
import { chainKeys, refreshChainData } from "@/lib/queryClient";

// ─── Fetchers ────────────────────────────────────────────────────────────────

export interface CreditInfo {
  success?: boolean;
  availableCredit?: number;
  tier?: number;
  tierName?: string;
  anomaly?: boolean;
}

export interface ScoreInfo {
  score?: number;
  tier?: number;
  eligibility?: {
    historyCount?: number;
    minHistoryRequired?: number;
    isHistoryEligible?: boolean;
  };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${url} respondió ${response.status}`);
  return response.json() as Promise<T>;
}

export const savingsQuery = (address: string) =>
  queryOptions({
    queryKey: chainKeys.savings(address),
    queryFn: () => readSavingsSnapshot(address),
  });

export const creditQuery = (address: string) =>
  queryOptions({
    queryKey: chainKeys.credit(address),
    queryFn: () => postJson<CreditInfo>("/api/get-available-credit", { userAddress: address }),
  });

export const activityQuery = (address: string) =>
  queryOptions({
    queryKey: chainKeys.activity(address),
    queryFn: () => fetchActivity(address),
  });

// ─── Hooks ───────────────────────────────────────────────────────────────────

/** Posición y acumulados del ahorro (saldo, depositado, retirado). */
export function useSavings(address: string | null | undefined) {
  return useQuery({ ...savingsQuery(address ?? ""), enabled: !!address });
}

/** Rendimiento: posición en vivo menos el principal neto aportado. */
export function useYield(address: string | null | undefined) {
  const savings = useSavings(address);
  const data: SavingsSnapshot = savings.data ?? { position: 0, deposited: 0, withdrawn: 0 };
  const netPrincipal = Math.max(0, data.deposited - data.withdrawn);
  return {
    realBalance: data.position,
    netPrincipal,
    yieldEarned: Math.max(0, data.position - netPrincipal),
    /** Primera carga (sin datos todavía). */
    loading: !!address && savings.isPending,
    /** Hay una lectura en curso (primera carga o refresco). */
    fetching: savings.isFetching,
  };
}

/** Tier on-chain y crédito disponible (`/api/get-available-credit`). */
export function useCredit(address: string | null | undefined) {
  return useQuery({ ...creditQuery(address ?? ""), enabled: !!address });
}

/**
 * Score dinámico (`/api/calculate-score`). Depende del saldo: lo pide a la caché,
 * que reutiliza una lectura en curso (p. ej. tras un depósito) en vez de repetirla.
 */
export function useScore(address: string | null | undefined) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: chainKeys.score(address ?? ""),
    queryFn: async () => {
      const savings = await queryClient.fetchQuery(savingsQuery(address as string));
      return postJson<ScoreInfo>("/api/calculate-score", {
        address,
        totalDeposited: Number(savings.position),
      });
    },
    enabled: !!address,
  });
}

/** Actividad on-chain (Horizon + mints locales), de la más reciente a la más antigua. */
export function useActivity(address: string | null | undefined) {
  return useQuery({ ...activityQuery(address ?? ""), enabled: !!address });
}

/** Panel de tesorería: interés acumulado y liquidez del pool de préstamos. */
export function useTreasury(address: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: chainKeys.treasury(address ?? ""),
    queryFn: async () => {
      const [accrued, pool] = await Promise.all([
        fetchAccruedInterest(address as string),
        fetchPoolBalance(address as string),
      ]);
      return { accrued, pool };
    },
    enabled: !!address && enabled,
  });
}

/** Refresca los datos de una wallet tras una acción que los cambia (ver `refreshChainData`). */
export function useRefreshChainData() {
  const queryClient = useQueryClient();
  return useCallback(
    (address?: string | null) => refreshChainData(queryClient, address),
    [queryClient]
  );
}

/** ¿Hay alguna lectura on-chain en curso? (para el aviso "Actualizando…"). */
export function useChainSyncing(): boolean {
  return useIsFetching({ queryKey: chainKeys.all }) > 0;
}

/**
 * Espera a que una tx enviada quede confirmada (o falle) antes de refrescar datos;
 * si se refresca antes, la red todavía devuelve los valores viejos.
 */
export async function waitForConfirmation(
  server: rpc.Server,
  hash: string,
  timeoutMs = 30_000
): Promise<"SUCCESS" | "FAILED" | "TIMEOUT"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await server.getTransaction(hash);
    const status = String(result.status);
    if (status === "SUCCESS") return "SUCCESS";
    if (status === "FAILED") return "FAILED";
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return "TIMEOUT";
}
