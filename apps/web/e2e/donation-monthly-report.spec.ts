import { test, expect } from "@playwright/test";
import { apiLogin, injectSession, SEED_USERS } from "./helpers/auth-api";
import { gotoAuthedPage, waitForLoadingComplete } from "./helpers/page-helpers";

/**
 * The monthly donation report is read on the portal (Donasi & Infak →
 * Laporan Bulanan), not only through `GET /api/donation/monthly-report`.
 *
 * The endpoint was fixed to bucket by the WIB month (#1176); a report nobody
 * can open proves nothing, so the page carries it. The API always returns
 * twelve months, which lets this spec assert the whole year without depending
 * on which donations the seed happens to contain.
 */
test("staff can read the monthly donation report (Donasi & Infak → Laporan Bulanan)", async ({
  page,
}) => {
  const admin = await apiLogin(SEED_USERS.adminSdit);
  await injectSession(page, admin);

  await gotoAuthedPage(page, "/donation", /Donasi & Infak/i);
  await waitForLoadingComplete(page);

  await page.getByRole("tab", { name: "Laporan Bulanan" }).click();

  await expect(
    page.getByText(/Total donasi terverifikasi \d{4}/),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Tahun laporan" }),
  ).toBeVisible();

  for (const month of ["Januari", "Juni", "Desember"]) {
    await expect(
      page.getByRole("cell", { name: month, exact: true }),
    ).toBeVisible();
  }
});
