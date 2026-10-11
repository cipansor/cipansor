import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
} from "./helpers/auth-api";

/**
 * Raport Merdeka print view. The multi-parameter page (`studentId` /
 * `academicYearId` / `semester`) moved to async `params` (the Next change that
 * turned every `params` into a Promise) and its P5 section learned to render
 * many projects and the empty case. Both were reachable only by hand before.
 */
test.describe("Raport Merdeka — tampilan cetak", () => {
  test("memuat rapor santri dan merender bagian P5 tanpa error", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const session = await apiLogin(SEED_USERS.superAdmin);
    await injectSession(page, session);

    const years = await apiRequest<{
      data: Array<{ id: string; isActive: boolean }>;
    }>(session, "GET", "/academic-years");
    const academicYearId = (years.data.find((y) => y.isActive) ?? years.data[0])
      ?.id;
    expect(academicYearId, "seed should provide an academic year").toBeTruthy();

    // Pick a student who is actually enrolled this year. `/students?limit=1`
    // returns the newest student, and the seed leaves a few without a class
    // (Zahra, Abdullah, Siti) — the API answers 404 "Data enrollment tidak
    // ditemukan" for those, so the page shows its error branch and this test
    // fails for a reason that has nothing to do with the async-params or P5
    // regressions it exists to guard. Start from a class in the year and read
    // its roster instead.
    const classes = await apiRequest<{ data: Array<{ id: string }> }>(
      session,
      "GET",
      `/classes?academicYearId=${academicYearId}&limit=100`,
    );
    let studentId: string | undefined;
    for (const cls of classes.data) {
      const roster = await apiRequest<{
        data: Array<{ id: string; enrollments?: unknown[] }>;
      }>(session, "GET", `/students?classId=${cls.id}&limit=1`);
      const candidate = roster.data[0];
      if (candidate && (candidate.enrollments?.length ?? 0) > 0) {
        studentId = candidate.id;
        break;
      }
    }
    expect(
      studentId,
      "seed should provide a student enrolled in the active academic year",
    ).toBeTruthy();

    await page.goto(
      `/assessment/raport-merdeka/${studentId}/${academicYearId}/1`,
    );

    // The async-params regression would show the error branch, not a report.
    await expect(page.getByText("Gagal memuat data raport")).toHaveCount(0);

    // The report body renders — the P5 section header, and the empty-case note
    // the seed produces (this student has no P5 project this semester).
    await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("heading", {
        name: /PROJEK PENGUATAN PROFIL PELAJAR PANCASILA/i,
      }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(/Belum ada projek P5 pada semester ini/i),
    ).toBeVisible();
  });
});
