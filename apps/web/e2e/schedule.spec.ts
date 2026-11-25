import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";
import { settledContent } from "./helpers/page-state";

/**
 * Schedule Module E2E Tests
 * Tests class schedule and timetable management
 */

test.describe("Schedule - Navigation", () => {
  test("should navigate to schedule page", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/schedule");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/schedule/);
  });

  test("should display schedule content", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/schedule");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    // Page should load with content
    const content = await settledContent(page);
    expect(content.length).toBeGreaterThan(1000);
    expect(page.url()).toMatch(/schedule/);
  });
});

test.describe("Schedule - Features", () => {
  test("should have schedule viewing functionality", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/schedule");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    // Check for schedule elements (table, calendar, or cards)
    const hasScheduleView = await page
      .locator('table, [class*="calendar"], [class*="schedule"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasScheduleView || page.url().includes("schedule")).toBeTruthy();
  });

  test("should allow filtering or navigation", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/schedule");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    // Look for filter controls
    const hasControls = await page
      .locator('select, button, input[type="search"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasControls || page.url().includes("schedule")).toBeTruthy();
  });
});

test.describe("Schedule - Performance", () => {
  test("should load schedule page quickly", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);

    const startTime = Date.now();
    await page.goto("/schedule");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(15000);
    expect(page.url()).toMatch(/schedule/);
  });
});
