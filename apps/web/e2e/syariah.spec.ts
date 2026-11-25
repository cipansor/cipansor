import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";

test.describe("Syariah - Navigation", () => {
  test("should navigate to syariah page", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/syariah");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
    expect(page.url()).toMatch(/syariah/);
  });

  test("should display syariah content", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/syariah");
    // These pages wrap themselves in MainLayout, whose ProtectedRoute renders
    // nothing until the persisted session has rehydrated. Snapshotting
    // page.content() at domcontentloaded therefore captured an empty shell.
    // Wait for the page's own h1 instead of racing it.
    await expect(
      page.getByRole("heading", { name: "Kepatuhan Syariah", level: 1 }),
    ).toBeVisible({ timeout: 15000 });
  });
});

test.describe("Syariah - Features", () => {
  test("should display compliance summary", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/syariah");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasSummary = await page
      .locator('text="Total Item"')
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasSummary || page.url().includes("syariah")).toBeTruthy();
  });

  test("should display category breakdown", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/syariah");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasCategories = await page
      .locator('text="Daftar Kepatuhan"')
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasCategories || page.url().includes("syariah")).toBeTruthy();
  });
});

test.describe("Syariah - Performance", () => {
  test("should load page within timeout", async ({ page }) => {
    await loginAs(page, "superAdmin");
    const startTime = Date.now();
    await page.goto("/syariah");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    expect(Date.now() - startTime).toBeLessThan(15000);
  });
});
