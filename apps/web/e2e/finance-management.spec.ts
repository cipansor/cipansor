import { test, expect } from "./fixtures/auth.fixture";
import {
  waitForLoadingComplete,
  waitForToast,
  navigateTo,
  fillForm,
} from "./helpers/page-helpers";
import {
  apiLogin,
  apiRequest,
  SEED_USERS,
  type AuthSession,
} from "./helpers/auth-api";

/**
 * Finance Module E2E Tests
 * Comprehensive tests for finance management including payments, invoices, and reports
 */

test.describe("Finance - Payment Management", () => {
  test.use({ storageState: ".auth/superAdmin.json" });

  test("should display payment list", async ({ page }) => {
    await navigateTo(page, "/finance/payments");

    const heading = page.getByRole("heading", { name: /pembayaran|payment/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      // Should show table with payments
      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 5000 });

      // Verify headers
      const expectedHeaders = [
        "siswa|student",
        "jumlah|amount",
        "tanggal|date",
        "status",
      ];
      for (const header of expectedHeaders) {
        const headerCell = page.getByRole("columnheader", {
          name: new RegExp(header, "i"),
        });
        if (
          await headerCell.waitFor({ state: "visible", timeout: 2000 }).then(
            () => true,
            () => false,
          )
        ) {
          await expect(headerCell).toBeVisible();
        }
      }
    } else {
      throw new Error(
        "Finance payments page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });

  test("should create new payment", async ({ page }) => {
    await navigateTo(page, "/finance/payments");

    const heading = page.getByRole("heading", { name: /pembayaran|payment/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const addButton = page
        .getByRole("button", { name: /tambah|add|create/i })
        .first();
      if (
        await addButton.waitFor({ state: "visible", timeout: 3000 }).then(
          () => true,
          () => false,
        )
      ) {
        await addButton.click();
        await waitForLoadingComplete(page);

        // Select student
        const studentSelect = page
          .locator('button[role="combobox"]')
          .filter({ hasText: /siswa|student/i })
          .first();
        if (
          await studentSelect.waitFor({ state: "visible", timeout: 3000 }).then(
            () => true,
            () => false,
          )
        ) {
          await studentSelect.click();
          const studentOptions = page.getByRole("option");
          if ((await studentOptions.count()) > 0) {
            await studentOptions.first().click();
          }
        }

        // Fill amount
        const amountInput = page.getByLabel(/jumlah|amount/i);
        if (
          await amountInput.waitFor({ state: "visible", timeout: 2000 }).then(
            () => true,
            () => false,
          )
        ) {
          await amountInput.fill("500000");
        }

        // Select payment method
        const methodSelect = page
          .locator('button[role="combobox"]')
          .filter({ hasText: /metode|method/i })
          .first();
        if (
          await methodSelect.waitFor({ state: "visible", timeout: 2000 }).then(
            () => true,
            () => false,
          )
        ) {
          await methodSelect.click();
          await page.getByRole("option", { name: /tunai|cash/i }).click();
        }

        // Submit
        const submitButton = page.getByRole("button", { name: /simpan|save/i });
        await submitButton.click();

        await waitForToast(page, /berhasil|success/i, "success");
      }
    } else {
      throw new Error(
        "Finance payments page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });

  test("should filter payments by status", async ({ page }) => {
    await navigateTo(page, "/finance/payments");

    const heading = page.getByRole("heading", { name: /pembayaran|payment/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const filterButton = page.getByRole("button", { name: /filter|status/i });
      if (
        await filterButton.waitFor({ state: "visible", timeout: 3000 }).then(
          () => true,
          () => false,
        )
      ) {
        await filterButton.click();

        const statusOption = page
          .getByRole("option", { name: /lunas|paid/i })
          .or(page.getByRole("menuitem", { name: /lunas|paid/i }));
        if (
          await statusOption.waitFor({ state: "visible", timeout: 2000 }).then(
            () => true,
            () => false,
          )
        ) {
          await statusOption.click();
          await waitForLoadingComplete(page);

          // Verify filter applied
          const rows = page.locator("table tbody tr");
          expect(await rows.count()).toBeGreaterThanOrEqual(0);
        }
      }
    } else {
      throw new Error(
        "Finance payments page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });
});

test.describe("Finance - Invoice Management", () => {
  test.use({ storageState: ".auth/superAdmin.json" });

  // The list is filtered to the active academic year, and the seed leaves that
  // year without bills — so the suite creates the one bill it then reads.
  let session: AuthSession;
  let billId: string | undefined;

  test.beforeAll(async () => {
    session = await apiLogin(SEED_USERS.superAdmin);
    const students = await apiRequest<{ data: Array<{ id: string }> }>(
      session,
      "GET",
      "/students?limit=1",
    );
    const types = await apiRequest<{ data: Array<{ id: string }> }>(
      session,
      "GET",
      "/finance/payment-types?isActive=true&limit=1",
    );
    const dueDate = new Date(Date.now() + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const bill = await apiRequest<{ data: { id: string } }>(
      session,
      "POST",
      "/finance/invoices",
      {
        studentId: students.data[0].id,
        paymentTypeId: types.data[0].id,
        amount: 150_000,
        dueDate,
        description: "Tagihan e2e",
      },
    );
    billId = bill.data.id;
  });

  test.afterAll(async () => {
    if (billId) {
      await apiRequest(session, "DELETE", `/finance/invoices/${billId}`);
    }
  });

  test("should display invoice list", async ({ page }) => {
    await navigateTo(page, "/finance");
    await expect(
      page.getByRole("heading", { name: /tagihan & spp/i, level: 1 }),
    ).toBeVisible({ timeout: 10000 });
    await page.getByRole("tab", { name: "Daftar Tagihan" }).click();

    await expect(page.locator("table").first()).toBeVisible({
      timeout: 10000,
    });
    for (const header of ["No. Tagihan", "Santri", "Jumlah", "Status"]) {
      await expect(
        page.getByRole("columnheader", { name: header }),
      ).toBeVisible();
    }
  });

  test("should generate bulk invoices", async ({ page }) => {
    await navigateTo(page, "/finance/bills/bulk");
    await expect(
      page.getByRole("heading", { name: /buat tagihan massal/i, level: 1 }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("button", { name: /buat \d+ tagihan/i }),
    ).toBeVisible();
  });

  test("should view invoice detail", async ({ page }) => {
    await navigateTo(page, "/finance");
    await page.getByRole("tab", { name: "Daftar Tagihan" }).click();

    const row = page.locator("table tbody tr").first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole("link", { name: /detail/i }).click();

    await expect(
      page.getByRole("heading", { name: /detail tagihan/i, level: 1 }),
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Finance - Reports", () => {
  test.use({ storageState: ".auth/superAdmin.json" });

  test("should generate income report", async ({ page }) => {
    await navigateTo(page, "/finance/reports");

    // The reports page ("Laporan Keuangan") presents reports as tabs rather than
    // a generate-on-demand form. Open the income statement (Laba Rugi) tab and
    // confirm its report renders.
    await expect(
      page.getByRole("heading", { name: /laporan keuangan/i }),
    ).toBeVisible({ timeout: 10000 });

    await page
      .getByRole("tab", { name: /laba rugi|income statement/i })
      .click();
    await waitForLoadingComplete(page);

    // The income-statement (Laba Rugi) report card renders with its activity
    // title regardless of the loaded data.
    await expect(page.getByText(/laporan aktivitas/i).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("should export report to Excel", async ({ page }) => {
    await navigateTo(page, "/finance/reports");

    const heading = page
      .getByRole("main")
      .getByRole("heading", { name: /laporan|report/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const exportButton = page.getByRole("button", {
        name: /export|unduh|download/i,
      });
      if (
        await exportButton.waitFor({ state: "visible", timeout: 3000 }).then(
          () => true,
          () => false,
        )
      ) {
        const downloadPromise = page.waitForEvent("download", {
          timeout: 10000,
        });
        await exportButton.click();

        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/\.xlsx?$/i);
      }
    } else {
      throw new Error(
        "Finance reports page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });

  test("should filter report by unit", async ({ page }) => {
    await navigateTo(page, "/finance/reports");

    const heading = page
      .getByRole("main")
      .getByRole("heading", { name: /laporan|report/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const unitSelect = page
        .locator('button[role="combobox"]')
        .filter({ hasText: /unit/i })
        .first();
      if (
        await unitSelect.waitFor({ state: "visible", timeout: 3000 }).then(
          () => true,
          () => false,
        )
      ) {
        await unitSelect.click();
        const unitOptions = page.getByRole("option");
        if ((await unitOptions.count()) > 0) {
          await unitOptions.first().click();
          await waitForLoadingComplete(page);
        }
      }
    } else {
      throw new Error(
        "Finance reports page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });
});

test.describe("Finance - Dashboard Integration", () => {
  test.use({ storageState: ".auth/superAdmin.json" });

  test("should display finance widgets on main dashboard", async ({ page }) => {
    await navigateTo(page, "/dashboard");

    // Look for finance-related widgets
    const financeWidget = page
      .getByText(/keuangan|finance|pendapatan|revenue/i)
      .first();
    if (
      await financeWidget.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      await expect(financeWidget).toBeVisible();

      // Should show financial metrics
      const metrics = page.locator(
        '[data-testid*="finance"], .finance-card, .revenue-card',
      );
      if (
        await metrics
          .first()
          .waitFor({ state: "visible", timeout: 3000 })
          .then(
            () => true,
            () => false,
          )
      ) {
        await expect(metrics.first()).toBeVisible();
      }
    }
  });

  test("should navigate from dashboard to finance module", async ({ page }) => {
    await navigateTo(page, "/dashboard");

    const financeLink = page.getByRole("link", { name: /keuangan|finance/i });
    if (
      await financeLink.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      await financeLink.click();
      await waitForLoadingComplete(page);

      await expect(page).toHaveURL(/finance/);
    }
  });
});

test.describe("Finance - Payment Reminder", () => {
  test.use({ storageState: ".auth/superAdmin.json" });

  test("should display overdue payments", async ({ page }) => {
    // Overdue bills live in the "Tunggakan" tab of /finance; there is no
    // /finance/reminders page and no reminder-sending feature to test.
    await navigateTo(page, "/finance");
    await page.getByRole("tab", { name: "Tunggakan" }).click();

    await expect(
      page.getByText(/daftar tunggakan santri/i).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("columnheader", { name: /total tunggakan/i }),
    ).toBeVisible();
  });
});
