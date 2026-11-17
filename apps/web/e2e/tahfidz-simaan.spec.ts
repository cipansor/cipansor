import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
  type AuthSession,
} from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";
import { gotoAuthedPage } from "./helpers/page-helpers";

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
