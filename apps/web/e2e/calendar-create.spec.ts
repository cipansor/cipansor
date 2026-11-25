import { test, expect } from "./fixtures/auth.fixture";
import { SEED_USERS, apiLogin, apiRequest, loginAs } from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";

/**
 * Tambah Agenda — the form that could not save (#1155).
 *
 * The page posted `category`, `recurrence` and a `recurrenceEnd`, none of which
 * the model has: `POST /calendar` reached Prisma with `eventType: undefined` and
 * answered 500 for every role, every unit. The list also rendered a blank
 * category badge, because it looked up `event.category` on a response that
 * carries `eventType`.
 *
 * These drive the real form against the real API and read the result back, so a
 * renamed field fails here and not in a teacher's browser. Writes, so it skips
 * itself against a production API.
 */

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);

interface Created {
  data: { id: string; eventType: string; startDate: string };
}
interface Listed {
  data: {
    id: string;
    title: string;
    eventType: string;
    unitId: string | null;
  }[];
}

test.beforeAll(async () => {
  test.skip(
    await isProductionApi(),
    "menulis data; tidak dijalankan di produksi",
  );
});

test.describe("Kalender Akademik — Tambah Agenda", () => {
  test("form Tambah menyimpan agenda dengan kategori yang dipilih", async ({
    page,
  }) => {
    const title = `Ujian e2e ${STAMP}`;
    const session = await apiLogin(SEED_USERS.superAdmin);
    let createdId = "";

    try {
      await loginAs(page, "superAdmin");
      await page.goto("/calendar/events/new");

      await page.getByLabel("Judul Event *").fill(title);

      // The category is a Radix Select: its trigger carries the label's `for`.
      const categoryId = await page
        .locator("label")
        .filter({ hasText: /^Kategori \*/ })
        .first()
        .getAttribute("for");
      await page.locator(`[id="${categoryId}"]`).click();
      await page.getByRole("option", { name: /Ujian\/Asesmen/ }).click();

      await page.getByRole("button", { name: /Simpan/ }).click();

      // A successful save navigates back to the list and the row is there.
      await expect(page).toHaveURL(/\/calendar\/events$/, { timeout: 15000 });
      await expect(page.getByText(title)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText("Ujian/Asesmen").first()).toBeVisible();

      // And the API stored the category the form showed, not a default.
      const listed = await apiRequest<Listed>(
        session,
        "GET",
        "/calendar?limit=100&eventType=EXAM",
      );
      const found = listed.data.find((e) => e.title === title);
      expect(found?.eventType).toBe("EXAM");
      createdId = found!.id;
    } finally {
      if (createdId)
        await apiRequest(session, "DELETE", `/calendar/${createdId}`);
    }
  });

  test("kategori tersimpan dapat disaring dari daftar", async ({ page }) => {
    const base = `e2e saring ${STAMP}`;
    const meetingTitle = `${base} rapat`;
    const examTitle = `${base} ujian`;
    const session = await apiLogin(SEED_USERS.superAdmin);
    const today = new Date().toISOString().slice(0, 10);
    const created = await apiRequest<Created>(session, "POST", "/calendar", {
      title: meetingTitle,
      eventType: "MEETING",
      startDate: today,
      isAllDay: true,
      isPublic: true,
    });
    const control = await apiRequest<Created>(session, "POST", "/calendar", {
      title: examTitle,
      eventType: "EXAM",
      startDate: today,
      isAllDay: true,
      isPublic: true,
    });

    try {
      await loginAs(page, "superAdmin");
      await page.goto("/calendar/events");

      // Both rows start on the same page, so the filter — not the page window —
      // is what removes the second one.
      await page.getByPlaceholder("Cari event...").fill(base);
      await expect(page.getByText(meetingTitle)).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByText(examTitle)).toBeVisible({ timeout: 15000 });

      const filtered = page.waitForRequest(
        (r) =>
          r.url().includes("/calendar?") &&
          r.url().includes("eventType=MEETING"),
      );
      await page.getByRole("combobox", { name: "Saring kategori" }).click();
      await page.getByRole("option", { name: /^Rapat$/ }).click();

      // The filter is `eventType`: a `category` filter returned everything.
      expect(
        new URL((await filtered).url()).searchParams.get("eventType"),
      ).toBe("MEETING");
      await expect(page.getByText(meetingTitle)).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByText(examTitle)).toHaveCount(0);
    } finally {
      await apiRequest(session, "DELETE", `/calendar/${created.data.id}`);
      await apiRequest(session, "DELETE", `/calendar/${control.data.id}`);
    }
  });

  test("form menerima agenda yang melewati tengah malam", async ({ page }) => {
    const title = `Tarawih e2e ${STAMP}`;
    const session = await apiLogin(SEED_USERS.superAdmin);
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000 + 7 * 3_600_000)
        .toISOString()
        .slice(0, 10);

    try {
      await loginAs(page, "superAdmin");
      await page.goto("/calendar/events/new");

      await page.getByLabel("Judul Event *").fill(title);
      await page.getByRole("switch", { name: "Sepanjang Hari" }).click();
      await page.getByLabel("Tanggal Mulai *").fill(day(1));
      await page.getByLabel("Tanggal Selesai").fill(day(2));
      await page.getByLabel("Waktu Mulai").fill("22:00");
      await page.getByLabel("Waktu Selesai").fill("06:00");
      await page.getByRole("button", { name: /Simpan/ }).click();

      // 22:00–06:00 with a later end date is eight hours, not a reversed clock.
      await expect(page).toHaveURL(/\/calendar\/events$/, { timeout: 15000 });
      await page.getByPlaceholder("Cari event...").fill(title);
      await expect(page.getByText(title)).toBeVisible({ timeout: 15000 });
    } finally {
      const listed = await apiRequest<Listed>(
        session,
        "GET",
        `/calendar?limit=100&search=${encodeURIComponent(title)}`,
      );
      for (const e of listed.data) {
        await apiRequest(session, "DELETE", `/calendar/${e.id}`);
      }
    }
  });

  test("admin unit menyimpan agenda ke unitnya, tanpa memilih unit lain", async ({
    page,
  }) => {
    const title = `Agenda unit e2e ${STAMP}`;
    const session = await loginAs(page, "adminSdit");

    try {
      await page.goto("/calendar/events/new");

      // A unit admin writes into their own unit: no unit picker, and the
      // class list is that unit's list.
      await expect(
        page.getByText(/Agenda disimpan untuk unit ini/),
      ).toBeVisible();
      await expect(page.getByText("Kelas (Opsional)")).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Unit" })).toHaveCount(0);

      await page.getByLabel("Judul Event *").fill(title);
      await page.getByRole("button", { name: /Simpan/ }).click();

      await expect(page).toHaveURL(/\/calendar\/events$/, { timeout: 15000 });
      const listed = await apiRequest<Listed>(
        session,
        "GET",
        `/calendar?limit=100&search=${encodeURIComponent(title)}`,
      );
      const found = listed.data.find((e) => e.title === title);
      expect(found?.unitId).toBe(session.user.unitId);
    } finally {
      const left = await apiRequest<Listed>(
        session,
        "GET",
        `/calendar?limit=100&search=${encodeURIComponent(title)}`,
      ).catch(() => ({ data: [] }));
      for (const e of left.data) {
        await apiRequest(session, "DELETE", `/calendar/${e.id}`).catch(
          () => undefined,
        );
      }
    }
  });

  test("kepala sekolah membuka formulir dan menyimpan agenda unitnya", async ({
    page,
  }) => {
    const title = `Agenda kepala e2e ${STAMP}`;
    const session = await loginAs(page, "kepalaSdit");

    try {
      // The API admits a kepala sekolah through ACADEMIC_MANAGE; the portal's
      // route guard did not, and bounced the form back to /dashboard.
      await page.goto("/calendar/events/new");
      await expect(page).toHaveURL(/\/calendar\/events\/new$/);
      await expect(
        page.getByText(/Agenda disimpan untuk unit ini/),
      ).toBeVisible();

      await page.getByLabel("Judul Event *").fill(title);
      await page.getByRole("button", { name: /Simpan/ }).click();

      await expect(page).toHaveURL(/\/calendar\/events$/, { timeout: 15000 });
      const listed = await apiRequest<Listed>(
        session,
        "GET",
        `/calendar?limit=100&search=${encodeURIComponent(title)}`,
      );
      const found = listed.data.find((e) => e.title === title);
      expect(found?.unitId).toBe(session.user.unitId);
    } finally {
      const left = await apiRequest<Listed>(
        session,
        "GET",
        `/calendar?limit=100&search=${encodeURIComponent(title)}`,
      ).catch(() => ({ data: [] }));
      for (const e of left.data) {
        await apiRequest(session, "DELETE", `/calendar/${e.id}`).catch(
          () => undefined,
        );
      }
    }
  });

  test("form menolak jam terbalik pada hari yang sama", async ({ page }) => {
    const today = new Date(Date.now() + 7 * 3_600_000)
      .toISOString()
      .slice(0, 10);

    await loginAs(page, "superAdmin");
    await page.goto("/calendar/events/new");

    await page.getByLabel("Judul Event *").fill(`Jam terbalik e2e ${STAMP}`);
    await page.getByRole("switch", { name: "Sepanjang Hari" }).click();
    await page.getByLabel("Tanggal Mulai *").fill(today);
    await page.getByLabel("Tanggal Selesai").fill(today);
    await page.getByLabel("Waktu Mulai").fill("10:00");
    await page.getByLabel("Waktu Selesai").fill("09:00");
    await page.getByRole("button", { name: /Simpan/ }).click();

    await expect(
      page.getByText("Waktu selesai tidak boleh sebelum waktu mulai"),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/calendar\/events\/new$/);
  });
});

/**
 * Deleting one occurrence of a series must leave the others, and deleting the
 * series must remove them all. Both go through the same dialog; only the
 * service and hook tests ran it, so a broken choice shipped untested.
 */
test.describe("Kalender Akademik — hapus satu kemunculan atau seluruh rangkaian", () => {
  const wibDay = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000 + 7 * 3_600_000)
      .toISOString()
      .slice(0, 10);

  async function remaining(
    session: Awaited<ReturnType<typeof apiLogin>>,
    title: string,
  ) {
    const listed = await apiRequest<Listed>(
      session,
      "GET",
      `/calendar?limit=100&search=${encodeURIComponent(title)}`,
    );
    return listed.data.filter((e) => e.title === title);
  }

  test("SINGLE menyisakan kemunculan lain, SERIES menghapus semuanya", async ({
    page,
  }) => {
    const title = `Rangkaian hapus e2e ${STAMP}`;
    const session = await apiLogin(SEED_USERS.superAdmin);
    await apiRequest<Created>(session, "POST", "/calendar", {
      title,
      eventType: "MEETING",
      startDate: wibDay(1),
      isAllDay: true,
      isPublic: true,
      recurrence: "DAILY",
      recurrenceEnd: wibDay(3),
    });

    try {
      await loginAs(page, "superAdmin");
      await page.goto("/calendar/events");
      await page.getByPlaceholder("Cari event...").fill(title);

      const rows = page.getByRole("row").filter({ hasText: title });
      await expect(rows).toHaveCount(3, { timeout: 15000 });

      // One occurrence only.
      await rows.first().getByRole("button").last().click({ force: true });
      await page.getByRole("menuitem", { name: /Hapus/ }).click();
      const singleDialog = page.getByRole("alertdialog");
      await singleDialog.getByLabel(/Hanya agenda ini/).check();
      await singleDialog.getByRole("button", { name: "Hapus" }).click();
      await expect(rows).toHaveCount(2, { timeout: 15000 });
      expect(await remaining(session, title)).toHaveLength(2);

      // The whole series.
      await rows.first().getByRole("button").last().click({ force: true });
      await page.getByRole("menuitem", { name: /Hapus/ }).click();
      const seriesDialog = page.getByRole("alertdialog");
      await seriesDialog.getByLabel(/Seluruh rangkaian/).check();
      await seriesDialog.getByRole("button", { name: "Hapus" }).click();
      await expect(rows).toHaveCount(0, { timeout: 15000 });
      expect(await remaining(session, title)).toHaveLength(0);
    } finally {
      // Cleanup must never fail the test. A row the UI already removed answers
      // 404, and deleting one occurrence at a time leaves nothing behind.
      const left = await remaining(session, title);
      for (const e of left) {
        await apiRequest(session, "DELETE", `/calendar/${e.id}`).catch(
          () => undefined,
        );
      }
    }
  });
});

/**
 * Deleting the only row on the last page must fall back to the page that still
 * has rows. Before this, the list kept requesting the vanished page, answered
 * "Tidak ada event ditemukan", and the pager (hidden at one page) offered no
 * way back — 50 agendas were still there.
 */
test.describe("Kalender Akademik — halaman terakhir setelah penghapusan", () => {
  const wibDay = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000 + 7 * 3_600_000)
      .toISOString()
      .slice(0, 10);

  test("kembali ke halaman pertama saat halaman kedua menjadi kosong", async ({
    page,
  }) => {
    const title = `Halaman terakhir e2e ${STAMP}`;
    const session = await apiLogin(SEED_USERS.superAdmin);
    const created = await apiRequest<Created>(session, "POST", "/calendar", {
      title,
      eventType: "MEETING",
      startDate: wibDay(60),
      isAllDay: true,
      isPublic: true,
      recurrence: "DAILY",
      recurrenceEnd: wibDay(110),
    });

    try {
      await loginAs(page, "superAdmin");
      await page.goto("/calendar/events");
      await page.getByPlaceholder("Cari event...").fill(title);

      // 51 occurrences fill page 1 (50) and leave one on page 2.
      const next = page.getByRole("button", { name: "Halaman berikutnya" });
      await expect(next).toBeVisible({ timeout: 15000 });
      await next.click();

      const rows = page.getByRole("row").filter({ hasText: title });
      await expect(rows).toHaveCount(1, { timeout: 15000 });

      await rows.first().getByRole("button").last().click({ force: true });
      await page.getByRole("menuitem", { name: /Hapus/ }).click();
      const dialog = page.getByRole("alertdialog");
      await dialog.getByLabel(/Hanya agenda ini/).check();
      await dialog.getByRole("button", { name: "Hapus" }).click();

      // The page falls back to page 1 where the other 50 rows still are.
      await expect(page.getByText("Tidak ada event ditemukan")).toHaveCount(0, {
        timeout: 15000,
      });
      await expect(rows).toHaveCount(50, { timeout: 15000 });
      await expect(
        page.getByRole("button", { name: "Halaman berikutnya" }),
      ).toHaveCount(0);
    } finally {
      // One delete removes the still-live occurrences, including the parent.
      await apiRequest(
        session,
        "DELETE",
        `/calendar/${created.data.id}?scope=SERIES`,
      ).catch(() => undefined);
    }
  });
});
