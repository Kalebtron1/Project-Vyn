---
tags: [index]
updated: 2026-10-22
---

# Project Vyn: index

Map of the project's notes. `docs/` is an Obsidian vault and plain Markdown on GitHub.
Each line says what the note answers, so you can open only what you need.

## How it works

- [Architecture](architecture.md): the three layers, routes, components, wallet providers,
  on-chain data caching, email login (Privy), where to make common changes.
- [Core flows](flows.md): auth, deposit, scoring and SBT mint, credit, loan and repayment,
  step by step.
- [API reference](api.md): request and response shape of every `/api` endpoint.
- [WebSocket streams](websocket.md): event replay on reconnect.

## Decisions

Why things are the way they are. Read before reverting something that looks odd.

- [ADR-001: Load Privy only when needed](decisions/ADR-001-lazy-privy.md)
- [ADR-002: Use the oldest Stellar wallet of a Privy account](decisions/ADR-002-oldest-privy-wallet.md)
- [ADR-003: Cache on-chain reads, no polling](decisions/ADR-003-no-polling-cache.md)

## Operating it

- [Deployment](deployment.md): local setup, Vercel, preview deploys, rollback.
- [Runbook](runbook.md): production URLs, post-deploy checks, common failures.
- [Contract migration](contracts/migration.md): deploy, upgrade and rollback of the three
  Soroban contracts.
- [E2E tests](e2e.md): Playwright setup and fixtures.

## Contributing

- [Contributing](contributing.md): how Stellar Wave issues are assigned, reviewed and merged.
- [Glossary](glossary.md): tier, SBT, DeFindex, SPEI, Wave and other project terms.

## Adding a note

1. Put it in the folder that matches its kind (`decisions/` for an ADR, the root for a
   topic).
2. Add the frontmatter used here (`tags`, `updated`) and, for topic notes, `files:` with
   the source files it describes.
3. Link it from this index with a relative Markdown link.
