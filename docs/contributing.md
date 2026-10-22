---
tags: [contributing, wave]
updated: 2026-10-22
---

# Contributing

Most community work arrives through Stellar Wave (Drips). These rules keep reviews fast and
make sure each PR can be merged.

## Before you start

1. **Apply to the issue in Drips and wait until you are assigned.** Work on unassigned
   issues is not reviewed, and `/claim` comments don't assign anything.
2. Read the issue's acceptance criteria. The review checks each one.
3. Read [CLAUDE.md](../CLAUDE.md) and the note for the area you are touching (see the
   [index](00-Index.md)), especially the [decision records](decisions/).

## The pull request

- **One issue per PR**, or a few closely related ones you were assigned together. Don't
  bundle unrelated work.
- Write `Closes #N` **only for issues assigned to you**.
- Start from the latest `main` and merge `main` again before asking for review. Stale
  branches usually conflict and can fail CI (for example the `ethnum` fix in #110).
- Include before/after notes and the evidence the issue asks for (test output, bundle
  sizes, testnet transaction hashes).
- Keep the repo's patterns:
  - user-facing text in both `src/i18n/locales/es.ts` and `en.ts`;
  - `formatAmount` / `formatDate` from `src/lib/format.ts`, not `toFixed` or raw `Intl`;
  - on-chain reads through the hooks in `src/lib/chainData.ts`, no polling;
  - no `@privy-io/*` imports outside the Privy layer.
- Contract changes: run `cargo test`, `cargo fmt --check` and
  `cargo clippy --all-targets -- -D warnings`. If you change a stored struct or key, explain
  what happens to existing entries in `docs/contracts/migration.md`.

## Checks to run locally

```bash
npm test
npm run lint
npm run build
npm run test:e2e   # if you touched login, wallet or data loading
```

`main` already has some TypeScript and lint errors. Your PR must not add new ones.

## Review

The maintainer reviews against the issue's acceptance criteria. Changes are requested in
the PR. A PR that is not updated, or that was opened without assignment, may be closed.
