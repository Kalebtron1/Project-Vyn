import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Project Vyn E2E tests.
 *
 * Run: npm run test:e2e
 * UI:  npm run test:e2e:ui
 *
 * The webServer boots Vite with `VITE_E2E=1`, which aliases Privy to a local
 * stub (see e2e/mocks). Wallet flows under test seed session keys in
 * localStorage instead of talking to Freighter/Privy.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    // Privy/analytics can keep the window "load" event from firing.
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_E2E: "1",
      VITE_PRIVY_APP_ID: "e2e-stub",
      VITE_LENDING_CONTRACT_ID:
        process.env.VITE_LENDING_CONTRACT_ID ||
        "CDLZFC3SYJYDZT7K67BXO2J2P5P7XH4X7K5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q",
      VITE_STAKING_CONTRACT_ID:
        process.env.VITE_STAKING_CONTRACT_ID ||
        "CDLZFC3SYJYDZT7K67BXO2J2P5P7XH4X7K5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q",
    },
  },
});
