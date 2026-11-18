import { FullConfig } from "@playwright/test";
import fs from "fs";
import path from "path";

/**
 * Global Teardown for E2E Tests
 * Runs once after all tests complete
 * - Cleanup temporary files
 * - Generate test summary
 */
async function globalTeardown(config: FullConfig) {
  console.log("🧹 Starting E2E Test Global Teardown...");

  // NOTE: .auth/ session/storageState files are deliberately KEPT (dir is
  // gitignored). global-setup revalidates the stored sessions by rotating them
  // against /auth/refresh on the next run and reuses the ones that still work —
  // deleting them here forced a fresh admin 2FA login on every run/iteration,
  // which trips the 2FA rate limiter (default 10/15min) during local iterative
  // runs.

  // Clean up old screenshots (keep only last 100)
  const screenshotsDir = path.join(__dirname, "../test-results/screenshots");
  if (fs.existsSync(screenshotsDir)) {
    const files = fs
      .readdirSync(screenshotsDir)
      .map((file) => ({
        name: file,
        path: path.join(screenshotsDir, file),
        time: fs.statSync(path.join(screenshotsDir, file)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    // Keep only last 100 screenshots
    if (files.length > 100) {
      for (const file of files.slice(100)) {
        fs.unlinkSync(file.path);
      }
      console.log(`✅ Cleaned up ${files.length - 100} old screenshots`);
    }
  }

  console.log("✅ Global teardown completed");
}

export default globalTeardown;
