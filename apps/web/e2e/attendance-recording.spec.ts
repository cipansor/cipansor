import { test, expect, type Page } from "@playwright/test";
import {
  SEED_USERS,
  apiLogin,
  apiRequest,
  injectSession,
  type AuthSession,
} from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";
import { waitForLoadingComplete } from "./helpers/page-helpers";
import { DEMO_ACCOUNTS } from "../../../packages/shared/src/types/demo-accounts";
import type {
  AttendanceRecorderScope,
  BulkAttendanceResult,
} from "../../../packages/shared/src/schemas/attendance";

/**
 * A class's daily register, taken by the people who take it (2026-09-27):
 *
 * - the wali kelas saves the day from *Mengajar → Absensi → Isi Absensi
 *   Harian*, and saving it again corrects it;
 * - *Wali Kelas → Absensi Harian* opens that same page, on their own class —
 *   one register, one page (the copy at /homeroom/attendance is gone, and
 *   its address answers with a 308);
 * - a teacher with a lesson in a class records it; a teacher with none cannot;
 * - the kepala sekolah reads the register and does not write it; another
 *   unit's teacher does not reach the class;
 * - a pupil marked Alpa on today's register: their wali is told at once, in
 *   the app, and saving the day again does not tell them twice; a santri
 *   mukim's musyrif is told as well;
 * - an Alpa with no reason waits in *Wali Kelas → Tindak Lanjut Absensi*: the
 *   wali kelas contacts the wali and records what came of it — "could not
 *   reach" keeps it there, a reason puts it on the register; a santri mukim's
 *   Alpa is their musyrif's to follow up, not the wali kelas's.
 *
 * Until then every one of these saves was refused: the write routes let
 * admins only, and this suite signed in as the super admin, so nobody saw it.
 *
 * One register per class per day, so the tests run in order; what the
 * accounts below wrote today is removed before and after.
 */

test.describe.configure({ mode: "serial" });

const account = (email: string) => {
  const found = DEMO_ACCOUNTS.find((a) => a.email === email);
  if (!found) throw new Error(`No demo account ${email}`);
  return { email: found.email, password: found.password };
};

/** Today as the teacher's browser dates it (the config pins Asia/Jakarta). */
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

const statusOf = (call: Promise<unknown>) =>
  call.then(
    () => 200,
    (error: Error) => Number(/→ (\d{3})/.exec(error.message)?.[1] ?? 0),
  );

type Row = {
  id: string;
  studentId: string;
  status: string;
  recordedBy?: { id: string };
};
type Enrollment = { student: { id: string; user?: { name: string } } };

let wali: AuthSession;
let pengampu: AuthSession;
let guru: AuthSession;
let kepala: AuthSession;
let waliSmp: AuthSession;
let admin: AuthSession;
let class1A = "";
let class7A = "";
let pupil: { id: string; name: string };

const scopeOf = async (session: AuthSession) =>
  (
    await apiRequest<{ data: AttendanceRecorderScope }>(
      session,
      "GET",
      "/attendance/me/classes",
    )
  ).data;

const registerOf = async (classId: string, session = admin) =>
  (
    await apiRequest<{ data: Row[] }>(
      session,
      "GET",
      `/attendance?classId=${classId}&date=${today()}&limit=100`,
    )
  ).data;

/** Accounts and classes the follow-up tests write to, beyond the above. */
const followers: AuthSession[] = [];
const followUpClasses: string[] = [];

/** Today's records of the classes written by the accounts in this file. */
const purge = async () => {
  const writers = new Set(
    [wali, pengampu, ...followers].map((s) => (s.user as { id: string }).id),
  );
  for (const classId of [class1A, class7A, ...followUpClasses]) {
    for (const row of await registerOf(classId)) {
      if (row.recordedBy && writers.has(row.recordedBy.id)) {
        await apiRequest(admin, "DELETE", `/attendance/${row.id}`);
      }
    }
  }
};

const saved = (page: Page) =>
  page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      new URL(res.url()).pathname.endsWith("/attendance/bulk"),
  );

test.beforeAll(async () => {
  test.skip(
    await isProductionApi(),
    "API_URL menunjuk API produksi; uji ini menulis absensi, jadi dilewati",
  );
  wali = await apiLogin(account("sdit.walikelas@cipansor.or.id"));
  pengampu = await apiLogin(account("smpit.guru@cipansor.or.id"));
  guru = await apiLogin(account("sdit.guru@cipansor.or.id"));
  kepala = await apiLogin(account("sdit.kepala@cipansor.or.id"));
  waliSmp = await apiLogin(account("smpit.walikelas@cipansor.or.id"));
  admin = await apiLogin(SEED_USERS.superAdmin);

  const own = (await scopeOf(wali)).classes.find((c) => c.as === "HOMEROOM");
  expect(
    own,
    "the seed makes sdit.walikelas the wali kelas of SD 1A",
  ).toBeTruthy();
  class1A = own!.id;
  const taught = (await scopeOf(pengampu)).classes.find(
    (c) => c.as === "TEACHER",
  );
  expect(taught, "the seed gives smpit.guru a lesson in SMP 7A").toBeTruthy();
  class7A = taught!.id;

  const enrolled = await apiRequest<{ data: Enrollment[] }>(
    wali,
    "GET",
    `/classes/${class1A}/enrollments`,
  );
  const first = enrolled.data[0]?.student;
  expect(first, "the seed enrols pupils in SD 1A").toBeTruthy();
  pupil = { id: first.id, name: first.user?.name ?? "" };

  await purge();
});

test.afterAll(async () => {
  if (admin) await purge().catch(() => undefined);
});

test("the wali kelas takes the register (Mengajar → Absensi → Isi Absensi Harian)", async ({
  page,
}) => {
  await injectSession(page, wali);
  await page.goto("/attendance");
  await page.getByRole("link", { name: "Isi Absensi Harian" }).click();
  await expect(page).toHaveURL(/\/attendance\/record/);
  await waitForLoadingComplete(page);

  // Their own class is chosen for them; there is no unit to pick.
  await expect(page.getByRole("combobox", { name: "Kelas" })).toContainText(
    "Wali Kelas",
  );
  await expect(page.getByRole("combobox", { name: "Unit" })).toHaveCount(0);

  const row = page.getByTestId(`attendance-row-${pupil.id}`);
  await row.getByRole("button", { name: "Sakit" }).click();
  await expect(row.getByRole("button", { name: "Sakit" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const response = saved(page);
  await page.getByRole("button", { name: "Simpan Kehadiran" }).click();
  const res = await response;
  expect(res.status(), await res.text()).toBe(201);
  const result = (await res.json()).data as BulkAttendanceResult;
  expect(result.updated).toBe(0);
  expect(result.created).toBeGreaterThan(0);
  await expect(page.getByText(/Kehadiran disimpan: \d+ baru/)).toBeVisible();
  // Back on the register, the pupil is named (the list read a field the API
  // does not send, and showed "-" for everyone).
  await expect(page).toHaveURL(/\/attendance$/);
  await expect(
    page.getByRole("cell", { name: pupil.name, exact: true }).first(),
  ).toBeVisible();

  const mine = (await registerOf(class1A)).find(
    (r) => r.studentId === pupil.id,
  );
  expect(mine?.status).toBe("SICK");
  expect(mine?.recordedBy?.id).toBe((wali.user as { id: string }).id);
});

test("saving the day again corrects it, and the form opens on what was saved", async ({
  page,
}) => {
  await injectSession(page, wali);
  await page.goto("/attendance/record");
  await waitForLoadingComplete(page);

  const row = page.getByTestId(`attendance-row-${pupil.id}`);
  await expect(row.getByRole("button", { name: "Sakit" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await row.getByRole("button", { name: "Hadir", exact: true }).click();

  const response = saved(page);
  await page.getByRole("button", { name: "Simpan Kehadiran" }).click();
  const res = await response;
  expect(res.status(), await res.text()).toBe(201);
  expect(((await res.json()).data as BulkAttendanceResult).created).toBe(0);
  await expect(
    page.getByText(/Kehadiran disimpan: \d+ diperbarui/),
  ).toBeVisible();

  const mine = (await registerOf(class1A)).find(
    (r) => r.studentId === pupil.id,
  );
  expect(mine?.status).toBe("PRESENT");
});

test("Wali Kelas → Absensi Harian opens the same register, on their own class", async ({
  page,
}) => {
  await injectSession(page, wali);
  await page.goto("/homeroom");
  await page
    .getByRole("complementary", { name: "Menu utama" })
    .getByRole("link", { name: "Absensi Harian" })
    .click();
  await expect(page).toHaveURL(/\/attendance\/record$/);
  await expect(
    page.getByRole("heading", { name: "Absensi Harian" }),
  ).toBeVisible();
  // One entry lit, not Mengajar → Absensi as well.
  const current = page
    .getByRole("complementary", { name: "Menu utama" })
    .locator('[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("Absensi Harian");
  await waitForLoadingComplete(page);
  await expect(page.getByRole("combobox", { name: "Kelas" })).toContainText(
    "Wali Kelas",
  );

  const row = page.getByTestId(`attendance-row-${pupil.id}`);
  await row.getByRole("button", { name: "Terlambat" }).click();
  const response = saved(page);
  await page.getByRole("button", { name: "Simpan Kehadiran" }).click();
  const res = await response;
  expect(res.status(), await res.text()).toBe(201);

  const mine = (await registerOf(class1A)).find(
    (r) => r.studentId === pupil.id,
  );
  expect(mine?.status).toBe("LATE");
});

test("the old Wali Kelas address answers with the one page", async ({
  page,
}) => {
  await injectSession(page, wali);
  const response = await page.request.get("/homeroom/attendance", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(308);
  expect(response.headers()["location"]).toMatch(/\/attendance\/record$/);

  await page.goto("/homeroom/attendance");
  await expect(page).toHaveURL(/\/attendance\/record$/);
  await expect(
    page.getByRole("heading", { name: "Absensi Harian" }),
  ).toBeVisible();
});

test("a teacher with a lesson in a class records it; one with no class cannot", async ({
  page,
}) => {
  const enrolled = await apiRequest<{ data: Enrollment[] }>(
    pengampu,
    "GET",
    `/classes/${class7A}/enrollments`,
  );
  const records = enrolled.data.map((e) => ({
    studentId: e.student.id,
    status: "PRESENT",
  }));
  const done = await apiRequest<{ data: BulkAttendanceResult }>(
    pengampu,
    "POST",
    "/attendance/bulk",
    { classId: class7A, date: today(), records },
  );
  expect(done.data.created + done.data.updated).toBe(records.length);

  expect(await scopeOf(guru)).toEqual({
    scope: "ASSIGNED",
    unitId: expect.any(String),
    classes: [],
  });
  expect(
    await statusOf(
      apiRequest(guru, "POST", "/attendance/bulk", {
        classId: class1A,
        date: today(),
        records: [{ studentId: pupil.id, status: "ABSENT" }],
      }),
    ),
  ).toBe(403);

  await injectSession(page, guru);
  await page.goto("/attendance/record");
  await expect(page.getByText("Tidak ada kelas untuk dicatat")).toBeVisible();
});

test("the register reminder's link opens that class's register", async ({
  page,
}) => {
  // The reminder 30 minutes after a class's first lesson links to
  // /attendance/record?classId=…. The admin unit records every class of
  // the unit and starts on none, so the class shown comes from the link.
  const adminUnit = await apiLogin(SEED_USERS.adminSdit);
  await injectSession(page, adminUnit);
  await page.goto(`/attendance/record?classId=${class1A}`);
  await waitForLoadingComplete(page);
  await expect(page.getByRole("combobox", { name: "Kelas" })).toContainText(
    "1A",
  );
  await expect(page.getByTestId(`attendance-row-${pupil.id}`)).toBeVisible();
});

test("the kepala sekolah reads the register and does not write it; another unit does not reach it", async () => {
  const read = await registerOf(class1A, kepala);
  expect(read.map((r) => r.studentId)).toContain(pupil.id);

  const change = {
    classId: class1A,
    date: today(),
    records: [{ studentId: pupil.id, status: "ABSENT" }],
  };
  expect(
    await statusOf(apiRequest(kepala, "POST", "/attendance/bulk", change)),
  ).toBe(403);
  expect(
    await statusOf(apiRequest(waliSmp, "POST", "/attendance/bulk", change)),
  ).toBe(404);

  const mine = (await registerOf(class1A)).find(
    (r) => r.studentId === pupil.id,
  );
  expect(mine?.status).toBe("LATE");
});

type Notice = {
  title: string;
  data?: { studentId?: string; date?: string; status?: string };
};

test("a pupil marked Alpa today: their wali is told at once, and only once", async ({
  page,
}) => {
  const ortu = await apiLogin(account("sdit.ortu@cipansor.or.id"));
  const children = await apiRequest<{ data: { id: string; name: string }[] }>(
    ortu,
    "GET",
    "/parent/children",
  );
  const inClass = new Set(
    (
      await apiRequest<{ data: Enrollment[] }>(
        wali,
        "GET",
        `/classes/${class1A}/enrollments`,
      )
    ).data.map((e) => e.student.id),
  );
  const child = children.data.find((c) => inClass.has(c.id));
  expect(child, "the seed's SD wali is the wali of a pupil in 1A").toBeTruthy();

  const alpaNotices = async () =>
    (
      await apiRequest<{ data: Notice[] }>(
        ortu,
        "GET",
        "/notifications?type=ATTENDANCE&limit=100",
      )
    ).data.filter(
      (n) =>
        n.data?.studentId === child!.id &&
        n.data?.date === today() &&
        n.data?.status === "ABSENT",
    ).length;
  const before = await alpaNotices();

  await injectSession(page, wali);
  await page.goto("/attendance/record");
  await waitForLoadingComplete(page);
  const row = page.getByTestId(`attendance-row-${child!.id}`);
  await row.getByRole("button", { name: "Tidak Hadir", exact: true }).click();
  let response = saved(page);
  await page.getByRole("button", { name: "Simpan Kehadiran" }).click();
  expect((await response).status()).toBe(201);

  await expect.poll(alpaNotices, { timeout: 15_000 }).toBe(before + 1);

  // A successful save sends the app to the register with `router.push`. That
  // client-side navigation is still committing when this test would otherwise
  // `goto` straight back to the form, and Firefox aborts the in-flight one
  // (`NS_BINDING_ABORTED`). Let it land first.
  await expect(page).toHaveURL(/\/attendance$/);
  await waitForLoadingComplete(page);

  // The same day saved again, the mark unchanged: no second notice.
  await page.goto("/attendance/record");
  await waitForLoadingComplete(page);
  await expect(
    page
      .getByTestId(`attendance-row-${child!.id}`)
      .getByRole("button", { name: "Tidak Hadir", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  response = saved(page);
  await page.getByRole("button", { name: "Simpan Kehadiran" }).click();
  expect((await response).status()).toBe(201);
  await page.waitForTimeout(2_000);
  expect(await alpaNotices()).toBe(before + 1);

  // What the wali sees: the bell says there is something unread, and opens
  // their own notifications (not the management page) with the notice in it.
  await injectSession(page, ortu);
  await page.goto("/parent");
  const bell = page.getByRole("link", {
    name: /^Notifikasi, \d+ belum dibaca$/,
  });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page).toHaveURL(/\/notifications\/me$/);
  await expect(
    page.getByRole("heading", { name: "Notifikasi Saya" }),
  ).toBeVisible();
  const notice = page
    .getByRole("listitem")
    .filter({ hasText: `${child!.name} tidak hadir tanpa keterangan (Alpa)` })
    .first();
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: /^Tandai dibaca/ }).click();
  await expect(
    notice.getByRole("button", { name: /^Tandai dibaca/ }),
  ).toHaveCount(0);
});

test("a santri mukim marked Alpa: the musyrif of their asrama is told", async () => {
  // A boarder in SMP 7A, the class smpit.guru teaches.
  const enrolled = (
    await apiRequest<{ data: Enrollment[] }>(
      admin,
      "GET",
      `/classes/${class7A}/enrollments`,
    )
  ).data.map((e) => e.student.id);
  let boarder: { id: string; asrama: string } | undefined;
  for (const id of enrolled) {
    const placed = await apiRequest<{
      data: { room: { dormitory: { name: string } } }[];
    }>(
      admin,
      "GET",
      `/dormitories/assignments/list?studentId=${id}&isActive=true`,
    );
    if (placed.data[0]) {
      boarder = { id, asrama: placed.data[0].room.dormitory.name };
      break;
    }
  }
  expect(boarder, "the seed places pupils of SMP 7A in an asrama").toBeTruthy();
  const musyrif = await apiLogin(
    account(
      boarder!.asrama.includes("Putri")
        ? "pesantren.musyrifah@cipansor.or.id"
        : "pesantren.musyrif@cipansor.or.id",
    ),
  );
  const told = async () =>
    (
      await apiRequest<{ data: Notice[] }>(
        musyrif,
        "GET",
        "/notifications?type=ATTENDANCE&limit=100",
      )
    ).data.filter(
      (n) =>
        n.data?.studentId === boarder!.id &&
        n.data?.date === today() &&
        n.data?.status === "ABSENT",
    ).length;
  const before = await told();

  await apiRequest(pengampu, "POST", "/attendance/bulk", {
    classId: class7A,
    date: today(),
    records: [{ studentId: boarder!.id, status: "ABSENT" }],
  });

  await expect.poll(told, { timeout: 15_000 }).toBe(before + 1);
});

type FollowUpItem = {
  attendanceId: string;
  student: { id: string; name: string };
  as: "WALI_KELAS" | "MUSYRIF";
  walis: { phone: string | null }[];
};

const followUpsOf = async (session: AuthSession) =>
  (
    await apiRequest<{ data: FollowUpItem[] }>(
      session,
      "GET",
      "/attendance/follow-ups",
    )
  ).data;

/** A class's pupils, split by whether they live in an asrama. */
const pupilsOf = async (classId: string) => {
  const enrolled = (
    await apiRequest<{ data: Enrollment[] }>(
      admin,
      "GET",
      `/classes/${classId}/enrollments`,
    )
  ).data;
  const day: { id: string; name: string }[] = [];
  const boarding: { id: string; name: string; asrama: string }[] = [];
  for (const e of enrolled) {
    const placed = await apiRequest<{
      data: { room: { dormitory: { name: string } } }[];
    }>(
      admin,
      "GET",
      `/dormitories/assignments/list?studentId=${e.student.id}&isActive=true`,
    );
    const who = { id: e.student.id, name: e.student.user?.name ?? "" };
    if (placed.data[0]) {
      boarding.push({ ...who, asrama: placed.data[0].room.dormitory.name });
    } else day.push(who);
  }
  return { day, boarding };
};

const markAbsent = (studentId: string, classId = class1A, by = wali) =>
  apiRequest(by, "POST", "/attendance/bulk", {
    classId,
    date: today(),
    records: [{ studentId, status: "ABSENT" }],
  });

test("an Alpa with no reason waits in Tindak Lanjut Absensi; a reason puts it on the register", async ({
  page,
}) => {
  const { day } = await pupilsOf(class1A);
  const dayPupil = day[0];
  expect(dayPupil, "SD 1A has a pupil who goes home daily").toBeTruthy();
  await markAbsent(dayPupil.id);
  const mark = (await registerOf(class1A)).find(
    (r) => r.studentId === dayPupil.id,
  )!;
  expect(mark.status).toBe("ABSENT");

  await injectSession(page, wali);
  await page.goto("/homeroom");
  await page
    .getByRole("complementary", { name: "Menu utama" })
    .getByRole("link", { name: "Tindak Lanjut Absensi" })
    .click();
  await expect(page).toHaveURL(/\/attendance\/follow-ups$/);
  await expect(
    page.getByRole("heading", { name: "Tindak Lanjut Absensi" }),
  ).toBeVisible();

  const card = page.getByTestId(`follow-up-${mark.id}`);
  await expect(card).toContainText(dayPupil.name);
  await expect(card).toContainText("Perwalian");
  // Someone to call: every pupil has at least the contact given at enrolment.
  await expect(
    card.getByRole("link", { name: /^WhatsApp / }).first(),
  ).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+$/);

  // The wali did not answer: tried, still open.
  await card.getByRole("button", { name: "Catat hasil" }).click();
  let dialog = page.getByRole("dialog", { name: "Catat hasil tindak lanjut" });
  await expect(dialog.getByRole("button", { name: "Simpan" })).toBeDisabled();
  await dialog.getByRole("radio", { name: /Wali tidak terhubungi/ }).check();
  await dialog.getByRole("button", { name: "Simpan" }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toContainText("Wali tidak terhubungi lewat telepon");

  // Reached on WhatsApp: ill. The mark becomes Sakit and leaves the list.
  await card.getByRole("button", { name: "Catat hasil" }).click();
  dialog = page.getByRole("dialog", { name: "Catat hasil tindak lanjut" });
  await dialog.getByRole("radio", { name: "WhatsApp" }).check();
  await dialog.getByRole("radio", { name: /^Sakit/ }).check();
  await dialog.getByLabel("Catatan (opsional)").fill("Demam sejak semalam");
  await dialog.getByRole("button", { name: "Simpan" }).click();
  await expect(
    page.getByText(`${dayPupil.name}: Absensi diubah menjadi Sakit`),
  ).toBeVisible();
  await expect(card).toHaveCount(0);

  const after = (await registerOf(class1A)).find(
    (r) => r.studentId === dayPupil.id,
  ) as Row & { notes?: string };
  expect(after.status).toBe("SICK");
  expect(after.notes).toBe("Tindak lanjut: sakit — Demam sejak semalam");
  // No longer Alpa: nothing more to follow up.
  expect(
    await statusOf(
      apiRequest(wali, "POST", `/attendance/${mark.id}/follow-ups`, {
        channel: "PHONE",
        outcome: "NO_REASON",
      }),
    ),
  ).toBe(409);
});

test("a santri mukim's Alpa is their musyrif's to follow up, not the wali kelas's", async () => {
  // Boarding is compulsory at SMP IT, so the SMP wali kelas's class is where
  // the seed has santri mukim.
  const classSmp = (await scopeOf(waliSmp)).classes.find(
    (c) => c.as === "HOMEROOM",
  )?.id;
  expect(classSmp, "the seed makes smpit.walikelas a wali kelas").toBeTruthy();
  followUpClasses.push(classSmp!);
  followers.push(waliSmp);
  const boarder = (await pupilsOf(classSmp!)).boarding[0];
  expect(
    boarder,
    "the seed places the SMP wali kelas's pupils in an asrama",
  ).toBeTruthy();
  const musyrif = await apiLogin(
    account(
      boarder.asrama.includes("Putri")
        ? "pesantren.musyrifah@cipansor.or.id"
        : "pesantren.musyrif@cipansor.or.id",
    ),
  );
  followers.push(musyrif);
  await markAbsent(boarder.id, classSmp!, waliSmp);
  const mark = (await registerOf(classSmp!)).find(
    (r) => r.studentId === boarder.id,
  )!;

  const theirs = (await followUpsOf(musyrif)).find(
    (i) => i.attendanceId === mark.id,
  );
  expect(theirs?.as).toBe("MUSYRIF");
  // The class's own wali kelas neither sees it nor can record it.
  expect((await followUpsOf(waliSmp)).map((i) => i.attendanceId)).not.toContain(
    mark.id,
  );
  expect(
    await statusOf(
      apiRequest(waliSmp, "POST", `/attendance/${mark.id}/follow-ups`, {
        channel: "PHONE",
        outcome: "NO_REASON",
      }),
    ),
  ).toBe(404);

  // No reason given: closed, and it stays Alpa.
  await apiRequest(musyrif, "POST", `/attendance/${mark.id}/follow-ups`, {
    channel: "IN_PERSON",
    outcome: "NO_REASON",
  });
  expect((await followUpsOf(musyrif)).map((i) => i.attendanceId)).not.toContain(
    mark.id,
  );
  expect(
    (await registerOf(classSmp!)).find((r) => r.studentId === boarder.id)
      ?.status,
  ).toBe("ABSENT");
});
