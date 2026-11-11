import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
} from "./helpers/auth-api";
import { gotoAuthedPage } from "./helpers/page-helpers";

/**
 * A slot's day, end to end.
 *
 * The API names it `dayOfWeek`; the pages read and group by `day`. Before the
 * mapping (`fromApiSchedule` / `toApiSchedule`), every slot came back with
 * `day: undefined`, so `Mata Pelajaran & Jadwal → Jadwal` showed "Tidak ada
 * jadwal" under every day, and a slot added through the form dropped its day
 * (the API's schema stripped the unknown key). This spec adds a slot through
 * the API, then asserts the page files it under the right day and shows the
 * guru pengajar's name — both read from the mapped row.
 */
test.describe("Jadwal — hari dan guru dari API", () => {
  test("slot terjadwal muncul di hari yang benar, dengan nama guru", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const admin = await apiLogin(SEED_USERS.superAdmin);

    const { data: classes } = await apiRequest<{
      data: Array<{ id: string; name: string; unitId: string }>;
    }>(admin, "GET", "/classes?limit=100");

    // The class whose unit actually has subjects and teachers to draw on.
    let chosen:
      | {
          cls: { id: string; unitId: string };
          subjectId: string;
          teacher: { id: string; user: { name: string } };
        }
      | undefined;
    for (const cls of classes) {
      const { data: subjects } = await apiRequest<{
        data: Array<{ id: string }>;
      }>(admin, "GET", `/curriculum/subjects?unitId=${cls.unitId}&limit=1`);
      const { data: teachers } = await apiRequest<{
        data: Array<{ id: string; user: { name: string } | null }>;
      }>(admin, "GET", `/hr/teachers?unitId=${cls.unitId}&limit=100`);
      const teacher = teachers.find((t) => t.user?.name);
      if (subjects.length && teacher) {
        chosen = {
          cls,
          subjectId: subjects[0].id,
          teacher: { id: teacher.id, user: teacher.user! },
        };
        break;
      }
    }
    expect(chosen, "a class with a subject and a teacher").toBeTruthy();

    const { data: years } = await apiRequest<{
      data: Array<{ id: string; isActive: boolean }>;
    }>(admin, "GET", "/academic-years?limit=100");
    const year = years.find((y) => y.isActive);
    expect(year, "an active academic year").toBeTruthy();

    const room = `Uji ${Date.now().toString(36).toUpperCase()}`;
    const created = await apiRequest<{ data: { id: string } }>(
      admin,
      "POST",
      "/curriculum/schedules",
      {
        unitId: chosen!.cls.unitId,
        academicYearId: year!.id,
        classId: chosen!.cls.id,
        subjectId: chosen!.subjectId,
        teacherId: chosen!.teacher.id,
        dayOfWeek: "WEDNESDAY",
        startTime: "13:00",
        endTime: "14:30",
        room,
        isActive: true,
      },
    );

    try {
      await injectSession(page, admin);
      await gotoAuthedPage(page, "/curriculum", /Mata Pelajaran & Jadwal/);
      await page.getByRole("tab", { name: "Jadwal" }).click();

      // The new slot's own row, inside the "Rabu" card: a `dayOfWeek` of
      // WEDNESDAY must be filed under Rabu, not dropped or shown elsewhere.
      const rabu = page
        .locator('[data-slot="card"]')
        .filter({
          has: page.locator('[data-slot="card-title"]', { hasText: "Rabu" }),
        })
        .last();
      const row = rabu.locator("div.rounded-lg").filter({ hasText: room });
      await expect(row).toBeVisible();
      await expect(row).toContainText("13:00 - 14:30");
      // The guru pengajar is the teacher's name, not an empty string.
      await expect(row).toContainText(chosen!.teacher.user.name);
    } finally {
      await apiRequest(
        admin,
        "DELETE",
        `/curriculum/schedules/${created.data.id}`,
      ).catch(() => {});
    }
  });
});
