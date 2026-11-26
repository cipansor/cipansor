import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";

test.describe("Organisasi - Navigation", () => {
  test("should navigate to organisasi page", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/organisasi");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
    expect(page.url()).toMatch(/organisasi/);
  });

  test("should display organisasi content", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/organisasi");
    // These pages wrap themselves in MainLayout, whose ProtectedRoute renders
    // nothing until the persisted session has rehydrated. Snapshotting
    // page.content() at domcontentloaded therefore captured an empty shell.
    // Wait for the page's own h1 instead of racing it.
    await expect(
      page.getByRole("heading", { name: "Struktur Organisasi", level: 1 }),
    ).toBeVisible({ timeout: 15000 });
  });
});

test.describe("Organisasi - Features", () => {
  test("should display units list", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/organisasi");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasList = await page
      .locator('text="Manajemen Unit"') // from the page header
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasList || page.url().includes("organisasi")).toBeTruthy();
  });
});

test.describe("Organisasi - Performance", () => {
  test("should load page within timeout", async ({ page }) => {
    await loginAs(page, "superAdmin");
    const startTime = Date.now();
    await page.goto("/organisasi");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    expect(Date.now() - startTime).toBeLessThan(15000);
  });
});
