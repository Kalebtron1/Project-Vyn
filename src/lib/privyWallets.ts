/**
 * privyWallets — qué wallet Stellar de Privy usa la app.
 *
 * Una cuenta de Privy puede tener más de una wallet Stellar (p. ej. si se crearon dos
 * en una carrera al entrar). `linkedAccounts` no garantiza un orden, así que tomar "la
 * primera" puede cambiar de una sesión a otra. La app usa siempre la más antigua.
 */

type LinkedAccountLike = {
  type?: string;
  chainType?: string;
  address?: string;
  firstVerifiedAt?: Date | string | null;
  walletIndex?: number | null;
};

function linkedTime(value: Date | string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/** Direcciones de las wallets Stellar de la cuenta, de la más antigua a la más nueva. */
export function stellarWalletsOf(user: unknown): string[] {
  const accounts = ((user as { linkedAccounts?: LinkedAccountLike[] } | null)?.linkedAccounts ?? [])
    .filter((a) => a.type === "wallet" && a.chainType === "stellar" && a.address);
  return accounts
    .sort(
      (a, b) =>
        linkedTime(a.firstVerifiedAt) - linkedTime(b.firstVerifiedAt) ||
        (a.walletIndex ?? 0) - (b.walletIndex ?? 0) ||
        (a.address as string).localeCompare(b.address as string)
    )
    .map((a) => a.address as string);
}

/** La wallet con la que entra la cuenta: siempre la más antigua. */
export function primaryStellarWallet(user: unknown): string | undefined {
  return stellarWalletsOf(user)[0];
}

/**
 * Con qué wallet firmar: la de la transacción si es de la cuenta (así una sesión que
 * quedó en otra wallet sigue firmando bien); si no, la principal.
 */
export function signingWalletFor(wallets: string[], txSource: string | undefined): string | undefined {
  if (txSource && wallets.includes(txSource)) return txSource;
  return wallets[0];
}

// Si el efecto que asegura la wallet corre dos veces antes de que Privy confirme la
// primera creación, la segunda espera a la misma promesa en vez de crear otra wallet.
let creating: Promise<string | undefined> | null = null;

export function createStellarWalletOnce(
  create: () => Promise<{ wallet: { address: string } }>
): Promise<string | undefined> {
  creating ??= create()
    .then(({ wallet }) => wallet.address)
    .finally(() => {
      creating = null;
    });
  return creating;
}
