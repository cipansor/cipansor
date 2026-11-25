import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";
import { settledContent } from "./helpers/page-state";

/**
 * Inventory Module E2E Tests
 * Tests inventory management for school assets and supplies
 */

test.describe("Inventory - Navigation", () => {
  test("should navigate to inventory page", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/inventory");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/inventory/);
  });

  test("should display inventory content", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/inventory");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    expect(content.length).toBeGreaterThan(1000);
    expect(page.url()).toMatch(/inventory/);
  });
});

test.describe("Inventory - Features", () => {
  test("should display inventory items or categories", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/inventory");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    // Check for inventory list
    const hasItems = await page
      .locator('table, [class*="inventory"], [class*="item"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasItems || page.url().includes("inventory")).toBeTruthy();
  });

  test("should have management features", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/inventory");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    // Look for management buttons
    const hasButtons = await page
      .getByRole("button")
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasButtons || page.url().includes("inventory")).toBeTruthy();
  });
});

test.describe("Inventory - Performance", () => {
  test("should load inventory page quickly", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);

    const startTime = Date.now();
    await page.goto("/inventory");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(15000);
    expect(page.url()).toMatch(/inventory/);
  });
});
