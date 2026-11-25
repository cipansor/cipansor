import { test, expect } from "./fixtures/auth.fixture";
import { LoginPage } from "./page-objects";
import { gotoAuthedPage } from "./helpers/page-helpers";

/**
 * /lingkungan wraps itself in MainLayout, so nothing renders until
 * ProtectedRoute has rehydrated the session. Every test here used to sample the
 * page at domcontentloaded — via page.content(), or via
 * isVisible with a timeout, which does not actually wait — and so raced that
 * gate. It landed right on Chromium and Firefox and wrong on WebKit. Wait for
 * the page's own <h1> first, then assert against what the page really renders.
 */
const HEADING = "Kampus Hijau";

test.describe("Lingkungan - Navigation", () => {
  test.beforeEach(async ({ page }) => {
    const login = new LoginPage(page);
    await page.goto("/login");
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );
  });

  test("should navigate to lingkungan page", async ({ page }) => {
    await gotoAuthedPage(page, "/lingkungan", HEADING);
    expect(page.url()).toMatch(/lingkungan/);
  });

  test("should display lingkungan content", async ({ page }) => {
    await gotoAuthedPage(page, "/lingkungan", HEADING);
    await expect(
      page.getByRole("heading", { name: HEADING, level: 1 }),
    ).toBeVisible();
  });
});

test.describe("Lingkungan - Features", () => {
  test.beforeEach(async ({ page }) => {
    const login = new LoginPage(page);
    await page.goto("/login");
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );
    await gotoAuthedPage(page, "/lingkungan", HEADING);
  });

  test("should display environment programs", async ({ page }) => {
    // Matched by role: "Tambah Program Lingkungan" also exists as a DialogTitle
    // in the closed create dialog, and a bare text match would find that too.
    await expect(
      page.getByRole("tab", { name: "Program Lingkungan" }),
    ).toBeVisible();
  });

  test("should display waste management section", async ({ page }) => {
    const wasteTab = page.getByRole("tab", { name: "Pengelolaan Sampah" });
    await expect(wasteTab).toBeVisible();

    await wasteTab.click();
    // getByText, not getByRole("heading"): shadcn's CardTitle renders a plain
    // <div data-slot="card-title">, so it has no heading role to match.
    await expect(page.getByText("Berdasarkan Kategori")).toBeVisible();
  });

  test("should display the green campus indicators", async ({ page }) => {
    await expect(
      page.getByRole("tab", { name: "Indikator Green Campus" }),
    ).toBeVisible();
    await expect(page.getByText("Program Aktif")).toBeVisible();
  });
});

test.describe("Lingkungan - Performance", () => {
  test("should load page within timeout", async ({ page }) => {
    const login = new LoginPage(page);
    await page.goto("/login");
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Time to the heading being *visible*, not to domcontentloaded. The old
    // version measured a wait that had its own 15s timeout against a 15s
    // budget, so it could only fail by timing out inside the wait itself.
    const startTime = Date.now();
    await gotoAuthedPage(page, "/lingkungan", HEADING);
    expect(Date.now() - startTime).toBeLessThan(15000);
  });
});
