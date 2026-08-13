import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: process.env.FRONTEND_BASE_URL ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    browserName: "chromium",
    ...devices["Desktop Chrome"],
  },
  webServer: process.env.FRONTEND_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1 --port 4173",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: true,
        timeout: 30_000,
      },
});
