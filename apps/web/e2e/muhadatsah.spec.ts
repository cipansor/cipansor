import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";
import { gotoAuthedPage } from "./helpers/page-helpers";

/**
 * Muhadatsah Module E2E Tests
 * Tests Arabic conversation practice module
 *
 * /muhadatsah wraps itself in MainLayout, so it renders nothing until
 * ProtectedRoute has rehydrated the session. These tests used to probe for
 * content at domcontentloaded with isVisible and a timeout, which Playwright
 * ignores the timeout on — the probe samples the page once and returns. That
 * raced rehydration and lost on WebKit. Wait for the page's own <h1> first.
 */
const HEADING = "Muhadatsah";
const NEW_HEADING = "Jadwalkan Muhadatsah";

test.describe("Muhadatsah - Navigation", () => {
  test("should navigate to muhadatsah page", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);
    expect(page.url()).toMatch(/muhadatsah/);
  });

  test("should display muhadatsah list or empty state", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    // The stats cards and the sessions table are rendered unconditionally —
    // the table keeps its header row when there are no sessions — so both are
    // assertable without depending on what the seed happens to create.
    await expect(page.getByText("Total Sesi")).toBeVisible();

    const table = page.locator("table");
    await expect(table).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Peserta" }),
    ).toBeVisible();
  });
});

test.describe("Muhadatsah - Create", () => {
  test("should navigate to create muhadatsah page", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah/new", NEW_HEADING);
    expect(page.url()).toMatch(/muhadatsah\/new/);
  });

  test("should display create form elements", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah/new", NEW_HEADING);

    // Asserted on the rendered form rather than on page.content().length, which
    // clears 1000 characters from the Next.js script tags alone and so passed
    // even when the page body was empty.
    await expect(
      page.getByRole("button", { name: "Simpan Jadwal" }),
    ).toBeVisible();
  });
});

test.describe("Muhadatsah - View & Evaluate", () => {
  test("should allow navigation from list to detail", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    const firstLink = page.locator('a[href*="/muhadatsah/"]').first();
    if ((await firstLink.count()) === 0) {
      test.skip(true, "No muhadatsah sessions seeded to open");
      return;
    }

    await firstLink.click();
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
    expect(page.url()).toMatch(/muhadatsah\/[^/]+/);
  });
});

test.describe("Muhadatsah - Performance", () => {
  test("should load muhadatsah page within timeout", async ({ page }) => {
    await loginAs(page, "superAdmin");

    const startTime = Date.now();
    await gotoAuthedPage(page, "/muhadatsah", HEADING);
    expect(Date.now() - startTime).toBeLessThan(15000);
    expect(page.url()).toMatch(/muhadatsah/);
  });
});
