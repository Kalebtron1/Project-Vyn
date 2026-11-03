import { expect, test, type Page } from "@playwright/test";
import { seedWalletSession, stubCreditApi } from "./helpers";

async function reachClabe(page: Page, status: string): Promise<void> {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await stubCreditApi(page);
  await page.route("**/api/onramp?action=quote", (route) =>
    route.fulfill({ json: { receiverUsd: 27, rateMxnPerUsd: 18.5, flatFeeUsd: 0.5, partnerFeeUsd: 0 } })
  );
  await page.route("**/api/onramp?action=payin", (route) =>
    route.fulfill({ json: { payinId: "pi_test", clabe: "646180000000000000", receiverUsd: 27, status: "processing" } })
  );
  await page.route("**/api/onramp?action=status*", (route) => route.fulfill({ json: { payinId: "pi_test", status } }));
  await seedWalletSession(page);
  await page.goto("/depositar");
  await page.getByRole("button", { name: /(Generar CLABE|Generate)/ }).click();
}

test.describe("SPEI deposit", () => {
  test("explains the limit when the deposit is over the cap", async ({ page }) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await stubCreditApi(page);
    await page.route("**/api/onramp?action=quote", (route) =>
      route.fulfill({ status: 400, json: { reason: "payin_cap", maxUsd: 100, error: "over" } })
    );
    await seedWalletSession(page);
    await page.goto("/depositar");
    await expect(page.getByText(/(máximo por depósito|maximum per deposit)/)).toBeVisible();
  });

  test("waits for BlindPay and offers no way to skip the confirmation", async ({ page }) => {
    await reachClabe(page, "processing");
    await expect(page.getByText("646180000000000000")).toBeVisible();
    await expect(page.getByText(/30 (segundos|seconds)/)).toBeVisible();
    await expect(page.getByRole("button", { name: /(Simular|Simulate)/ })).toHaveCount(0);
  });

  for (const status of ["failed", "refunded"]) {
    test(`stops waiting when the payin is ${status}`, async ({ page }) => {
      let settleCalled = false;
      await page.route("**/api/onramp?action=settle", (route) => {
        settleCalled = true;
        return route.fulfill({ json: { settled: false } });
      });
      await reachClabe(page, status);
      await expect(page.getByRole("button", { name: /(Intentar de nuevo|Try again)/ })).toBeVisible({ timeout: 20_000 });
      expect(settleCalled).toBe(false);
    });
  }
});
