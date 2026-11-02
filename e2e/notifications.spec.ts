import { expect, test, type Page } from "@playwright/test";
import { E2E_WALLET, seedWalletSession, stubCreditApi } from "./helpers";

// Valor por defecto de VITE_STAKING_CONTRACT_ID en playwright.config.ts.
const STAKING = "CDLZFC3SYJYDZT7K67BXO2J2P5P7XH4X7K5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q";

const depositOperation = {
  id: "101",
  type: "invoke_host_function",
  transaction_hash: "abc",
  created_at: "2026-11-02T10:00:00Z",
  asset_balance_changes: [
    { type: "transfer", asset_type: "credit_alphanum4", asset_code: "USDC", from: E2E_WALLET, to: STAKING, amount: "12.5" },
  ],
};

async function isolate(page: Page, records: unknown[] | "fail"): Promise<void> {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await stubCreditApi(page);
  await page.route(/horizon-testnet.*operations/, (route) =>
    records === "fail"
      ? route.abort()
      : route.fulfill({ json: { _embedded: { records } } })
  );
}

// Una wallet que ya usó la bandeja antes de este depósito: el depósito es novedad.
async function seedInbox(page: Page): Promise<void> {
  await page.addInitScript((wallet) => {
    const key = `vinculo_notifications_${wallet}`;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({ readBefore: 0, readIds: [], dismissedIds: [] }));
    }
  }, E2E_WALLET);
}

test.describe("Notifications", () => {
  test("shows no invented notifications for a wallet without activity", async ({ page }) => {
    await isolate(page, []);
    await seedWalletSession(page);
    await page.goto("/notificaciones");

    await expect(page.getByTestId("notifications-empty")).toBeVisible();
    await expect(page.getByTestId("notification")).toHaveCount(0);
    await expect(page.getByTestId("unread-dot")).toHaveCount(0);
    await expect(page.getByText(/50 USDC/)).toHaveCount(0);
  });

  test("shows a real deposit, and read state survives a reload", async ({ page }) => {
    await isolate(page, [depositOperation]);
    await seedWalletSession(page);
    await seedInbox(page);
    await page.goto("/");

    await expect(page.getByTestId("unread-dot")).toBeVisible();

    await page.goto("/notificaciones");
    const row = page.getByTestId("notification");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/12[.,]5 USDC/);
    await expect(row).toHaveAttribute("data-unread", "true");

    await row.getByRole("button").first().click();
    await expect(row).toHaveAttribute("data-unread", "false");
    await expect(page.getByTestId("unread-dot")).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("notification")).toHaveAttribute("data-unread", "false");
  });

  test("previous history is not new the first time", async ({ page }) => {
    await isolate(page, [depositOperation]);
    await seedWalletSession(page);
    await page.goto("/notificaciones");

    await expect(page.getByTestId("notification")).toHaveAttribute("data-unread", "false");
    await expect(page.getByTestId("unread-dot")).toHaveCount(0);
  });

  test("a deleted notification stays deleted", async ({ page }) => {
    await isolate(page, [depositOperation]);
    await seedWalletSession(page);
    await seedInbox(page);
    await page.goto("/notificaciones");

    await page.getByRole("button", { name: /^(Borrar aviso|Delete notification)$/ }).click();
    await expect(page.getByTestId("notifications-empty")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("notifications-empty")).toBeVisible();
  });

  test("a failed read says so instead of showing an empty inbox", async ({ page }) => {
    await isolate(page, "fail");
    await seedWalletSession(page);
    await page.goto("/notificaciones");

    await expect(page.getByTestId("notifications-error")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("notifications-empty")).toHaveCount(0);
  });
});
