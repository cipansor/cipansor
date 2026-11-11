import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth-api";

/**
 * Piket & Jaga (/duty-roster) — "Jadwal Hari Ini" must be the WIB calendar day
 * (Asia/Jakarta, UTC+7), not the UTC day the browser's clock happens to report.
 *
 * Before the fix the page derived its day from `new Date().toISOString()`, so
 * between 00:00 and 06:59 WIB — when the UTC day is still yesterday — it asked
 * `GET /duty-roster?date=` for the previous day's roster and reported the
 * statistics window one day short (ticket #1026; the API side was already
 * correct via `todayWib()`).
 *
 * The clock is pinned to 05:00 WIB, the middle of that window, so the test
 * exercises the failure every run rather than only in the early morning.
 */

// 2026-11-02 05:00 WIB == 2026-11-01T22:00:00Z: the WIB day is 2026-11-02
// while the UTC day is still 2026-11-01.
const FIXED_INSTANT = new Date("2026-11-01T22:00:00.000Z");
const WIB_DAY = "2026-11-02";
const UTC_DAY = "2026-11-01";

test.describe("Piket & Jaga — 'Hari Ini' memakai hari WIB", () => {
  test.use({ timezoneId: "Asia/Jakarta" });

  test("sebelum 07:00 WIB meminta jadwal hari ini, bukan hari UTC", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");

    // Pin the browser clock to 05:00 WIB before the app mounts, so `new Date()`
    // inside the page returns that instant on first render.
    await page.clock.install({ time: FIXED_INSTANT });

    const rosterRequest = page.waitForRequest(
      (r) => r.url().includes("/duty-roster?") && r.url().includes("date="),
    );
    await page.goto("/duty-roster");

    const requestedDay = new URL((await rosterRequest).url()).searchParams.get(
      "date",
    );
    expect(requestedDay).toBe(WIB_DAY);
    expect(requestedDay).not.toBe(UTC_DAY);

    // The date the page shows must be the same WIB day it asked the API for.
    await expect(page.getByText("Senin, 2 November 2026")).toBeVisible();
  });

  // A device clock west of WIB is where the label and the request disagree: the
  // page asks for the WIB day but `new Date("YYYY-MM-DD")` is UTC midnight, so
  // formatting it in the device zone would print the previous day. The label is
  // pinned to Asia/Jakarta, so it must still name the day that was requested.
  test.describe("perangkat di sebelah barat WIB", () => {
    test.use({ timezoneId: "America/New_York" });

    test("label tanggal tetap sama dengan hari yang diminta", async ({
      page,
    }) => {
      await loginAs(page, "superAdmin");
      await page.clock.install({ time: FIXED_INSTANT });

      const rosterRequest = page.waitForRequest(
        (r) => r.url().includes("/duty-roster?") && r.url().includes("date="),
      );
      await page.goto("/duty-roster");

      const requestedDay = new URL(
        (await rosterRequest).url(),
      ).searchParams.get("date");
      expect(requestedDay).toBe(WIB_DAY);
      await expect(page.getByText("Senin, 2 November 2026")).toBeVisible();
    });
  });

  test("jendela statistik dihitung dari hari WIB", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.clock.install({ time: FIXED_INSTANT });

    const statsRequest = page.waitForRequest((r) =>
      r.url().includes("/duty-roster/statistics"),
    );
    await page.goto("/duty-roster");

    const url = new URL((await statsRequest).url());
    expect(url.searchParams.get("startDate")).toBe("2026-11-01");
    expect(url.searchParams.get("endDate")).toBe(WIB_DAY);
  });

  test("tombol hari sebelumnya/berikutnya menggeser hari WIB", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");
    await page.clock.install({ time: FIXED_INSTANT });
    await page.goto("/duty-roster");

    await expect(page.getByText("Senin, 2 November 2026")).toBeVisible();

    const nextRequest = page.waitForRequest(
      (r) => r.url().includes("/duty-roster?") && r.url().includes("date="),
    );
    await page.getByRole("button", { name: "Hari berikutnya" }).click();
    expect(new URL((await nextRequest).url()).searchParams.get("date")).toBe(
      "2026-11-03",
    );
    await expect(page.getByText("Selasa, 3 November 2026")).toBeVisible();

    // Back one day. React Query answers this from the cache it filled on load,
    // so there is no new request to await — the day the page shows is the
    // contract that matters here.
    await page.getByRole("button", { name: "Hari sebelumnya" }).click();
    await expect(page.getByText("Senin, 2 November 2026")).toBeVisible();
  });
});
