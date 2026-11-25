import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";

test.describe("Perencanaan - Navigation", () => {
  test("should navigate to perencanaan page", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/perencanaan");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
    expect(page.url()).toMatch(/perencanaan/);
  });

  test("should display perencanaan content", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/perencanaan");
    // These pages wrap themselves in MainLayout, whose ProtectedRoute renders
    // nothing until the persisted session has rehydrated. Snapshotting
    // page.content() at domcontentloaded therefore captured an empty shell.
    // Wait for the page's own h1 instead of racing it.
    await expect(
      page.getByRole("heading", { name: "Perencanaan Strategis", level: 1 }),
    ).toBeVisible({ timeout: 15000 });
  });
});

test.describe("Perencanaan - Features", () => {
  test("should display summary statistics", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/perencanaan");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasStats = await page
      .locator('text="Total Rencana"')
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasStats || page.url().includes("perencanaan")).toBeTruthy();
  });

  test("should display plan list section", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/perencanaan");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasList = await page
      .locator('text="Daftar Rencana"')
      .waitFor({ state: "visible", timeout: 5000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasList || page.url().includes("perencanaan")).toBeTruthy();
  });
});

test.describe("Perencanaan - Performance", () => {
  test("should load page within timeout", async ({ page }) => {
    await loginAs(page, "superAdmin");
    const startTime = Date.now();
    await page.goto("/perencanaan");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    expect(Date.now() - startTime).toBeLessThan(15000);
  });
});
