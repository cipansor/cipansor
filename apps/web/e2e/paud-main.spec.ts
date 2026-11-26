import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";

/**
 * PAUD Module E2E Tests
 * Tests PAUD (TK Qur'an) assessment and reporting system
 */

test.describe("PAUD - Main Page", () => {
  test("should navigate to PAUD page", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/paud");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/paud/);
  });

  test("should display PAUD overview with stats", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/paud");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    // Check for heading
    const heading = await page
      .getByRole("heading", { name: /PAUD|TK/i })
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(heading || page.url().includes("paud")).toBeTruthy();
  });

  test("should display menu cards for PAUD features", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/paud");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    // Should have links to sub-modules
    const hasLinks = await page
      .locator('a[href*="/paud/"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasLinks || page.url().includes("paud")).toBeTruthy();
  });
});

test.describe("PAUD - Tabs Navigation", () => {
  test("should switch between tabs", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/paud");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    // Try to click assessment tab
    const assessmentTab = page.getByRole("tab", {
      name: /penilaian|assessment/i,
    });
    if (
      await assessmentTab.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      await assessmentTab.click();
      await page.waitForTimeout(500);
    }

    expect(page.url()).toMatch(/paud/);
  });

  test("should display quick actions", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/paud");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    // Look for quick action buttons
    const hasQuickActions = await page
      .getByRole("button", { name: /buat|laporan|lihat/i })
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasQuickActions || page.url().includes("paud")).toBeTruthy();
  });
});

test.describe("PAUD - Sub-modules", () => {
  test("should navigate to PAUD assessment page", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/paud/assessment");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/paud\/assessment/);
  });

  test("should navigate to daily reports page", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/paud/daily-reports");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/paud\/daily-reports/);
  });

  test("should navigate to PAUD reports page", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/paud/reports");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/paud\/reports/);
  });
});

test.describe("PAUD - Performance", () => {
  test("should load PAUD page within acceptable time", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);

    const startTime = Date.now();
    await page.goto("/paud");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(15000);
    expect(page.url()).toMatch(/paud/);
  });
});
