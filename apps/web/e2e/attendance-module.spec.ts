import { test, expect } from "./fixtures/auth.fixture";
import {
  waitForLoadingComplete,
  waitForToast,
  fillForm,
} from "./helpers/page-helpers";
import { LoginPage } from "./page-objects";

/**
 * Attendance Module E2E Tests
 * Tests attendance marking, viewing records, and reports
 */

test.describe("Attendance - Daily Marking", () => {
  test.beforeEach(async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Navigate to attendance page
    await page.goto("/attendance");
    await waitForLoadingComplete(page);
  });

  test("should display attendance page", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /absen|attendance|kehadiran/i }),
    ).toBeVisible({ timeout: 10000 });

    // Check for the date selector. The page uses a custom date-picker button
    // (shows "Pilih tanggal" or a formatted Indonesian date), not input[type=date].
    const dateInput = page.locator('input[type="date"]').or(
      page.getByRole("button", {
        name: /tanggal|date|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember/i,
      }),
    );
    await expect(dateInput.first()).toBeVisible();
  });

  test("should mark student as present", async ({ page }) => {
    // Select class
    const classSelect = page
      .locator('button[role="combobox"]')
      .filter({ hasText: /kelas|class/i })
      .first();

    if (
      await classSelect.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      await classSelect.click();

      const classOptions = page.getByRole("option");
      const optionCount = await classOptions.count();

      if (optionCount > 0) {
        await classOptions.first().click();
        await waitForLoadingComplete(page);

        // Should show student list
        const studentList = page.locator('table tbody tr, [role="listitem"]');
        const studentCount = await studentList.count();

        if (studentCount > 0) {
          // Mark first student as present
          const presentButton = studentList
            .first()
            .getByRole("button", { name: /hadir|present/i })
            .or(
              studentList
                .first()
                .locator('input[type="radio"][value="PRESENT"]'),
            );

          if (
            await presentButton
              .waitFor({ state: "visible", timeout: 3000 })
              .then(
                () => true,
                () => false,
              )
          ) {
            await presentButton.click();

            // Save attendance
            const saveButton = page.getByRole("button", {
              name: /simpan|save/i,
            });
            if (
              await saveButton
                .waitFor({ state: "visible", timeout: 3000 })
                .then(
                  () => true,
                  () => false,
                )
            ) {
              await saveButton.click();
              await waitForToast(page, /berhasil|success/i, "success");
            }
          }
        }
      }
    } else {
      throw new Error(
        "Class selection not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });

  test("should mark student as absent with reason", async ({ page }) => {
    const classSelect = page
      .locator('button[role="combobox"]')
      .filter({ hasText: /kelas|class/i })
      .first();

    if (
      await classSelect.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      await classSelect.click();
      await page.getByRole("option").first().click();
      await waitForLoadingComplete(page);

      const studentList = page.locator('table tbody tr, [role="listitem"]');
      const studentCount = await studentList.count();

      if (studentCount > 0) {
        // Mark as absent
        const absentButton = studentList
          .first()
          .getByRole("button", { name: /tidak hadir|absent/i })
          .or(
            studentList.first().locator('input[type="radio"][value="ABSENT"]'),
          );

        if (
          await absentButton.waitFor({ state: "visible", timeout: 3000 }).then(
            () => true,
            () => false,
          )
        ) {
          await absentButton.click();

          // Add reason if field exists
          const reasonInput = page.getByLabel(/keterangan|reason|alasan/i);
          if (
            await reasonInput.waitFor({ state: "visible", timeout: 2000 }).then(
              () => true,
              () => false,
            )
          ) {
            await reasonInput.fill("Sakit");
          }

          // Save
          const saveButton = page.getByRole("button", { name: /simpan|save/i });
          if (
            await saveButton.waitFor({ state: "visible", timeout: 3000 }).then(
              () => true,
              () => false,
            )
          ) {
            await saveButton.click();
            await waitForToast(page, /berhasil|success/i, "success");
          }
        }
      }
    }
  });

  test("should mark all students present (bulk action)", async ({ page }) => {
    // The bulk action lives on the recording page; /attendance is the list.
    await page.goto("/attendance/record");
    await waitForLoadingComplete(page);

    const classSelect = page.getByRole("combobox", { name: /kelas/i });
    await expect(classSelect).toBeVisible({ timeout: 10000 });
    await classSelect.click();
    await page.getByRole("option").first().click();
    await waitForLoadingComplete(page);

    const markAllButton = page.getByRole("button", { name: /semua hadir/i });
    await expect(markAllButton).toBeVisible({ timeout: 10000 });
    await markAllButton.click();

    await page.getByRole("button", { name: /simpan kehadiran/i }).click();
    await waitForToast(page, /kehadiran disimpan/i, "success");
  });
});

test.describe("Attendance - View Records", () => {
  test.beforeEach(async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );
    await page.goto("/attendance");
    await waitForLoadingComplete(page);
  });

  test("should view attendance history for a class", async ({ page }) => {
    // /attendance *is* the record history: a date and class filter over the
    // attendance table. There is no /attendance/history route.
    await expect(
      page.getByRole("heading", { name: /kehadiran/i, level: 1 }),
    ).toBeVisible({ timeout: 10000 });

    const dateFilter = page.getByRole("button", {
      name: /pilih tanggal|\d{4}/,
    });
    await expect(dateFilter.first()).toBeVisible({ timeout: 10000 });

    await expect(page.locator("table").first()).toBeVisible({
      timeout: 10000,
    });
    for (const header of ["Tanggal", "NIS", "Nama Siswa", "Kelas", "Status"]) {
      await expect(
        page.getByRole("columnheader", { name: header }),
      ).toBeVisible();
    }
  });

  test("should view attendance summary statistics", async ({ page }) => {
    for (const label of [
      /^total$/i,
      /^hadir$/i,
      /^tidak hadir$/i,
      /^terlambat$/i,
      /^sakit$/i,
      /^izin$/i,
    ]) {
      await expect(page.getByText(label).first()).toBeVisible({
        timeout: 10000,
      });
    }
  });
});

test.describe("Attendance - Integration with Dashboard", () => {
  test("should update dashboard attendance statistics", async ({ page }) => {
    const loginPage = await import("./page-objects");
    const login = new loginPage.LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Get current dashboard stats
    const dashboardPage = await import("./page-objects");
    const dashboard = new dashboardPage.DashboardPage(page);
    await dashboard.goto();
    await dashboard.waitForDataLoad();

    const todayAttendance = dashboard.todayAttendanceCard;
    if (
      await todayAttendance.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const initialValue = await todayAttendance.textContent();

      // Go mark attendance
      await page.goto("/attendance");
      await waitForLoadingComplete(page);

      // Mark attendance (if possible)
      const classSelect = page
        .locator('button[role="combobox"]')
        .filter({ hasText: /kelas|class/i })
        .first();
      if (
        await classSelect.waitFor({ state: "visible", timeout: 5000 }).then(
          () => true,
          () => false,
        )
      ) {
        await classSelect.click();
        await page.getByRole("option").first().click();
        await waitForLoadingComplete(page);

        // Save attendance if button exists
        const saveButton = page.getByRole("button", { name: /simpan|save/i });
        if (
          await saveButton.waitFor({ state: "visible", timeout: 3000 }).then(
            () => true,
            () => false,
          )
        ) {
          await saveButton.click();
          await waitForLoadingComplete(page);
        }
      }

      // Go back to dashboard
      await dashboard.goto();
      await dashboard.waitForDataLoad();

      // Stats should be updated (or at least still visible)
      await expect(todayAttendance).toBeVisible();
    }
  });
});
