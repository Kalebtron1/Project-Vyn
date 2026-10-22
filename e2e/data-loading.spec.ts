/**
 * On-chain data is read once, cached, and refreshed only after user actions.
 * Before, the home screen re-requested credit, score, balance and history every 5–15 s.
 */

import type { Page } from "@playwright/test";
import { test, expect } from "../playwright-fixture";
import { ONBOARDED_KEY, PROVIDER_KEY, WALLET_KEY, stubCreditApi } from "./helpers";
import { e2ePrivyKeypair } from "./mocks/privy-wallet";

const SOROBAN_RPC = /soroban-testnet\.stellar\.org/;

async function trackApiCalls(page: Page): Promise<() => Record<string, number>> {
  const counts: Record<string, number> = { credit: 0, score: 0, rpc: 0, horizon: 0 };
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/get-available-credit")) counts.credit += 1;
    else if (url.includes("/api/calculate-score")) counts.score += 1;
    else if (SOROBAN_RPC.test(url)) counts.rpc += 1;
    else if (url.includes("horizon-testnet")) counts.horizon += 1;
  });
  return () => ({ ...counts });
}

// A valid Stellar address, so the app really calls Soroban RPC and Horizon (the shared
// E2E_WALLET fixture has a bad checksum and the SDK rejects it before any request).
const VALID_WALLET = e2ePrivyKeypair().publicKey();

async function seedValidWalletSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ wallet, keys }) => {
      localStorage.setItem(keys.wallet, wallet);
      localStorage.setItem(keys.provider, "freighter");
      localStorage.setItem(keys.onboarded, "1");
    },
    { wallet: VALID_WALLET, keys: { wallet: WALLET_KEY, provider: PROVIDER_KEY, onboarded: ONBOARDED_KEY } }
  );
}

async function isolate(page: Page): Promise<void> {
  // Keep the run offline and deterministic: chain reads fail fast (cards fall back to 0).
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await stubCreditApi(page);
}

test.describe("On-chain data loading", () => {
  test("shows a loading state while the first data arrives", async ({ page }) => {
    await isolate(page);
    // Slow chain + API so the loading state is observable.
    await page.route(SOROBAN_RPC, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.abort();
    });
    await page.route("**/api/get-available-credit", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, availableCredit: 0, tierName: "Bronce", tier: 0 }),
      });
    });
    await seedValidWalletSession(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("chain-syncing")).toBeVisible();
    await expect(page.getByTestId("balance-loading")).toBeVisible();

    await expect(page.getByTestId("balance-amount")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("chain-syncing")).toBeHidden({ timeout: 20_000 });
  });

  test("home reads each piece of data once and does not poll", async ({ page }) => {
    test.setTimeout(60_000);
    await isolate(page);
    const counts = await trackApiCalls(page);
    await seedValidWalletSession(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("open-deposit")).toBeVisible();
    await expect(page.getByTestId("chain-syncing")).toBeHidden({ timeout: 20_000 });

    const settled = counts();
    expect(settled.rpc).toBeGreaterThan(0);
    // Credit was requested by three cards and score by two; each is now read once.
    expect(settled.credit).toBe(1);
    expect(settled.score).toBe(1);

    // The old code re-requested every 5–15 s; nothing should happen now.
    await page.waitForTimeout(17_000);
    expect(counts()).toEqual(settled);
  });

  test("coming back to home uses the cache instead of reloading", async ({ page }) => {
    await isolate(page);
    const counts = await trackApiCalls(page);
    await seedValidWalletSession(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("open-deposit")).toBeVisible();
    await expect(page.getByTestId("chain-syncing")).toBeHidden({ timeout: 20_000 });
    const settled = counts();

    await page.getByRole("button", { name: /^(Historial|History)$/ }).first().click();
    await expect(page).toHaveURL(/\/historial$/);
    await page.getByRole("button", { name: /^(Inicio|Home)$/ }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("balance-amount")).toBeVisible();

    await page.waitForTimeout(1_000);
    expect(counts().credit).toBe(settled.credit);
    expect(counts().score).toBe(settled.score);
  });
});
