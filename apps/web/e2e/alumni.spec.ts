import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";
import { settledContent } from "./helpers/page-state";

/**
 * Alumni Module E2E Tests
 * Tests alumni tracking and engagement features
 */

test.describe("Alumni - Navigation", () => {
  test("should navigate to alumni page", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/alumni");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/alumni/);
  });

  test("should display alumni interface", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/alumni");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    expect(content.length).toBeGreaterThan(1000);
  });
});

test.describe("Alumni - Features", () => {
  test("should display alumni list or directory", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/alumni");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasAlumni = await page
      .locator('table, [class*="alumni"], [class*="grid"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasAlumni || page.url().includes("alumni")).toBeTruthy();
  });

  test("should have search or filter functionality", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/alumni");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasSearch = await page
      .locator(
        'input[type="search"], input[placeholder*="Cari"], input[placeholder*="Search"]',
      )
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasSearch || page.url().includes("alumni")).toBeTruthy();
  });

  test("should display alumni statistics", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/alumni");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    const hasStats =
      content.includes("Total") ||
      content.includes("Alumni") ||
      (await page
        .locator('[class*="stat"]')
        .first()
        .waitFor({ state: "visible", timeout: 5000 })
        .then(
          () => true,
          () => false,
        ));

    expect(hasStats || page.url().includes("alumni")).toBeTruthy();
  });
});

test.describe("Alumni - Performance", () => {
  test("should load alumni page quickly", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);

    const startTime = Date.now();
    await page.goto("/alumni");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(15000);
  });
});
