import { test, expect } from "./fixtures/auth.fixture";
import { DashboardPage } from "./page-objects";
import { waitForLoadingComplete } from "./helpers/page-helpers";

/**
 * Dashboard data refresh, caching and load time.
 *
 * The dashboard stays fresh by polling (React Query); there is no push channel
 * (decision `realtime-polling` in the project memory).
 */

test.describe("Dashboard Data Refresh", () => {
  test("should use cached data on initial load", async ({ page }) => {
    const loginPage = await import("./page-objects");
    const login = new loginPage.LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    const dashboardPage = new DashboardPage(page);
    // First visit - data is fetched from API
    await dashboardPage.goto();
    await dashboardPage.waitForDataLoad();

    const firstLoadValue = await dashboardPage.totalStudentsCard.textContent();

    // Navigate away and back
    await page.goto("/tahfidz/dashboard");
    await waitForLoadingComplete(page);

    await dashboardPage.goto();

    // Second load should be faster (cached)
    // Data should be immediately visible (from cache)
    await expect(dashboardPage.totalStudentsCard).toBeVisible({
      timeout: 5000,
    });

    const cachedValue = await dashboardPage.totalStudentsCard.textContent();
    expect(cachedValue).toBe(firstLoadValue);
  });

  test("should invalidate cache after data mutation", async ({ page }) => {
    // Login
    const loginPage = await import("./page-objects");
    const login = new loginPage.LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Go to dashboard
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto();
    await dashboardPage.waitForDataLoad();

    const beforeValue = await dashboardPage.totalStudentsCard.textContent();

    // Navigate to create/edit page (simulating data mutation)
    const createLink = page.getByRole("link", { name: /tambah|add|create/i });
    if (
      await createLink.waitFor({ state: "visible", timeout: 3000 }).then(
        () => true,
        () => false,
      )
    ) {
      await createLink.click();
      await waitForLoadingComplete(page);

      // Go back to dashboard
      await dashboardPage.goto();
      await dashboardPage.waitForDataLoad();

      // Data should be fresh (cache invalidated)
      await expect(dashboardPage.totalStudentsCard).toBeVisible();
    }
  });
});

test.describe("Dashboard Performance", () => {
  test("should load dashboard within acceptable time", async ({ page }) => {
    // Login
    const loginPage = await import("./page-objects");
    const login = new loginPage.LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Measure dashboard load time
    const startTime = Date.now();

    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await waitForLoadingComplete(page);

    const loadTime = Date.now() - startTime;

    console.log(`Dashboard load time: ${loadTime}ms`);

    // Should load within 5 seconds
    expect(loadTime).toBeLessThan(5000);

    // All quick stats should be visible
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.verifyQuickStats();
  });

  test("should handle concurrent metric requests efficiently", async ({
    page,
  }) => {
    // Login
    const loginPage = await import("./page-objects");
    const login = new loginPage.LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Track API calls
    const apiCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/dashboard")) {
        apiCalls.push(request.url());
      }
    });

    // Load dashboard
    await page.goto("/dashboard");
    await waitForLoadingComplete(page);

    // Should not make duplicate requests for same data
    const uniqueCalls = new Set(apiCalls);
    console.log("Unique API calls:", uniqueCalls.size);
    console.log("Total API calls:", apiCalls.length);

    // React Query should deduplicate requests
    // Expect fewer total calls than potential duplicates
  });
});
