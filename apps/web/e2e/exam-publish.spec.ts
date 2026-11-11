import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
} from "./helpers/auth-api";
import { gotoAuthedPage, waitForToast } from "./helpers/page-helpers";

/**
 * Publishing an exam from its detail page (`/assessment/[id]`).
 *
 * `usePublishExam` invalidates `["exam", id]`, which `["exams"]` does not
 * cover, so the detail page used to keep showing "Draft" and the Publikasikan
 * button after a successful publish. The hook test proves the key is
 * invalidated; only this spec proves a guru can press the button and see the
 * same page change. It creates a real DRAFT exam through the API, publishes it
 * through the UI, and removes it afterwards.
 */
test.describe("Terbitkan penilaian dari halaman detail", () => {
  test("status dan tombol berubah setelah Publikasikan", async ({ page }) => {
    test.setTimeout(120_000);
    const teacher = await apiLogin(SEED_USERS.teacher);
    const me = teacher.user as { id: string; unitId: string };

    const { data: years } = await apiRequest<{
      data: Array<{ id: string; isActive: boolean }>;
    }>(teacher, "GET", "/academic-years?limit=100");
    const year = years.find((y) => y.isActive);
    expect(year, "an active academic year").toBeTruthy();

    const { data: subjects } = await apiRequest<{
      data: Array<{ id: string }>;
    }>(teacher, "GET", "/curriculum/subjects?limit=1");
    const { data: classes } = await apiRequest<{
      data: Array<{ id: string }>;
    }>(teacher, "GET", "/classes?limit=1");
    const { data: teachers } = await apiRequest<{
      data: Array<{ id: string; userId: string | null }>;
    }>(teacher, "GET", "/hr/teachers?limit=100");
    const teacherRecord = teachers.find((t) => t.userId === me.id);
    expect(teacherRecord, "the teacher's own record").toBeTruthy();

    // Create through the API (which sets SCHEDULED) and drop it to DRAFT, the
    // one state that shows the Publikasikan button.
    const created = await apiRequest<{ data: { id: string } }>(
      teacher,
      "POST",
      "/assessment/exams",
      {
        unitId: me.unitId,
        academicYearId: year!.id,
        subjectId: subjects[0].id,
        classId: classes[0].id,
        teacherId: teacherRecord!.id,
        type: "DAILY_TEST",
        title: `Uji terbit ${Date.now()}`,
        scheduledAt: new Date().toISOString(),
        maxScore: 100,
        passingScore: 70,
      },
    );
    const examId = created.data.id;

    try {
      await apiRequest(teacher, "PATCH", `/assessment/exams/${examId}/status`, {
        status: "DRAFT",
      });

      await injectSession(page, teacher);
      await gotoAuthedPage(page, `/assessment/${examId}`, /Uji terbit/);

      // Draft state: the warning banner and the publish button are shown.
      await expect(page.getByText(/masih dalam status draft/i)).toBeVisible();
      const publish = page.getByRole("button", { name: "Publikasikan" });
      await expect(publish).toBeVisible();

      await publish.click();
      await waitForToast(page, /berhasil dipublikasikan/i);

      // The same page must change: the button goes, the published banner
      // replaces the draft one — without a manual reload.
      await expect(
        page.getByRole("button", { name: "Publikasikan" }),
      ).toHaveCount(0);
      await expect(
        page.getByText(/sudah dipublikasikan dan nilai dapat dilihat/i),
      ).toBeVisible();

      // And the change is the API's, not just local state.
      const after = await apiRequest<{ data: { status: string } }>(
        teacher,
        "GET",
        `/assessment/exams/${examId}`,
      );
      expect(after.data.status).not.toBe("DRAFT");
    } finally {
      await apiRequest(teacher, "DELETE", `/assessment/exams/${examId}`).catch(
        () => {},
      );
    }
  });
});
