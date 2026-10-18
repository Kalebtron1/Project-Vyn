# PR Test Checklist — Closes #2

Onboarding, login, and wallet connection flow validation.
Test environment: desktop browser, clean localStorage (`localStorage.clear()` before each run).

---

## 1. Fresh user — full happy path

| Step | Expected | Pass/Fail |
|------|----------|-----------|
| Visit `/` with empty localStorage | Redirected to `/bienvenida` | |
| Step through all 3 onboarding slides | Slides advance, dots update | |
| Tap "¡Vamos allá!" on last slide | Redirected to `/login` (not `/`) | |
| Tap "Conectar con Freighter" (extension installed) | Freighter popup opens | |
| Approve in Freighter | Redirected to `/`, wallet address shown in header | |

---

## 2. Fresh user — skip onboarding

| Step | Expected | Pass/Fail |
|------|----------|-----------|
| Visit `/bienvenida`, tap "Omitir" | Redirected to `/login` | |
| Connect wallet | Lands on `/` successfully | |

---

## 3. Already logged in — no re-login loop

| Step | Expected | Pass/Fail |
|------|----------|-----------|
| With wallet in localStorage, visit `/login` | Immediately redirected to `/` | |

---

## 4. Error state — rejected signature

| Step | Expected | Pass/Fail |
|------|----------|-----------|
| Tap connect, then reject in Freighter | Error banner appears: "Conexión cancelada. Puedes intentarlo de nuevo cuando quieras." | |
| Tap connect again | Flow retries cleanly, no stale error | |

---

## 5. Error state — missing wallet (desktop, no Freighter)

| Step | Expected | Pass/Fail |
|------|----------|-----------|
| Open `/login` on desktop without Freighter installed | "Freighter no detectado" warning shown, Albedo fallback button visible | |
| Tap "Continuar con Albedo (web)" | Albedo popup opens | |
| Approve in Albedo | Redirected to `/` successfully | |

---

## 6. Error state — disconnected wallet (Freighter removed after login)

| Step | Expected | Pass/Fail |
|------|----------|-----------|
| Set `vinculo_wallet` and `vinculo_wallet_provider=freighter` in localStorage, then disable/remove Freighter extension | Amber "Wallet desconectada" banner visible on `/` | |
| Tap "Reconectar" in banner | Redirected to `/login`, localStorage cleared | |

---

## 7. WalletSetupModal — no Freighter on desktop

| Step | Expected | Pass/Fail |
|------|----------|-----------|
| Trigger WalletSetupModal without Freighter | Amber warning shown + Albedo connect button (no dead-end error) | |
| Connect via Albedo | Address shown, "Guardar" button appears | |
| Tap "Guardar" | Modal closes, wallet saved to profile | |
| Tap "Después" | Modal closes, can reopen later | |

---

## 8. No blocking console errors

| Step | Expected | Pass/Fail |
|------|----------|-----------|
| Run through flows 1–7 with DevTools open | Zero `TypeError`, `Uncaught`, or unhandled promise rejections in console | |

---

## 9. i18n / locale coverage (English + Spanish)

| Step | Expected | Pass/Fail |
|------|----------|-----------|
| Switch language to English via the language toggle | All UI strings update to English — no key paths (e.g. `wallet_setup.error_generic`) visible in the UI | |
| On `/login`, reject Freighter connection | English error banner shows a human-readable sentence (not a key path) | |
| On `/login`, trigger popup-blocked error (block pop-ups in browser settings) | English message: "The popup was blocked. Allow pop-ups for this site and try again." | |
| Switch to Spanish, navigate to `/perfil` | NFT mint button shows "Nivel máximo alcanzado" (with accent), not "Nivel maximo alcanzado" | |
| With Spanish active, trigger NFT mint connection error | Toast title shows "Conexión inestable" (with accent), not "Conexion inestable" | |
| Navigate to a non-existent route (e.g. `/xyz`) with Spanish active | 404 page shows "¡Ups! Página no encontrada" (Spanish), not English text | |
| On `/` with wallet disconnected and English active | Banner description reads "Your wallet is not available. Make sure Freighter is installed and unlocked, or use the reconnect button." | |
| Open DevTools console — filter for missing key warnings | No i18next "missing key" warnings for `wallet_setup.*`, `not_found.*`, or `profile.mint_button_max_tier` | |

---

---

## Screenshots / clips

Attach success and error state screenshots below before merging.
