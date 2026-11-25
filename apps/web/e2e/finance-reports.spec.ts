import { test, expect } from "@playwright/test";
import { apiLogin, apiRequest, loginAs, SEED_USERS } from "./helpers/auth-api";

// The settings tests write the same kinds of mappings, so keep them serial.
test.describe.configure({ mode: "serial" });

const TAX = "ACCOUNT_MAPPING_TAX_PAYABLE";
const CASH = "ACCOUNT_MAPPING_CASH";

// The projects run concurrently against the same database. Give each one its
// own unit so the settings tests never restore each other's mappings.
const SETTINGS_UNIT_BY_PROJECT: Record<string, string> = {
  chromium: "SD IT Cipansor",
  firefox: "SMA Qur'an Cipansor",
  webkit: "TK Qur'an Cipansor",
  "mobile-chrome": "Pesantren Cipansor",
};

function settingsUnitFor(
  units: Array<{ id: string; name: string }>,
  projectName: string,
) {
  const preferred = SETTINGS_UNIT_BY_PROJECT[projectName];
  return units.find((unit) => unit.name === preferred) ?? units[0];
}

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
}, testInfo) => {
  test.setTimeout(90000);

  const session = await apiLogin(SEED_USERS.superAdmin);
  const units = await apiRequest<{
    data: Array<{ id: string; name: string }>;
  }>(session, "GET", "/units?limit=100");
  const unit = settingsUnitFor(units.data, testInfo.project.name);
  test.skip(!unit, "seed has no unit");
  if (!unit) return;

  // The settings are shared with payroll; put back exactly what was there so a
  // reused database does not pay salaries against this test's choice.
  const original = await apiRequest<{
    data: { mappings: Record<string, string | null>; invalidKeys: string[] };
  }>(session, "GET", `/finance/accounting/settings?unitId=${unit.id}`);
  test.skip(
    original.data.invalidKeys.includes(TAX),
    "seed PPh 21 mapping is already invalid and cannot be restored through the API",
  );

  const stamp = Date.now();
  const account = await apiRequest<{ id: string; code: string; name: string }>(
    session,
    "POST",
    "/finance/accounting/accounts",
    {
      code: `E2E-PPH-SAVE-${stamp}`,
      name: `E2E PPh Simpan ${stamp}`,
      type: "LIABILITY",
      normalBalance: "CREDIT",
      isActive: true,
    },
  );
  const selectedLabel = `${account.code} - ${account.name}`;

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
    await page
      .getByRole("option", { name: selectedLabel, exact: true })
      .click();

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
    // Restore only the key this test changed: sending every stored mapping
    // would fail on an unrelated legacy row and leave the test account behind.
    try {
      await apiRequest(session, "POST", "/finance/accounting/settings", {
        unitId: unit.id,
        settings: { [TAX]: original.data.mappings[TAX] ?? null },
      });
    } finally {
      await apiRequest(
        session,
        "DELETE",
        `/finance/accounting/accounts/${account.id}`,
      );
    }
  }
});

test("Finance Accounting Settings - saving cash keeps an unusable PPh 21 mapping", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);

  const session = await apiLogin(SEED_USERS.superAdmin);
  const units = await apiRequest<{
    data: Array<{ id: string; name: string }>;
  }>(session, "GET", "/units?limit=100");
  const unit = settingsUnitFor(units.data, testInfo.project.name);
  test.skip(!unit, "seed has no unit");
  if (!unit) return;

  const original = await apiRequest<{
    data: { mappings: Record<string, string | null>; invalidKeys: string[] };
  }>(session, "GET", `/finance/accounting/settings?unitId=${unit.id}`);
  test.skip(
    original.data.invalidKeys.includes(TAX) ||
      original.data.invalidKeys.includes(CASH),
    "seed already has an unusable PPh 21 or cash mapping",
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
      data: { mappings: Record<string, string | null>; invalidKeys: string[] };
    }>(session, "GET", `/finance/accounting/settings?unitId=${unit.id}`);
    expect(invalid.data.mappings[TAX]).toBe(account.id);
    expect(invalid.data.invalidKeys).toContain(TAX);

    const accounts = await apiRequest<{
      data: Array<{
        id: string;
        code: string;
        name: string;
        unitId: string | null;
      }>;
    }>(session, "GET", "/finance/accounting/accounts?isActive=true&limit=500");
    const currentCash = accounts.data.find(
      (item) => item.id === original.data.mappings[CASH],
    );
    const replacement = accounts.data.find(
      (item) =>
        item.id !== original.data.mappings[CASH] &&
        (item.unitId === null || item.unitId === unit.id) &&
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
      data: { mappings: Record<string, string | null>; invalidKeys: string[] };
    }>(session, "GET", `/finance/accounting/settings?unitId=${unit.id}`);
    expect(after.data.mappings[TAX]).toBe(account.id);
    expect(after.data.mappings[CASH]).toBe(replacement.id);
  } finally {
    try {
      await apiRequest(session, "POST", "/finance/accounting/settings", {
        unitId: unit.id,
        settings: {
          [TAX]: original.data.mappings[TAX] ?? null,
          [CASH]: original.data.mappings[CASH] ?? null,
        },
      });
    } finally {
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
  }
});

test("Finance Accounting Settings - clearing a mapping removes it after reload", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);

  const session = await apiLogin(SEED_USERS.superAdmin);
  const units = await apiRequest<{
    data: Array<{ id: string; name: string }>;
  }>(session, "GET", "/units?limit=100");
  const unit = settingsUnitFor(units.data, testInfo.project.name);
  test.skip(!unit, "seed has no unit");
  if (!unit) return;

  const original = await apiRequest<{
    data: { mappings: Record<string, string | null>; invalidKeys: string[] };
  }>(session, "GET", `/finance/accounting/settings?unitId=${unit.id}`);
  test.skip(
    original.data.invalidKeys.includes(TAX),
    "seed PPh 21 mapping is already invalid and cannot be restored through the API",
  );

  const stamp = Date.now();
  const account = await apiRequest<{ id: string; code: string; name: string }>(
    session,
    "POST",
    "/finance/accounting/accounts",
    {
      code: `E2E-CLEAR-${stamp}`,
      name: `E2E Kosongkan ${stamp}`,
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

    await loginAs(page, "superAdmin");
    await page.goto("/finance/accounting");
    await page.getByRole("tab", { name: /Pengaturan/i }).click();
    await page.getByRole("combobox", { name: "Pilih Unit" }).click();
    await page
      .getByRole("option", { name: unit.name, exact: true })
      .first()
      .click();

    await page.getByRole("combobox", { name: "Utang PPh 21" }).click();
    await page.getByRole("option", { name: /Kosongkan pemetaan/i }).click();

    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/finance/accounting/settings") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Simpan Pengaturan/i }).click();
    expect((await saved).status()).toBeLessThan(300);
    await expect(page.getByText("Pengaturan berhasil disimpan")).toBeVisible();

    const cleared = await apiRequest<{
      data: { mappings: Record<string, string | null>; invalidKeys: string[] };
    }>(session, "GET", `/finance/accounting/settings?unitId=${unit.id}`);
    expect(cleared.data.mappings[TAX]).toBeNull();
    expect(cleared.data.invalidKeys).not.toContain(TAX);

    await page.reload();
    await page.getByRole("tab", { name: /Pengaturan/i }).click();
    await page.getByRole("combobox", { name: "Pilih Unit" }).click();
    await page
      .getByRole("option", { name: unit.name, exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("combobox", { name: "Utang PPh 21" }),
    ).toContainText("Pilih Akun");
  } finally {
    try {
      await apiRequest(session, "POST", "/finance/accounting/settings", {
        unitId: unit.id,
        settings: { [TAX]: original.data.mappings[TAX] ?? null },
      });
    } finally {
      await apiRequest(
        session,
        "DELETE",
        `/finance/accounting/accounts/${account.id}`,
      );
    }
  }
});

test("Finance Accounting Settings - a business-unit mapping is shown and can be cleared", async ({
  page,
}, testInfo) => {
  test.setTimeout(150000);

  const session = await apiLogin(SEED_USERS.superAdmin);
  const businessUnits = await apiRequest<{
    data: Array<{
      id: string;
      name: string;
      type: "CANTEEN" | "LAUNDRY" | string;
      unitId: string;
    }>;
  }>(session, "GET", "/business-units");
  const projectMapping =
    testInfo.project.name === "firefox"
      ? {
          type: "CANTEEN",
          key: "ACCOUNT_MAPPING_COGS",
          label: "Beban Pokok Penjualan",
          accountType: "EXPENSE",
          normalBalance: "DEBIT",
        }
      : testInfo.project.name === "webkit"
        ? {
            type: "CANTEEN",
            key: "ACCOUNT_MAPPING_INVENTORY_ASSET",
            label: "Aset Persediaan",
            accountType: "ASSET",
            normalBalance: "DEBIT",
          }
        : testInfo.project.name === "mobile-chrome"
          ? {
              type: "LAUNDRY",
              key: "ACCOUNT_MAPPING_LAUNDRY_REVENUE",
              label: "Pendapatan Laundry",
              accountType: "REVENUE",
              normalBalance: "CREDIT",
            }
          : {
              type: "CANTEEN",
              key: "ACCOUNT_MAPPING_SALES_REVENUE",
              label: "Pendapatan",
              accountType: "REVENUE",
              normalBalance: "CREDIT",
            };
  const businessUnit = businessUnits.data.find(
    (item) => item.type === projectMapping.type,
  );
  test.skip(!businessUnit, "seed has no canteen or laundry business unit");
  if (!businessUnit) return;

  const units = await apiRequest<{
    data: Array<{ id: string; name: string }>;
  }>(session, "GET", "/units?limit=100");
  const unit = units.data.find((item) => item.id === businessUnit.unitId);
  test.skip(!unit, "business unit has no parent unit");
  if (!unit) return;

  const mappingKey = `BU_${businessUnit.id}_${projectMapping.key}`;
  const label = projectMapping.label;

  const original = await apiRequest<{
    data: { mappings: Record<string, string | null>; invalidKeys: string[] };
  }>(
    session,
    "GET",
    `/finance/accounting/settings?unitId=${businessUnit.unitId}`,
  );
  test.skip(
    original.data.invalidKeys.includes(mappingKey),
    "seed already has an unusable business-unit mapping",
  );

  const stamp = Date.now();
  const account = await apiRequest<{ id: string; code: string; name: string }>(
    session,
    "POST",
    "/finance/accounting/accounts",
    {
      code: `E2E-BU-${stamp}`,
      name: `E2E Unit Usaha ${stamp}`,
      type: projectMapping.accountType,
      normalBalance: projectMapping.normalBalance,
      isActive: true,
    },
  );
  const accountLabel = `${account.code} - ${account.name}`;

  const selectBusinessUnit = async () => {
    await page.getByRole("combobox", { name: "Pilih Unit" }).click();
    await page
      .getByRole("option", { name: unit.name, exact: true })
      .first()
      .click();
  };

  try {
    await loginAs(page, "superAdmin");
    await page.goto("/finance/accounting");
    await page.getByRole("tab", { name: /Pengaturan/i }).click();
    await selectBusinessUnit();

    await page
      .getByRole("combobox", { name: `${businessUnit.name} — ${label}` })
      .click();
    await page.getByRole("option", { name: accountLabel, exact: true }).click();

    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/finance/accounting/settings") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Simpan Pengaturan/i }).click();
    expect((await saved).status()).toBeLessThan(300);
    await expect(page.getByText("Pengaturan berhasil disimpan")).toBeVisible();

    const stored = await apiRequest<{
      data: { mappings: Record<string, string | null>; invalidKeys: string[] };
    }>(
      session,
      "GET",
      `/finance/accounting/settings?unitId=${businessUnit.unitId}`,
    );
    expect(stored.data.mappings[mappingKey]).toBe(account.id);

    await page.reload();
    await page.getByRole("tab", { name: /Pengaturan/i }).click();
    await selectBusinessUnit();
    await expect(
      page.getByRole("combobox", { name: `${businessUnit.name} — ${label}` }),
    ).toContainText(accountLabel);

    await page
      .getByRole("combobox", { name: `${businessUnit.name} — ${label}` })
      .click();
    await page.getByRole("option", { name: /Kosongkan pemetaan/i }).click();

    const cleared = page.waitForResponse(
      (response) =>
        response.url().includes("/finance/accounting/settings") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Simpan Pengaturan/i }).click();
    expect((await cleared).status()).toBeLessThan(300);
    await expect(page.getByText("Pengaturan berhasil disimpan")).toBeVisible();

    const after = await apiRequest<{
      data: { mappings: Record<string, string | null>; invalidKeys: string[] };
    }>(
      session,
      "GET",
      `/finance/accounting/settings?unitId=${businessUnit.unitId}`,
    );
    expect(after.data.mappings[mappingKey]).toBeUndefined();

    await page.reload();
    await page.getByRole("tab", { name: /Pengaturan/i }).click();
    await selectBusinessUnit();
    await expect(
      page.getByRole("combobox", { name: `${businessUnit.name} — ${label}` }),
    ).toContainText("Pilih Akun");
  } finally {
    try {
      await apiRequest(session, "POST", "/finance/accounting/settings", {
        unitId: businessUnit.unitId,
        settings: { [mappingKey]: original.data.mappings[mappingKey] ?? null },
      });
    } finally {
      await apiRequest(
        session,
        "DELETE",
        `/finance/accounting/accounts/${account.id}`,
      );
    }
  }
});

test("Finance Accounting Settings - a yayasan treasurer sees business-unit mappings without a token unit", async ({
  page,
}) => {
  test.setTimeout(90000);

  const session = await apiLogin(SEED_USERS.superAdmin);
  const units = await apiRequest<{
    data: Array<{ id: string; name: string }>;
  }>(session, "GET", "/units?limit=100");
  const unit = units.data.find((item) => item.name === "SMP IT Cipansor");
  test.skip(!unit, "seed has no SMP IT unit");
  if (!unit) return;

  await loginAs(page, "yayasanBendahara");
  await page.goto("/finance/accounting");
  await page.getByRole("tab", { name: /Pengaturan/i }).click();
  await page.getByRole("combobox", { name: "Pilih Unit" }).click();
  await page
    .getByRole("option", { name: unit.name, exact: true })
    .first()
    .click();

  await expect(page.getByText("Pemetaan per Unit Usaha")).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: / — / }).first(),
  ).toBeVisible();
});
