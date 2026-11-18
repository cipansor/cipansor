import { test, expect } from "@playwright/test";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  adoptRotatedSession,
  apiLogin,
  injectSession,
  SEED_USERS,
} from "./helpers/auth-api";

/**
 * Regression for #1144.
 *
 * The two tests in this file run on two Playwright workers (CI: 2). Before the
 * fix every worker read ONE cached session per role from `.auth/sessions.json`,
 * so they shared a single refresh token — and the API rotates that token on
 * first use, deleting the presented row. Whichever worker refreshed first
 * revoked the session for the other, whose next `/auth/refresh` answered 401,
 * cleared every cookie and bounced it to `/login`.
 *
 * Each test here forces a refresh. With a per-worker session both refreshes
 * answer 200; with a shared session the second one does not.
 */
test.describe("session isolation between workers (#1144)", () => {
  for (const label of ["worker-a", "worker-b"]) {
    test(`${label}: a refresh keeps this worker's own session`, async ({
      page,
      context,
    }) => {
      const email = SEED_USERS.superAdmin.email;
      const session = await apiLogin(SEED_USERS.superAdmin);
      await injectSession(page, session);

      await page.goto("/dashboard");
      await expect(page).toHaveURL(/dashboard/);

      // Drop the access cookie so the next load must refresh, the way the
      // 15-minute access cookie passing does in a long run.
      await context.clearCookies({ name: ACCESS_COOKIE });

      const refreshed = page.waitForResponse((r) =>
        r.url().endsWith("/auth/refresh"),
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      expect((await refreshed).status()).toBe(200);

      // Still signed in: the dashboard settled, not the login screen.
      await expect(page).toHaveURL(/dashboard/);
      await expect(page.locator("#main-content")).toBeVisible();

      // The browser just rotated the worker's refresh token; carry the new one
      // back into the cache so a `--repeat-each` pass (or a retry) starts from
      // a live token rather than the one this test just spent.
      const cookies = await context.cookies();
      adoptRotatedSession(email, {
        accessToken: cookies.find((c) => c.name === ACCESS_COOKIE)!.value,
        refreshToken: cookies.find((c) => c.name === REFRESH_COOKIE)!.value,
      });
    });
  }
});
