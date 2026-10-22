---
tags: [history]
updated: 2026-10-22
---

# Project history

What entered `main`, when and why, from the merged pull requests and the commit log
(248 commits; 41 merged PRs out of 67 closed, as of 2026-10-22). Dates are merge dates (UTC).
Community PRs mostly came through Stellar Wave (Drips); see [contributing](contributing.md).

## Timeline at a glance

| When | Stage | Main changes |
|---|---|---|
| 2026-03-18 → 03-22 | Hackathon prototype ("Vínculo") | Lovable UI, Freighter login, Supabase auth via Lovable Cloud, first contracts, SBT mint |
| 2026-03-29 → 04-09 | First deploy | Vercel app, deposits and withdrawals, env docs |
| 2026-05-24 → 05-25 | Community round 1 (#26–#31) | Mobile wallets, onboarding, i18n base, scoring fixes, docs, wallet abstraction |
| 2026-06-21 | Community round 2 (#53–#66) | Scripts, gas, validation, metrics, logging, health checks, English locale, WS replay |
| 2026-06-23 → 06-29 | DeFindex and fintech pivot | USDC vault with real yield (#77), treasury, Stellar Wallets Kit, BlindPay SPEI, faucet, Privy, Supabase only for the backend |
| 2026-10-18 | Community round 3 (#79–#88 via #109, #110) | i18n polish, LOBSTR, formatting, wallet docs, E2E, runbook, WalletConnect, CI fix |
| 2026-10-21 → 10-22 | Performance and auth (#130–#142) | Lazy routes and Privy, passkey and Google linking, oldest-wallet rule, cache without polling, docs vault |

## 1. Hackathon prototype (March 2026)

Not through PRs. The UI was generated with Lovable (`gpt-engineer-app[bot]`, about 95
commits on 2026-03-20): onboarding, home, history, profile, Freighter connect and deposit,
withdrawals, reputation levels. Lovable Cloud added Supabase auth with profiles and Google
login. On 03-21 the Soroban contracts arrived (`vinculo_lending` by a teammate, the SBT and
the staking pool with synthetic yield), NFT minting and tier metadata; on 03-22 a commit marked the
version "ready to present". The team repository was
`YORCH12/Stellar-Hack-vinculo-credito`, which still hosts the SBT metadata.

On 03-29 the app went to Vercel; 03-30 completed deposits and withdrawals; 04-09 documented
the environment setup.

## 2. Community round 1 (May 2026)

| PR | Author | What and why |
|---|---|---|
| #26 | daree-dev | Mobile wallet connection (Albedo on mobile) — issue #12. |
| #27 | daree-dev | Fixes in onboarding, login and wallet connection. |
| #28 | daree-dev | i18n foundation (i18next). |
| #29 | paulinaapeh8 | Correct Stellar type mapping and guard negative `totalDeposited` in scoring. |
| #30 | paulinaapeh8 | First `architecture.md` and `flows.md`. |
| #31 | paulinaapeh8 | Wallet abstraction layer (`WalletAdapter`). |

## 3. Community round 2 (June 21, 2026)

| PR | Author | What and why |
|---|---|---|
| #53 | abrak01 | Deploy and upgrade scripts and the contract migration guide (issue #40). |
| #54 | abrak01 | Fewer clones and storage reads in the three contracts (issue #41). |
| #55 | abrak01 | `StellarWalletAdapter` delegating to the connectors (issue #46). |
| #56 | daree-dev | Less spike-sensitive scoring, retention capped (issue #42). |
| #57 | Benedict315 | Wallet connection errors with guidance and retry. |
| #58 | Oby38 | Server-side validation with zod (`api/validation`). |
| #59 | paulinaapeh8 | Latency, conversion and failure metrics in the API (issue #35). |
| #60 | Escelit | Anomaly thresholds for the score (issue #45). |
| #62 | daree-dev | WebSocket replay hub (never connected, see [WebSocket](integrations/websocket.md)). |
| #63 | oncleweynom | Structured JSON logging and the scoring stress fixture (issues #34, #44). |
| #64 | daree-dev | English locale for the main screens (issue #9). |
| #65 | daree-dev | Deployment, environment and API docs (issue #22). |
| #66 | levoski1 | `/api/health` and `/api/readiness` (issue #36). |

The same day the maintainer stopped tracking Rust build output.

## 4. DeFindex, treasury and SPEI (June 23–29, 2026)

| Change | How it entered | Why |
|---|---|---|
| #77 DeFindex vault yield | PR (maintainer) | Replace the synthetic APY with a real USDC vault; scoring reads the pool's counters. |
| Treasury and pool management in `vinculo_lending`; treasury panel; contract IDs from env | Direct commits 06-24 | Let the business withdraw loan interest; stop hard-coding IDs. Loans stay in XLM. |
| New UI with `AppShell`, light/dark theme, dashboard | Direct commit 06-27 | Redesign. |
| Supabase removed from the frontend (auth, profiles) | Direct commit 06-27 | Auth moved to wallet/email signatures. |
| Stellar Wallets Kit | Direct commit 06-27 | One modal for many wallets. |
| BlindPay on/off-ramp, USDC faucet, trustlines, Privy and Accesly bridges, Supabase for the backend | Direct commit 06-28 | SPEI in and out; testnet USDC; email login. |
| 17 → 10 API functions | Direct commit 06-28 | The Vercel Hobby build failed above 12 functions ([Vercel](integrations/vercel.md)). |
| USDC deposit flow, faucet and mint fixes | Direct commits 06-28 → 06-29 | Fail-open faucet, Friendbot for new wallets, confirmed mints, Freighter check only for Freighter. |

These changes skipped PR review; [pending integrations](integrations/pending.md) lists what
they left unfinished.

## 5. Community round 3 (October 18, 2026)

PR #109 merged the reviewed community PRs and optional WalletConnect:

| PR | Author | What and why |
|---|---|---|
| #79 | paulinaapeh8 | English copy audit and fallback coverage (issue #69). |
| #80 | tebney | LOBSTR wallet support. |
| #81 | mzterwalexzyy | Localized dates, numbers and amounts (`formatAmount`, `formatDate`) — issue #71. |
| #82 | jerrymusaga | Multi-wallet docs, dead `FreighterAdapter` removed (issue #74). |
| #86 | sunnykid-02 | Consistent Spanish copy. |
| #87 | DonCervantes | Persisted language, mobile overflow checks and wallet E2E tests. |
| #88 | StephenMero | Incident runbook. |
| #109 | Kalebtron1 | The merge itself plus the optional WalletConnect module. |
| #110 | Kalebtron1 | `ethnum` 1.5.3 so the contracts CI builds on current stable Rust. |

The same day the maintainer opened issues #89–#107 (security, contracts, scoring, network
config) for the next Wave.

## 6. Performance, auth and docs (October 21–22, 2026)

| PR | What and why | Record |
|---|---|---|
| #130 | Lazy-load routes; keep the Stellar SDK out of the first bundle (issue #108). | |
| #132 | Load Privy only on `/login`, for email sessions, or on demand (issue #131). Initial load 1,130 kB → 135 kB gzipped. | [ADR-001](decisions/ADR-001-lazy-privy.md) |
| #133 | Show why a Privy login method fails; reset the email button. | |
| #134 | Remove Apple from the login methods. | |
| #135 | Passkey sign-in for email accounts. | |
| #136 | Link Google to an email account from Perfil. | |
| #137 | Always use the account's oldest Stellar wallet; no duplicate wallets. | [ADR-002](decisions/ADR-002-oldest-privy-wallet.md) |
| #138 | Cache on-chain reads, no polling, refresh after actions (home: 13 requests + 25 every 20 s → 4 then 0). | [ADR-003](decisions/ADR-003-no-polling-cache.md) |
| #139 | `CLAUDE.md`, docs index, ADRs, contributing guide, glossary. | |
| #140–#142 | Obsidian settings ignored, `launch.json` ignored, LF line endings in `docs/`. | |

## Closed without merging

26 PRs. Notable ones: #50 (security audit), #51 (contract test suite), #78 (WalletConnect,
later done in #109), #111–#126 (one contributor's batch for issues #89–#107, including the
#91/#92 SPEI fixes, closed unmerged), #127 (lazy loading, superseded by #130).

Open at the time of writing: #128 (interest by term, slippage, contract events, SBT tests,
frontend CI) and #129 (SBT metadata hosted in this repo).
