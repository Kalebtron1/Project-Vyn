import { Home, ArrowDownToLine, Clock, User, Landmark } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TREASURY_ADDRESS } from "@/stellar/contracts";

export interface NavItem {
  icon: LucideIcon;
  /** Clave i18n para la etiqueta. */
  labelKey: string;
  path: string;
}

/**
 * Fuente única de verdad para la navegación (sidebar de escritorio + bottom nav móvil).
 * La pestaña de Tesorería solo se muestra a la wallet dueña (gating cosmético; el
 * contrato impone la seguridad real con `treasury.require_auth()`).
 */
export function getNavItems(): NavItem[] {
  const savedWallet = (localStorage.getItem("vinculo_wallet") || "").trim();
  const isTreasury = !!TREASURY_ADDRESS && savedWallet === TREASURY_ADDRESS.trim();

  return [
    { icon: Home, labelKey: "nav.home", path: "/" },
    { icon: ArrowDownToLine, labelKey: "nav.withdrawals", path: "/retiros" },
    { icon: Clock, labelKey: "nav.history", path: "/historial" },
    { icon: User, labelKey: "nav.profile", path: "/perfil" },
    ...(isTreasury ? [{ icon: Landmark, labelKey: "nav.treasury", path: "/tesoreria" }] : []),
  ];
}
