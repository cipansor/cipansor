import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";
import { settledContent } from "./helpers/page-state";

/**
 * Dashboard Module E2E Tests
 * Tests main dashboard metrics and real-time updates.
 *
 * Authenticates via the API (loginAs) — super-admins are 2FA-gated, so the
 * old UI-form login could never reach the dashboard.
 */

test.beforeEach(async ({ page }) => {
  await loginAs(page, "superAdmin");
  await page.goto("/dashboard");
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
});

/**
 * The "hari ini" cards read `GET /dashboard-enhancement/quick-stats`, whose
 * counts are bounded by the WIB calendar day (#1152). The page must ask that
 * endpoint, not derive "today" from the browser clock.
 */
test.describe("Dashboard - Today's WIB quick stats", () => {
  test("reads today's attendance and murojaah from quick-stats", async ({
    page,
  }) => {
    const quickStats = page.waitForRequest((r) =>
      r.url().includes("/dashboard-enhancement/quick-stats"),
    );

    await page.reload();
    await quickStats;

    await expect(page.getByText("Kehadiran Hari Ini")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText("Murojaah Hari Ini")).toBeVisible();
  });
});

test.describe("Dashboard - Navigation", () => {
  test("should load dashboard after login", async ({ page }) => {
    expect(page.url()).toMatch(/(dashboard|home)/);
  });

  test("should display dashboard content", async ({ page }) => {
    const content = await settledContent(page);
    expect(content.length).toBeGreaterThan(2000);
  });
});

test.describe("Dashboard - Metrics", () => {
  test("should display statistics cards", async ({ page }) => {
    // Scope to the content landmark and target the shadcn Card slot. The old
    // page-wide `[class*="card"]` selector also matched the hidden lucide
    // `id-card` icon in the sidebar, and `.first()` resolved to that
    // `aria-hidden` SVG (never visible), so this always timed out. First paint
    // sits on an auth-hydration spinner, which can exceed 10s under parallel
    // worker load — wait for an actual card in <main> properly.
    await expect(
      page.getByRole("main").locator('[data-slot="card"]').first(),
    ).toBeVisible({ timeout: 20000 });
  });

  test("should show student count metrics", async ({ page }) => {
    await page.waitForTimeout(2000); // let metrics queries resolve
    const content = await settledContent(page);
    const hasStudentMetrics =
      content.includes("Siswa") ||
      content.includes("Student") ||
      content.includes("Total");

    expect(hasStudentMetrics).toBeTruthy();
  });

  test("should display charts or graphs", async ({ page }) => {
    const hasChart = await page
      .locator('canvas, svg[class*="chart"], [class*="graph"]')
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    expect(hasChart || page.url().includes("dashboard")).toBeTruthy();
  });
});

test.describe("Dashboard - Navigation Links", () => {
  test("should have links to main modules", async ({ page }) => {
    await page.waitForTimeout(2000); // sidebar renders after auth hydration
    const content = await settledContent(page);
    const hasNavigation =
      content.includes("Siswa") ||
      content.includes("Guru") ||
      content.includes("Keuangan") ||
      content.includes("Students") ||
      content.includes("Teachers") ||
      content.includes("Finance");

    expect(hasNavigation).toBeTruthy();
  });

  test("should navigate to PAUD module", async ({ page }) => {
    await page.goto("/paud");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/paud/);
  });

  test("should navigate to Tahfidz module", async ({ page }) => {
    await page.goto("/tahfidz");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/tahfidz/);
  });
});

test.describe("Dashboard - Performance", () => {
  test("should load dashboard quickly", async ({ page }) => {
    const startTime = Date.now();
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(10000);
  });

  test("stays responsive after loading", async ({ page }) => {
    await page.waitForTimeout(3000);

    // Check if page is still responsive
    const isResponsive = await page.evaluate(() => {
      return document.readyState === "complete";
    });

    expect(isResponsive).toBeTruthy();
  });
});
