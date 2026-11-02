/**
 * Avisos de la app, derivados de la actividad on-chain real del usuario. No hay datos
 * de ejemplo: si algo no ocurrió en la cadena, no aparece aquí.
 *
 * Lo leído y lo borrado se guarda por wallet en este navegador; no se sincroniza entre
 * dispositivos.
 */

import type { ActivityItem } from "@/stellar/activity";

export interface AppNotification {
  id: string;
  kind: ActivityItem["kind"];
  amount: number;
  currency: ActivityItem["currency"];
  level?: string;
  date: Date;
  read: boolean;
}

export interface NotificationState {
  /** Lo ocurrido hasta este momento (ms) ya cuenta como leído. */
  readBefore: number;
  readIds: string[];
  dismissedIds: string[];
}

/** La lista viene de las últimas operaciones, así que basta con recordar las recientes. */
const MAX_STORED_IDS = 200;

const storageKey = (wallet: string) => `vinculo_notifications_${wallet}`;

export function readNotificationState(wallet: string): NotificationState | null {
  try {
    const raw = localStorage.getItem(storageKey(wallet));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NotificationState>;
    return {
      readBefore: Number(parsed.readBefore) || 0,
      readIds: Array.isArray(parsed.readIds) ? parsed.readIds : [],
      dismissedIds: Array.isArray(parsed.dismissedIds) ? parsed.dismissedIds : [],
    };
  } catch {
    return null;
  }
}

export function writeNotificationState(wallet: string, state: NotificationState): void {
  try {
    localStorage.setItem(
      storageKey(wallet),
      JSON.stringify({
        ...state,
        readIds: state.readIds.slice(-MAX_STORED_IDS),
        dismissedIds: state.dismissedIds.slice(-MAX_STORED_IDS),
      })
    );
  } catch {
    /* localStorage no disponible: el estado dura lo que dure la sesión */
  }
}

/**
 * Estado de una wallet que usa la bandeja por primera vez: su historial previo no son
 * novedades. Se toma la fecha de la cadena, no el reloj del dispositivo.
 */
export function initialNotificationState(activity: ActivityItem[]): NotificationState {
  const newest = activity.reduce((latest, item) => Math.max(latest, item.date.getTime()), 0);
  return { readBefore: newest, readIds: [], dismissedIds: [] };
}

export function buildNotifications(
  activity: ActivityItem[],
  state: NotificationState | null
): AppNotification[] {
  const dismissed = new Set(state?.dismissedIds);
  const readIds = new Set(state?.readIds);
  const seen = new Set<string>();
  const notifications: AppNotification[] = [];

  for (const item of activity) {
    const id = `${item.id}:${item.kind}:${item.amount}`;
    if (seen.has(id) || dismissed.has(id)) continue;
    seen.add(id);
    notifications.push({
      id,
      kind: item.kind,
      amount: item.amount,
      currency: item.currency,
      level: item.level,
      date: item.date,
      // Sin estado todavía (primera carga) nada se presenta como novedad.
      read: !state || readIds.has(id) || item.date.getTime() <= state.readBefore,
    });
  }
  return notifications;
}
