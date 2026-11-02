import { expect, test, type Page } from "@playwright/test";
import { seedWalletSession, stubCreditApi } from "./helpers";

async function openHelp(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await stubCreditApi(page);
  await seedWalletSession(page);
  await page.goto("/ayuda");
  await expect(page.getByTestId("help-testnet-notice")).toBeVisible();
}

test.describe("Help center", () => {
  test("search ignores accents and opens the matching answers", async ({ page }) => {
    await openHelp(page);
    await expect(page.getByTestId("help-category")).toHaveCount(6);

    await page.getByRole("searchbox").fill("frase semilla");
    await expect(page.getByTestId("help-category").first()).toContainText(/Nunca|Never/);

    await page.getByRole("searchbox").fill("palabrainexistente");
    await expect(page.getByTestId("help-no-results")).toBeVisible();
    await expect(page.getByTestId("help-contact")).toBeVisible();
  });

  test("an answer can take you to the right screen", async ({ page }) => {
    await openHelp(page);
    await page.getByRole("searchbox").fill("retiro ahorro");
    await page.getByRole("link", { name: /^(Ir a Retiros|Go to Withdrawals)$/ }).click();
    await expect(page).toHaveURL(/\/retiros$/);
  });

  test("support details never include secrets", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "Clipboard permissions are Chromium only");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openHelp(page);
    await page.getByRole("button", { name: /(soporte|support)$/ }).click();

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("Stellar Testnet");
    expect(copied).not.toMatch(/\bS[A-Z2-7]{55}\b/);
  });
});
