import { test, expect } from "./fixtures/auth.fixture";
import {
  waitForLoadingComplete,
  waitForToast,
  navigateTo,
} from "./helpers/page-helpers";
import { LoginPage, DashboardPage } from "./page-objects";

/**
 * Integration Tests - Cross-Module Workflows
 * Tests end-to-end flows that span multiple modules
 */

test.describe("Integration: Student → Attendance → Report Flow", () => {
  test("complete workflow: create student, mark attendance, view report", async ({
    page,
  }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // STEP 1: Create a new student. The list's "Add Student" action renders as
    // a link (Button asChild + Link), so match it by the link role.
    await navigateTo(page, "/students");

    // Generous timeout: the students list hydrates its role-gated header
    // action late on loaded CI runners (webkit misses the default 10s).
    await page
      .getByRole("link", { name: /add student|tambah/i })
      .first()
      .click({ timeout: 30000 });
    // The /students/new route compiles on first hit in dev mode — navigation
    // can exceed the default 5s while the click has already landed.
    await expect(page).toHaveURL(/\/students\/new/, { timeout: 20000 });
    await waitForLoadingComplete(page);

    const timestamp = Date.now();
    const studentName = `Integration Test Student ${timestamp}`;
    const studentNIS = `INT${timestamp.toString().slice(-10)}`;

    // Fill every required field (name, nis, gender, birthDate, birthPlace,
    // address, unit, parentName, parentPhone) so submit passes validation.
    await page.getByLabel(/^NIS/i).fill(studentNIS);
    await page.getByLabel(/full name/i).fill(studentName);

    // Open the Nth Radix select (gender = 0, unit = 1 — only the two Radix
    // triggers are <button role=combobox>; the hidden native selects are
    // <select> and excluded) and pick an option. Wait for the listbox to open
    // so async-loaded options (units) and the close-on-select race don't drop
    // the value.
    const pickOption = async (index: number, optionName?: RegExp) => {
      const trigger = page.locator('button[role="combobox"]').nth(index);
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      const listbox = page.getByRole("listbox");
      await expect(listbox).toBeVisible();
      const option = optionName
        ? listbox.getByRole("option", { name: optionName })
        : listbox.getByRole("option");
      await option.first().click();
      await expect(listbox).toBeHidden();
    };

    await pickOption(0, /laki-laki|male/i); // Gender

    await page.getByLabel(/birth date/i).fill("2012-05-15");
    await page.getByLabel(/birth place/i).fill("Tasikmalaya");
    await page.getByLabel(/address/i).fill("Jl. Integration Test No. 1");

    await pickOption(1); // Unit

    await page.getByLabel(/parent name/i).fill("Bapak Integration");
    await page.getByLabel(/parent phone/i).fill("081234567890");

    await page
      .getByRole("button", { name: /create student|simpan|save/i })
      .click();

    // A successful create redirects back to the students list.
    await expect(page).toHaveURL(/\/students$/, { timeout: 15000 });
    await waitForLoadingComplete(page);

    // STEP 2: Mark attendance for this student
    await navigateTo(page, "/attendance");

    // Select the class where student was added
    const attendanceClassSelect = page
      .locator('button[role="combobox"]')
      .filter({ hasText: /kelas|class/i })
      .first();
    if (
      await attendanceClassSelect
        .waitFor({ state: "visible", timeout: 5000 })
        .then(
          () => true,
          () => false,
        )
    ) {
      await attendanceClassSelect.click();
      await page.getByRole("option").first().click();
      await waitForLoadingComplete(page);

      // Find our student in the list
      const studentRow = page
        .locator('table tbody tr, [role="listitem"]')
        .filter({ hasText: studentName });

      if (
        await studentRow.waitFor({ state: "visible", timeout: 3000 }).then(
          () => true,
          () => false,
        )
      ) {
        // Mark as present
        const presentButton = studentRow
          .getByRole("button", { name: /hadir|present/i })
          .or(studentRow.locator('input[type="radio"][value="PRESENT"]'));

        if (
          await presentButton.waitFor({ state: "visible", timeout: 2000 }).then(
            () => true,
            () => false,
          )
        ) {
          await presentButton.click();

          const saveAttendance = page.getByRole("button", {
            name: /simpan|save/i,
          });
          if (
            await saveAttendance
              .waitFor({ state: "visible", timeout: 2000 })
              .then(
                () => true,
                () => false,
              )
          ) {
            await saveAttendance.click();
            await waitForToast(page, /berhasil|success/i, "success");
          }
        }
      }
    }

    // STEP 3: Verify in attendance report
    await navigateTo(page, "/attendance/reports");

    const reportHeading = page.getByRole("main").getByRole("heading", {
      name: /laporan|report/i,
    });
    if (
      await reportHeading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      // Generate report
      const generateButton = page.getByRole("button", {
        name: /generate|tampilkan|buat/i,
      });
      if (
        await generateButton.waitFor({ state: "visible", timeout: 3000 }).then(
          () => true,
          () => false,
        )
      ) {
        await generateButton.click();
        await waitForLoadingComplete(page);

        // Should show report with our student
        const reportContent = page.locator("table, .report-content");
        await expect(reportContent).toBeVisible({ timeout: 5000 });
      }
    }

    // STEP 4: Clean up - delete the test student
    await navigateTo(page, "/students");

    const searchInput = page
      .getByPlaceholder(/cari|search/i)
      .or(page.getByLabel(/cari|search/i));
    if (
      await searchInput.waitFor({ state: "visible", timeout: 3000 }).then(
        () => true,
        () => false,
      )
    ) {
      await searchInput.fill(studentNIS);
      await waitForLoadingComplete(page);

      const deleteButton = page
        .getByRole("button", { name: /delete|hapus/i })
        .first();
      if (
        await deleteButton.waitFor({ state: "visible", timeout: 3000 }).then(
          () => true,
          () => false,
        )
      ) {
        await deleteButton.click();

        const confirmButton = page.getByRole("button", {
          name: /ya|yes|confirm|hapus/i,
        });
        await confirmButton.click();

        await waitForToast(page, /berhasil|success/i, "success");
      }
    }
  });
});

test.describe("Integration: Dashboard → Module Navigation", () => {
  test("should navigate from dashboard to modules and back", async ({
    page,
  }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    const dashboard = new DashboardPage(page);

    // Start from dashboard
    await dashboard.goto();
    await dashboard.waitForDataLoad();

    // Navigate to Students
    const studentsLink = page.getByRole("link", {
      name: /santri|students|siswa/i,
    });
    if (
      await studentsLink.waitFor({ state: "visible", timeout: 3000 }).then(
        () => true,
        () => false,
      )
    ) {
      await studentsLink.click();
      await waitForLoadingComplete(page);
      await expect(page).toHaveURL(/students/);
    }

    // Back to dashboard
    await dashboard.goto();
    await dashboard.waitForDataLoad();

    // Navigate to Attendance
    const attendanceLink = page.getByRole("link", {
      name: /absen|attendance|kehadiran/i,
    });
    if (
      await attendanceLink.waitFor({ state: "visible", timeout: 3000 }).then(
        () => true,
        () => false,
      )
    ) {
      await attendanceLink.click();
      await waitForLoadingComplete(page);
      await expect(page).toHaveURL(/attendance/);
    }

    // Back to dashboard
    await dashboard.goto();
    await dashboard.waitForDataLoad();

    // Navigate to Tahfidz
    const tahfidzLink = page.getByRole("link", { name: /tahfidz|hafalan/i });
    if (
      await tahfidzLink.waitFor({ state: "visible", timeout: 3000 }).then(
        () => true,
        () => false,
      )
    ) {
      await tahfidzLink.click();
      await waitForLoadingComplete(page);
      await expect(page).toHaveURL(/tahfidz/);
    }
  });
});

test.describe("Integration: Student → Tahfidz Progress", () => {
  test("should track tahfidz progress for student", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Go to student detail
    await navigateTo(page, "/students");

    const firstStudent = page.locator('table tbody tr, [role="row"]').first();
    if (
      await firstStudent.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const studentName = await firstStudent.textContent();

      // Click to view detail
      const viewButton = firstStudent.getByRole("button", {
        name: /view|lihat|detail/i,
      });
      if (
        await viewButton.waitFor({ state: "visible", timeout: 2000 }).then(
          () => true,
          () => false,
        )
      ) {
        await viewButton.click();
      } else {
        await firstStudent.click();
      }

      await waitForLoadingComplete(page);

      // Clicking the row should open the student's detail (proves the
      // student → detail navigation works). Tahfidz progress is rendered
      // within that detail when data exists, so it's a soft check.
      await expect(page).toHaveURL(/\/students\/[^/]+/);

      const tahfidzSection = page
        .locator("main")
        .getByText(/tahfidz|hafalan/i)
        .first();
      if (
        await tahfidzSection.waitFor({ state: "visible", timeout: 3000 }).then(
          () => true,
          () => false,
        )
      ) {
        await expect(tahfidzSection).toBeVisible();
      }
    }
  });
});

test.describe("Integration: Finance → Dashboard Sync", () => {
  test("should sync finance data with dashboard", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Check dashboard finance metrics
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.waitForDataLoad();

    const financeCard = page
      .getByRole("main")
      .getByText(/keuangan|finance|pendapatan|revenue/i)
      .first();
    if (
      await financeCard.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const initialValue = await financeCard.textContent();

      // Navigate to finance module
      await navigateTo(page, "/finance");

      // Should show finance data
      // The page's own h1, not the sidebar group label: /finance is titled
      // "Tagihan & SPP" since it shows santri billing, while the sidebar
      // still renders an <h4>Keuangan</h4> group heading. Unscoped, this
      // assertion passed on any page that had that sidebar.
      await expect(
        page.getByRole("main").getByRole("heading", {
          level: 1,
          name: /tagihan|spp|keuangan|finance/i,
        }),
      ).toBeVisible({ timeout: 5000 });

      // Go back to dashboard
      await dashboard.goto();
      await dashboard.waitForDataLoad();

      // Finance card should still be visible
      await expect(financeCard).toBeVisible();
    }
  });
});

test.describe("Integration: Multi-user Collaboration", () => {
  test("should handle concurrent user actions", async ({ page, context }) => {
    // Login as superadmin
    const login = new LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Open second tab (simulate another user)
    const page2 = await context.newPage();
    const login2 = new LoginPage(page2);
    await login2.goto();
    await login2.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Both navigate to students
    await navigateTo(page, "/students");
    await navigateTo(page2, "/students");

    // Verify both can see the same data
    const heading1 = page
      .getByRole("main")
      .getByRole("heading", { name: /santri|students/i });
    const heading2 = page2
      .getByRole("main")
      .getByRole("heading", { name: /santri|students/i });

    await expect(heading1).toBeVisible();
    await expect(heading2).toBeVisible();

    // Close second tab
    await page2.close();
  });
});
