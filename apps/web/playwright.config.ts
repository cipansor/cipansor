import { defineConfig, devices } from "@playwright/test";
import path from "path";

/**
 * Playwright E2E Test Configuration for Cipansor Web App
 * Optimized for performance, reliability, and best practices
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./e2e",

  /* Global Setup & Teardown */
  globalSetup: require.resolve("./e2e/global-setup"),
  globalTeardown: require.resolve("./e2e/global-teardown"),

  /* Test Organization */
  testMatch: "**/*.spec.ts",
  // Ignore debug specs and the screenshot/verification utilities — the latter
  // are tooling (they write gallery images and aren't product tests);
  // crash-sweep.spec.ts covers page-crash detection instead.
  testIgnore: [
    "**/debug-*.spec.ts",
    "**/generate-screenshots.spec.ts",
    "**/verify-screenshots.spec.ts",
    "**/verify_reception.spec.ts",
    "**/_*.spec.ts",
  ],

  /* Parallel Execution */
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4, // More workers locally for speed
  forbidOnly: !!process.env.CI,

  /* Retry Strategy */
  retries: process.env.CI ? 2 : 1, // Retry once locally for flaky tests

  /* Timeouts - Optimized for faster execution */
  timeout: 30000, // 30s per test (reduced from 60s)
  expect: {
    timeout: 8000, // 8s for assertions (reduced from 10s)
  },

  /* Output */
  outputDir: "./test-results",

  /* Reporters */
  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
    ["junit", { outputFile: "test-results/junit.xml" }],
    ["list"], // Console output
    ...(process.env.CI ? [["github", {}] as const] : []), // GitHub Actions annotations
  ],

  /* Shared settings for all projects */
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",

    /* Tracing */
    trace: process.env.CI ? "retain-on-failure" : "on-first-retry",

    /* Screenshots */
    screenshot: "only-on-failure",

    /* Videos */
    video: process.env.CI ? "retain-on-failure" : "off",

    /* Action timeout - Optimized */
    actionTimeout: 10000, // 10s for actions (reduced from 15s)

    /* Navigation timeout - Optimized */
    navigationTimeout: 20000, // 20s for navigation (reduced from 30s)

    /* Locale & Timezone */
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",

    /* Viewport */
    viewport: { width: 1920, height: 1080 },

    /* Additional context options */
    ignoreHTTPSErrors: true,

    /* Storage state path */
    // storageState: 'playwright/.auth/superAdmin.json', // Use per-project
  },

  /* Configure projects for different browsers and scenarios */
  projects: [
    // Setup project - runs first
    {
      name: "setup",
      testMatch: /global-setup\.ts/,
    },

    // Chromium - Primary browser
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Pre-authenticated state for faster tests
        // storageState: 'playwright/.auth/superAdmin.json',
        // Constrained sandboxes may ship a pre-installed Chromium whose build
        // differs from the one this Playwright version would download. When
        // PW_CHROMIUM_EXECUTABLE_PATH is set, launch that binary instead of
        // downloading. Unset in CI, so CI behaviour is unchanged.
        ...(process.env.PW_CHROMIUM_EXECUTABLE_PATH
          ? {
              launchOptions: {
                executablePath: process.env.PW_CHROMIUM_EXECUTABLE_PATH,
              },
            }
          : {}),
      },
      dependencies: ["setup"],
    },

    // Firefox - Cross-browser testing.
    // Secondary browsers run markedly slower than Chromium under CI load
    // (full-matrix runs take 25-30 min), so heavy integration flows can
    // exceed the 30s default — give them more headroom to avoid slow-run
    // flakes without weakening any assertion.
    {
      name: "firefox",
      timeout: 60_000,
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: {
          firefoxUserPrefs: {
            // On CI Linux (no NetworkManager) Firefox reports
            // navigator.onLine=false and fires offline events, which pauses
            // every React Query request (networkMode "online") and shows the
            // offline banner — tests then fail on pages that never load data.
            "network.manage-offline-status": false,
          },
        },
      },
      dependencies: ["setup"],
    },

    // Webkit (Safari) - Cross-browser testing. Slowest engine under CI load;
    // give it the same extended per-test timeout as Firefox.
    {
      name: "webkit",
      timeout: 60_000,
      use: {
        ...devices["Desktop Safari"],
      },
      dependencies: ["setup"],
    },

    // Mobile Chrome
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
      },
      dependencies: ["setup"],
    },

    // Mobile Safari
    {
      name: "mobile-safari",
      use: {
        ...devices["iPhone 13"],
      },
      dependencies: ["setup"],
    },
  ],

  /* Run the web server before tests. In CI we serve the production build
   * (fast, deterministic per-route — dev mode compiles on demand and is slow
   * and flaky). Locally we use the dev server and reuse an already-running one. */
  webServer: {
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 240 * 1000, // 4 minutes for server startup
    stdout: "pipe", // Capture server logs
    stderr: "pipe",
    // `next start` honours the PORT env var. In CI the job sets PORT=3001 for
    // the API, which would make the web server try to bind 3001 too
    // (EADDRINUSE). Pin the web server to 3000 regardless of the inherited PORT.
    env: { PORT: "3000" },
  },
});
