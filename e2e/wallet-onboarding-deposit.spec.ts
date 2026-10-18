/**
 * E2E #49: onboarding → home → deposit method picker.
 * Does not open Freighter/Privy or sign on-chain.
 */

import { test, expect } from "../playwright-fixture";
import { seedWalletSession, stubCreditApi } from "./helpers";

test.describe("Wallet flow: onboarding → deposit", () => {
  test.beforeEach(async ({ page }) => {
    await stubCreditApi(page);
    await seedWalletSession(page, { onboarded: false });
  });

  test("completes onboarding and opens the deposit method modal", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/bienvenida/);
    await expect(page.getByTestId("onboarding-cta")).toBeVisible();

    await page.getByTestId("onboarding-cta").click();
    await page.getByTestId("onboarding-cta").click();
    await expect(page.getByTestId("onboarding-cta")).toContainText(/vamos|let'?s go/i);
    await page.getByTestId("onboarding-cta").click();

    await expect(page.getByTestId("open-deposit")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/$/);

    await page.getByTestId("open-deposit").click();
    await expect(page.getByTestId("deposit-method-title")).toBeVisible();
  });
});
