import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useActivity } from "@/lib/chainData";
import {
  buildNotifications,
  initialNotificationState,
  readNotificationState,
  writeNotificationState,
  type NotificationState,
} from "@/lib/notifications";

// Fuera de ["chain", ...]: leer el navegador no debe mostrar "Actualizando…".
const stateKey = (wallet: string) => ["notifications", wallet] as const;

/**
 * Avisos de la wallet. Reutilizan la lectura de actividad compartida: se actualizan al
 * entrar y tras cada acción del usuario, sin polling (ver ADR-003).
 */
export function useNotifications(wallet: string | null | undefined) {
  const address = wallet ?? "";
  const queryClient = useQueryClient();
  const activity = useActivity(wallet);
  const { data: state = null } = useQuery({
    queryKey: stateKey(address),
    queryFn: () => readNotificationState(address),
    enabled: !!wallet,
    staleTime: Infinity,
  });
  const stateLoaded = queryClient.getQueryState(stateKey(address))?.status === "success";

  const save = useCallback(
    (next: NotificationState) => {
      writeNotificationState(address, next);
      queryClient.setQueryData(stateKey(address), next);
    },
    [address, queryClient]
  );

  // Una lectura fallida no sirve de punto de partida: lo que llegue después sería "nuevo".
  useEffect(() => {
    if (stateLoaded && !state && activity.isSuccess) {
      save(initialNotificationState(activity.data));
    }
  }, [stateLoaded, state, activity.isSuccess, activity.data, save]);

  const notifications = useMemo(
    () => buildNotifications(activity.data ?? [], state),
    [activity.data, state]
  );

  const current = useCallback(
    (): NotificationState => state ?? { readBefore: 0, readIds: [], dismissedIds: [] },
    [state]
  );

  return {
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
    loading: !!wallet && activity.isPending,
    failed: activity.isError,
    retry: () => void activity.refetch(),
    markRead: (id: string) => {
      const base = current();
      if (!base.readIds.includes(id)) save({ ...base, readIds: [...base.readIds, id] });
    },
    markAllRead: () => {
      const base = current();
      save({ ...base, readIds: [...base.readIds, ...notifications.map((n) => n.id)] });
    },
    dismiss: (id: string) => {
      const base = current();
      save({ ...base, dismissedIds: [...base.dismissedIds, id] });
    },
    dismissAll: () => {
      const base = current();
      save({ ...base, dismissedIds: [...base.dismissedIds, ...notifications.map((n) => n.id)] });
    },
  };
}
