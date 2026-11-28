import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "https://127.0.0.1:17382",
    trace: "retain-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /ink\.spec/ },
    { name: "iphone-webkit", use: { ...devices["iPhone 13"] }, testIgnore: /ink\.spec/ },
    // Pencil ink: iPad viewport with touch, synthetic pen pointer events, rotated in-test.
    { name: "ipad-webkit", use: { ...devices["iPad Pro 11"] }, testMatch: /ink\.spec/ },
  ],
  webServer: {
    command: "npx tsx tests/helpers/browser-server.mts",
    url: "https://127.0.0.1:17382",
    timeout: 120_000,
    reuseExistingServer: false,
    ignoreHTTPSErrors: true,
  },
});
