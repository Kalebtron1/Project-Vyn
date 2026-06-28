import type { TFunction } from "i18next";

// Mapeo canónico nombre (español, como lo devuelve el backend) → número de tier.
// Centraliza lo que antes estaba duplicado en ProgressRing/Perfil/NFTModal.
const TIER_NAME_TO_NUMBER: Record<string, number> = {
  Bronce: 0,
  Plata: 1,
  Oro: 2,
  Diamante: 3,
  Platino: 4,
};

/** Convierte un nombre de tier en español (backend/legacy) a su número 0..4. */
export function tierNumberFromName(name: string | undefined | null): number {
  if (!name) return 0;
  return TIER_NAME_TO_NUMBER[name] ?? 0;
}

/** Etiqueta traducida del tier según el idioma activo (credit.tiers.0..4). */
export function tierLabel(t: TFunction, tierNumber: number): string {
  const n = Math.min(4, Math.max(0, Math.floor(tierNumber || 0)));
  return t(`credit.tiers.${n}`);
}
