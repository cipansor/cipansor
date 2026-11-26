import { test, expect } from "./fixtures/auth.fixture";
import {
  apiLoginNew,
  apiRequest,
  loginAs,
  SEED_USERS,
} from "./helpers/auth-api";
import { gotoAuthedPage } from "./helpers/page-helpers";

/**
 * Muhadatsah Module E2E Tests
 * Tests Arabic conversation practice module
 *
 * /muhadatsah wraps itself in MainLayout, so it renders nothing until
 * ProtectedRoute has rehydrated the session. These tests used to probe for
 * content at domcontentloaded with isVisible({ timeout }), which Playwright
 * ignores the timeout on — the probe samples the page once and returns. That
 * raced rehydration and lost on WebKit. Wait for the page's own <h1> first.
 *
 * Every action button on the list used to be inert: no onClick, no link, no
 * dialog. The detail page was reachable only by typing its URL, and "Edit"
 * pointed at a route that was never built. Each control below is driven for
 * real, so a button that stops doing something fails here instead of shipping.
 */
const HEADING = "Muhadatsah";
const NEW_HEADING = "Jadwalkan Muhadatsah";
const DETAIL_HEADING = "Detail Muhadatsah";

test.describe("Muhadatsah - Navigation", () => {
  test("should navigate to muhadatsah page", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);
    expect(page.url()).toMatch(/muhadatsah/);
  });

  test("should display muhadatsah list or empty state", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    // The stats cards and the sessions table are rendered unconditionally —
    // the table keeps its header row when there are no sessions — so both are
    // assertable without depending on what the seed happens to create.
    await expect(page.getByText("Total Sesi")).toBeVisible();

    const table = page.locator("table");
    await expect(table).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Peserta" }),
    ).toBeVisible();
  });
});

test.describe("Muhadatsah - Create", () => {
  test("should navigate to create muhadatsah page", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah/new", NEW_HEADING);
    expect(page.url()).toMatch(/muhadatsah\/new/);
  });

  test("should display create form elements", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah/new", NEW_HEADING);

    // Asserted on the rendered form rather than on page.content().length, which
    // clears 1000 characters from the Next.js script tags alone and so passed
    // even when the page body was empty.
    await expect(
      page.getByRole("button", { name: "Simpan Jadwal" }),
    ).toBeVisible();
  });

  test("Jadwalkan Muhadatsah opens the scheduling form", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    await page.getByRole("link", { name: "Jadwalkan Muhadatsah" }).click();

    await expect(
      page.getByRole("heading", { name: NEW_HEADING, level: 1 }),
    ).toBeVisible();
    expect(page.url()).toMatch(/muhadatsah\/new$/);
  });
});

test.describe("Muhadatsah - View & Evaluate", () => {
  test("should allow navigation from list to detail", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    // The seed creates sessions, so the list is never empty: the old
    // test.skip("No muhadatsah sessions seeded to open") hid a list whose rows
    // carried no link at all.
    const firstLink = page
      .getByRole("link", { name: "Lihat detail sesi muhadatsah" })
      .first();
    await expect(firstLink).toBeVisible();

    await firstLink.click();

    await expect(
      page.getByRole("heading", { name: DETAIL_HEADING, level: 1 }),
    ).toBeVisible();
    expect(page.url()).toMatch(/muhadatsah\/[^/]+$/);
  });

  test("does not offer an Edit link to the page that was never built", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    await expect(
      page.getByRole("link", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.locator('a[href*="/muhadatsah/"][href$="/edit"]'),
    ).toHaveCount(0);

    await page
      .getByRole("link", { name: "Lihat detail sesi muhadatsah" })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: DETAIL_HEADING, level: 1 }),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('a[href$="/edit"]')).toHaveCount(0);
  });

  test("Trash confirms, then deletes the session", async ({ page }) => {
    // A throwaway session of its own: the spec files run in parallel against
    // one seeded database, so deleting a seeded row would pull it out from
    // under another test.
    const session = await apiLoginNew(SEED_USERS.superAdmin);
    const existing = await apiRequest<{
      data: Array<{ unitId: string; studentId: string }>;
    }>(session, "GET", "/muhadatsah?limit=1");
    const seedRecord = existing.data[0];
    const topic = `E2E hapus ${Date.now()}`;
    const scheduledAt = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
    const created = await apiRequest<{ data: { id: string } }>(
      session,
      "POST",
      "/muhadatsah",
      {
        unitId: seedRecord.unitId,
        studentId: seedRecord.studentId,
        scheduledAt: scheduledAt.toISOString(),
        language: "English",
        topic,
      },
    );

    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    const row = page.getByRole("row").filter({ hasText: topic });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Hapus sesi muhadatsah" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();

    // The delete must refresh more than the table: the "Terjadwal" card and
    // "Jadwal Mendatang" read other endpoints, so count the requests.
    const seen = { statistics: 0, upcoming: 0 };
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/muhadatsah/statistics")) seen.statistics++;
      if (url.includes("/muhadatsah/upcoming")) seen.upcoming++;
    });
    const before = { ...seen };

    const deletion = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().includes(`/muhadatsah/${created.data.id}`),
    );
    await dialog.getByRole("button", { name: "Hapus" }).click();

    expect((await deletion).status()).toBe(200);
    await expect(page.getByRole("row").filter({ hasText: topic })).toHaveCount(
      0,
    );
    await expect
      .poll(() => seen.statistics, { timeout: 10_000 })
      .toBeGreaterThan(before.statistics);
    await expect
      .poll(() => seen.upcoming, { timeout: 10_000 })
      .toBeGreaterThan(before.upcoming);
  });
});

test.describe("Muhadatsah - Partner Matching", () => {
  test("the language dropdown changes the partners requested", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    await page.getByRole("tab", { name: "Cari Partner" }).click();

    const englishRequest = page.waitForRequest(
      (request) =>
        request.url().includes("/muhadatsah/match-partners") &&
        /[?&]language=English(&|$)/.test(request.url()),
    );

    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /Bahasa Inggris/ }).click();

    await englishRequest;
  });

  test("kegagalan memuat partner disebutkan, bukan dikira kosong", async ({
    page,
  }) => {
    await page.route("**/muhadatsah/match-partners**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ success: false, message: "boom" }),
      }),
    );
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    await page.getByRole("tab", { name: "Cari Partner" }).click();

    await expect(page.getByText(/Gagal memuat daftar partner/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Belum ada santri yang tersedia/)).toHaveCount(
      0,
    );
  });

  test("Pilih carries the santri into the form as the partner", async ({
    page,
  }) => {
    const session = await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    await page.getByRole("tab", { name: "Cari Partner" }).click();

    const pick = page.getByRole("link", { name: "Pilih" }).first();
    await expect(pick).toBeVisible();
    const href = await pick.getAttribute("href");
    const partnerId = new URL(href!, "http://localhost").searchParams.get(
      "partnerId",
    );
    expect(partnerId).toBeTruthy();

    const partner = await apiRequest<{
      data: { name?: string; user?: { name?: string } };
    }>(session, "GET", `/students/${partnerId}`);
    const partnerName = partner.data.name ?? partner.data.user?.name;
    expect(partnerName).toBeTruthy();

    await pick.click();

    await expect(
      page.getByRole("heading", { name: NEW_HEADING, level: 1 }),
    ).toBeVisible();
    expect(page.url()).toContain(`partnerId=${partnerId}`);
    await expect(page.getByText(partnerName!).first()).toBeVisible();
  });
});

test.describe("Muhadatsah - Bahasa partner", () => {
  test("Pilih dari hasil Bahasa Inggris menyimpan sesi Bahasa Inggris", async ({
    page,
  }) => {
    // The partner list is filtered by language, so a santri offered under
    // English was matched for English. The form used to open in Arabic and
    // save Arabic, silently contradicting the choice made one click earlier.
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    await page.getByRole("tab", { name: "Cari Partner" }).click();
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /Bahasa Inggris/ }).click();

    const pick = page.getByRole("link", { name: "Pilih" }).first();
    await expect(pick).toBeVisible();
    expect(await pick.getAttribute("href")).toContain("language=English");

    await pick.click();
    await expect(
      page.getByRole("heading", { name: NEW_HEADING, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Bahasa Inggris/ }),
    ).toHaveAttribute("aria-pressed", "true");

    // Santri 1: the unit came in with the chosen partner. The trigger is a
    // button with role="combobox" whose text is the only stable handle.
    await page
      .getByRole("combobox")
      .filter({ hasText: "Pilih santri" })
      .click();
    await page.getByRole("option").first().click();

    // A day the calendar shows without paging: the picker opens on the
    // current month, so the target stays inside it.
    const today = new Date();
    const lastDay = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      0,
    ).getDate();
    const day = new Date(
      today.getFullYear(),
      today.getMonth(),
      Math.min(today.getDate() + 2, lastDay),
      12,
    );
    const iso = day.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    await page.getByRole("button", { name: "Pilih tanggal" }).click();
    await page.locator(`td[data-day="${iso}"] button`).click();

    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/muhadatsah"),
    );
    await page.getByRole("button", { name: "Simpan Jadwal" }).click();

    const body = await (await created).json();
    expect(body.data.language).toBe("English");
  });
});

test.describe("Muhadatsah - Peran", () => {
  test("guru menjadwalkan dan menilai, tetapi tidak ditawari Hapus", async ({
    page,
  }) => {
    // The API answers DELETE only to Super Admin and unit admins. The buttons
    // must agree, or a teacher confirms a deletion and gets a 403.
    const session = await loginAs(page, "teacher");
    const students = await apiRequest<{
      data: Array<{ id: string; unitId: string }>;
    }>(session, "GET", "/students?limit=1");
    const student = students.data[0];
    expect(student?.id).toBeTruthy();

    const topic = `E2E guru ${Date.now()}`;
    const created = await apiRequest<{ data: { id: string } }>(
      session,
      "POST",
      "/muhadatsah",
      {
        unitId: student.unitId,
        studentId: student.id,
        scheduledAt: new Date(
          Date.now() + 11 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        language: "Arabic",
        topic,
      },
    );

    await gotoAuthedPage(page, "/muhadatsah", HEADING);
    await expect(
      page.getByRole("link", { name: "Jadwalkan Muhadatsah" }),
    ).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: topic });
    await expect(row).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Hapus sesi muhadatsah" }),
    ).toHaveCount(0);

    await row
      .getByRole("link", { name: "Lihat detail sesi muhadatsah" })
      .click();
    await expect(
      page.getByRole("heading", { name: DETAIL_HEADING, level: 1 }),
    ).toBeVisible();
    expect(page.url()).toContain(created.data.id);
    await expect(
      page.getByRole("link", { name: "Mulai & Nilai" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Hapus", exact: true }),
    ).toHaveCount(0);

    // A teacher may not delete, so the throwaway session is removed with the
    // admin account the cleanup needs.
    const admin = await apiLoginNew(SEED_USERS.superAdmin);
    await apiRequest(admin, "DELETE", `/muhadatsah/${created.data.id}`);
  });

  test("santri hanya membaca: tanpa Jadwalkan, Pilih, dan tanpa formulir", async ({
    page,
  }) => {
    await loginAs(page, "student");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    await expect(
      page.getByRole("link", { name: "Jadwalkan Muhadatsah" }),
    ).toHaveCount(0);

    await page.getByRole("tab", { name: "Cari Partner" }).click();
    await expect(page.getByRole("link", { name: "Pilih" })).toHaveCount(0);

    // Typing the form's URL must not offer a form the API will refuse.
    await page.goto("/muhadatsah/new");
    await expect(page.getByText("Tidak Ada Akses")).toBeVisible();
  });
});

test.describe("Muhadatsah - Penilaian", () => {
  test("nilai yang disimpan sama dengan nilai yang ditampilkan formulir", async ({
    page,
  }) => {
    const session = await apiLoginNew(SEED_USERS.superAdmin);
    const students = await apiRequest<{
      data: Array<{ id: string; unitId: string }>;
    }>(session, "GET", "/students?limit=1");
    const student = students.data[0];
    const created = await apiRequest<{ data: { id: string } }>(
      session,
      "POST",
      "/muhadatsah",
      {
        unitId: student.unitId,
        studentId: student.id,
        scheduledAt: new Date(
          Date.now() + 12 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        language: "Arabic",
        topic: `E2E nilai ${Date.now()}`,
      },
    );

    await loginAs(page, "superAdmin");
    await gotoAuthedPage(
      page,
      `/muhadatsah/${created.data.id}`,
      DETAIL_HEADING,
    );
    await page.getByRole("link", { name: "Mulai & Nilai" }).first().click();
    await expect(
      page.getByRole("heading", { name: "Penilaian Muhadatsah", level: 1 }),
    ).toBeVisible();

    // One rubric per session: the four sliders ARE the session score. Push the
    // first to 100, leaving the rest at 75 → (100 + 75 + 75 + 75) / 4 = 81.
    const slider = page.getByRole("slider").first();
    await slider.focus();
    await slider.press("End");
    const summary = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Ringkasan Nilai" });
    await expect(
      summary.getByText("Nilai Sesi", { exact: true }),
    ).toBeVisible();
    await expect(summary.getByText("81", { exact: true })).toBeVisible();

    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes(`/muhadatsah/${created.data.id}/evaluate`),
    );
    await page.getByRole("button", { name: "Simpan Penilaian" }).click();

    const body = await (await response).json();
    expect(body.data.totalScore).toBe(81);
    expect(body.data.fluencyScore).toBe(100);

    // Reopening the session shows the stored score, not a recomputed one.
    await expect(
      page.getByRole("heading", { name: DETAIL_HEADING, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("81", { exact: true }).first()).toBeVisible();

    // "Edit Penilaian" must reopen the stored rubric: starting again from 75
    // would rewrite the whole score on the next save.
    await page.goto(`/muhadatsah/${created.data.id}/evaluate`);
    await expect(
      page.getByRole("heading", { name: "Penilaian Muhadatsah", level: 1 }),
    ).toBeVisible();
    await expect(summary.getByText("81", { exact: true })).toBeVisible();

    await apiRequest(session, "DELETE", `/muhadatsah/${created.data.id}`);
  });
});

test.describe("Muhadatsah - Performance", () => {
  test("should load muhadatsah page within timeout", async ({ page }) => {
    await loginAs(page, "superAdmin");

    const startTime = Date.now();
    await gotoAuthedPage(page, "/muhadatsah", HEADING);
    expect(Date.now() - startTime).toBeLessThan(15000);
    expect(page.url()).toMatch(/muhadatsah/);
  });
});
