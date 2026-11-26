import { test, expect } from "@playwright/test";
import { apiLogin, injectSession, SEED_USERS } from "./helpers/auth-api";
import { gotoAuthedPage } from "./helpers/page-helpers";

/**
 * "Catat Kesehatan" defaults its date to today on the WIB calendar (#1167).
 *
 * `new Date().toISOString().split("T")[0]` is the UTC day. Between 00:00 and
 * 06:59 WIB it is still yesterday — on the 1st, the previous month — so a
 * nurse who left the default recorded the visit in the wrong month and the
 * "Kunjungan bulan ini" card (now correctly on the WIB month) skipped it.
 *
 * The clock is frozen at 1 Nov 2026 00:30 WIB while the UTC date is still
 * 31 Oct, so a UTC default would fill 2026-10-31.
 */
test("the new health record form defaults to the WIB day", async ({ page }) => {
  const staff = await apiLogin(SEED_USERS.adminSdit);
  await injectSession(page, staff);

  await page.clock.install({
    time: new Date("2026-10-31T17:30:00.000Z"), // = 2026-11-01T00:30 WIB
  });
  await gotoAuthedPage(page, "/health/new", "Catat Kesehatan");

  await expect(page.locator('input[name="date"]')).toHaveValue("2026-11-01");
});
