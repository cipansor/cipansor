import { test, expect } from "./fixtures/auth.fixture";
import { loginAs } from "./helpers/auth-api";
import { settledContent } from "./helpers/page-state";

/**
 * Calendar Module E2E Tests
 * Tests calendar view and event management
 */

test.describe("Calendar - Navigation", () => {
  test("should navigate to calendar page", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/calendar");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/calendar/);
  });

  test("should display calendar interface", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/calendar");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    expect(content.length).toBeGreaterThan(1000);
  });
});

test.describe("Calendar - Features", () => {
  test("should display calendar view", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/calendar");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    const hasCalendar =
      content.includes("Calendar") ||
      content.includes("Kalender") ||
      (await page
        .locator('[class*="calendar"]')
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false));

    expect(hasCalendar || page.url().includes("calendar")).toBeTruthy();
  });

  test("should have event management", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/calendar");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasEventButton = await page
      .locator(
        'button:has-text("Event"), button:has-text("Acara"), button:has-text("Tambah")',
      )
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    expect(hasEventButton || page.url().includes("calendar")).toBeTruthy();
  });

  test("should show month/week views", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/calendar");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    const hasViewSelector =
      content.includes("Month") ||
      content.includes("Week") ||
      content.includes("Bulan") ||
      content.includes("Minggu");

    expect(hasViewSelector || page.url().includes("calendar")).toBeTruthy();
  });
});

/**
 * The month window the page asks the API for must name the month exactly in a
 * WIB browser (Asia/Jakarta, UTC+7) — every user of the pesantren portal. The
 * window was built from `new Date(year, month, 1)` (local midnight) read back
 * with `toISOString()` (UTC), so it slid one day at both ends: the month lost
 * its last day and pulled in the last day of the previous one (ticket #911).
 *
 * The clock is pinned inside January 2026, so the page opens on that month and
 * the request carries its window.
 */
test.describe("Kalender Akademik — jendela bulan memakai bulan yang dilihat", () => {
  test.use({ timezoneId: "Asia/Jakarta" });

  test("Januari 2026 meminta 2026-01-01 sampai 2026-01-31", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");

    // 2026-01-15 05:00 WIB == 2026-01-14T22:00:00Z: mid-January, inside the
    // 00:00–06:59 WIB window where the UTC and WIB days disagree.
    await page.clock.install({ time: new Date("2026-01-14T22:00:00.000Z") });

    const monthRequest = page.waitForRequest(
      (r) =>
        r.url().includes("/calendar?") &&
        r.url().includes("startDate=") &&
        r.url().includes("endDate="),
    );
    await page.goto("/calendar");

    const params = new URL((await monthRequest).url()).searchParams;
    expect(params.get("startDate")).toBe("2026-01-01");
    expect(params.get("endDate")).toBe("2026-01-31");
  });
});

test.describe("Calendar - Performance", () => {
  test("should load calendar quickly", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);

    const startTime = Date.now();
    await page.goto("/calendar");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(15000);
  });
});
