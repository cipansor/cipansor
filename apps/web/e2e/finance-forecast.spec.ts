import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth-api";

test("Finance Cash Flow Forecast Page", async ({ page }) => {
  test.setTimeout(60000);

  // Unit admin with an assigned unit — the forecast endpoint is unit-scoped
  await loginAs(page, "adminSdit");

  // Navigate to forecast page. Firefox occasionally aborts this navigation
  // (NS_BINDING_ABORTED) when the previous page still has requests in
  // flight — retry once.
  await page
    .goto("/finance/reports/cash-flow-forecast")
    .catch(() => page.goto("/finance/reports/cash-flow-forecast"));

  // Verify structure rendered from the real forecast endpoint (amounts are
  // data-dependent, so assert Rp formatting rather than fixed values)
  await expect(page.locator("text=Proyeksi Arus Kas")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator("text=Net Perubahan Kas")).toBeVisible();
  await expect(page.getByText(/Rp\s?[\d.,]+/).first()).toBeVisible();

  // Verify Chart presence (Recharts renders svg/div)
  await expect(page.locator(".recharts-responsive-container")).toHaveCount(2);

  // The projection table renders one row per forecast month
  const table = page.locator("table");
  await expect(table).toBeVisible();
  expect(await table.locator("tbody tr").count()).toBeGreaterThan(0);
});

/**
 * A SUPER_ADMIN has no `unitId` of their own. The page used to read
 * `user.unitId` directly, which left the forecast query permanently disabled
 * and rendered the error branch on a page that has data. It now defaults to
 * the first available unit and lets the user switch.
 */
test("Finance Cash Flow Forecast — super admin tanpa unit tetap melihat data", async ({
  page,
}) => {
  test.setTimeout(60000);
  await loginAs(page, "superAdmin");

  await page
    .goto("/finance/reports/cash-flow-forecast")
    .catch(() => page.goto("/finance/reports/cash-flow-forecast"));

  // The regression was a dead "Gagal memuat proyeksi arus kas" branch.
  await expect(page.locator("text=Gagal memuat")).toHaveCount(0);
  await expect(page.locator("text=Proyeksi Arus Kas")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByText(/Rp\s?[\d.,]+/).first()).toBeVisible();

  // A unit picker lets the foundation user choose which unit to forecast.
  await expect(page.getByRole("combobox")).toBeVisible();
  await expect(page.locator(".recharts-responsive-container")).toHaveCount(2);
});
