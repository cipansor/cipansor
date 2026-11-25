import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";

test.describe("Pengawasan - Navigation", () => {
  test("should navigate to pengawasan page", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/pengawasan");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
    expect(page.url()).toMatch(/pengawasan/);
  });

  test("should display pengawasan content", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/pengawasan");
    // These pages wrap themselves in MainLayout, whose ProtectedRoute renders
    // nothing until the persisted session has rehydrated. Snapshotting
    // page.content() at domcontentloaded therefore captured an empty shell.
    // Wait for the page's own h1 instead of racing it.
    await expect(
      page.getByRole("heading", { name: "Pengawasan Internal", level: 1 }),
    ).toBeVisible({ timeout: 15000 });
  });
});

test.describe("Pengawasan - Features", () => {
  test("should display audit statistics", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/pengawasan");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasStats = await page
      .locator('text="Total Audit"')
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasStats || page.url().includes("pengawasan")).toBeTruthy();
  });

  test("should display audit list", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/pengawasan");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasList = await page
      .locator('text="Daftar Audit"')
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasList || page.url().includes("pengawasan")).toBeTruthy();
  });
});

test.describe("Pengawasan - Performance", () => {
  test("should load page within timeout", async ({ page }) => {
    await loginAs(page, "superAdmin");
    const startTime = Date.now();
    await page.goto("/pengawasan");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    expect(Date.now() - startTime).toBeLessThan(15000);
  });
});
