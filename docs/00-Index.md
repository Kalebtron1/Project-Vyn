---
tags: [index]
updated: 2026-10-22
---

# Project Vyn: index

Map of the project's notes. `docs/` is an Obsidian vault and plain Markdown on GitHub.
Each line says what the note answers, so you can open only what you need.

## How it works

- [Architecture](architecture.md): the three layers, routes, session, components, wallet
  providers, on-chain data caching, API functions, contracts, tier system, where to make
  common changes.
- [Core flows](flows.md): sign-in, USDC activation, deposits (wallet and SPEI), scoring and
  SBT mint, credit, loans, withdrawals, treasury, step by step.
- [API reference](api.md): request and response shape of every `/api` endpoint.
- [WebSocket streams](websocket.md): event replay protocol (not deployed).

## Integrations

- [Integrations overview](integrations/overview.md): every external service, its variables
  and what happens when it fails, in one table; plus which keys can move funds.
- [Soroban RPC](integrations/soroban-rpc.md): contract reads and writes, contract IDs.
- [Horizon and Friendbot](integrations/horizon.md): accounts, trustlines, history, classic
  payments, testnet funding.
- [DeFindex](integrations/defindex.md): the USDC vault behind the savings pool and the
  yield keeper.
- [Privy](integrations/privy.md): email, Google and passkey login with an embedded wallet.
- [Stellar Wallets Kit](integrations/stellar-wallets-kit.md): Freighter, Albedo, xBull,
  LOBSTR, Hana, Rabet, WalletConnect.
- [BlindPay](integrations/blindpay.md): SPEI on-ramp and off-ramp, open security issues.
- [Supabase](integrations/supabase.md): backend tables, fallback, keep-alive.
- [USDC faucet](integrations/usdc-faucet.md): test USDC for new wallets.
- [Vercel](integrations/vercel.md): function count (10 of 12), Hobby limits, what to do at
  the limit.
- [WebSocket](integrations/websocket.md): what exists and what is missing.
- [Other services](integrations/other-services.md): StellarExpert, SBT metadata on GitHub,
  Google Fonts, Lovable.
- [Pending and half-finished integrations](integrations/pending.md): unconnected code,
  unused variables, mocks, gaps.

## Decisions

Why things are the way they are. Read before reverting something that looks odd.

- [ADR-001: Load Privy only when needed](decisions/ADR-001-lazy-privy.md)
- [ADR-002: Use the oldest Stellar wallet of a Privy account](decisions/ADR-002-oldest-privy-wallet.md)
- [ADR-003: Cache on-chain reads, no polling](decisions/ADR-003-no-polling-cache.md)

## Operating it

- [Deployment](deployment.md): local setup, Vercel, every environment variable, scheduled
  jobs, rollback, contract redeployment.
- [Runbook](runbook.md): production URLs, post-deploy checks, common failures.
- [SPEI testing](spei-testing.md): BlindPay sandbox setup, simulate mode, sentinel amounts,
  risks.
- [Contract migration](contracts/migration.md): deploy and initialize the three Soroban
  contracts (they can't be upgraded in place).
- [E2E tests](e2e.md): Playwright setup and fixtures.

## Project

- [History](history.md): what each merged PR brought, by stage.
- [Contributing](contributing.md): how Stellar Wave issues are assigned, reviewed and merged.
- [Glossary](glossary.md): tier, SBT, DeFindex, SPEI, Wave and other project terms.

## Adding a note

1. Put it in the folder that matches its kind (`decisions/` for an ADR, `integrations/` for
   an external service, the root for a topic).
2. Add the frontmatter used here (`tags`, `updated`) and, for topic notes, `files:` with
   the source files it describes.
3. Link it from this index with a relative Markdown link.
