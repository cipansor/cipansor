import { test, expect } from "@playwright/test";
import {
  LAUNDRY_STATUS_LABELS,
  LAUNDRY_STATUS_VALUES,
  laundryStatusOptions,
  type LaundryStatusCode,
} from "@cipansor/shared";
import {
  apiLoginNew,
  apiRequest,
  injectSession,
  SEED_USERS,
  type AuthSession,
} from "./helpers/auth-api";
import { gotoAuthedPage } from "./helpers/page-helpers";

/**
 * Property 31, Portal side (#1010): the status menu offers exactly the moves
 * `LAUNDRY_STATUS_FLOW` names — the same table `PATCH …/status` validates
 * against (#989). Before this the page printed a hardcoded list of every
 * status, so it offered moves the API refused with 409.
 *
 * The actor is the SMP IT admin: laundry rows belong to that unit, and a
 * super admin has no `unitId` to create one with.
 */
const LAUNDRY_ADMIN = {
  email: "smpit.admin@cipansor.or.id",
  password: "Cipansor123!",
};

interface CreatedTransaction {
  id: string;
  transactionNo: string;
  status: LaundryStatusCode;
}

async function createReceivedTransaction(
  session: AuthSession,
  paymentMethod: "CASH" | "PENDING" = "CASH",
  studentId?: string,
): Promise<CreatedTransaction> {
  const pricing = await apiRequest<{ data: Array<{ id: string }> }>(
    session,
    "GET",
    "/laundry/pricing",
  );
  expect(pricing.data.length, "seed tanpa tarif laundry").toBeGreaterThan(0);

  let selectedStudentId = studentId;
  if (!selectedStudentId) {
    const students = await apiRequest<{ data: Array<{ id: string }> }>(
      session,
      "GET",
      "/students?limit=1",
    );
    expect(students.data.length, "seed tanpa santri").toBeGreaterThan(0);
    selectedStudentId = students.data[0].id;
  }

  const created = await apiRequest<{ data: CreatedTransaction }>(
    session,
    "POST",
    "/laundry/transactions",
    {
      studentId: selectedStudentId,
      pricingId: pricing.data[0].id,
      weight: 2,
      paymentMethod,
      items: [{ itemType: "Seragam", quantity: 2 }],
    },
  );
  return created.data;
}

async function openTransactionDetail(
  page: import("@playwright/test").Page,
  transactionNo: string,
) {
  const row = page.getByRole("row").filter({ hasText: transactionNo });
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole("button", { name: "Lihat detail" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(transactionNo);
  return dialog;
}

test.describe("Petugas membuat transaksi lalu memindahkan statusnya (R22.1, R22.9)", () => {
  test("status yang dipilih lewat menu tetap tersimpan sesudah halaman dimuat ulang", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const session = await apiLoginNew(LAUNDRY_ADMIN);
    const pricing = await apiRequest<{
      data: Array<{
        id: string;
        businessUnitId: string | null;
        isActive: boolean;
      }>;
    }>(session, "GET", "/laundry/pricing");
    const firstActiveTier = pricing.data.find((tier) => tier.isActive);
    expect(firstActiveTier, "seed tanpa tarif laundry aktif").toBeTruthy();
    expect(
      firstActiveTier?.businessUnitId,
      "tarif pertama tidak terhubung ke unit usaha",
    ).toBeTruthy();
    const students = await apiRequest<{
      data: Array<{ nis: string; user?: { name?: string } }>;
    }>(session, "GET", "/students?limit=1");
    const student = students.data[0];
    expect(student, "seed tanpa santri").toBeTruthy();
    // `GET /students` nests the display name on the user; the form searches
    // by NIS so the choice is one row whichever unit the santri belongs to.
    const studentName = student.user?.name ?? "";
    await injectSession(page, session);

    await gotoAuthedPage(page, "/laundry", /^Laundry$/);

    // Transaksi Baru — the form the counter staff actually uses (R22.9).
    await page.getByRole("button", { name: "Transaksi Baru" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Cari Santri").fill(student.nis);
    await form.getByRole("button", { name: new RegExp(student.nis) }).click();
    await form.getByRole("combobox", { name: "Pilih tarif" }).click();
    await page.getByRole("option").first().click();
    await form.getByLabel("Berat (kg)").fill("2");
    await form.getByRole("button", { name: "Buat Transaksi" }).click();
    await expect(
      page.getByText("Transaksi laundry berhasil dibuat"),
    ).toBeVisible({
      timeout: 15000,
    });

    // The newest row is the one just created; open it and take the flow's move.
    const row = page.getByRole("row").nth(1);
    const transactionNo = (
      await row.getByRole("cell").first().innerText()
    ).trim();
    expect(transactionNo).toMatch(/^LDR-/);

    // R22.9: the API takes the business unit from the tier, so the row the
    // portal created must carry the tier's unit — even though the form never
    // sends one. This is the journal's account-mapping key.
    await expect
      .poll(
        async () =>
          (
            await apiRequest<{
              data: Array<{ businessUnitId: string | null }>;
            }>(
              session,
              "GET",
              `/laundry/transactions?search=${encodeURIComponent(transactionNo)}`,
            )
          ).data[0]?.businessUnitId,
        { timeout: 20000 },
      )
      .toBe(firstActiveTier?.businessUnitId);
    await row.getByRole("button", { name: "Lihat detail" }).click();
    const detail = page.getByRole("dialog");
    await expect(detail).toContainText(transactionNo);

    const [next] = laundryStatusOptions("RECEIVED");
    expect(next).toBeTruthy();
    await detail.getByRole("button", { name: next.label, exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await apiRequest<{ data: Array<{ status: LaundryStatusCode }> }>(
              session,
              "GET",
              `/laundry/transactions?search=${encodeURIComponent(transactionNo)}`,
            )
          ).data[0]?.status,
        { timeout: 20000 },
      )
      .toBe(next.value);

    // Reload: the status came from the API, not from component state.
    await page.reload();
    await gotoAuthedPage(page, "/laundry", /^Laundry$/);
    const reloaded = page.getByRole("row").filter({ hasText: transactionNo });
    await expect(reloaded).toContainText(LAUNDRY_STATUS_LABELS[next.value], {
      timeout: 15000,
    });
    // R22.2: the santri column is `student.user.name`, and the item count is
    // the sum of `items[].quantity` — 0 here, because the form left the
    // optional clothing list empty and the API then sends no items.
    await expect(reloaded).toContainText(studentName);
    await expect(reloaded).toContainText("0 item");
  });
});

test.describe("Menu status laundry mengikuti LAUNDRY_STATUS_FLOW", () => {
  // Each test creates a transaction, and `generateTransactionNo` reads the last
  // number and adds one — two creates in the same second race for the same
  // `transactionNo` and one loses with a 409. Serial keeps this file's own
  // creates apart; the numbering race itself is a separate API issue.
  test.describe.configure({ mode: "serial" });

  let session: AuthSession;
  let transaction: CreatedTransaction;

  test.beforeEach(async ({ page }) => {
    session = await apiLoginNew(LAUNDRY_ADMIN);
    transaction = await createReceivedTransaction(session);
    await injectSession(page, session);
  });

  test("hanya transisi yang tercatat di flow yang ditawarkan", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await gotoAuthedPage(page, "/laundry", /^Laundry$/);
    const dialog = await openTransactionDetail(page, transaction.transactionNo);

    const offered = new Set(
      laundryStatusOptions(transaction.status).map((option) => option.value),
    );
    for (const status of LAUNDRY_STATUS_VALUES) {
      await expect(
        dialog.getByRole("button", {
          name: LAUNDRY_STATUS_LABELS[status],
          exact: true,
        }),
        `${LAUNDRY_STATUS_LABELS[status]} ${
          offered.has(status) ? "harus" : "tidak boleh"
        } ditawarkan untuk status ${transaction.status}`,
      ).toHaveCount(offered.has(status) ? 1 : 0);
    }
  });

  test("tombol yang ditawarkan diterima API dan statusnya berpindah", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await gotoAuthedPage(page, "/laundry", /^Laundry$/);
    const dialog = await openTransactionDetail(page, transaction.transactionNo);

    const [next] = laundryStatusOptions(transaction.status);
    expect(next, `flow tanpa tujuan dari ${transaction.status}`).toBeTruthy();
    await dialog.getByRole("button", { name: next.label, exact: true }).click();

    // The API is the record, so poll it: the dialog's buttons carry the same
    // labels as the badge, so any text assertion here could be satisfied by a
    // button that has not re-rendered yet.
    await expect
      .poll(
        async () =>
          (
            await apiRequest<{ data: { status: LaundryStatusCode } }>(
              session,
              "GET",
              `/laundry/transactions/${transaction.id}`,
            )
          ).data.status,
        { timeout: 20000 },
      )
      .toBe(next.value);

    // The menu moved with the transaction: the new status' own options only.
    const offered = new Set(
      laundryStatusOptions(next.value).map((option) => option.value),
    );
    for (const status of LAUNDRY_STATUS_VALUES) {
      await expect(
        dialog.getByRole("button", {
          name: LAUNDRY_STATUS_LABELS[status],
          exact: true,
        }),
      ).toHaveCount(offered.has(status) ? 1 : 0);
    }
  });

  test("transaksi selesai tidak menawarkan status lanjutan", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Walk the flow to DELIVERED through the API, then read the menu.
    let status: LaundryStatusCode = transaction.status;
    while (status !== "DELIVERED") {
      const [step] = laundryStatusOptions(status);
      expect(step, `flow berhenti di ${status}`).toBeTruthy();
      const moved = await apiRequest<{ data: { status: LaundryStatusCode } }>(
        session,
        "PATCH",
        `/laundry/transactions/${transaction.id}/status`,
        { status: step.value },
      );
      status = moved.data.status;
    }

    await gotoAuthedPage(page, "/laundry", /^Laundry$/);
    const dialog = await openTransactionDetail(page, transaction.transactionNo);
    for (const candidate of LAUNDRY_STATUS_VALUES) {
      await expect(
        dialog.getByRole("button", {
          name: LAUNDRY_STATUS_LABELS[candidate],
          exact: true,
        }),
      ).toHaveCount(0);
    }
    await expect(
      dialog.getByText(
        "Transaksi ini sudah selesai; tidak ada status lanjutan.",
      ),
    ).toBeVisible();
  });
});

test.describe("Pelunasan dan pembatalan di portal (R22.7)", () => {
  test.describe.configure({ mode: "serial" });

  let session: AuthSession;

  test.beforeEach(async ({ page }) => {
    session = await apiLoginNew(LAUNDRY_ADMIN);
    await injectSession(page, session);
  });

  test("melunasi tagihan Bayar Nanti lalu menyimpannya", async ({ page }) => {
    test.setTimeout(180_000);
    const unpaid = await createReceivedTransaction(session, "PENDING");
    await gotoAuthedPage(page, "/laundry", /^Laundry$/);
    const dialog = await openTransactionDetail(page, unpaid.transactionNo);

    await dialog.getByRole("button", { name: /Lunasi Tunai/ }).click();
    await expect(
      page.getByText("Pembayaran laundry berhasil dicatat"),
    ).toBeVisible({ timeout: 15000 });

    await expect
      .poll(
        async () =>
          (
            await apiRequest<{
              data: {
                paymentStatus: string;
                paymentMethod: string;
                paidAt: string | null;
              };
            }>(session, "GET", `/laundry/transactions/${unpaid.id}`)
          ).data,
        { timeout: 20000 },
      )
      .toMatchObject({ paymentStatus: "PAID", paymentMethod: "CASH" });

    const stored = await apiRequest<{
      data: { paymentStatus: string; paidAt: string | null };
    }>(session, "GET", `/laundry/transactions/${unpaid.id}`);
    expect(stored.data.paidAt).toBeTruthy();
    await expect(dialog.getByText("Lunas")).toBeVisible();
  });

  test("pembatalan menolak lalu menerima konfirmasi", async ({ page }) => {
    test.setTimeout(180_000);
    const paid = await createReceivedTransaction(session, "CASH");
    await gotoAuthedPage(page, "/laundry", /^Laundry$/);
    const dialog = await openTransactionDetail(page, paid.transactionNo);

    let declined = false;
    page.once("dialog", async (confirmation) => {
      declined = true;
      await confirmation.dismiss();
    });
    await dialog
      .getByRole("button", { name: LAUNDRY_STATUS_LABELS.CANCELLED })
      .click();
    await expect.poll(() => declined, { timeout: 5000 }).toBe(true);

    await expect
      .poll(
        async () =>
          (
            await apiRequest<{ data: { status: string } }>(
              session,
              "GET",
              `/laundry/transactions/${paid.id}`,
            )
          ).data.status,
        { timeout: 5000 },
      )
      .toBe("RECEIVED");

    page.once("dialog", (confirmation) => confirmation.accept());
    await dialog
      .getByRole("button", { name: LAUNDRY_STATUS_LABELS.CANCELLED })
      .click();

    await expect
      .poll(
        async () =>
          (
            await apiRequest<{ data: { status: string } }>(
              session,
              "GET",
              `/laundry/transactions/${paid.id}`,
            )
          ).data.status,
        { timeout: 20000 },
      )
      .toBe("CANCELLED");
  });
});

test.describe("Petugas mengelola tarif laundry (R22.8)", () => {
  test("menambah, mengubah, lalu menghapus tarif", async ({ page }) => {
    test.setTimeout(180_000);
    const session = await apiLoginNew(LAUNDRY_ADMIN);
    const businessUnits = await apiRequest<{
      data: Array<{ id: string; name: string; code: string; type: string }>;
    }>(session, "GET", "/business-units?type=LAUNDRY");
    const laundryUnit = businessUnits.data[0];
    expect(laundryUnit, "seed tanpa unit usaha laundry").toBeTruthy();
    await injectSession(page, session);
    await gotoAuthedPage(page, "/laundry", /^Laundry$/);
    await page.getByRole("tab", { name: /Tarif/ }).click();

    const name = `Cuci Uji ${Date.now()}`;
    await page.getByRole("button", { name: "Tambah Tarif" }).click();
    const create = page.getByRole("dialog");
    await create.getByLabel("Nama Layanan").fill(name);
    await create.getByLabel("Harga per Kg (Rp)").fill("7500");
    await create.getByLabel("Berat Minimal (kg)").fill("1.25");
    await create.getByRole("combobox", { name: "Unit Usaha Laundry" }).click();
    await page
      .getByRole("option", {
        name: `${laundryUnit.name} (${laundryUnit.code})`,
      })
      .click();
    await create.getByRole("button", { name: "Tambah", exact: true }).click();
    await expect(
      page.getByText("Tarif laundry berhasil ditambahkan"),
    ).toBeVisible({ timeout: 15000 });

    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row).toContainText("7.500");
    // Two decimals survive the form (step 0.01), not rounded to 1.2/1.3.
    await expect(row).toContainText("1.25 kg");
    await expect(row).toContainText(laundryUnit.name);

    const storedTier = await expect
      .poll(
        async () => {
          const pricing = await apiRequest<{
            data: Array<{
              id: string;
              name: string;
              businessUnitId: string | null;
            }>;
          }>(session, "GET", "/laundry/pricing");
          return pricing.data.find((tier) => tier.name === name)
            ?.businessUnitId;
        },
        { timeout: 15000 },
      )
      .toBe(laundryUnit.id);
    expect(storedTier).toBeUndefined();

    await row.getByRole("button", { name: "Aksi" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const edit = page.getByRole("dialog");
    await edit.getByLabel("Harga per Kg (Rp)").fill("8000");
    await edit.getByRole("button", { name: "Simpan" }).click();
    await expect(
      page.getByText("Tarif laundry berhasil diperbarui"),
    ).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText(
      "8.000",
      { timeout: 15000 },
    );

    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "Aksi" })
      .click();
    await page.getByRole("menuitem", { name: "Hapus" }).click();
    await expect(page.getByText("Tarif laundry berhasil dihapus")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(
      0,
      { timeout: 15000 },
    );
  });
});

test.describe("Pencarian laundry menyaring baris nyata (R22.11)", () => {
  test.describe.configure({ mode: "serial" });

  test("nama, NIS, nomor transaksi, dan huruf besar/kecil", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const session = await apiLoginNew(LAUNDRY_ADMIN);
    const students = await apiRequest<{
      data: Array<{
        id: string;
        nis: string;
        user?: { name?: string };
      }>;
    }>(session, "GET", "/students?limit=1");
    const student = students.data[0];
    expect(student?.user?.name, "seed tanpa nama santri").toBeTruthy();
    const transaction = await createReceivedTransaction(
      session,
      "CASH",
      student.id,
    );
    await injectSession(page, session);

    await gotoAuthedPage(page, "/laundry", /^Laundry$/);
    const search = page.getByLabel("Cari transaksi");
    const row = () =>
      page.getByRole("row").filter({ hasText: transaction.transactionNo });

    // Name match, typed in the opposite case from the stored name.
    await search.fill(student.user!.name!.toLowerCase());
    await expect(row()).toBeVisible({ timeout: 15000 });

    await search.fill(student.nis);
    await expect(row()).toBeVisible({ timeout: 15000 });

    // `transactionNo` is stored with upper-case LDR-; a lower-case query must
    // still find it, which proves `mode: "insensitive"`.
    await search.fill(transaction.transactionNo.toLowerCase());
    await expect(row()).toBeVisible({ timeout: 15000 });

    await search.fill(`tidak-ada-${Date.now()}`);
    await expect(page.getByText("Belum ada transaksi laundry")).toBeVisible({
      timeout: 15000,
    });
  });
});

test.describe("Tarif laundry memakai akun unit usaha (R22.8)", () => {
  test("tarif yang dibuat di portal membawa pembayarannya ke akun unit usaha", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "one financial period per unit and day; the mobile project would race it",
    );
    test.setTimeout(240_000);
    const session = await apiLoginNew(LAUNDRY_ADMIN);
    const finance = await apiLoginNew(SEED_USERS.superAdmin);
    const stamp = Date.now();
    const unitName = `Zz E2E Laundry ${stamp}`;
    const firstCode = `E2E-LDR-A-${stamp}`;
    const secondCode = `E2E-LDR-B-${stamp}`;
    let businessUnitId: string | undefined;
    let secondBusinessUnitId: string | undefined;
    let unitId: string | undefined;
    let accountId: string | undefined;
    let secondAccountId: string | undefined;
    let cashAccountId: string | undefined;
    let originalCashMapping: string | null | undefined;
    let pricingId: string | undefined;
    let secondPricingId: string | undefined;

    try {
      const businessUnit = await apiRequest<{
        data: { id: string; unitId: string };
      }>(session, "POST", "/business-units", {
        name: unitName,
        code: firstCode,
        type: "LAUNDRY",
      });
      businessUnitId = businessUnit.data.id;
      unitId = businessUnit.data.unitId;

      const periods = await apiRequest<{
        data: Array<{ startDate: string; endDate: string; isClosed: boolean }>;
      }>(
        finance,
        "GET",
        `/finance-enhancement/financial-periods?unitId=${unitId}&limit=100`,
      );
      const now = new Date();
      const covering = periods.data.find(
        (period) =>
          new Date(period.startDate) <= now && new Date(period.endDate) >= now,
      );
      test.skip(
        Boolean(covering?.isClosed),
        "the unit's current financial period is closed",
      );

      const secondBusinessUnit = await apiRequest<{
        data: { id: string; unitId: string };
      }>(session, "POST", "/business-units", {
        name: unitName,
        code: secondCode,
        type: "LAUNDRY",
      });
      secondBusinessUnitId = secondBusinessUnit.data.id;

      const account = await apiRequest<{
        id: string;
        code: string;
        name: string;
      }>(finance, "POST", "/finance/accounting/accounts", {
        code: `E2E-LDR-REV-${stamp}`,
        name: `E2E Pendapatan Laundry ${stamp}`,
        type: "REVENUE",
        normalBalance: "CREDIT",
        isActive: true,
      });
      accountId = account.id;

      const secondAccount = await apiRequest<{ id: string }>(
        finance,
        "POST",
        "/finance/accounting/accounts",
        {
          code: `E2E-LDR-REV2-${stamp}`,
          name: `E2E Pendapatan Laundry B ${stamp}`,
          type: "REVENUE",
          normalBalance: "CREDIT",
          isActive: true,
        },
      );
      secondAccountId = secondAccount.id;

      const cash = await apiRequest<{ id: string }>(
        finance,
        "POST",
        "/finance/accounting/accounts",
        {
          code: `E2E-LDR-CASH-${stamp}`,
          name: `E2E Kas Laundry ${stamp}`,
          type: "ASSET",
          normalBalance: "DEBIT",
          isActive: true,
        },
      );
      cashAccountId = cash.id;

      const originalSettings = await apiRequest<{
        data: { mappings: Record<string, string | null> };
      }>(finance, "GET", `/finance/accounting/settings?unitId=${unitId}`);
      originalCashMapping = originalSettings.data.mappings.ACCOUNT_MAPPING_CASH;

      const mappingKey = `BU_${businessUnitId}_ACCOUNT_MAPPING_LAUNDRY_REVENUE`;
      const secondMappingKey = `BU_${secondBusinessUnitId}_ACCOUNT_MAPPING_LAUNDRY_REVENUE`;
      await apiRequest(finance, "POST", "/finance/accounting/settings", {
        unitId,
        settings: {
          [mappingKey]: accountId,
          [secondMappingKey]: secondAccountId,
          ACCOUNT_MAPPING_CASH: cashAccountId,
        },
      });

      await injectSession(page, session);
      await gotoAuthedPage(page, "/laundry", /^Laundry$/);
      await page.getByRole("tab", { name: /Tarif/ }).click();
      const tierName = `Setrika Unit ${stamp}`;
      await page.getByRole("button", { name: "Tambah Tarif" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Nama Layanan").fill(tierName);
      await dialog.getByLabel("Harga per Kg (Rp)").fill("9000");
      await dialog
        .getByRole("combobox", { name: "Unit Usaha Laundry" })
        .click();
      await page
        .getByRole("option", { name: `${unitName} (${firstCode})` })
        .click();
      await dialog.getByRole("button", { name: "Tambah" }).click();
      await expect(
        page.getByText("Tarif laundry berhasil ditambahkan"),
      ).toBeVisible({ timeout: 15000 });

      let storedTier:
        { id: string; name: string; businessUnitId: string | null } | undefined;
      await expect
        .poll(
          async () => {
            const rows = await apiRequest<{
              data: Array<{
                id: string;
                name: string;
                businessUnitId: string | null;
              }>;
            }>(session, "GET", "/laundry/pricing");
            storedTier = rows.data.find((row) => row.name === tierName);
            return storedTier?.businessUnitId;
          },
          { timeout: 15000 },
        )
        .toBe(businessUnitId);
      expect(storedTier, "tarif baru tidak tersimpan").toBeTruthy();
      pricingId = storedTier!.id;

      const duplicateTier = await apiRequest<{ data: { id: string } }>(
        session,
        "POST",
        "/laundry/pricing",
        {
          name: tierName,
          pricePerKg: 9000,
          minWeight: 1,
          processDays: 2,
          isExpress: false,
          isActive: true,
          businessUnitId: secondBusinessUnitId,
        },
      );
      secondPricingId = duplicateTier.data.id;

      // The duplicate was created through the API, outside React Query's
      // cache; reload so the dialog offers both equal tariffs.
      await page.reload();
      await expect(page.getByRole("tab", { name: /Transaksi/ })).toBeVisible({
        timeout: 15000,
      });

      const students = await apiRequest<{
        data: Array<{ id: string; nis: string; user: { name: string } }>;
      }>(session, "GET", "/students?limit=1");
      const student = students.data[0];
      expect(student, "seed tanpa santri").toBeTruthy();

      await page.getByRole("tab", { name: /Transaksi/ }).click();
      await page.getByRole("button", { name: /Transaksi Baru/ }).click();
      const transactionDialog = page.getByRole("dialog");
      await transactionDialog.getByLabel("Cari Santri").fill(student.user.name);
      await transactionDialog
        .getByRole("button", { name: new RegExp(student.user.name) })
        .click();
      const tariffSelect = transactionDialog.getByRole("combobox", {
        name: "Pilih tarif",
      });
      await expect(tariffSelect).toBeEnabled({ timeout: 15000 });
      await tariffSelect.click();

      const firstOption = page.getByRole("option", {
        name: new RegExp(`${tierName}.*${firstCode}`),
      });
      const secondOption = page.getByRole("option", {
        name: new RegExp(`${tierName}.*${secondCode}`),
      });
      await expect(firstOption).toBeVisible({ timeout: 15000 });
      await expect(secondOption).toBeVisible({ timeout: 15000 });
      await firstOption.click();

      const weight = transactionDialog.getByLabel("Berat (kg)");
      await weight.fill("2");
      await transactionDialog
        .getByRole("button", { name: "Buat Transaksi" })
        .click();
      await expect(
        page.getByText("Transaksi laundry berhasil dibuat"),
      ).toBeVisible({ timeout: 15000 });

      let transactionNo: string | undefined;
      await expect
        .poll(
          async () => {
            const rows = await apiRequest<{
              data: Array<{
                transactionNo: string;
                businessUnitId: string | null;
              }>;
            }>(session, "GET", "/laundry/transactions?limit=5");
            const created = rows.data.find(
              (row) => row.businessUnitId === businessUnitId,
            );
            transactionNo = created?.transactionNo;
            return transactionNo;
          },
          { timeout: 15000 },
        )
        .toBeTruthy();

      await expect
        .poll(
          async () => {
            const journal = await apiRequest<{
              data: Array<{
                accountId: string;
                credit: number;
              }>;
            }>(
              session,
              "GET",
              `/finance-enhancement/journal-entries?search=${encodeURIComponent(
                transactionNo!,
              )}&limit=20`,
            );
            const wrong = journal.data.find(
              (entry) => entry.accountId === secondAccountId,
            );
            expect(
              wrong,
              "jurnal memakai akun unit usaha yang salah",
            ).toBeUndefined();
            return journal.data.find(
              (entry) =>
                entry.accountId === accountId && Number(entry.credit) > 0,
            );
          },
          { timeout: 20000 },
        )
        .toBeTruthy();
    } finally {
      if (businessUnitId && unitId) {
        const settings: Record<string, string | null> = {
          [`BU_${businessUnitId}_ACCOUNT_MAPPING_LAUNDRY_REVENUE`]: null,
        };
        if (secondBusinessUnitId) {
          settings[
            `BU_${secondBusinessUnitId}_ACCOUNT_MAPPING_LAUNDRY_REVENUE`
          ] = null;
        }
        if (originalCashMapping !== undefined) {
          settings.ACCOUNT_MAPPING_CASH = originalCashMapping;
        }
        await apiRequest(finance, "POST", "/finance/accounting/settings", {
          unitId,
          settings,
        }).catch(() => undefined);
        for (const id of [businessUnitId, secondBusinessUnitId]) {
          if (!id) continue;
          await apiRequest(finance, "PUT", `/business-units/${id}`, {
            isActive: false,
          }).catch(() => undefined);
        }
      }
      for (const id of [pricingId, secondPricingId]) {
        if (!id) continue;
        await apiRequest(session, "DELETE", `/laundry/pricing/${id}`).catch(
          () => undefined,
        );
      }
      for (const id of [accountId, secondAccountId, cashAccountId]) {
        if (!id) continue;
        await apiRequest(finance, "PUT", `/finance/accounting/accounts/${id}`, {
          isActive: false,
        }).catch(() => undefined);
      }
    }
  });
});
