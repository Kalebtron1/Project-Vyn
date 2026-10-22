/**
 * Caché de datos on-chain (React Query) — configuración y claves.
 *
 * Sin dependencias pesadas: lo importa `App.tsx`, que va en el bundle inicial. Los hooks
 * que leen la blockchain viven en `chainData.ts` (cargan el Stellar SDK con las páginas).
 *
 * Política: los datos se leen al entrar y se guardan en caché; NO hay polling. Se vuelven
 * a pedir sólo cuando (a) pasa `STALE_MS` y el usuario vuelve a la pestaña o abre una
 * página que los usa, o (b) una acción del usuario los cambia (`refreshChainData`).
 */

import { QueryClient } from "@tanstack/react-query";

/** Tras este tiempo un dato se considera viejo y se refresca en el siguiente uso. */
export const STALE_MS = 60_000;

/** Horizon (historial) tarda unos segundos en indexar una tx ya confirmada. */
export const HORIZON_LAG_MS = 6_000;

/** Todas las claves de datos on-chain cuelgan de ["chain", wallet, ...]. */
export const chainKeys = {
  all: ["chain"] as const,
  wallet: (address: string) => ["chain", address] as const,
  savings: (address: string) => ["chain", address, "savings"] as const,
  credit: (address: string) => ["chain", address, "credit"] as const,
  score: (address: string) => ["chain", address, "score"] as const,
  activity: (address: string) => ["chain", address, "activity"] as const,
  treasury: (address: string) => ["chain", address, "treasury"] as const,
};

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_MS,
        // Mantiene la caché al navegar entre páginas (se muestra al instante).
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  });
}

/**
 * Tras una acción que cambia datos (depósito, retiro, préstamo, pago, mint…): refresca
 * ya todo lo de esa wallet y, unos segundos después, lo que depende de Horizon
 * (historial y score), que tarda en reflejar la tx. Sólo esas dos rondas, sin polling.
 */
export function refreshChainData(queryClient: QueryClient, address?: string | null): void {
  const scope = address ? chainKeys.wallet(address) : chainKeys.all;
  void queryClient.invalidateQueries({ queryKey: scope });
  setTimeout(() => {
    void queryClient.invalidateQueries({
      queryKey: scope,
      predicate: (query) => query.queryKey[2] === "activity" || query.queryKey[2] === "score",
    });
  }, HORIZON_LAG_MS);
}
