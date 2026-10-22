---
tags: [integration, external]
updated: 2026-10-22
files:
  - backend/contracts/vinculo_sbt/src/lib.rs
  - metadata/
  - src/components/NFTModal.tsx
  - src/components/ActivityList.tsx
  - src/pages/Historial.tsx
  - src/index.css
  - vite.config.ts
---

# Other external services

Smaller dependencies that are easy to miss. None of them needs an environment variable.

## StellarExpert (block explorer)

Links of the form `https://stellar.expert/explorer/testnet/tx/<hash>` let users open a
transaction: deposit success (`DepositModal`), SBT mint (`NFTModal`), activity rows
(`ActivityList`, `Historial`), and a general link in Ayuda. Testnet is hard-coded in the URL.
If StellarExpert is down only the links break.

## SBT metadata on GitHub (`token_uri`)

`vinculo_sbt.token_uri(user)` returns a URL to a JSON file in a **third-party repository**
from the hackathon (`raw.githubusercontent.com/YORCH12/Stellar-Hack-vinculo-credito/...`),
one per tier. The URLs are compiled into the contract, so changing them needs a redeploy
(the contract has no upgrade function).

Checked on 2026-10-22:

- `plata.json` and its image answer `200`.
- **`bronce.json` (tier 0) answers `404`**: it doesn't exist there, nor in this repo's
  `metadata/` folder (which has plata, oro, diamante and platino only).
- The metadata still says "Vínculo", lists the credit benefit in XLM and points
  `external_url` to a domain that is not the project's.

The app itself doesn't read `token_uri`: `NFTModal` shows local images from
`public/images/`. Only wallets or explorers that read SEP-style metadata would see these
files. If they matter, host them in this repo (or the app's domain) and redeploy the SBT.

`src/stellar/nft-metadata.json` describes a different, older mint interface and is not
imported anywhere.

## Google Fonts

`src/index.css` imports the **Inter** font from `fonts.googleapis.com`. The CSP in
`vercel.json` allows `https:` styles and fonts, so it loads in production. If it fails, the
browser falls back to the next font in the stack.

## Lovable

The project started from a Lovable template (March 2026). `lovable-tagger` still runs as a
Vite plugin in development mode only (`componentTagger()` in `vite.config.ts`); it is not in
production builds. `.lovable/memory/index.md` is the old Lovable design memory and is out
of date (it describes an app called "Vin" and other tier names).

## Related

- [Integrations overview](overview.md)
