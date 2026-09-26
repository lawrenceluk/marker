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
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone-webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: "npx tsx tests/helpers/browser-server.mts",
    url: "https://127.0.0.1:17382",
    timeout: 120_000,
    reuseExistingServer: false,
    ignoreHTTPSErrors: true,
  },
});
