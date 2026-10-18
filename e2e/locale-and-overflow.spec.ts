/**
 * E2E: locale persistence (#70) and mobile overflow (#72).
 */

import { test, expect } from "../playwright-fixture";
import { seedWalletSession, stubCreditApi } from "./helpers";

const LANGUAGE_KEY = "vinculo_language";

async function pageOverflows(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1;
  });
}

test.describe("Locale persistence", () => {
  test("keeps the selected language after reload and in a new tab", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "en", exact: true }).click();
    await expect(page.getByTestId("connect-wallet")).toContainText(/Connect wallet/i);

    const stored = await page.evaluate((key) => localStorage.getItem(key), LANGUAGE_KEY);
    expect(stored).toBe("en");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("connect-wallet")).toContainText(/Connect wallet/i);

    const second = await page.context().newPage();
    await second.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(second.getByTestId("connect-wallet")).toContainText(/Connect wallet/i);
    await second.close();
  });

  test("falls back to Spanish when the stored locale is invalid", async ({ page }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(key, "fr");
    }, LANGUAGE_KEY);

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("connect-wallet")).toContainText(/Conectar/i);
  });
});

test.describe("Translation overflow on mobile", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("login, onboarding, and home do not overflow in English", async ({ page }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(key, "en");
    }, LANGUAGE_KEY);

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("connect-wallet")).toBeVisible();
    expect(await pageOverflows(page)).toBe(false);

    await stubCreditApi(page);
    await seedWalletSession(page, { onboarded: false });
    await page.goto("/bienvenida", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("onboarding-cta")).toBeVisible();
    expect(await pageOverflows(page)).toBe(false);

    await seedWalletSession(page, { onboarded: true });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("open-deposit")).toBeVisible();
    expect(await pageOverflows(page)).toBe(false);

    const navOverflow = await page.evaluate(() => {
      const nav = document.querySelector("nav");
      return nav ? nav.scrollWidth > nav.clientWidth + 1 : false;
    });
    expect(navOverflow).toBe(false);
  });
});
