import { defineConfig, devices } from "@playwright/test";

/**
 * Config for the zoom benchmark only (tests/e2e/perf). The default config ignores this folder so
 * `npm run test:e2e` stays fast. Each run starts its own dev server: reuseExistingServer is false so
 * the benchmark can never silently measure a different checkout that is already serving on 5173.
 */
export default defineConfig({
  testDir: "./tests/e2e/perf",
  outputDir: "./test-results/playwright-perf",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60 * 1000,
  reporter: [["line"]],
  use: { baseURL: "http://127.0.0.1:5173", trace: "off", screenshot: "off", video: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 90 * 1000,
  },
});
