# Project Vyn

DeFi savings and credit app on Stellar/Soroban (testnet). Users deposit USDC into a
DeFindex-backed staking pool, build an on-chain reputation score, receive a soulbound
tier NFT (SBT) and borrow against that tier.

Start with [docs/00-Index.md](docs/00-Index.md): it maps every note in `docs/`, which is
also an Obsidian vault. Read the note for the area you are touching before changing it,
and the decision records in `docs/decisions/` before undoing something that looks odd.

## Stack

- Frontend: Vite, React 18, TypeScript, React Router, React Query, Tailwind, shadcn/ui,
  i18n in `src/i18n/locales/{es,en}.ts` (Spanish is the primary language).
- API: Vercel serverless functions in `api/` (`_*.mjs` files are shared helpers).
- Contracts: Rust/Soroban in `backend/contracts/{staking_pool,vinculo_lending,vinculo_sbt}`.
- Wallets: Stellar Wallets Kit (Freighter, xBull, Lobstr, Hana, Rabet, Albedo, optional
  WalletConnect) and Privy for email/Google/passkey login with an embedded Stellar wallet.

## Commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` |
| Unit tests (Vitest) | `npm test` |
| E2E (Playwright, Privy stubbed via `VITE_E2E=1`) | `npm run test:e2e` |
| Lint | `npm run lint` |
| Build | `npm run build` |
| Type check | `npx tsc --noEmit -p tsconfig.app.json` |
| Contracts | `cargo test` inside each `backend/contracts/*` folder |

`main` already has about 23 TypeScript errors and some lint problems in unrelated files.
Compare against `main` and only make sure you add no new ones.

## Rules

- Never import `@privy-io/*` outside `src/components/PrivyLayer.tsx` and
  `src/components/PrivyBridge.tsx`. Use `src/lib/privyBridge.ts` instead, or Privy (~2 MB)
  ends up in every page. See [ADR-001](docs/decisions/ADR-001-lazy-privy.md).
- A Privy account always uses its oldest Stellar wallet (`src/lib/privyWallets.ts`).
  See [ADR-002](docs/decisions/ADR-002-oldest-privy-wallet.md).
- Read on-chain data only through the hooks in `src/lib/chainData.ts`. No `setInterval`
  polling. After a transaction that changes data, wait for confirmation and call
  `useRefreshChainData()(address)`. See [ADR-003](docs/decisions/ADR-003-no-polling-cache.md).
- Every user-facing string goes in both `es.ts` and `en.ts`. Format numbers and dates with
  `formatAmount` / `formatDate` from `src/lib/format.ts`.
- Contract storage changes must stay compatible with existing entries, or the PR must
  document the migration in `docs/contracts/migration.md`. None of the contracts has an
  `upgrade` function, so a breaking change means a redeploy with a new contract ID.
- Never commit secrets: `.env*` files stay local. `.env.example` lists the variables.
- Community PRs follow [docs/contributing.md](docs/contributing.md).

## Notes

- `docs/` is an Obsidian vault. Link with relative Markdown paths, e.g.
  `[Flows](flows.md)`, not `[[wikilinks]]`, so links also work on GitHub.
- When a decision changes how something works, add or update an ADR in `docs/decisions/`.
- The maintainer keeps private notes (strategy, contributor reviews, session log) in the
  private repo `Kalebtron1/vyn-notas`. When it is available next to this repo, read its
  `00-Inicio.md` for current priorities. Never copy its contents into this public repo.
