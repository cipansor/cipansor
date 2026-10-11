import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Vitest configuration for the web app.
 *
 * Three projects run under a single `pnpm --filter web test`:
 *  - `unit`      — jsdom + React Testing Library for `src/**` (components,
 *                  hooks, and pure helpers like `lib/rbac.ts`).
 *  - `e2e-utils` — node env for the Playwright helper/fixture unit tests.
 *  - `scripts`   — node env for the visual-QA sweep helpers (`scripts/lib/*`),
 *                  whose session/route plumbing a browser run cannot cheaply
 *                  exercise on its own.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@/e2e": path.resolve(__dirname, "./e2e"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          globals: true,
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "e2e-utils",
          globals: true,
          environment: "node",
          include: ["e2e/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "scripts",
          globals: true,
          environment: "node",
          include: ["scripts/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "src/**",
        "e2e/helpers/**",
        "e2e/fixtures/**",
        "scripts/lib/**",
      ],
    },
  },
});
