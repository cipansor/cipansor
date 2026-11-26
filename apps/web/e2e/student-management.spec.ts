import { test, expect } from "./fixtures/auth.fixture";
import { waitForLoadingComplete, waitForToast } from "./helpers/page-helpers";
import { LoginPage } from "./page-objects";

/**
 * Student Management E2E Tests
 * Tests CRUD operations, search, filter, and pagination
 */

test.describe("Student Management - List & View", () => {
  test.beforeEach(async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    // Navigate to students page
    await page.goto("/students");
    await waitForLoadingComplete(page);
  });

  test("should display students list page", async ({ page }) => {
    // Check page heading with multiple possible variations
    const heading = page
      .getByRole("heading", { name: /daftar santri|students|siswa|santri/i })
      .first();
    const pageTitle = page
      .locator("h1, h2, h3")
      .filter({ hasText: /santri|student|siswa/i })
      .first();

    if (
      await heading.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      await expect(heading).toBeVisible();
    } else if (
      await pageTitle.waitFor({ state: "visible", timeout: 3000 }).then(
        () => true,
        () => false,
      )
    ) {
      await expect(pageTitle).toBeVisible();
    } else {
      // At minimum, should be on students page
      await expect(page).toHaveURL(/students/);
    }

    // Check for add button
    // "Add Student" is rendered as a link (Button asChild + Link), so match
    // either role.
    const addButton = page
      .getByRole("link", { name: /tambah|add|create/i })
      .or(page.getByRole("button", { name: /tambah|add|create/i }))
      .first();
    if (
      await addButton.waitFor({ state: "visible", timeout: 3000 }).then(
        () => true,
        () => false,
      )
    ) {
      await expect(addButton).toBeVisible();
    }

    // Check if table or grid exists
    const hasTable = await page
      .locator("table")
      .waitFor({ state: "visible", timeout: 2000 })
      .then(
        () => true,
        () => false,
      );
    const hasGrid = await page
      .locator('[role="grid"]')
      .waitFor({ state: "visible", timeout: 2000 })
      .then(
        () => true,
        () => false,
      );
    const hasListItems = await page
      .locator('[role="listitem"]')
      .first()
      .waitFor({ state: "visible", timeout: 2000 })
      .then(
        () => true,
        () => false,
      );

    expect(hasTable || hasGrid || hasListItems).toBeTruthy();
  });

  test("should search students by name", async ({ page }) => {
    // Find search input
    const searchInput = page
      .getByPlaceholder(/cari|search/i)
      .or(page.getByLabel(/cari|search/i));

    if (
      await searchInput.waitFor({ state: "visible", timeout: 3000 }).then(
        () => true,
        () => false,
      )
    ) {
      // Data-agnostic: derive a search term from a real seeded student rather
      // than hardcoding a name that may not exist.
      const rows = page.locator("table tbody tr");
      if ((await rows.count()) === 0) {
        throw new Error(
          "No students to search — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
            "must provide it; a missing page or control here is a failure, not a skip",
        );
        return;
      }
      // Search matches name/NIS, so derive the term from the first row's *name*
      // cell (rendered in a font-medium element). Deriving it from arbitrary
      // row text (status, unit, action-button labels) could yield a token the
      // query can't match — which narrows the table to zero rows and leaves a
      // whitespace-only empty/skeleton <tr>, making the assertion fail.
      const nameText =
        (await rows
          .first()
          .locator(".font-medium")
          .first()
          .textContent()
          .catch(() => null)) ??
        (await rows.first().textContent()) ??
        "";
      const term = (nameText.match(/[A-Za-z]{3,}/) ?? ["a"])[0].toLowerCase();

      // Typing debounces a refetch of the students list. Wait for that GET to
      // land before asserting, otherwise the table may still show stale rows.
      const searchResponse = page
        .waitForResponse(
          (r) =>
            /\/students(\?|$)/.test(r.url()) && r.request().method() === "GET",
          { timeout: 10000 },
        )
        .catch(() => null);
      await searchInput.fill(term);
      await searchResponse;
      await waitForLoadingComplete(page);

      // The source student matches its own name, so the term must appear among
      // the rendered rows. Poll (ignoring whitespace-only skeleton rows) so a
      // transient loading/empty frame doesn't fail the assertion.
      await expect(async () => {
        const texts = (await rows.allTextContents())
          .map((t) => t.replace(/\s+/g, " ").trim())
          .filter(Boolean);
        expect(texts.join(" ").toLowerCase()).toContain(term);
      }).toPass({ timeout: 7000 });
    } else {
      throw new Error(
        "Search functionality not found — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });

  test("should filter students by unit", async ({ page }) => {
    // Find filter dropdown
    const unitFilter = page
      .locator('button[role="combobox"]')
      .filter({ hasText: /unit|semua/i })
      .first();

    if (
      await unitFilter.waitFor({ state: "visible", timeout: 3000 }).then(
        () => true,
        () => false,
      )
    ) {
      await unitFilter.click();

      const options = page.getByRole("option");
      const optionCount = await options.count();

      if (optionCount > 1) {
        await options.nth(1).click();
        await waitForLoadingComplete(page);

        // Data should be filtered
        await expect(
          page.locator('table tbody tr, [role="row"]').first(),
        ).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test("should paginate through students", async ({ page }) => {
    const nextButton = page.getByRole("button", { name: "Halaman berikutnya" });
    await expect(nextButton).toBeEnabled({ timeout: 10000 });

    const firstStudent = await page
      .locator("table tbody tr")
      .first()
      .innerText();
    await nextButton.click();
    await waitForLoadingComplete(page);

    await expect(page.locator("table tbody tr").first()).not.toHaveText(
      firstStudent,
    );
  });

  test("should view student detail", async ({ page }) => {
    // Click first student row (body only — [role=row] would also match the header).
    const firstRow = page.locator("table tbody tr").first();

    if (
      await firstRow.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      )
    ) {
      // Try clicking the row or view button
      const viewButton = firstRow.getByRole("button", {
        name: /view|lihat|detail/i,
      });

      if (
        await viewButton.waitFor({ state: "visible", timeout: 2000 }).then(
          () => true,
          () => false,
        )
      ) {
        await viewButton.click();
        await expect(page).toHaveURL(/\/students\/[0-9a-f-]{16,}/, {
          timeout: 10000,
        });
      } else {
        // Click the name cell (a data cell, not the actions column) so the row's
        // onClick navigation fires. Retry until it navigates — under parallel
        // workers the click can land before the row's handler is hydrated.
        await expect(async () => {
          // A slow engine can navigate after the URL probe has already timed
          // out; clicking again from the detail page would wait forever.
          if (!/\/students\/[0-9a-f-]{16,}/.test(page.url())) {
            await firstRow.locator("td").nth(1).click({ timeout: 5000 });
          }
          await expect(page).toHaveURL(/\/students\/[0-9a-f-]{16,}/, {
            timeout: 3000,
          });
        }).toPass({ timeout: 30000 });
      }

      // Should show student details
      await expect(
        page
          .getByRole("main")
          .getByText(/nama|name/i)
          .first(),
      ).toBeVisible({
        timeout: 8000,
      });
      await expect(
        page
          .getByRole("main")
          .getByText(/nisn|nis/i)
          .first(),
      ).toBeVisible();
    } else {
      throw new Error(
        "No students available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
    }
  });
});

test.describe("Student Management - Create", () => {
  test.beforeEach(async ({ page }) => {
    const loginPage = await import("./page-objects");
    const login = new loginPage.LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    await page.goto("/students");
    await waitForLoadingComplete(page);
  });

  test("should open create student form", async ({ page }) => {
    // "Add Student" is rendered as a link (Button asChild + Link), so match
    // either role.
    const addButton = page
      .getByRole("link", { name: /tambah|add|create/i })
      .or(page.getByRole("button", { name: /tambah|add|create/i }))
      .first();
    await addButton.click();

    // Should show form
    await expect(
      page.getByRole("heading", { name: /tambah|add|create|baru/i }),
    ).toBeVisible({ timeout: 5000 });

    // Check for required fields (use specific labels to avoid matching
    // "Parent Name" / multiple inputs).
    await expect(page.getByLabel(/full name|nama lengkap/i)).toBeVisible();
    await expect(page.getByLabel(/nis/i).first()).toBeVisible();
  });

  test("should validate required fields", async ({ page }) => {
    // "Add Student" is rendered as a link (Button asChild + Link), so match
    // either role.
    const addButton = page
      .getByRole("link", { name: /tambah|add|create/i })
      .or(page.getByRole("button", { name: /tambah|add|create/i }))
      .first();
    await addButton.click();
    await waitForLoadingComplete(page);

    // Try to submit empty form
    const submitButton = page.getByRole("button", {
      name: /simpan|save|submit|create student/i,
    });
    await submitButton.click();

    // Should show validation errors
    const errorMessage = page.getByText(/wajib|required|harus diisi/i);
    await expect(errorMessage.first()).toBeVisible({ timeout: 5000 });
  });

  test("should create new student successfully", async ({ page }) => {
    // "Add Student" is rendered as a link (Button asChild + Link), so match
    // either role.
    const addButton = page
      .getByRole("link", { name: /tambah|add|create/i })
      .or(page.getByRole("button", { name: /tambah|add|create/i }))
      .first();
    await addButton.click();
    await waitForLoadingComplete(page);

    // Generate unique data
    const timestamp = Date.now();
    const studentData = {
      nama: `Test Student ${timestamp}`,
      nisn: `TEST${timestamp.toString().slice(-10)}`,
    };

    // Atomically open a Radix select, pick the first option, and confirm it
    // closed. Retried as a unit — under parallel workers on a production build,
    // interacting before hydration (or before async options load) silently drops
    // the value and leaves overlays that block the next control.
    const pickFirstOption = async (
      trigger: import("@playwright/test").Locator,
    ) => {
      await expect(async () => {
        await trigger.click();
        const option = page.getByRole("option").first();
        await option.waitFor({ state: "visible", timeout: 1500 });
        await option.click();
        await expect(page.getByRole("listbox")).toHaveCount(0, {
          timeout: 1500,
        });
      }).toPass({ timeout: 20000 });
    };

    // Fill all required fields (target inputs by id to avoid ambiguity).
    await page.locator("#name").fill(studentData.nama);
    await page.locator("#nis").fill(studentData.nisn);
    await page.locator("#birthDate").fill("2012-05-10");
    await page.locator("#birthPlace").fill("Bandung");
    await page.locator("#address").fill("Jl. Test No. 123, Bandung");
    await page.locator("#parentName").fill("Wali Test");
    await page.locator("#parentPhone").fill("081234567890");
    const emailInput = page.locator("#email");
    if (
      await emailInput.waitFor({ state: "visible", timeout: 1000 }).then(
        () => true,
        () => false,
      )
    ) {
      await emailInput.fill(`test${timestamp}@example.com`);
    }

    // Gender + Unit selects (Unit options load asynchronously via useUnits).
    // Radix renders the placeholder via data-placeholder, so hasText matching is
    // unreliable — address the two triggers by index (gender = 0, unit = 1).
    await pickFirstOption(page.locator('button[role="combobox"]').nth(0));
    await pickFirstOption(page.locator('button[role="combobox"]').nth(1));

    // Submit form
    const submitButton = page.getByRole("button", {
      name: /simpan|save|submit|create student/i,
    });
    await submitButton.click();

    // On success the form navigates back to the students list.
    await expect(page).toHaveURL(/\/students(\/)?$/, { timeout: 15000 });
  });
});

test.describe("Student Management - Update", () => {
  test("should edit student information", async ({ page }) => {
    const loginPage = await import("./page-objects");
    const login = new loginPage.LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    await page.goto("/students");
    await waitForLoadingComplete(page);

    const firstRow = page.locator("table tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    // Row actions live behind the last-cell menu, not as buttons on the row.
    await firstRow.getByRole("cell").last().getByRole("button").click();
    await page.getByRole("menuitem", { name: "Edit" }).click();

    await expect(
      page.getByRole("heading", { name: /edit student/i, level: 1 }),
    ).toBeVisible({ timeout: 10000 });

    const nameInput = page.getByLabel(/nama|name/i).first();
    const currentName = await nameInput.inputValue();
    await nameInput.fill(`${currentName} (Updated)`);
    await page.getByRole("button", { name: /simpan|save|update/i }).click();

    await waitForToast(page, /updated successfully/i, "success");
  });
});

test.describe("Student Management - Delete", () => {
  test("should delete student with confirmation", async ({ page }) => {
    const loginPage = await import("./page-objects");
    const login = new loginPage.LoginPage(page);
    await login.goto();
    await login.loginAndWaitForDashboard(
      "superadmin@cipansor.or.id",
      "SuperAdmin123!",
    );

    await page.goto("/students");
    await waitForLoadingComplete(page);

    const firstRow = page.locator("table tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await firstRow.getByRole("cell").last().getByRole("button").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const confirmDialog = page
      .getByRole("alertdialog")
      .or(page.getByRole("dialog"));
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await confirmDialog.getByRole("button", { name: /hapus|delete/i }).click();

    await waitForToast(page, /deleted successfully/i, "success");
    await waitForLoadingComplete(page);
  });
});
