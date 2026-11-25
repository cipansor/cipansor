import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Authentication Fixture
 * Provides authenticated context for E2E tests
 */

export interface AuthUser {
  email: string;
  password: string;
  role: "SUPER_ADMIN" | "UNIT_ADMIN" | "TEACHER" | "STAFF";
  unitId?: string;
}

// Credentials below match prisma/seed.ts (the real seeded users), so e2e runs
// against the actual backend rather than mock data.
export const testUsers: Record<string, AuthUser> = {
  superAdmin: {
    email: "superadmin@cipansor.or.id",
    password: "SuperAdmin123!",
    role: "SUPER_ADMIN",
  },
  unitAdmin: {
    email: "admin.sdit@cipansor.or.id",
    password: "Admin123!",
    role: "UNIT_ADMIN",
  },
  teacher: {
    email: "fatimah@cipansor.or.id",
    password: "Teacher123!",
    role: "TEACHER",
  },
};

/**
 * Login helper function
 * @param page - Playwright page instance
 * @param user - User credentials
 */
export async function loginAsUser(page: Page, user: AuthUser) {
  await page.goto("/login");

  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password|kata sandi/i).fill(user.password);
  await page.getByRole("button", { name: /sign in|masuk|login/i }).click();

  // Admin accounts hit a 2FA challenge after the password step — complete it
  // through the UI with a TOTP from the fixed seed secret (E2E_FIXED_2FA=1).
  const otpInput = page.getByPlaceholder("123456");
  const needs2fa = await otpInput
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (needs2fa) {
    const { generate } = await import("otplib");
    const secret =
      process.env.E2E_2FA_SECRET || "NTGHH5U5LDHIYARFFNGFQKQHARJU7GBE";
    await otpInput.fill(await generate({ secret }));
    await page.getByRole("button", { name: "Verifikasi", exact: true }).click();
  }

  // Wait for redirect to dashboard
  await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });
  // domcontentloaded, not networkidle — long-lived connections keep the network
  // busy, so networkidle would always time out.
  await page.waitForLoadState("domcontentloaded");

  // The session lives in an HttpOnly cookie, so nothing token-like may appear
  // in the JS-reachable storage or cookies.
  const leaked = await page.evaluate(() => ({
    accessToken: localStorage.getItem("accessToken"),
    refreshToken: localStorage.getItem("refreshToken"),
    cookie: document.cookie,
  }));
  expect(leaked.accessToken).toBeNull();
  expect(leaked.refreshToken).toBeNull();
  expect(leaked.cookie).not.toContain("accessToken");
}

/**
 * Logout helper function
 */
export async function logout(page: Page) {
  // Try to find and click logout button
  const logoutButton = page
    .getByRole("button", { name: /logout|keluar/i })
    .first();

  if (
    await logoutButton.waitFor({ state: "visible", timeout: 3000 }).then(
      () => true,
      () => false,
    )
  ) {
    await logoutButton.click();
  }

  // Clear all storage
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // Verify redirect to login
  await expect(page).toHaveURL(/login/, { timeout: 5000 });
}

/**
 * Extended test fixture with authentication context
 */
export const test = base.extend<{
  authenticatedPage: Page;
  superAdminPage: Page;
  unitAdminPage: Page;
}>({
  authenticatedPage: async ({ page }, use) => {
    await loginAsUser(page, testUsers.superAdmin);
    await use(page);
    await logout(page);
  },

  superAdminPage: async ({ page }, use) => {
    await loginAsUser(page, testUsers.superAdmin);
    await use(page);
    await logout(page);
  },

  unitAdminPage: async ({ page }, use) => {
    await loginAsUser(page, testUsers.unitAdmin);
    await use(page);
    await logout(page);
  },
});

export { expect };
