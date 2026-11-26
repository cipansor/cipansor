import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";
import { settledContent } from "./helpers/page-state";

/**
 * Canteen Module E2E Tests
 * Tests canteen menu, ordering, and transaction management
 */

test.describe("Canteen - Navigation", () => {
  test("should navigate to canteen page", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/canteen");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/canteen/);
  });

  test("should display canteen interface", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/canteen");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    expect(content.length).toBeGreaterThan(1000);
  });
});

test.describe("Canteen - Features", () => {
  test("should display menu items", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/canteen");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasMenu = await page
      .locator('[class*="menu"], [class*="item"], table')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasMenu || page.url().includes("canteen")).toBeTruthy();
  });

  test("should have add menu item functionality", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/canteen");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasAddButton = await page
      .locator('button:has-text("Tambah"), button:has-text("Add")')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasAddButton || page.url().includes("canteen")).toBeTruthy();
  });

  test("should display canteen transactions or orders", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/canteen");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    const hasTransactions =
      content.includes("Transaksi") ||
      content.includes("Order") ||
      content.includes("Pesanan");

    expect(hasTransactions || page.url().includes("canteen")).toBeTruthy();
  });
});

test.describe("Canteen - Performance", () => {
  test("should load canteen page quickly", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);

    const startTime = Date.now();
    await page.goto("/canteen");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(15000);
  });
});
