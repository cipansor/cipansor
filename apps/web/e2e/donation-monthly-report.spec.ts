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

const MONTH_NAMES = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function reportPayload(year: number, yearTotal: number) {
  return {
    success: true,
    data: {
      year,
      yearTotal,
      months: MONTH_NAMES.map((monthName, index) => ({
        month: index + 1,
        monthName,
        total: 0,
        byType: {},
      })),
    },
  };
}

/**
 * A report that only relabels itself on a year change would pass a test that
 * reads the picker and the month names. Switching the year must fetch that
 * year's report and render its nominal — not keep the previous year's total.
 *
 * The two years are served with distinct totals so a stale render is visible.
 */
test("changing the report year renders that year's nominal", async ({
  page,
}) => {
  const admin = await apiLogin(SEED_USERS.adminSdit);
  await injectSession(page, admin);

  let firstSeenYear: string | null = null;
  await page.route("**/donation/monthly-report*", (route) => {
    const url = new URL(route.request().url());
    const year = url.searchParams.get("year") ?? "";
    firstSeenYear ??= year;
    const yearTotal = year === firstSeenYear ? 1_234_567 : 7_654_321;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reportPayload(Number(year), yearTotal)),
    });
  });

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
  await expect(page.getByText("Rp 1.234.567")).toBeVisible();

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
  await expect(page.getByText("Rp 7.654.321")).toBeVisible();
  await expect(page.getByText("Rp 1.234.567")).toHaveCount(0);
});

/**
 * A failed read used to fall through to `yearTotal || 0` and an empty table,
 * which reads as a genuine Rp 0 report once the transient toast is gone. The
 * page must say it failed and recover when the API does.
 */
test("a failed report says so and Coba lagi recovers", async ({ page }) => {
  const admin = await apiLogin(SEED_USERS.adminSdit);
  await injectSession(page, admin);

  let failReport = true;
  await page.route("**/donation/monthly-report*", (route) => {
    if (failReport) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ success: false, message: "boom" }),
      });
    }
    const year = Number(
      new URL(route.request().url()).searchParams.get("year"),
    );
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reportPayload(year, 2_500_000)),
    });
  });

  await gotoAuthedPage(page, "/donation", /Donasi & Infak/i);
  await page.getByRole("tab", { name: "Laporan Bulanan" }).click();

  await expect(page.getByText(/gagal dimuat/i)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Total donasi terverifikasi/)).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
    timeout: 2_000,
  });

  const retry = page.getByRole("button", { name: "Coba lagi" });
  await expect(retry).toBeVisible();
  failReport = false;
  await retry.click();

  await expect(page.getByText(/Total donasi terverifikasi/)).toBeVisible();
  await expect(page.getByText("Rp 2.500.000")).toBeVisible();
});
