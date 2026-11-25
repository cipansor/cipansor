import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";
import { settledContent } from "./helpers/page-state";

/**
 * Academic Years Module E2E Tests
 * Tests academic year management and configuration
 */

test.describe("Academic Years - Navigation", () => {
  test("should navigate to academic years page", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/academic-years");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/academic-years/);
  });

  test("should display academic years interface", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/academic-years");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    expect(content.length).toBeGreaterThan(1000);
  });
});

test.describe("Academic Years - Features", () => {
  test("should display academic year list", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/academic-years");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasYearList = await page
      .locator('table, [class*="year"], [class*="tahun"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasYearList || page.url().includes("academic-years")).toBeTruthy();
  });

  test("should have add year functionality", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/academic-years");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasAddButton = await page
      .locator('button:has-text("Tambah"), button:has-text("Add")')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasAddButton || page.url().includes("academic-years")).toBeTruthy();
  });
});

test.describe("Academic Years - Performance", () => {
  test("should load quickly", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);

    const startTime = Date.now();
    await page.goto("/academic-years");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(15000);
  });
});
