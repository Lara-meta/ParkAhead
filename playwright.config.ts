import { defineConfig, devices } from "@playwright/test";
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const production = process.env.E2E_PRODUCTION === "1";
const port = Number(new URL(baseURL).port || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid test port.");
export default defineConfig({
  testDir: "tests/e2e",
  expect: { timeout: 15000 },
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: production
      ? `npm run start -- --hostname localhost --port ${port}`
      : "npm run dev",
    url: baseURL,
    reuseExistingServer: production ? false : !process.env.CI,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
