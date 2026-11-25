import { test, expect } from "./fixtures/auth.fixture";
import { TahfidzDashboardPage } from "./page-objects";
import { waitForLoadingComplete } from "./helpers/page-helpers";

/**
 * Tahfidz Dashboard E2E Tests
 * Tests Murojaah Analytics and Tahfidz tracking features
 * Optimized with Page Object Model and reusable helpers
 */

test.describe("Tahfidz Dashboard", () => {
  let tahfidzPage: TahfidzDashboardPage;

  test.beforeEach(async ({ page }) => {
    // Login as superadmin
    const loginPage = await import("./page-objects");
    const login = new loginPage.LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Navigate to Tahfidz Dashboard
    tahfidzPage = new TahfidzDashboardPage(page);
    await tahfidzPage.goto();
    await tahfidzPage.waitForDataLoad();
  });

  test("should display all dashboard components", async () => {
    // Verify main heading
    await expect(tahfidzPage.heading).toBeVisible({ timeout: 10000 });

    // Verify summary cards
    await expect(tahfidzPage.totalRecordsCard).toBeVisible({ timeout: 10000 });
    await expect(tahfidzPage.activeSantriCard).toBeVisible();
    await expect(tahfidzPage.totalJuzCard).toBeVisible();

    // Verify chart sections
    await expect(tahfidzPage.recordTypeChart).toBeVisible();
    await expect(tahfidzPage.topSantriSection).toBeVisible();
    await expect(tahfidzPage.progressPerJuzSection).toBeVisible();
  });

  test("should display catatan per tipe (record type chart)", async ({
    page,
  }) => {
    void page;
    await expect(tahfidzPage.recordTypeChart).toBeVisible({ timeout: 10000 });

    // Chart should be rendered (check for canvas or SVG)
    const chartContainer = tahfidzPage.recordTypeChart.locator("..");
    const hasChart = await chartContainer.locator("canvas, svg").count();
    expect(hasChart).toBeGreaterThan(0);
  });

  test("should display top 10 santri section", async () => {
    await expect(tahfidzPage.topSantriSection).toBeVisible({ timeout: 10000 });

    // The section renders the santri it ranked, not an empty placeholder.
    await expect(tahfidzPage.topSantriSection).not.toHaveText("");
  });

  test("should display progress per juz", async () => {
    await expect(tahfidzPage.progressPerJuzSection).toBeVisible({
      timeout: 10000,
    });

    // Should show progress bars or chart
    const section = tahfidzPage.progressPerJuzSection.locator("..");
    const hasProgress = await section
      .locator('canvas, svg, [role="progressbar"]')
      .count();
    expect(hasProgress).toBeGreaterThan(0);
  });

  test("should filter by unit", async ({ page }) => {
    // Wait for initial data load
    await waitForLoadingComplete(page);
    await expect(tahfidzPage.totalRecordsCard).toBeVisible({ timeout: 10000 });

    // Select a unit
    const unitSelect = page
      .locator('button[role="combobox"]')
      .filter({ hasText: /semua unit|unit/i })
      .first();

    await expect(unitSelect).toBeVisible({ timeout: 5000 });
    await unitSelect.click();

    // Select first real unit (skip "Semua Unit")
    const firstOption = page.getByRole("option").nth(1);
    await expect(firstOption).toBeVisible();
    await firstOption.click();

    // Wait for data to reload
    await waitForLoadingComplete(page);

    // Data should still be visible (stats may change)
    await expect(tahfidzPage.heading).toBeVisible();
    await expect(tahfidzPage.totalRecordsCard).toBeVisible();
  });

  test("should display recent records table", async ({ page }) => {
    const recentSection = page.getByText(/catatan terbaru/i).first();
    await expect(recentSection).toBeVisible({ timeout: 10000 });

    // Check if table exists
    const table = page
      .locator("table")
      .filter({ hasText: /catatan terbaru|santri|tanggal/i });
    const hasTable = await table.count();

    if (hasTable > 0) {
      // Table has headers
      const headers = table.locator("thead th");
      await expect(headers.first()).toBeVisible();
    }
  });

  test("should display recent record rows with data", async ({ page }) => {
    // This test used to click the first row and assert that a modal opened or
    // the URL changed. Neither is implemented — the recent-records table is a
    // read-only summary — and the assertion only ever passed because the table
    // was empty and the test skipped itself. Now that the seed creates tahfidz
    // records, it asserts what the table actually does: render them.
    const firstRow = page.locator("table tbody tr").first();
    const hasRows = await firstRow
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    if (!hasRows) {
      throw new Error(
        "No tahfidz records seeded — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
      return;
    }

    const cells = firstRow.locator("td");
    expect(await cells.count()).toBeGreaterThan(1);
    await expect(firstRow).not.toBeEmpty();
  });

  test("should reset filters and keep the data visible", async ({ page }) => {
    // The dashboard offers Reset (back to the current month, every unit), not
    // a refresh button — the queries re-run when the filters change.
    const resetButton = page.getByRole("button", { name: /^reset$/i });
    await expect(resetButton).toBeVisible({ timeout: 10000 });
    await resetButton.click();
    await waitForLoadingComplete(page);
    await expect(tahfidzPage.heading).toBeVisible();
  });

  test("should display monthly activity chart", async ({ page }) => {
    const monthlyActivity = page
      .getByText(/aktivitas bulanan|monthly activity/i)
      .first();
    await expect(monthlyActivity).toBeVisible({ timeout: 10000 });

    // Should have chart element
    const chartSection = monthlyActivity.locator("..");
    const chart = chartSection.locator("canvas, svg");
    const hasChart = await chart.count();
    expect(hasChart).toBeGreaterThan(0);
  });
});
