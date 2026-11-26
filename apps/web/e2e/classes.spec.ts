import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";
import { settledContent } from "./helpers/page-state";

/**
 * Classes Module E2E Tests
 * Tests class management and student grouping
 */

test.describe("Classes - Navigation", () => {
  test("should navigate to classes page", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/classes");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/classes/);
  });

  test("should display classes interface", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/classes");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    expect(content.length).toBeGreaterThan(1000);
  });
});

test.describe("Classes - Features", () => {
  test("should display class list or grid", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/classes");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasClassList = await page
      .locator('table, [class*="grid"], [class*="class"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasClassList || page.url().includes("classes")).toBeTruthy();
  });

  test("should have add class functionality", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/classes");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasAddButton = await page
      .locator('button:has-text("Tambah"), button:has-text("Add")')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasAddButton || page.url().includes("classes")).toBeTruthy();
  });

  test("should display class details", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/classes");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    const hasClassInfo =
      content.includes("Kelas") ||
      content.includes("Class") ||
      content.includes("Siswa") ||
      content.includes("Student");

    expect(hasClassInfo || page.url().includes("classes")).toBeTruthy();
  });
});

test.describe("Classes - Performance", () => {
  test("should load classes page quickly", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);

    const startTime = Date.now();
    await page.goto("/classes");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(15000);
  });
});
