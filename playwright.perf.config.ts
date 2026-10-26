import { defineConfig, devices } from "@playwright/test";

/**
 * Clypra Performance Benchmark Playwright Configuration
 *
 * Runs ONLY the specs under tests/e2e/perf/. These measure wheel-zoom frame
 * deltas, spring settle times, and ruler render cost on a live dev server.
 *
 * Usage:
 *   npm run test:perf                 # run all perf specs (headless)
 *   npm run test:perf -- --headed     # headed, useful for debugging
 *   npm run test:perf -- --project=chromium --grep "zoom-bench"
 *
 * Output:
 *   test-results/perf/              JSON timing files (written by the spec)
 *   test-results/playwright-perf/   Playwright trace / screenshots on failure
 *
 * These specs are intentionally excluded from the default playwright.config.ts
 * and from all CI jobs. Run them manually on the machine you want to measure.
 * Label all numbers "Observed on <OS> <DPR> <GPU>" and never claim cross-platform
 * parity from a single run.
 *
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./tests/e2e/perf",
  outputDir: "./test-results/playwright-perf",
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/perf/summary.json" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 60 * 1000,
  },
});
