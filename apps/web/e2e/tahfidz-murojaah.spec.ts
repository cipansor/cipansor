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

// Same default as helpers/auth-api.ts.
const API_URL = process.env.API_URL || "http://localhost:3001/api";

/**
 * POST the page's body and return the record. `apiRequest` keeps only the
 * first 200 characters of an error, which cuts a Prisma message before its
 * cause; this reports the whole response so a failure names what is wrong.
 */
async function postMurojaah(session: AuthSession, body: unknown) {
  const res = await fetch(`${API_URL}/murojaah`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST /murojaah → ${res.status}: ${text}`);
  return JSON.parse(text) as { data: Murojaah };
}

/**
 * Tahfidz → Murojaah → Tambah (#908).
 *
 * The form's date picker writes `murojaahDate` as a date-only string
 * (`format(data.date, "yyyy-MM-dd")` in `tahfidz/murojaah/new/page.tsx`), and
 * the API's schema demanded an ISO datetime, so every save answered 400 before
 * it reached the service. These cases send the page's own request body to the
 * real API, then read the record back by the same date-only filter the list
 * page uses, so a schema that rejects the form's day fails here again.
 */

type Murojaah = { id: string; murojaahDate: string; studentId: string };

/** The WIB calendar day, as the form's date picker shows it to a WIB user. */
const todayWib = () =>
  new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

test.describe("Murojaah - Tambah", () => {
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
    const teachers = await apiRequest<{ data: { id: string }[] }>(
      session,
      "GET",
      "/hr/teachers?limit=1",
    );
    teacherId = teachers.data[0]?.id ?? "";
  });

  test.afterAll(async () => {
    for (const id of created) {
      await apiRequest(session, "DELETE", `/murojaah/${id}`).catch(() => {});
    }
  });

  test("the form's page opens with its Simpan button", async ({ page }) => {
    await injectSession(page, session);
    await gotoAuthedPage(page, "/tahfidz/murojaah/new", "Tambah Murojaah");
    await expect(page.getByRole("button", { name: "Simpan" })).toBeVisible();
  });

  test("saves the body the form sends, with a date-only murojaahDate", async () => {
    test.skip(await isProductionApi(), "writes a record");
    const day = todayWib();

    // The page spreads its form values and adds the fixed fields (page.tsx,
    // `onSubmit`): the same shape, field for field.
    const res = await postMurojaah(session, {
      studentId,
      teacherId,
      date: new Date().toISOString(),
      surahId: "1",
      startAyat: 1,
      endAyat: 7,
      repetitions: 3,
      notes: "e2e #908",
      murojaahDate: day,
      murojaahType: "DAILY",
      juzStart: 1,
      juzEnd: 1,
      pagesReviewed: 1,
      durationMinutes: 30,
      qualityScore: 0,
    });
    created.push(res.data.id);

    // A `@db.Date` column: the stored day is the one the form showed.
    expect(res.data.murojaahDate.slice(0, 10)).toBe(day);

    // The list filters by the same date-only bounds; the record is on its day.
    const list = await apiRequest<{ data: Murojaah[] }>(
      session,
      "GET",
      `/murojaah?studentId=${studentId}&dateFrom=${day}&dateTo=${day}&limit=100`,
    );
    expect(list.data.map((r) => r.id)).toContain(res.data.id);
  });

  test("still rejects a day that is not a date", async () => {
    test.skip(await isProductionApi(), "would write a record if accepted");
    await expect(
      apiRequest(session, "POST", "/murojaah", {
        studentId,
        murojaahDate: "28/10/2026",
        murojaahType: "DAILY",
        juzStart: 1,
        juzEnd: 1,
        pagesReviewed: 1,
        durationMinutes: 30,
        qualityScore: 0,
      }),
    ).rejects.toThrow(/→ 400/);
  });
});
