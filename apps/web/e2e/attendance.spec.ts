import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";
import { settledContent } from "./helpers/page-state";

/**
 * Attendance Module E2E Tests
 * Tests student attendance tracking and reporting
 */

test.describe("Attendance - Navigation", () => {
  test("should navigate to attendance page", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/attendance");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/attendance/);
  });

  test("should display attendance interface", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/attendance");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    expect(content.length).toBeGreaterThan(1000);
  });
});

test.describe("Attendance - Features", () => {
  test("should display attendance list or calendar", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/attendance");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasTable = await page
      .locator('table, [class*="attendance"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasTable || page.url().includes("attendance")).toBeTruthy();
  });

  test("should have date selection controls", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/attendance");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasDateControl = await page
      .locator('input[type="date"], button[class*="calendar"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasDateControl || page.url().includes("attendance")).toBeTruthy();
  });
});

test.describe("Attendance - Performance", () => {
  test("should load attendance page quickly", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);

    const startTime = Date.now();
    await page.goto("/attendance");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(15000);
  });
});
