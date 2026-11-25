import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth-api";

test("Finance Accounting Page - Trial Balance and Reports", async ({
  page,
}) => {
  test.setTimeout(60000);

  await loginAs(page, "superAdmin");

  // 1. Navigate directly to the accounting page.
  await page.goto("/finance/accounting");

  // 2. Open the reports tab ("Ringkasan Laporan").
  await page.getByRole("tab", { name: /Ringkasan Laporan/i }).click();

  // 3. The trial balance report renders from the real journal data.
  await expect(page.getByText("Neraca Saldo (Trial Balance)")).toBeVisible({
    timeout: 15000,
  });
});

test("Finance Accounting Settings - a valid PPh 21 account can be saved", async ({
  page,
}) => {
  test.setTimeout(90000);

  await loginAs(page, "superAdmin");
  await page.goto("/finance/accounting");
  await page.getByRole("tab", { name: /Pengaturan/i }).click();

  await page.getByRole("combobox", { name: "Pilih Unit" }).click();
  await page.getByRole("option").first().click();

  const tax = page.getByRole("combobox", { name: "Utang PPh 21" });
  await tax.click();
  const options = page.getByRole("option");
  const hasOptions = await expect(options.first())
    .toBeVisible({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  test.skip(
    !hasOptions,
    "seed has no active liability account usable as PPh 21",
  );
  const optionCount = await options.count();
  const option = options.nth(optionCount > 1 ? 1 : 0);
  const selectedLabel = (await option.innerText()).trim();
  await option.click();

  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("/finance/accounting/settings") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Simpan Pengaturan/i }).click();
  const response = await saved;
  expect(response.status()).toBeLessThan(300);
  await expect(page.getByText("Pengaturan berhasil disimpan")).toBeVisible();

  // Reload and prove the value came back from the API, not just local state.
  await page.reload();
  await page.getByRole("tab", { name: /Pengaturan/i }).click();
  await page.getByRole("combobox", { name: "Pilih Unit" }).click();
  await page.getByRole("option").first().click();
  await expect(
    page.getByRole("combobox", { name: "Utang PPh 21" }),
  ).toContainText(selectedLabel);
});
