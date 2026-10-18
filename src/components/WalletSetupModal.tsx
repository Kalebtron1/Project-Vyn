/**
 * WalletSetupModal — informational overlay about supported wallets.
 *
 * Shows which wallets are supported, where to get them, and any
 * provider-specific limitations (e.g. LOBSTR desktop-only).
 *
 * Usage:
 *   <WalletSetupModal open={open} onClose={() => setOpen(false)} />
 *
 * The modal does NOT initiate a wallet connection. Call the kit modal
 * (via `connectWallet()` from mobileWalletConnectors) for that.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, MonitorSmartphone, Monitor, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

// ─── Wallet descriptor ────────────────────────────────────────────────────────

interface WalletEntry {
  /** Unique id from the kit (matches the provider stored in session). */
  id: string;
  name: string;
  description: string;
  url: string;
  /** Where the wallet works. */
  platforms: ("desktop" | "mobile" | "web")[];
  /** Known limitations relevant to this app. */
  limitation?: string;
}

const WALLETS: WalletEntry[] = [
  {
    id: "freighter",
    name: "Freighter",
    description:
      "Official Stellar browser extension by the Stellar Development Foundation.",
    url: "https://www.freighter.app",
    platforms: ["desktop"],
    limitation: undefined,
  },
  {
    id: "lobstr",
    name: "LOBSTR",
    description:
      "Popular Stellar wallet available as a browser extension and mobile app. " +
      "Connect via the browser extension on desktop.",
    url: "https://lobstr.co",
    platforms: ["desktop"],
    limitation:
      "Browser extension only for in-app signing. The LOBSTR mobile app does not " +
      "support deep-link signing in this flow. Install the LOBSTR extension on " +
      "Chrome or Brave to use it here.",
  },
  {
    id: "albedo",
    name: "Albedo",
    description:
      "Web-based Stellar signer — no installation required, works in any browser " +
      "including mobile.",
    url: "https://albedo.link",
    platforms: ["desktop", "mobile", "web"],
    limitation: undefined,
  },
  {
    id: "xbull",
    name: "xBull",
    description: "Feature-rich Stellar wallet available as a browser extension.",
    url: "https://xbull.app",
    platforms: ["desktop"],
    limitation: undefined,
  },
];

// ─── Platform badge ───────────────────────────────────────────────────────────

function PlatformBadge({ platform }: { platform: "desktop" | "mobile" | "web" }) {
  const icons = {
    desktop: <Monitor className="w-3 h-3 mr-1" />,
    mobile: <MonitorSmartphone className="w-3 h-3 mr-1" />,
    web: <Globe className="w-3 h-3 mr-1" />,
  };
  const labels = { desktop: "Desktop", mobile: "Mobile", web: "Web" };

  return (
    <Badge variant="secondary" className="text-[10px] gap-0.5 px-1.5 py-0.5">
      {icons[platform]}
      {labels[platform]}
    </Badge>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface WalletSetupModalProps {
  open: boolean;
  onClose: () => void;
}

export function WalletSetupModal({ open, onClose }: WalletSetupModalProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("wallet_setup.title", "Supported Wallets")}</DialogTitle>
          <DialogDescription>
            {t(
              "wallet_setup.description",
              'Choose any of the wallets below. Click the Connect Wallet button on the login page to open the multi-wallet picker.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          {WALLETS.map((wallet) => (
            <div
              key={wallet.id}
              className="rounded-xl border border-border bg-card p-4 space-y-2"
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-foreground">
                      {wallet.name}
                    </span>
                    {wallet.platforms.map((p) => (
                      <PlatformBadge key={p} platform={p} />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {wallet.description}
                  </p>
                </div>
                <a
                  href={wallet.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 flex items-center gap-1 text-[11px] text-primary font-semibold hover:underline mt-0.5"
                  aria-label={`Open ${wallet.name} website`}
                >
                  <ExternalLink className="w-3 h-3" />
                  {t("wallet_setup.get_wallet", "Get")}
                </a>
              </div>

              {/* Limitation notice */}
              {wallet.limitation && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    <span className="font-bold">
                      {t("wallet_setup.limitation_label", "Note: ")}
                    </span>
                    {wallet.limitation}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="mt-4 text-[10px] text-muted-foreground text-center">
          {t(
            "wallet_setup.footer",
            "All wallets communicate with Stellar Testnet. Switch your wallet network to Testnet before connecting."
          )}
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default WalletSetupModal;
