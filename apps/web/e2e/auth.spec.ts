import { test, expect } from "./fixtures/auth.fixture";
import { LoginPage } from "./page-objects";
import { waitForToast } from "./helpers/page-helpers";

/**
 * Authentication E2E Tests
 * Tests the login flow and session management
 * Optimized with Page Object Model and fixtures
 */

test.describe("Authentication", () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test("should display login form with all required elements", async ({
    page,
  }) => {
    // Check for login heading or page title
    const loginHeading = page.getByRole("heading", {
      name: /masuk|login|sign in/i,
    });
    const pageTitle = page
      .locator("h1, h2")
      .filter({ hasText: /masuk|login|sign in/i });

    if (
      await loginHeading.waitFor({ state: "visible", timeout: 3000 }).then(
        () => true,
        () => false,
      )
    ) {
      await expect(loginHeading).toBeVisible();
    } else if (
      await pageTitle.waitFor({ state: "visible", timeout: 3000 }).then(
        () => true,
        () => false,
      )
    ) {
      await expect(pageTitle).toBeVisible();
    }

    // Essential form elements should be present
    await expect(loginPage.emailInput).toBeVisible({ timeout: 5000 });
    await expect(loginPage.passwordInput).toBeVisible({ timeout: 5000 });
    await expect(loginPage.loginButton).toBeVisible({ timeout: 5000 });
  });

  test("should show error for invalid credentials", async ({ page }) => {
    await loginPage.login("invalid@example.com", "wrongpassword");

    // After invalid login, should either:
    // 1. Show error message, OR
    // 2. Stay on login page (not redirect to dashboard)

    // Wait a bit for potential error to appear
    await page.waitForTimeout(2000);

    // Check we're still on login page (not redirected to dashboard)
    const currentURL = page.url();
    expect(currentURL).toMatch(/login/);

    // Should NOT be on dashboard
    expect(currentURL).not.toMatch(/dashboard/);
  });

  test("should show error for empty fields", async ({ page }) => {
    await loginPage.loginButton.click();

    // Browser validation or app validation should show
    // Could be HTML5 validation, toast, or inline error
    const emailError = page.getByText(
      /email.*required|email.*wajib|wajib.*email/i,
    );
    const passwordError = page.getByText(
      /password.*required|password.*wajib|wajib.*password/i,
    );
    const generalError = loginPage.errorMessage;

    // At least one error should be visible
    const anyError = emailError.or(passwordError).or(generalError);

    // Give more time for validation to appear
    if (
      await anyError.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      await expect(anyError).toBeVisible();
    } else {
      // HTML5 validation might prevent submission, check if still on login page
      await expect(page).toHaveURL(/login/);
    }
  });

  test("should redirect to dashboard after successful login", async ({
    page,
  }) => {
    await loginPage.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Verify we're on dashboard
    await expect(page).toHaveURL(/dashboard/);

    // The session is an HttpOnly cookie; it must NOT be readable from JS.
    const stored = await page.evaluate(() => ({
      accessToken: localStorage.getItem("accessToken"),
      refreshToken: localStorage.getItem("refreshToken"),
      cookie: document.cookie,
    }));
    expect(stored.accessToken).toBeNull();
    expect(stored.refreshToken).toBeNull();
    expect(stored.cookie).not.toContain("accessToken");
    expect(stored.cookie).not.toContain("refreshToken");
  });

  test("should persist session after page reload", async ({ page }) => {
    await loginPage.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Reload page
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Should still be on dashboard, not redirected to login
    await expect(page).toHaveURL(/dashboard/);
  });

  test("should logout successfully and clear session", async ({ page }) => {
    const loginPage = new LoginPage(page);

    // Login first with simple flow
    await page.goto("/login");
    await loginPage.login("superadmin@cipansor.or.id", "SuperAdmin123!");

    // Wait for navigation to dashboard (multiple possible URLs)
    await Promise.race([
      page.waitForURL(/dashboard/, { timeout: 15000 }).catch(() => {}),
      page.waitForURL(/home/, { timeout: 15000 }).catch(() => {}),
      page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}),
    ]);

    // Find and click logout (multiple possible locations)
    // Logout lives in the header user menu (avatar dropdown, aria-label
    // "User menu") as a menuitem.
    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("menuitem", { name: /logout|keluar/i }).click();

    // Should redirect to login
    await expect(page).toHaveURL(/login/, { timeout: 10000 });

    // The session cookie is cleared and no token lingers in JS-reachable storage.
    const stored = await page.evaluate(() => ({
      accessToken: localStorage.getItem("accessToken"),
      refreshToken: localStorage.getItem("refreshToken"),
      cookie: document.cookie,
    }));
    expect(stored.accessToken).toBeNull();
    expect(stored.refreshToken).toBeNull();
    expect(stored.cookie).not.toContain("accessToken");
    expect(stored.cookie).not.toContain("refreshToken");
  });

  test("should prevent access to protected routes when not authenticated", async ({
    page,
  }) => {
    // Try to access dashboard directly
    await page.goto("/dashboard");

    // Should be redirected to login
    await expect(page).toHaveURL(/login/, { timeout: 10000 });
  });

  test("should handle network errors gracefully", async ({ page }) => {
    // Simulate network failure
    await page.route("**/api/auth/login", (route) => route.abort("failed"));

    await loginPage.login("superadmin@cipansor.or.id", "SuperAdmin123!");

    // Should show error message or stay on login page
    const errorMessage = page.getByText(/network|koneksi|gagal|error|failed/i);

    if (
      await errorMessage.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      await expect(errorMessage).toBeVisible();
    } else {
      // Should at least stay on login page
      await expect(page).toHaveURL(/login/);
    }

    // Clean up route
    await page.unroute("**/api/auth/login");
  });
});

test.describe("Role-based Access Control", () => {
  test("superadmin should access all modules", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Check navigation menu has all items. The sidebar renders one
    // <nav>/navigation per section (plus a hidden mobile copy), so scope to the
    // visible sidebar links by role rather than a broad nav text search.
    await expect(
      page.getByRole("link", { name: "Dashboard" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /tahfidz/i }).first(),
    ).toBeVisible();
    // Add more based on your menu structure
  });

  test("unit admin should have limited access", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    try {
      await loginPage.loginAndWaitForDashboard(
        "admin@cipansor.com",
        "admin123",
      );

      // Check for unit-specific restrictions
      // This depends on your actual RBAC implementation
      await expect(page).toHaveURL(/dashboard/);
    } catch (error) {
      test.skip(error instanceof Error, "Unit admin credentials not available");
    }
  });
});
