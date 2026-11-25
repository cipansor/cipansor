import { test, expect } from "@playwright/test";
import { apiLogin, apiRequest, loginAs, SEED_USERS } from "./helpers/auth-api";

// The two settings tests share one unit's account mappings.
test.describe.configure({ mode: "serial" });

const TAX = "ACCOUNT_MAPPING_TAX_PAYABLE";
const CASH = "ACCOUNT_MAPPING_CASH";

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

  const session = await apiLogin(SEED_USERS.superAdmin);
  const units = await apiRequest<{
    data: Array<{ id: string; name: string }>;
  }>(session, "GET", "/units?limit=100");
  const unit = units.data[0];
  test.skip(!unit, "seed has no unit");
  if (!unit) return;

  // The settings are shared with payroll; put back exactly what was there so a
  // reused database does not pay salaries against this test's choice.
  const original = await apiRequest<{
    data: Record<string, string | null>;
  }>(session, "GET", `/finance/accounting/settings?unitId=${unit.id}`);

  try {
    await loginAs(page, "superAdmin");
    await page.goto("/finance/accounting");
    await page.getByRole("tab", { name: /Pengaturan/i }).click();

    await page.getByRole("combobox", { name: "Pilih Unit" }).click();
    await page
      .getByRole("option", { name: unit.name, exact: true })
      .first()
      .click();

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
    await page
      .getByRole("option", { name: unit.name, exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("combobox", { name: "Utang PPh 21" }),
    ).toContainText(selectedLabel);
  } finally {
    // A failed restore must fail the test: the database is reused, and a
    // silent catch would leave this test's PPh 21 choice behind for payroll.
    await apiRequest(session, "POST", "/finance/accounting/settings", {
      unitId: unit.id,
      settings: original.data,
    });
  }
});

test("Finance Accounting Settings - saving cash keeps an unusable PPh 21 mapping", async ({
  page,
}) => {
  test.setTimeout(120000);

  const session = await apiLogin(SEED_USERS.superAdmin);
  const units = await apiRequest<{
    data: Array<{ id: string; name: string }>;
  }>(session, "GET", "/units?limit=100");
  const unit = units.data[0];
  test.skip(!unit, "seed has no unit");
  if (!unit) return;

  const original = await apiRequest<{
    data: Record<string, string | null>;
    invalidKeys: string[];
  }>(session, "GET", `/finance/accounting/settings?unitId=${unit.id}`);
  test.skip(
    original.invalidKeys?.includes(TAX),
    "seed already has an unusable PPh 21 mapping",
  );

  const stamp = Date.now();
  const account = await apiRequest<{ id: string; code: string; name: string }>(
    session,
    "POST",
    "/finance/accounting/accounts",
    {
      code: `E2E-PPH-${stamp}`,
      name: `E2E PPh 21 ${stamp}`,
      type: "LIABILITY",
      normalBalance: "CREDIT",
      isActive: true,
    },
  );

  try {
    await apiRequest(session, "POST", "/finance/accounting/settings", {
      unitId: unit.id,
      settings: { [TAX]: account.id },
    });
    // Make the stored mapping unusable without deleting it, as an account-type
    // correction in the chart of accounts would.
    await apiRequest(
      session,
      "PUT",
      `/finance/accounting/accounts/${account.id}`,
      { type: "EXPENSE" },
    );

    const invalid = await apiRequest<{
      data: Record<string, string | null>;
      invalidKeys: string[];
    }>(session, "GET", `/finance/accounting/settings?unitId=${unit.id}`);
    expect(invalid.data[TAX]).toBe(account.id);
    expect(invalid.invalidKeys).toContain(TAX);

    const accounts = await apiRequest<{
      data: Array<{ id: string; code: string; name: string }>;
    }>(session, "GET", "/finance/accounting/accounts?isActive=true&limit=500");
    const currentCash = accounts.data.find(
      (item) => item.id === original.data[CASH],
    );
    const replacement = accounts.data.find(
      (item) =>
        item.id !== original.data[CASH] &&
        `${item.code} - ${item.name}` !==
          (currentCash ? `${currentCash.code} - ${currentCash.name}` : ""),
    );
    test.skip(!replacement, "seed has no second account for the cash mapping");
    if (!replacement) return;

    await loginAs(page, "superAdmin");
    await page.goto("/finance/accounting");
    await page.getByRole("tab", { name: /Pengaturan/i }).click();
    await page.getByRole("combobox", { name: "Pilih Unit" }).click();
    await page
      .getByRole("option", { name: unit.name, exact: true })
      .first()
      .click();

    await expect(
      page.getByRole("tabpanel", { name: "Pengaturan" }).getByRole("alert"),
    ).toContainText("tidak lagi aktif");

    await page.getByRole("combobox", { name: "Akun Kas Tunai" }).click();
    await page
      .getByRole("option", {
        name: `${replacement.code} - ${replacement.name}`,
        exact: true,
      })
      .click();

    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/finance/accounting/settings") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Simpan Pengaturan/i }).click();
    expect((await saved).status()).toBeLessThan(300);
    await expect(page.getByText("Pengaturan berhasil disimpan")).toBeVisible();

    const after = await apiRequest<{
      data: Record<string, string | null>;
      invalidKeys: string[];
    }>(session, "GET", `/finance/accounting/settings?unitId=${unit.id}`);
    expect(after.data[TAX]).toBe(account.id);
    expect(after.data[CASH]).toBe(replacement.id);
  } finally {
    await apiRequest(session, "POST", "/finance/accounting/settings", {
      unitId: unit.id,
      settings: original.data,
    });
    await apiRequest(
      session,
      "PUT",
      `/finance/accounting/accounts/${account.id}`,
      { type: "LIABILITY" },
    );
    await apiRequest(
      session,
      "DELETE",
      `/finance/accounting/accounts/${account.id}`,
    );
  }
});
