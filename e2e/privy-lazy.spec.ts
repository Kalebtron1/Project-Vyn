/**
 * E2E #131: Privy loads only for email sessions and /login.
 * Privy is the local stub (see e2e/mocks), which behaves like an email session.
 */

import type { Page } from "@playwright/test";
import { test, expect } from "../playwright-fixture";
import { E2E_WALLET, ONBOARDED_KEY, PROVIDER_KEY, WALLET_KEY, seedWalletSession, stubCreditApi } from "./helpers";
import {
  E2E_PRIVY_AUTH_KEY,
  E2E_PRIVY_GOOGLE_KEY,
  E2E_PRIVY_GOOGLE_TAKEN_KEY,
  E2E_PRIVY_LOGIN_FAILURE_KEY,
  E2E_PRIVY_READY_DELAY_KEY,
  e2ePrivyKeypair,
} from "./mocks/privy-wallet";

const PRIVY_WALLET = e2ePrivyKeypair().publicKey();

/** Any request for the Privy layer or the Privy SDK (stubbed in E2E). */
const isPrivyRequest = (url: string) => /PrivyLayer|mocks\/privy/.test(url);

async function isolate(page: Page): Promise<string[]> {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  // Only the local dev server: no Horizon, Friendbot or analytics.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.route("**/api/onramp**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  );
  await stubCreditApi(page);
  return requests;
}

async function seedStorage(page: Page, values: Record<string, string>): Promise<void> {
  await page.addInitScript((entries) => {
    // Only seed once per test, so reloads keep whatever the app wrote.
    if (sessionStorage.getItem("e2e_seeded")) return;
    sessionStorage.setItem("e2e_seeded", "1");
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, values);
}

function seedPrivySession(page: Page, extra: Record<string, string> = {}): Promise<void> {
  return seedStorage(page, {
    [WALLET_KEY]: PRIVY_WALLET,
    [PROVIDER_KEY]: "privy",
    [ONBOARDED_KEY]: "1",
    [E2E_PRIVY_AUTH_KEY]: "1",
    ...extra,
  });
}

const privyCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __e2ePrivyCalls?: string[] }).__e2ePrivyCalls ?? []);

const signThroughPrivy = (page: Page, address: string) =>
  page.evaluate(async (addr) => {
    const mod = await import(/* @vite-ignore */ "/e2e/support/privy-sign-check.ts");
    return mod.signThroughPrivy(addr);
  }, address);

test.describe("Privy loads on demand", () => {
  test("a wallet session never downloads Privy", async ({ page }) => {
    const requests = await isolate(page);
    await seedWalletSession(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("open-deposit")).toBeVisible();
    await page.goto("/perfil", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /Abrir wallet|Open wallet/ })).toBeVisible();
    await page.waitForTimeout(1_000);

    expect(requests.filter(isPrivyRequest)).toEqual([]);
  });

  test("/login loads Privy and an early email login still enters the app", async ({ page }) => {
    const requests = await isolate(page);
    // Privy takes a moment to get ready, so the click below lands before it is.
    await seedStorage(page, { [E2E_PRIVY_READY_DELAY_KEY]: "800" });

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByTestId("login-email").click();

    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    await expect(page.getByTestId("open-deposit")).toBeVisible();
    expect(requests.some(isPrivyRequest)).toBe(true);
    expect(await privyCalls(page)).toContain("login");
    expect(await page.evaluate((key) => localStorage.getItem(key), PROVIDER_KEY)).toBe("privy");
    expect(await page.evaluate((key) => localStorage.getItem(key), WALLET_KEY)).toBe(PRIVY_WALLET);
  });

  test("a failing login method shows why, and closing the modal resets the button", async ({ page }) => {
    await isolate(page);
    await seedStorage(page, { [E2E_PRIVY_LOGIN_FAILURE_KEY]: "Login with Google not allowed" });

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByTestId("login-email").click();

    await expect(page.getByText("Login with Google not allowed")).toBeVisible();
    await expect(page.getByTestId("login-email")).toBeDisabled();

    await page.evaluate(() => (window as unknown as { __e2ePrivyCloseModal: () => void }).__e2ePrivyCloseModal());
    await expect(page.getByTestId("login-email")).toBeEnabled();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("an email session survives a reload and signs right away", async ({ page }) => {
    await isolate(page);
    await seedPrivySession(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("open-deposit")).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    // Sign before Privy has finished loading: privySign must wait, not fail.
    const result = await signThroughPrivy(page, PRIVY_WALLET);
    expect(result).toEqual({ signatures: 1, valid: true });
    expect(await privyCalls(page)).toContain("signRawHash");
  });

  test("export opens Privy and logout ends the Privy session", async ({ page }) => {
    await isolate(page);
    await seedPrivySession(page);

    await page.goto("/perfil", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Abrir wallet|Open wallet/ }).click();
    await expect.poll(() => privyCalls(page)).toContain("exportWallet");

    await page.getByRole("button", { name: /Cerrar sesión|Log out/ }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expect.poll(() => privyCalls(page)).toContain("logout");
    expect(await page.evaluate((key) => localStorage.getItem(key), E2E_PRIVY_AUTH_KEY)).toBeNull();

    // Privy must not log the user back in on /login.
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/login$/);
  });

  test("an email account turns on fingerprint sign-in from Perfil", async ({ page }) => {
    await isolate(page);
    await seedPrivySession(page);

    await page.goto("/perfil", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("access-methods-card");
    await card.getByRole("button", { name: /Activar acceso con huella|Turn on fingerprint sign-in/ }).click();

    await expect.poll(() => privyCalls(page)).toContain("linkPasskey");
    await expect(card.getByText(/Acceso con huella activado|Fingerprint sign-in is on/)).toBeVisible();
    await expect(card.getByRole("button", { name: /Agregar en otro dispositivo|Add another device/ })).toBeVisible();
  });

  test("a wallet session does not offer sign-in methods", async ({ page }) => {
    await isolate(page);
    await seedWalletSession(page);

    await page.goto("/perfil", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /Abrir wallet|Open wallet/ })).toBeVisible();
    await expect(page.getByTestId("access-methods-card")).toHaveCount(0);
  });

  test("linking Google hides the button, also after a reload", async ({ page }) => {
    await isolate(page);
    await seedPrivySession(page);

    await page.goto("/perfil", { waitUntil: "domcontentloaded" });
    await page.getByTestId("link-google").click();

    await expect.poll(() => privyCalls(page)).toContain("linkGoogle");
    await expect(page.getByTestId("google-linked")).toBeVisible();
    await expect(page.getByTestId("link-google")).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("google-linked")).toBeVisible();
    await expect(page.getByTestId("link-google")).toHaveCount(0);
  });

  test("an account with Google linked never shows the button while Privy loads", async ({ page }) => {
    await isolate(page);
    await seedPrivySession(page, { [E2E_PRIVY_GOOGLE_KEY]: "1", [E2E_PRIVY_READY_DELAY_KEY]: "1500" });
    // Record every time the button shows up, even briefly.
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="link-google"]')) {
          (window as unknown as { __sawLinkGoogle?: boolean }).__sawLinkGoogle = true;
        }
      }).observe(document, { childList: true, subtree: true });
    });

    await page.goto("/perfil", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("access-methods-card")).toBeVisible();
    await expect(page.getByTestId("google-linked")).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { __sawLinkGoogle?: boolean }).__sawLinkGoogle ?? false)
    ).toBe(false);
  });

  test("a Google account that belongs to another Vyn account shows a clear message", async ({ page }) => {
    await isolate(page);
    await seedPrivySession(page, { [E2E_PRIVY_GOOGLE_TAKEN_KEY]: "1" });

    await page.goto("/perfil", { waitUntil: "domcontentloaded" });
    await page.getByTestId("link-google").click();

    await expect(
      page.getByText(/ya está registrada como otra cuenta de Vyn|already registered as a different Vyn account/).first()
    ).toBeVisible();
    await expect(page.getByTestId("link-google")).toBeEnabled();
    await expect(page.getByTestId("google-linked")).toHaveCount(0);
  });

  test("a leftover Privy session does not log a wallet user back in", async ({ page }) => {
    const requests = await isolate(page);
    await seedStorage(page, {
      [WALLET_KEY]: E2E_WALLET,
      [PROVIDER_KEY]: "freighter",
      [ONBOARDED_KEY]: "1",
      [E2E_PRIVY_AUTH_KEY]: "1",
    });

    await page.goto("/perfil", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Cerrar sesión|Log out/ }).first().click();
    await expect(page).toHaveURL(/\/login$/);

    // Privy loads on /login, finds the old session and closes it instead of entering.
    await expect.poll(() => privyCalls(page)).toContain("logout");
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/login$/);
    expect(requests.some(isPrivyRequest)).toBe(true);
    expect(await page.evaluate((key) => localStorage.getItem(key), WALLET_KEY)).toBeNull();
  });
});
