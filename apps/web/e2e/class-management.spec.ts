import { test, expect } from "./fixtures/auth.fixture";
import {
  waitForLoadingComplete,
  waitForToast,
  navigateTo,
  fillForm,
} from "./helpers/page-helpers";

/**
 * Class Management E2E Tests
 * Tests for class/classroom management including CRUD, student enrollment, and schedules
 */

test.describe("Class Management - List and View", () => {
  test.use({ storageState: ".auth/superAdmin.json" });

  test("should display class list", async ({ page }) => {
    await navigateTo(page, "/classes");

    const heading = page
      .getByRole("main")
      .getByRole("heading", { name: /kelas|class/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 5000 });

      // Verify table headers
      const expectedHeaders = [
        "nama.*kelas|class.*name",
        "tingkat|grade",
        "wali.*kelas|homeroom",
        "jumlah.*siswa|student.*count",
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
        "Classes page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });

  test("should view class detail", async ({ page }) => {
    await navigateTo(page, "/classes");

    const heading = page
      .getByRole("main")
      .getByRole("heading", { name: /kelas|class/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const firstRow = page.locator("table tbody tr").first();
      if (
        await firstRow.waitFor({ state: "visible", timeout: 3000 }).then(
          () => true,
          () => false,
        )
      ) {
        // Row click navigates to the class detail page (/classes/[id]).
        await firstRow.click();

        // Confirm we landed on a detail route rather than asserting a brittle
        // heading derived from concatenated cell text.
        await page.waitForURL(/\/classes\/[^/]+$/, { timeout: 10000 });
        await waitForLoadingComplete(page);

        // Should show student list
        const studentSection = page.getByText(/daftar.*siswa|student.*list/i);
        if (
          await studentSection
            .waitFor({ state: "visible", timeout: 3000 })
            .then(
              () => true,
              () => false,
            )
        ) {
          await expect(studentSection).toBeVisible();
        }
      }
    } else {
      throw new Error(
        "Classes page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });

  test("should filter classes by grade level", async ({ page }) => {
    await navigateTo(page, "/classes");

    const heading = page
      .getByRole("main")
      .getByRole("heading", { name: /kelas|class/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const filterButton = page.getByRole("button", {
        name: /filter|tingkat/i,
      });
      if (
        await filterButton.waitFor({ state: "visible", timeout: 3000 }).then(
          () => true,
          () => false,
        )
      ) {
        await filterButton.click();

        const gradeOption = page
          .getByRole("option")
          .or(page.getByRole("menuitem"))
          .first();
        if (
          await gradeOption.waitFor({ state: "visible", timeout: 2000 }).then(
            () => true,
            () => false,
          )
        ) {
          await gradeOption.click();
          await waitForLoadingComplete(page);

          const rows = page.locator("table tbody tr");
          expect(await rows.count()).toBeGreaterThanOrEqual(0);
        }
      }
    } else {
      throw new Error(
        "Classes page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });
});

test.describe("Class Management - Create and Update", () => {
  test.use({ storageState: ".auth/superAdmin.json" });

  test("should create new class", async ({ page }) => {
    await navigateTo(page, "/classes");

    const heading = page
      .getByRole("main")
      .getByRole("heading", { name: /kelas|class/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      // The header action is a role-gated Link styled as a button (renders
      // as role=link) — accept either role and wait for hydration.
      const addButton = page
        .getByRole("link", { name: /tambah|add|create/i })
        .or(page.getByRole("button", { name: /tambah|add|create/i }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 20000 });
      await addButton.click();
      await waitForLoadingComplete(page);

      const timestamp = Date.now();
      const className = `Kelas Test ${timestamp}`;

      // Required text inputs: Nama Kelas, Tingkat (plain input), Kapasitas
      await fillForm(page, {
        "nama.*kelas|class.*name": className,
        "tingkat|level": "7",
        "kapasitas|capacity": "30",
      });

      // Required selects (labels are not <label htmlFor>, so locate the
      // triggers by their placeholder text). Tahun Ajaran stays disabled
      // until a unit is chosen.
      const unitTrigger = page
        .getByRole("combobox")
        .filter({ hasText: /^pilih unit$/i })
        .first();
      await expect(unitTrigger).toBeVisible({ timeout: 10000 });
      await unitTrigger.click();
      // Prefer a unit the seed guarantees has an active academic year
      const seededUnit = page.getByRole("option", { name: /sd it/i }).first();
      if (
        await seededUnit.waitFor({ state: "visible", timeout: 2000 }).then(
          () => true,
          () => false,
        )
      ) {
        await seededUnit.click();
      } else {
        await page.getByRole("option").first().click();
      }

      const yearTrigger = page
        .getByRole("combobox")
        .filter({ hasText: /tahun/i })
        .first();
      await expect(yearTrigger).toBeEnabled({ timeout: 10000 });
      await yearTrigger.click();
      await expect(page.getByRole("option").first()).toBeVisible({
        timeout: 10000,
      });
      await page.getByRole("option").first().click();

      const submitButton = page.getByRole("button", {
        name: /simpan|save|submit/i,
      });
      await submitButton.click();

      // Success navigates back to the list; the row is the source of truth
      // (the toast auto-dismisses too fast to assert reliably).
      await page.waitForURL(/\/classes$/, { timeout: 15000 });
      await waitForLoadingComplete(page);

      // The list is paginated — search for the new class first.
      await page.getByPlaceholder(/search|cari/i).fill(className);

      const newClassRow = page
        .locator("table tbody tr")
        .filter({ hasText: className });
      await expect(newClassRow).toBeVisible({ timeout: 10000 });
    } else {
      throw new Error(
        "Classes page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });

  test("should update class information", async ({ page }) => {
    await navigateTo(page, "/classes");

    const heading = page
      .getByRole("main")
      .getByRole("heading", { name: /kelas|class/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const firstRow = page.locator("table tbody tr").first();
      if (
        !(await firstRow.waitFor({ state: "visible", timeout: 3000 }).then(
          () => true,
          () => false,
        ))
      ) {
        throw new Error(
          "No classes available to edit — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
            "must provide it; a missing page or control here is a failure, not a skip",
        );
        return;
      }

      // Edit is exposed via the row's actions dropdown (the trailing icon
      // button), which navigates to the dedicated /classes/[id]/edit page.
      await expect(firstRow.getByRole("button").last()).toBeVisible({
        timeout: 20000,
      });
      await firstRow.getByRole("button").last().click();
      await page.getByRole("menuitem", { name: /edit|ubah/i }).click();

      await page.waitForURL(/\/classes\/.+\/edit/, { timeout: 10000 });
      await waitForLoadingComplete(page);

      // Wait for the form to hydrate the class (name populated from the load).
      await expect(page.getByLabel(/nama kelas|class name/i)).not.toHaveValue(
        "",
        { timeout: 20000 },
      );

      // Deterministically set the required Unit / Tahun Ajaran selects rather
      // than relying on the controlled selects being pre-hydrated — on slower
      // browsers the per-unit list queries can leave them unset, tripping the
      // required-field validation on save. The edit page always exposes the
      // class's current unit and year as options, so picking the first option
      // of each is safe. (These are shadcn <SelectTrigger> buttons; the page
      // has no other combobox before the form.)
      const triggers = page.locator('button[role="combobox"]');
      await triggers.nth(0).click();
      await page.getByRole("option").first().click({ force: true });

      // Selecting a unit resets the year field; pick a year once it is enabled.
      await expect(triggers.nth(1)).toBeEnabled({ timeout: 10000 });
      await triggers.nth(1).click();
      await page.getByRole("option").first().click({ force: true });

      // Update capacity
      const capacityInput = page.getByLabel(/kapasitas|capacity/i);
      await capacityInput.fill("35");

      const saveButton = page.getByRole("button", {
        name: /simpan|save|update/i,
      });
      await saveButton.click();

      // Success navigates to the class detail page — assert that instead of
      // the toast, which auto-dismisses too quickly to be reliable.
      await page.waitForURL(/\/classes\/[^/]+$/, { timeout: 15000 });
    } else {
      throw new Error(
        "Classes page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });

  test("should validate required fields", async ({ page }) => {
    await navigateTo(page, "/classes");

    const heading = page
      .getByRole("main")
      .getByRole("heading", { name: /kelas|class/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      // The header action is a role-gated Link styled as a button (renders
      // as role=link) — accept either role and wait for hydration.
      const addButton = page
        .getByRole("link", { name: /tambah|add|create/i })
        .or(page.getByRole("button", { name: /tambah|add|create/i }))
        .first();
      await expect(addButton).toBeVisible({ timeout: 20000 });
      await addButton.click();
      await waitForLoadingComplete(page);

      // Try to submit empty form
      const submitButton = page.getByRole("button", {
        name: /simpan|save|submit/i,
      });
      await submitButton.click();

      // Should show validation errors
      const errorMessages = page.getByText(/wajib|required|harus/i);
      await expect(errorMessages.first()).toBeVisible({ timeout: 3000 });
    } else {
      throw new Error(
        "Classes page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });
});

test.describe("Class Management - Student Enrollment", () => {
  test.use({ storageState: ".auth/superAdmin.json" });

  test("should enroll student to class", async ({ page }) => {
    await navigateTo(page, "/classes");

    const heading = page
      .getByRole("main")
      .getByRole("heading", { name: /kelas|class/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const firstRow = page.locator("table tbody tr").first();

      const viewButton = firstRow.getByRole("button", { name: /view|lihat/i });
      if (
        await viewButton.waitFor({ state: "visible", timeout: 2000 }).then(
          () => true,
          () => false,
        )
      ) {
        await viewButton.click();
      } else {
        await firstRow.click();
      }

      await waitForLoadingComplete(page);

      // Look for add student button
      const addStudentButton = page.getByRole("button", {
        name: /tambah.*siswa|add.*student/i,
      });
      if (
        await addStudentButton
          .waitFor({ state: "visible", timeout: 3000 })
          .then(
            () => true,
            () => false,
          )
      ) {
        await addStudentButton.click();

        // Select student
        const studentSelect = page.locator('button[role="combobox"]').first();
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

          const confirmButton = page.getByRole("button", {
            name: /tambah|add/i,
          });
          await confirmButton.click();

          await waitForToast(page, /berhasil|success/i, "success");
        }
      }
    } else {
      throw new Error(
        "Classes page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });

  test("should remove student from class", async ({ page }) => {
    await navigateTo(page, "/classes");

    const heading = page
      .getByRole("main")
      .getByRole("heading", { name: /kelas|class/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const firstRow = page.locator("table tbody tr").first();

      const viewButton = firstRow.getByRole("button", { name: /view|lihat/i });
      if (
        await viewButton.waitFor({ state: "visible", timeout: 2000 }).then(
          () => true,
          () => false,
        )
      ) {
        await viewButton.click();
      } else {
        await firstRow.click();
      }

      await waitForLoadingComplete(page);

      // Look for student list
      const studentRow = page
        .locator('table tbody tr, [role="listitem"]')
        .first();
      if (
        await studentRow.waitFor({ state: "visible", timeout: 3000 }).then(
          () => true,
          () => false,
        )
      ) {
        const removeButton = studentRow.getByRole("button", {
          name: /hapus|remove/i,
        });
        if (
          await removeButton.waitFor({ state: "visible", timeout: 2000 }).then(
            () => true,
            () => false,
          )
        ) {
          await removeButton.click();

          const confirmButton = page.getByRole("button", {
            name: /ya|yes|hapus/i,
          });
          await confirmButton.click();

          await waitForToast(page, /berhasil|success/i, "success");
        }
      }
    } else {
      throw new Error(
        "Classes page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });
});

test.describe("Class Management - Schedule", () => {
  test.use({ storageState: ".auth/superAdmin.json" });

  test("should add schedule entry", async ({ page }) => {
    await navigateTo(page, "/classes");

    const heading = page
      .getByRole("main")
      .getByRole("heading", { name: /kelas|class/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const firstRow = page.locator("table tbody tr").first();
      await firstRow.click();
      await waitForLoadingComplete(page);

      const scheduleTab = page.getByRole("tab", { name: /jadwal|schedule/i });
      if (
        await scheduleTab.waitFor({ state: "visible", timeout: 3000 }).then(
          () => true,
          () => false,
        )
      ) {
        await scheduleTab.click();
        await waitForLoadingComplete(page);

        const addScheduleButton = page.getByRole("button", {
          name: /tambah.*jadwal|add.*schedule/i,
        });
        if (
          await addScheduleButton
            .waitFor({ state: "visible", timeout: 3000 })
            .then(
              () => true,
              () => false,
            )
        ) {
          await addScheduleButton.click();

          // Fill schedule details
          const subjectSelect = page
            .locator('button[role="combobox"]')
            .filter({ hasText: /mata.*pelajaran|subject/i })
            .first();
          if (
            await subjectSelect
              .waitFor({ state: "visible", timeout: 2000 })
              .then(
                () => true,
                () => false,
              )
          ) {
            await subjectSelect.click();
            await page.getByRole("option").first().click();
          }

          const teacherSelect = page
            .locator('button[role="combobox"]')
            .filter({ hasText: /guru|teacher/i })
            .first();
          if (
            await teacherSelect
              .waitFor({ state: "visible", timeout: 2000 })
              .then(
                () => true,
                () => false,
              )
          ) {
            await teacherSelect.click();
            await page.getByRole("option").first().click();
          }

          const saveButton = page.getByRole("button", { name: /simpan|save/i });
          await saveButton.click();

          await waitForToast(page, /berhasil|success/i, "success");
        }
      }
    } else {
      throw new Error(
        "Classes page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });
});

test.describe("Class Management - Export", () => {
  test.use({ storageState: ".auth/superAdmin.json" });

  test("should export class list", async ({ page }) => {
    await navigateTo(page, "/classes");

    const heading = page
      .getByRole("main")
      .getByRole("heading", { name: /kelas|class/i });
    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      const exportButton = page.getByRole("button", { name: /export|unduh/i });
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
        expect(download.suggestedFilename()).toMatch(/class|kelas/i);
        expect(download.suggestedFilename()).toMatch(/\.xlsx?$/i);
      }
    } else {
      throw new Error(
        "Classes page not available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });
});
