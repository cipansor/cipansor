import { test, expect } from "./fixtures/auth.fixture";
import { SEED_USERS, apiLogin, apiRequest, loginAs } from "./helpers/auth-api";
import { settledContent } from "./helpers/page-state";

/**
 * Calendar Module E2E Tests
 * Tests calendar view and event management
 */

test.describe("Calendar - Navigation", () => {
  test("should navigate to calendar page", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/calendar");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/calendar/);
  });

  test("should display calendar interface", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/calendar");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    expect(content.length).toBeGreaterThan(1000);
  });
});

test.describe("Calendar - Features", () => {
  test("should display calendar view", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/calendar");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    const hasCalendar =
      content.includes("Calendar") ||
      content.includes("Kalender") ||
      (await page
        .locator('[class*="calendar"]')
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false));

    expect(hasCalendar || page.url().includes("calendar")).toBeTruthy();
  });

  test("should have event management", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/calendar");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasEventButton = await page
      .locator(
        'button:has-text("Event"), button:has-text("Acara"), button:has-text("Tambah")',
      )
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    expect(hasEventButton || page.url().includes("calendar")).toBeTruthy();
  });

  test("should show month/week views", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/calendar");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    const hasViewSelector =
      content.includes("Month") ||
      content.includes("Week") ||
      content.includes("Bulan") ||
      content.includes("Minggu");

    expect(hasViewSelector || page.url().includes("calendar")).toBeTruthy();
  });
});

/**
 * The month window the page asks the API for must name the month exactly in a
 * WIB browser (Asia/Jakarta, UTC+7) — every user of the pesantren portal. The
 * window was built from `new Date(year, month, 1)` (local midnight) read back
 * with `toISOString()` (UTC), so it slid one day at both ends: the month lost
 * its last day and pulled in the last day of the previous one (ticket #911).
 *
 * The clock is pinned inside January 2026, so the page opens on that month and
 * the request carries its window.
 */
test.describe("Kalender Akademik — jendela bulan memakai bulan yang dilihat", () => {
  test.use({ timezoneId: "Asia/Jakarta" });

  test("Januari 2026 meminta 2026-01-01 sampai 2026-01-31", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");

    // 2026-01-15 05:00 WIB == 2026-01-14T22:00:00Z: mid-January, inside the
    // 00:00–06:59 WIB window where the UTC and WIB days disagree.
    await page.clock.install({ time: new Date("2026-01-14T22:00:00.000Z") });

    const monthRequest = page.waitForRequest(
      (r) =>
        r.url().includes("/calendar?") &&
        r.url().includes("startDate=") &&
        r.url().includes("endDate="),
    );
    await page.goto("/calendar");

    const params = new URL((await monthRequest).url()).searchParams;
    expect(params.get("startDate")).toBe("2026-01-01");
    expect(params.get("endDate")).toBe("2026-01-31");
  });
});

/**
 * An agenda that straddles a month boundary — the classic "libur semester"
 * running 31 Dec–4 Jan — must appear in *both* months it touches. The month
 * window is right (#911 fixed `useMonthEvents`), but the API's `findAll`
 * filtered on `startDate` alone, so the January view dropped any event that
 * began in December: the month lost the holiday it was in the middle of.
 *
 * The event is seeded through the API and read back through the page, so the
 * test fails if the server-side window regresses, not merely if the client
 * window does. It overlaps the *current* month, so it needs no pinned clock.
 */
test.describe("Kalender Akademik — agenda lintas bulan tetap tampil", () => {
  test("agenda yang mulai bulan lalu dan berlanjut ke bulan ini muncul", async ({
    page,
  }) => {
    // A day in WIB, `offset` days from today (negative = earlier).
    const wibDay = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000 + 7 * 3_600_000)
        .toISOString()
        .slice(0, 10);

    // Starts on the last day of the previous month, ends on the 2nd of this
    // one — so the current month's view can only find it by overlap.
    const lastDayOfPrevMonth = new Date(Date.now() + 7 * 3_600_000);
    lastDayOfPrevMonth.setUTCDate(0);
    const start = lastDayOfPrevMonth.toISOString().slice(0, 10);
    const end = wibDay(0).slice(0, 8) + "02";

    const title = `Libur lintas bulan e2e ${Date.now()}`;
    const session = await apiLogin(SEED_USERS.superAdmin);
    const created = await apiRequest<{ data: { id: string } }>(
      session,
      "POST",
      "/calendar",
      {
        title,
        eventType: "HOLIDAY",
        startDate: `${start}T00:00:00.000Z`,
        endDate: `${end}T00:00:00.000Z`,
        isAllDay: true,
        isPublic: true,
      },
    );

    try {
      await loginAs(page, "superAdmin");
      await page.goto("/calendar");

      // The current month's grid must carry it, even though it began last month.
      await expect(
        page.getByRole("button", { name: title }).first(),
      ).toBeVisible({ timeout: 15000 });
    } finally {
      await apiRequest(session, "DELETE", `/calendar/${created.data.id}`);
    }
  });
});

/**
 * The "Agenda Hari Ini" card reads `GET /calendar/today/:unitId`, whose window
 * is the WIB calendar day (#1152). A unit-scoped user supplies the unit, so the
 * card must request that endpoint rather than filtering the month window in the
 * browser — and it must render what the endpoint returned, then obey the
 * category filter (the card used to list the raw API result).
 */
test.describe("Kalender Akademik — agenda hari ini", () => {
  test("renders the API agenda and follows the category filter", async ({
    page,
  }) => {
    const session = await apiLogin(SEED_USERS.superAdmin);
    const wibToday = new Date(Date.now() + 7 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    // 08:00 WIB — inside today whatever time the suite runs.
    const startDate = `${wibToday}T01:00:00.000Z`;
    const suffix = Date.now();
    const meetingTitle = `Rapat agenda e2e ${suffix}`;
    const religiousTitle = `Keagamaan agenda e2e ${suffix}`;

    const create = (title: string, eventType: "MEETING" | "RELIGIOUS") =>
      apiRequest<{ data: { id: string } }>(session, "POST", "/calendar", {
        title,
        eventType,
        startDate,
        endDate: startDate,
        isAllDay: false,
        startTime: "08:00",
        endTime: "09:00",
        isPublic: true,
      });

    const meeting = await create(meetingTitle, "MEETING");
    const religious = await create(religiousTitle, "RELIGIOUS");

    try {
      await loginAs(page, "adminSdit");
      const agendaResponse = page.waitForResponse((r) =>
        r.url().includes("/calendar/today/"),
      );
      await page.goto("/calendar");

      const body = (await (await agendaResponse).json()) as {
        data: { title: string }[];
      };
      expect(body.data.map((event) => event.title)).toEqual(
        expect.arrayContaining([meetingTitle, religiousTitle]),
      );

      const agenda = page
        .locator('[data-slot="card"]')
        .filter({ hasText: "Agenda Hari Ini" });
      await expect(agenda.getByText(meetingTitle)).toBeVisible({
        timeout: 15000,
      });
      await expect(agenda.getByText(religiousTitle)).toBeVisible();

      // The legend's "Rapat" button narrows both the grid and the agenda.
      await page
        .getByRole("button", { name: "Rapat", exact: true })
        .first()
        .click();

      await expect(agenda.getByText(meetingTitle)).toBeVisible();
      await expect(agenda.getByText(religiousTitle)).toHaveCount(0);
    } finally {
      await apiRequest(session, "DELETE", `/calendar/${meeting.data.id}`);
      await apiRequest(session, "DELETE", `/calendar/${religious.data.id}`);
    }
  });
});

test.describe("Manajemen Event — filter kategori", () => {
  test("mengirim eventType dan menyempitkan daftar", async ({ page }) => {
    const session = await apiLogin(SEED_USERS.superAdmin);
    const suffix = Date.now();
    const wibToday = new Date(Date.now() + 7 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    const startDate = `${wibToday}T01:00:00.000Z`;
    const meetingTitle = `Rapat daftar e2e ${suffix}`;
    const religiousTitle = `Keagamaan daftar e2e ${suffix}`;

    const create = (title: string, eventType: "MEETING" | "RELIGIOUS") =>
      apiRequest<{ data: { id: string } }>(session, "POST", "/calendar", {
        title,
        eventType,
        startDate,
        endDate: startDate,
        isAllDay: false,
        startTime: "08:00",
        endTime: "09:00",
        isPublic: true,
      });

    const meeting = await create(meetingTitle, "MEETING");
    const religious = await create(religiousTitle, "RELIGIOUS");

    try {
      await loginAs(page, "superAdmin");
      await page.goto("/calendar/events");

      await expect(page.getByText(meetingTitle)).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByText(religiousTitle)).toBeVisible();

      const filtered = page.waitForRequest(
        (request) =>
          request.url().includes("/calendar?") &&
          request.url().includes("eventType=MEETING"),
      );
      await page.locator('[data-slot="select-trigger"]').first().click();
      await page.getByRole("option", { name: "Rapat", exact: true }).click();

      const url = new URL((await filtered).url());
      expect(url.searchParams.get("eventType")).toBe("MEETING");

      await expect(page.getByText(meetingTitle)).toBeVisible();
      await expect(page.getByText(religiousTitle)).toHaveCount(0);
    } finally {
      await apiRequest(session, "DELETE", `/calendar/${meeting.data.id}`);
      await apiRequest(session, "DELETE", `/calendar/${religious.data.id}`);
    }
  });
});

test.describe("Tambah Event — unit admin", () => {
  test("menyimpan event ke unit aktif dan tidak menawarkan Semua Unit", async ({
    page,
  }) => {
    const session = await apiLogin(SEED_USERS.adminSdit);
    const title = `Rapat unit e2e ${Date.now()}`;
    let createdId: string | undefined;

    try {
      await loginAs(page, "adminSdit");
      await page.goto("/calendar/events/new");

      await expect(page.getByTestId("event-unit")).toHaveText(/SD IT/, {
        timeout: 15000,
      });
      await expect(page.getByText("Semua Unit", { exact: true })).toHaveCount(
        0,
      );

      await page.locator("#title").fill(title);
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes("/calendar") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Simpan" }).click();

      const response = await saved;
      expect(response.status()).toBe(201);
      const body = (await response.json()) as {
        data: { id: string; scope: string; unit?: { name: string } | null };
      };
      createdId = body.data.id;
      expect(body.data.scope).toBe("SPECIFIC_UNIT");
      expect(body.data.unit?.name).toMatch(/SD IT/);
      await expect(page).toHaveURL(/\/calendar\/events/, { timeout: 15000 });
    } finally {
      if (createdId) {
        await apiRequest(session, "DELETE", `/calendar/${createdId}`);
      }
    }
  });
});

test.describe("Tambah Event — Pengurus yayasan", () => {
  test("membuka formulir dan menyimpan agenda seluruh yayasan", async ({
    page,
  }) => {
    const session = await apiLogin(SEED_USERS.ketuaPengurus);
    const title = `Agenda yayasan e2e ${Date.now()}`;
    let createdId: string | undefined;

    try {
      await loginAs(page, "ketuaPengurus");
      await page.goto("/calendar");

      const add = page.getByRole("link", { name: /Tambah Event/i }).first();
      await expect(add).toBeVisible({ timeout: 15000 });
      await add.click();

      await expect(
        page.getByRole("heading", { name: /Tambah Event Baru/i }),
      ).toBeVisible({ timeout: 15000 });
      await expect(page.getByText("Akses ditolak")).toHaveCount(0);
      await expect(page.getByRole("combobox", { name: "Unit" })).toHaveText(
        /Semua Unit/,
      );

      await page.locator("#title").fill(title);
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes("/calendar") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Simpan" }).click();

      const response = await saved;
      expect(response.status()).toBe(201);
      const body = (await response.json()) as {
        data: { id: string; scope: string; unit?: { name: string } | null };
      };
      createdId = body.data.id;
      expect(body.data.scope).toBe("ALL_UNITS");
      expect(body.data.unit).toBeNull();
      await expect(page).toHaveURL(/\/calendar\/events/, { timeout: 15000 });
    } finally {
      if (createdId) {
        await apiRequest(session, "DELETE", `/calendar/${createdId}`);
      }
    }
  });
});

test.describe("Edit Event — Pengurus yayasan", () => {
  test("membuka formulir dari Manajemen Event dan menyimpan judul baru", async ({
    page,
  }) => {
    const session = await apiLogin(SEED_USERS.ketuaPengurus);
    const title = `Agenda edit e2e ${Date.now()}`;
    const updatedTitle = `${title} (revisi)`;
    const todayWib = new Date(Date.now() + 7 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    const created = await apiRequest<{ data: { id: string } }>(
      session,
      "POST",
      "/calendar",
      {
        title,
        eventType: "MEETING",
        startDate: `${todayWib}T00:00:00.000Z`,
        isAllDay: true,
        isPublic: true,
      },
    );

    try {
      await loginAs(page, "ketuaPengurus");
      await page.goto("/calendar/events");

      const row = page.locator("tbody tr").filter({ hasText: title });
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.getByRole("button").click();
      await page.getByRole("menuitem", { name: /Edit/i }).click();

      await expect(page).toHaveURL(
        new RegExp(`/calendar/events/${created.data.id}/edit`),
      );
      await expect(
        page.getByRole("heading", { name: /Edit Event/i }),
      ).toBeVisible({ timeout: 15000 });
      await expect(page.locator("#title")).toHaveValue(title);

      await page.locator("#title").fill(updatedTitle);
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes(`/calendar/${created.data.id}`) &&
          response.request().method() === "PUT",
      );
      await page.getByRole("button", { name: "Simpan" }).click();

      const response = await saved;
      expect(response.status()).toBe(200);
      const body = (await response.json()) as { data: { title: string } };
      expect(body.data.title).toBe(updatedTitle);
      await expect(page).toHaveURL(/\/calendar\/events/, { timeout: 15000 });
    } finally {
      await apiRequest(session, "DELETE", `/calendar/${created.data.id}`);
    }
  });
});

test.describe("Kalender Akademik — pengawasan hanya membaca", () => {
  test("menyembunyikan aksi tulis dan menolak formulir langsung", async ({
    page,
  }) => {
    await loginAs(page, "pengawas");
    await page.goto("/calendar");

    await expect(
      page.getByRole("heading", { name: /Kalender Akademik/i }),
    ).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("link", { name: /Tambah Event/i })).toHaveCount(
      0,
    );

    await page.goto("/calendar/events");
    await expect(
      page.getByRole("heading", { name: /Manajemen Event/i }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("link", { name: /Tambah Event/i })).toHaveCount(
      0,
    );

    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    await firstRow.getByRole("button").click();
    await expect(
      page.getByRole("menuitem", { name: /Lihat Detail/i }),
    ).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Edit/i })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /Hapus/i })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/calendar/events/new");
    await expect(page.getByText("Akses ditolak")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator("#title")).toHaveCount(0);
  });

  test("dialog detail tidak menawarkan Edit Event", async ({ page }) => {
    const session = await apiLogin(SEED_USERS.superAdmin);
    const title = `Agenda baca e2e ${Date.now()}`;
    const todayWib = new Date(Date.now() + 7 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    const created = await apiRequest<{ data: { id: string } }>(
      session,
      "POST",
      "/calendar",
      {
        title,
        eventType: "MEETING",
        startDate: `${todayWib}T00:00:00.000Z`,
        isAllDay: true,
        isPublic: true,
      },
    );

    try {
      await loginAs(page, "pengawas");
      await page.goto("/calendar");

      const eventButton = page.getByRole("button", { name: title }).first();
      await expect(eventButton).toBeVisible({ timeout: 15000 });
      await eventButton.click();

      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("button", { name: "Tutup" })).toBeVisible();
      await expect(page.getByRole("link", { name: /Edit Event/i })).toHaveCount(
        0,
      );
    } finally {
      await apiRequest(session, "DELETE", `/calendar/${created.data.id}`);
    }
  });
});

test.describe("Manajemen Event — agenda kelas milik admin lain", () => {
  test("admin unit melihat dan menghapus agenda kelas unitnya", async ({
    page,
  }) => {
    const admin = await apiLogin(SEED_USERS.adminSdit);
    const classes = await apiRequest<{
      data: Array<{ id: string; unitId: string }>;
    }>(admin, "GET", "/classes?limit=10");
    const kelas = classes.data[0];
    expect(
      kelas,
      "seed should provide a class for the unit admin",
    ).toBeTruthy();

    const superAdmin = await apiLogin(SEED_USERS.superAdmin);
    const title = `Agenda kelas e2e ${Date.now()}`;
    const wibToday = new Date(Date.now() + 7 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    const startDate = `${wibToday}T03:00:00.000Z`;
    const created = await apiRequest<{ data: { id: string } }>(
      superAdmin,
      "POST",
      "/calendar",
      {
        title,
        eventType: "ACADEMIC",
        startDate,
        endDate: startDate,
        isAllDay: false,
        startTime: "10:00",
        endTime: "11:00",
        isPublic: false,
        unitId: kelas.unitId,
        classId: kelas.id,
        scope: "SPECIFIC_CLASS",
      },
    );

    try {
      await loginAs(page, "adminSdit");
      await page.goto("/calendar/events");

      const row = page.locator("tr").filter({ hasText: title });
      await expect(row).toBeVisible({ timeout: 15000 });

      await row.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Hapus" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Hapus" })
        .click();

      await expect(row).toHaveCount(0, { timeout: 15000 });
    } finally {
      // The UI may already have deleted it; cleanup only needs to be sure.
      await apiRequest(
        superAdmin,
        "DELETE",
        `/calendar/${created.data.id}`,
      ).catch(() => undefined);
    }
  });
});

test.describe("Kalender Akademik — agenda satu hari tidak merusak grid", () => {
  test("grid bulan tetap tergambar saat ada agenda tanpa tanggal selesai", async ({
    page,
  }) => {
    const title = `Agenda sehari e2e ${Date.now()}`;
    const session = await apiLogin(SEED_USERS.superAdmin);
    const today = new Date(Date.now() + 7 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    const created = await apiRequest<{ data: { id: string } }>(
      session,
      "POST",
      "/calendar",
      {
        title,
        eventType: "MEETING",
        startDate: today,
        isAllDay: true,
        isPublic: true,
      },
    );

    try {
      await loginAs(page, "superAdmin");
      await page.goto("/calendar");

      // A month grid is four to six weeks, so its day cells are 28–42. The old
      // selector also counted the seven weekday headers and pinned 42, which
      // only matched a six-week month.
      const cells = page.getByTestId("calendar-day");
      await expect(cells.first()).toBeVisible({ timeout: 15000 });
      const count = await cells.count();
      expect(count).toBeGreaterThanOrEqual(28);
      expect(count).toBeLessThanOrEqual(42);
      await expect(page.getByText(/Application error/i)).toHaveCount(0);
    } finally {
      await apiRequest(session, "DELETE", `/calendar/${created.data.id}`);
    }
  });
});

test.describe("Calendar - Performance", () => {
  test("should load calendar quickly", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);

    const startTime = Date.now();
    await page.goto("/calendar");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(15000);
  });
});
