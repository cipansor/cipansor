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

/**
 * A report that only relabels itself on a year change would pass a test that
 * reads the picker and the month names. Switching the year must fetch that
 * year's report and render it.
 */
test("changing the report year refetches that year's data", async ({
  page,
}) => {
  const admin = await apiLogin(SEED_USERS.adminSdit);
  await injectSession(page, admin);

  const initialReport = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith("/donation/monthly-report");
  });

  await gotoAuthedPage(page, "/donation", /Donasi & Infak/i);
  const firstRequest = await initialReport;
  const firstYear = new URL(firstRequest.url()).searchParams.get("year");
  expect(firstYear).not.toBeNull();

  await page.getByRole("tab", { name: "Laporan Bulanan" }).click();
  await expect(
    page.getByText(`Total donasi terverifikasi ${firstYear}`),
  ).toBeVisible();

  const nextYear = String(Number(firstYear) - 1);
  const switchedResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/donation/monthly-report") &&
      url.searchParams.get("year") === nextYear
    );
  });

  await page.getByRole("combobox", { name: "Tahun laporan" }).click();
  await page.getByRole("option", { name: nextYear, exact: true }).click();

  const response = await switchedResponse;
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data.year).toBe(Number(nextYear));
  expect(body.data.months).toHaveLength(12);
  await expect(
    page.getByText(`Total donasi terverifikasi ${nextYear}`),
  ).toBeVisible();
});

/**
 * A failed read used to fall through to `yearTotal || 0` and an empty table,
 * which reads as a genuine Rp 0 report once the transient toast is gone.
 */
test("a failed report says so instead of showing a zero total", async ({
  page,
}) => {
  const admin = await apiLogin(SEED_USERS.adminSdit);
  await injectSession(page, admin);

  await page.route("**/donation/monthly-report*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ success: false, message: "boom" }),
    }),
  );

  await gotoAuthedPage(page, "/donation", /Donasi & Infak/i);
  await page.getByRole("tab", { name: "Laporan Bulanan" }).click();

  await expect(page.getByText(/gagal dimuat/i)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Total donasi terverifikasi/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Coba lagi" })).toBeVisible();
});
