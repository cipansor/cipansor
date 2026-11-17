import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
  type AuthSession,
} from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";
import { gotoAuthedPage, waitForToast } from "./helpers/page-helpers";

/**
 * Tahfidz → Jadwal Simaan → Jadwalkan / Ubah (#1024).
 *
 * The three simaan forms sent values the API's Zod schema rejected, so every
 * save answered 400: the API validated `simaanType` against `JUZ_AMMA`/`ONE_JUZ`
 * while the forms and the Prisma `SimaanType` enum used `BIN_NAZHR`/…; the edit
 * form sent an ISO datetime where the schema wanted `YYYY-MM-DD`, and wrote
 * `juzStart: 1` with the juz count as `juzEnd`, silently overwriting the real
 * range. The contract now lives once in `@cipansor/shared` (canonical set = the
 * Prisma enum), and the edit form sends only the fields the user changed.
 *
 * These cases drive the real pages and the real API: they open the Jadwalkan
 * form, save, then edit and read the record back — so a schema that stops
 * agreeing with the forms fails here again.
 */

type Simaan = {
  id: string;
  simaanType: string;
  examDate: string;
  juzStart: number;
  juzEnd: number;
  notes?: string | null;
  overallScore?: number | null;
  tajwidScore?: number | null;
  fashohaScore?: number | null;
  tartilScore?: number | null;
  passed?: boolean;
};

const API_URL = process.env.API_URL || "http://localhost:3001/api";

/** POST the form's body and return the record, reporting the whole response. */
async function postSimaan(session: AuthSession, body: unknown) {
  const res = await fetch(`${API_URL}/simaan`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST /simaan → ${res.status}: ${text}`);
  return JSON.parse(text) as { data: Simaan };
}

/** The WIB calendar day, as the form's date picker shows it to a WIB user. */
const todayWib = () =>
  new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

test.describe("Simaan - jadwalkan dan ubah", () => {
  let session: AuthSession;
  let studentId: string;
  let teacherId: string;
  const created: string[] = [];

  test.beforeAll(async () => {
    session = await apiLogin(SEED_USERS.superAdmin);
    const students = await apiRequest<{ data: { id: string }[] }>(
      session,
      "GET",
      "/students?limit=1",
    );
    studentId = students.data[0].id;
    const teachers = await apiRequest<{
      data: { id: string; userId: string }[];
    }>(session, "GET", "/hr/teachers?limit=1");
    // `SimaanExaminer.examinerId` references `users.id`; the picker sends
    // `teacher.userId`, not the Teacher row id (the FK bug #1024 hid behind).
    teacherId = teachers.data[0]?.userId ?? "";
  });

  test.afterAll(async () => {
    for (const id of created) {
      await apiRequest(session, "DELETE", `/simaan/${id}`).catch(() => {});
    }
  });

  test("the Jadwalkan form opens with its submit button", async ({ page }) => {
    await injectSession(page, session);
    await gotoAuthedPage(page, "/tahfidz/simaan/new", "Jadwalkan Ujian Simaan");
    await expect(
      page.getByRole("button", { name: "Jadwalkan Ujian" }),
    ).toBeVisible();
  });

  test("saves the create body, with a date-only examDate and the shared type", async () => {
    test.skip(await isProductionApi(), "writes a record");
    const day = todayWib();

    // The page's own `onSubmit` body (tahfidz/simaan/new/page.tsx): a shared
    // `simaanType`, a `yyyy-MM-dd` day, and the user's juz range.
    const res = await postSimaan(session, {
      studentId,
      simaanType: "BIN_NAZHR",
      examDate: day,
      juzStart: 1,
      juzEnd: 30,
      notes: "e2e #1024",
      examinerIds: teacherId ? [teacherId] : [],
    });
    created.push(res.data.id);

    expect(res.data.simaanType).toBe("BIN_NAZHR");
    expect(res.data.examDate.slice(0, 10)).toBe(day);
    expect(res.data.juzStart).toBe(1);
    expect(res.data.juzEnd).toBe(30);
  });

  test("the update form sends only the fields the user changed", async () => {
    test.skip(await isProductionApi(), "writes a record");
    const day = todayWib();

    const res = await postSimaan(session, {
      studentId,
      simaanType: "BIL_GHAIB",
      examDate: day,
      juzStart: 21,
      juzEnd: 25,
      notes: "e2e #1024 — before",
      examinerIds: teacherId ? [teacherId] : [],
    });
    created.push(res.data.id);

    // The edit form only sends what `dirtyFields` reports (page.tsx): changing
    // notes must NOT resend `juzStart`/`juzEnd`, or the original range is
    // silently overwritten with 1–1.
    const patched = await apiRequest<{ data: Simaan }>(
      session,
      "PATCH",
      `/simaan/${res.data.id}`,
      { notes: "e2e #1024 — after" },
    );
    expect(patched.data.juzStart).toBe(21);
    expect(patched.data.juzEnd).toBe(25);
    expect(patched.data.notes).toBe("e2e #1024 — after");
  });

  test("reads the saved record back from the list and detail pages", async ({
    page,
  }) => {
    test.skip(await isProductionApi(), "writes a record");
    const day = todayWib();

    const res = await postSimaan(session, {
      studentId,
      simaanType: "TASMI",
      examDate: day,
      juzStart: 1,
      juzEnd: 1,
      notes: "e2e #1024 — read back",
      examinerIds: teacherId ? [teacherId] : [],
    });
    created.push(res.data.id);

    await injectSession(page, session);

    // The list shows the Indonesian label for the shared type, not the raw code.
    await gotoAuthedPage(page, "/tahfidz/simaan", "Ujian Simaan");
    await expect(
      page.getByText("Tasmi (Setoran)", { exact: false }).first(),
    ).toBeVisible();

    // The detail page shows the coverage the juz range means.
    await gotoAuthedPage(
      page,
      `/tahfidz/simaan/${res.data.id}`,
      "Detail Ujian Simaan",
    );
    await expect(page.getByText("Juz 1", { exact: true })).toBeVisible();
  });

  test("still rejects a simaanType outside the shared enum", async () => {
    test.skip(await isProductionApi(), "would write a record if accepted");
    await expect(
      apiRequest(session, "POST", "/simaan", {
        studentId,
        simaanType: "JUZ_AMMA",
        examDate: todayWib(),
        juzStart: 1,
        juzEnd: 1,
      }),
    ).rejects.toThrow(/→ 400/);
  });
});

/**
 * The three forms themselves — driven through the browser, not by posting a
 * body straight at the API. The cases above read the contract; these read the
 * *forms*, so a page whose `onSubmit` stops agreeing with the contract fails
 * here. The one that matters most is the edit form's `dirtyFields` guard: the
 * #1024 regression overwrote a juz 21–25 range with 1–1 because the form
 * resent every field on save.
 */
test.describe("Simaan — alur ketiga formulir", () => {
  let session: AuthSession;
  let studentId: string;
  let studentName: string;
  let enrollmentId: string;
  let takhosusStudentId: string;
  let takhosusStudentName: string;
  const created: string[] = [];

  test.beforeAll(async () => {
    session = await apiLogin(SEED_USERS.superAdmin);

    // A santri the super admin reaches, for the create form's own picker.
    // The raw API nests the display name under `user` (the `useStudents` hook
    // flattens it; this call reads the API directly).
    const students = await apiRequest<{
      data: { id: string; user: { name: string } }[];
    }>(session, "GET", "/students?limit=1");
    studentId = students.data[0].id;
    studentName = students.data[0].user.name;

    // The Takhosus dialog lives on the enrollment detail page and lists the
    // exams of the enrolled santri. There is one seeded enrollment.
    const enrollments = await apiRequest<{
      data: { id: string; studentId: string }[];
    }>(session, "GET", "/takhosus/enrollment?limit=1");
    enrollmentId = enrollments.data[0].id;
    takhosusStudentId = enrollments.data[0].studentId;
    const enrolled = await apiRequest<{ data: { user: { name: string } } }>(
      session,
      "GET",
      `/students/${takhosusStudentId}`,
    );
    takhosusStudentName = enrolled.data.user.name;
  });

  test.afterAll(async () => {
    for (const id of created) {
      await apiRequest(session, "DELETE", `/simaan/${id}`).catch(() => {});
    }
  });

  test("the Jadwalkan form saves from the page, not a posted body", async ({
    page,
  }) => {
    test.skip(await isProductionApi(), "writes a record");
    await injectSession(page, session);
    await gotoAuthedPage(page, "/tahfidz/simaan/new", "Jadwalkan Ujian Simaan");

    // Santri picker — the page's own `useStudents`, not a posted id.
    await page
      .locator('button[role="combobox"]')
      .filter({ hasText: "Pilih santri" })
      .click();
    await page.getByRole("option", { name: new RegExp(studentName) }).click();

    // Jenis Ujian is a card grid; the default is Bin Nazhr, pick Tasmi to prove
    // the choice reaches the contract.
    await page.getByText("Tasmi (Setoran)").click();

    // At least one penguji: the checkbox's onClick lives on its row, so click
    // the teacher's name (the row), which is what a person does.
    await page.getByText("Pengajar").first().click();

    await page.getByRole("button", { name: "Jadwalkan Ujian" }).click();
    await waitForToast(page, "Ujian simaan berhasil dijadwalkan");

    // The page routes back to the list; the new row shows the shared type label.
    await expect(
      page.getByRole("heading", { name: "Ujian Simaan", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText("Tasmi (Setoran)", { exact: false }).first(),
    ).toBeVisible();
  });

  test("the edit form sends only the changed field, keeping the juz range", async ({
    page,
  }) => {
    test.skip(await isProductionApi(), "writes a record");

    // Seed a record with a juz range that the #1024 regression overwrote.
    const seeded = await postSimaan(session, {
      studentId,
      simaanType: "TASMI",
      examDate: todayWib(),
      juzStart: 21,
      juzEnd: 25,
      notes: "e2e dirtyFields — sebelum",
      examinerIds: [],
    });
    created.push(seeded.data.id);

    await injectSession(page, session);
    await gotoAuthedPage(
      page,
      `/tahfidz/simaan/${seeded.data.id}/edit`,
      "Edit Ujian Simaan",
    );

    // Change only the notes. `dirtyFields` must then send `{ notes }` alone —
    // a form that resends `juzStart`/`juzEnd` silently rewrites 21–25 to 1–1.
    await page.getByLabel("Catatan").fill("e2e dirtyFields — sesudah");
    await page.getByRole("button", { name: "Simpan Perubahan" }).click();

    await expect(
      page.getByRole("heading", { name: "Detail Ujian Simaan", level: 1 }),
    ).toBeVisible();

    // Read the record back through the API: the range must be intact.
    const after = await apiRequest<{ data: Simaan }>(
      session,
      "GET",
      `/simaan/${seeded.data.id}`,
    );
    expect(after.data.juzStart).toBe(21);
    expect(after.data.juzEnd).toBe(25);
    expect(after.data.notes).toBe("e2e dirtyFields — sesudah");

    // And the detail page shows the coverage that range means.
    await expect(page.getByText(/Juz 21.25/)).toBeVisible();
  });

  test("the Takhosus dialog edits the record through its own form", async ({
    page,
  }) => {
    test.skip(await isProductionApi(), "writes a record");

    // One exam for the enrolled santri, so the dialog has a row to open.
    const seeded = await postSimaan(session, {
      studentId: takhosusStudentId,
      simaanType: "BIN_NAZHR",
      examDate: todayWib(),
      juzStart: 2,
      juzEnd: 4,
      notes: "e2e dialog — sebelum",
      examinerIds: [],
    });
    created.push(seeded.data.id);

    await injectSession(page, session);
    await gotoAuthedPage(
      page,
      `/takhosus/enrollment/${enrollmentId}`,
      takhosusStudentName,
    );

    // Riwayat Simaan tab → the row's edit (pencil) button opens the dialog.
    await page.getByRole("tab", { name: "Riwayat Simaan" }).click();
    await page
      .locator("tr", { hasText: "Juz 2-4" })
      .getByRole("button")
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Catatan").fill("e2e dialog — sesudah");
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await waitForToast(page, "Data simaan berhasil diperbarui");

    // The dialog's `onSubmit` sends the whole form; the juz range it loaded
    // must be the one it saves back, and the notes must reach the record.
    const after = await apiRequest<{ data: Simaan }>(
      session,
      "GET",
      `/simaan/${seeded.data.id}`,
    );
    expect(after.data.juzStart).toBe(2);
    expect(after.data.juzEnd).toBe(4);
    expect(after.data.notes).toBe("e2e dialog — sesudah");
  });
});

/**
 * The review's two web-observable findings on PR #1125.
 *
 * (1) A `z.coerce.number()` in the dialog's schema read a `null` score from the
 *     loaded record as `0`, so editing the notes of an ungraded simaan wrote
 *     four zeroes over four blanks. (2) The list page filtered on `passed`
 *     while the badge used "has a score", so a failed exam (score 40,
 *     passed=false) showed a "Selesai" badge yet was hidden from "Selesai" and
 *     listed under "Terjadwal". Both drive the real pages/API and read the
 *     record back.
 */
test.describe("Simaan — catatan tanpa nilai, dan status turunan", () => {
  let session: AuthSession;
  let studentId: string;
  let studentName: string;
  let enrollmentId: string;
  let takhosusStudentId: string;
  let takhosusStudentName: string;
  const created: string[] = [];

  test.beforeAll(async () => {
    session = await apiLogin(SEED_USERS.superAdmin);
    const students = await apiRequest<{
      data: { id: string; user: { name: string } }[];
    }>(session, "GET", "/students?limit=1");
    studentId = students.data[0].id;
    studentName = students.data[0].user.name;

    const enrollments = await apiRequest<{
      data: { id: string; studentId: string }[];
    }>(session, "GET", "/takhosus/enrollment?limit=1");
    enrollmentId = enrollments.data[0].id;
    takhosusStudentId = enrollments.data[0].studentId;
    const enrolled = await apiRequest<{ data: { user: { name: string } } }>(
      session,
      "GET",
      `/students/${takhosusStudentId}`,
    );
    takhosusStudentName = enrolled.data.user.name;
  });

  test.afterAll(async () => {
    for (const id of created) {
      await apiRequest(session, "DELETE", `/simaan/${id}`).catch(() => {});
    }
  });

  test("editing an ungraded simaan keeps its four scores blank", async ({
    page,
  }) => {
    test.skip(await isProductionApi(), "writes a record");

    const seeded = await postSimaan(session, {
      studentId: takhosusStudentId,
      simaanType: "BIN_NAZHR",
      examDate: todayWib(),
      juzStart: 2,
      juzEnd: 4,
      notes: "e2e null-score — sebelum",
      examinerIds: [],
    });
    created.push(seeded.data.id);

    await injectSession(page, session);
    await gotoAuthedPage(
      page,
      `/takhosus/enrollment/${enrollmentId}`,
      takhosusStudentName,
    );
    await page.getByRole("tab", { name: "Riwayat Simaan" }).click();
    await page
      .locator("tr", { hasText: "Juz 2-4" })
      .getByRole("button")
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Change only the notes; every score input is left empty.
    await dialog.getByLabel("Catatan").fill("e2e null-score — sesudah");
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await waitForToast(page, "Data simaan berhasil diperbarui");

    // Read it back: the four ungraded scores must still be blank, not zero.
    const after = await apiRequest<{ data: Simaan }>(
      session,
      "GET",
      `/simaan/${seeded.data.id}`,
    );
    expect(after.data.notes).toBe("e2e null-score — sesudah");
    expect(after.data.overallScore).toBeNull();
    expect(after.data.tajwidScore).toBeNull();
    expect(after.data.fashohaScore).toBeNull();
    expect(after.data.tartilScore).toBeNull();
  });

  test("a failed exam (score, passed=false) is Selesai on the server and the page", async ({
    page,
  }) => {
    test.skip(await isProductionApi(), "writes a record");

    const seeded = await postSimaan(session, {
      studentId,
      simaanType: "TASMI",
      examDate: todayWib(),
      juzStart: 6,
      juzEnd: 6,
      notes: "e2e status — gagal",
      examinerIds: [],
    });
    created.push(seeded.data.id);

    // Grade it below the pass mark: `passed=false` but a score is present.
    await apiRequest(session, "POST", "/simaan/scores", {
      simaanId: seeded.data.id,
      overallScore: 40,
      grade: "RASIB",
      passed: false,
    });

    // The server agrees with the badge: Selesai is "passed OR a score".
    const completed = await apiRequest<{ data: Simaan[] }>(
      session,
      "GET",
      "/simaan?status=COMPLETED&limit=100",
    );
    expect(completed.data.some((e) => e.id === seeded.data.id)).toBe(true);

    const scheduled = await apiRequest<{ data: Simaan[] }>(
      session,
      "GET",
      "/simaan?status=SCHEDULED&limit=100",
    );
    expect(scheduled.data.some((e) => e.id === seeded.data.id)).toBe(false);

    // And the page: filtering on Selesai keeps the row on screen. The student
    // is the first seeded one, so the filter cannot page the row away.
    await injectSession(page, session);
    await gotoAuthedPage(page, "/tahfidz/simaan", "Ujian Simaan");
    await page.getByPlaceholder("Cari nama santri...").fill(studentName);
    await page
      .locator('button[role="combobox"]')
      .filter({ hasText: "Semua Status" })
      .click();
    await page.getByRole("option", { name: "Selesai" }).click();
    const row = page.locator("tr", { hasText: studentName }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText("Selesai")).toBeVisible();
  });
});

/**
 * A passing simaan moves the Takhosus progress no matter which door it came
 * through. It used to move only on `/takhosus/simaan/:id/grade`, so the same
 * `passed: true` saved through `PATCH /simaan/:id` left the enrollment ACTIVE
 * with no hafidz record (#1125). This creates its own santri + enrollment so it
 * touches no seeded progress, then drives the write through the enrollment
 * dialog itself and checks the page moves without a reload.
 */
test.describe("Simaan — kelulusan memperbarui progres di setiap jalur", () => {
  let session: AuthSession;
  let studentId: string;
  let enrollmentId: string | null = null;
  let examId: string | null = null;
  let takhosusStudentName = "";

  test.beforeAll(async () => {
    // The setup itself writes (it enrolls a santri), so it must not run against
    // production either — `test.skip` inside each case runs *after* `beforeAll`,
    // so it cannot prevent that write. Nothing to clean up when we bail here.
    if (await isProductionApi()) return;
    session = await apiLogin(SEED_USERS.superAdmin);
    const students = await apiRequest<{ data: { id: string }[] }>(
      session,
      "GET",
      "/students?limit=100",
    );
    // A santri with no enrollment, so the created one is ours to remove.
    for (const s of students.data) {
      const existing = await apiRequest<{ data: unknown[] }>(
        session,
        "GET",
        `/takhosus/enrollment?studentId=${s.id}`,
      ).catch(() => ({ data: [] }));
      if (!existing.data || existing.data.length === 0) {
        studentId = s.id;
        break;
      }
    }
    const halaqohs = await apiRequest<{ data: { id: string }[] }>(
      session,
      "GET",
      "/takhosus/halaqoh?limit=1",
    );
    const enrollment = await apiRequest<{
      data: { id: string; student?: { user?: { name?: string } } };
    }>(session, "POST", "/takhosus/enrollment", {
      studentId,
      halaqohId: halaqohs.data[0].id,
      targetJuz: 30,
    });
    enrollmentId = enrollment.data.id;
    takhosusStudentName = enrollment.data.student?.user?.name ?? "";
  });

  test.afterAll(async () => {
    if (examId)
      await apiRequest(session, "DELETE", `/simaan/${examId}`).catch(() => {});
    if (enrollmentId)
      await apiRequest(
        session,
        "DELETE",
        `/takhosus/enrollment/${enrollmentId}`,
      ).catch(() => {});
  });

  test("marking the 30-juz exam lulus in the dialog updates the page", async ({
    page,
  }) => {
    test.skip(await isProductionApi(), "writes records");

    // The enrollment we created is fresh: 0 of 30 juz, status Aktif.
    const exam = await postSimaan(session, {
      studentId,
      simaanType: "KHATAM",
      examDate: todayWib(),
      juzStart: 1,
      juzEnd: 30,
      examinerIds: [],
    });
    examId = exam.data.id;

    await injectSession(page, session);
    await gotoAuthedPage(
      page,
      `/takhosus/enrollment/${enrollmentId}`,
      takhosusStudentName,
    );

    // Nothing passed yet: the progress card reads 0 of 30.
    await expect(page.getByText(/^0 dari 30 juz selesai/)).toBeVisible();

    await page.getByRole("tab", { name: "Riwayat Simaan" }).click();
    await page
      .locator("tr", { hasText: "Juz 1-30" })
      .first()
      .getByRole("button")
      .first()
      .click();

    // The dialog's own path: tick Lulus Ujian and save. This is the write that
    // used to mark the exam passed and leave the enrollment ACTIVE.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Lulus Ujian").check();
    await dialog.getByRole("button", { name: "Simpan" }).click();
    await waitForToast(page, "Data simaan berhasil diperbarui");

    // Without a reload, the page's progress must move — the mutation
    // invalidates the Takhosus keys the enrollment page reads (#1125).
    await expect(page.getByText(/^30 dari 30 juz selesai/)).toBeVisible();

    // And the server agrees: the enrollment is COMPLETED.
    const after = await apiRequest<{ data: { status: string } }>(
      session,
      "GET",
      `/takhosus/enrollment/${enrollmentId}`,
    );
    expect(after.data.status).toBe("COMPLETED");

    // Reverting undoes it, again without a reload.
    await page
      .locator("tr", { hasText: "Juz 1-30" })
      .first()
      .getByRole("button")
      .first()
      .click();
    const again = page.getByRole("dialog");
    await expect(again).toBeVisible();
    await again.getByLabel("Lulus Ujian").uncheck();
    await again.getByRole("button", { name: "Simpan" }).click();
    await waitForToast(page, "Data simaan berhasil diperbarui");
    await expect(page.getByText(/^0 dari 30 juz selesai/)).toBeVisible();

    const reverted = await apiRequest<{ data: { status: string } }>(
      session,
      "GET",
      `/takhosus/enrollment/${enrollmentId}`,
    );
    expect(reverted.data.status).not.toBe("COMPLETED");
  });
});
