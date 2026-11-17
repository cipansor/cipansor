import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  type AuthSession,
} from "./helpers/auth-api";
import { gotoAuthedPage, waitForToast } from "./helpers/page-helpers";
import { DEMO_ACCOUNTS } from "../../../packages/shared/src/types/demo-accounts";

/**
 * Publishing an exam from its detail page (`/assessment/[id]`).
 *
 * `usePublishExam` invalidates `["exam", id]`, which `["exams"]` does not
 * cover, so the detail page used to keep showing "Draft" and the Publikasikan
 * button after a successful publish. The hook test proves the key is
 * invalidated; only this spec proves a guru can press the button and see the
 * same page change. It creates a real DRAFT exam through the API, publishes it
 * through the UI, and removes it afterwards.
 *
 * Since #987 an exam may only be created by a Penulis_Penilaian of it: a guru
 * of the record's unit with an active TeacherSubject for its subject *and*
 * class (R25.3). The seeded `smpit.guru` persona is the one guru who teaches a
 * lesson in SMP IT 7A, so the exam is built from their own TeacherSubject —
 * the first subject/class the lists happen to return (SD IT 1A for another
 * persona) is not in scope and would 404.
 */
async function guruWhoTeachesAClass(): Promise<{
  session: AuthSession;
  teacherId: string;
  subjectId: string;
  classId: string;
}> {
  const guru = DEMO_ACCOUNTS.find(
    (a) => a.email === "smpit.guru@cipansor.or.id",
  );
  if (!guru) throw new Error("seeded smpit.guru persona required");
  const session = await apiLogin({
    email: guru.email,
    password: guru.password,
  });
  const me = session.user as { id: string };

  const { data: teachers } = await apiRequest<{
    data: Array<{ id: string; userId: string | null }>;
  }>(session, "GET", "/hr/teachers?limit=100");
  const teacherRecord = teachers.find((t) => t.userId === me.id);
  if (!teacherRecord) throw new Error("the guru's own Teacher record required");

  const { data: assignments } = await apiRequest<{
    data: Array<{ subjectId: string; classId: string | null }>;
  }>(session, "GET", `/curriculum/teachers/${teacherRecord.id}/subjects`);
  const scoped = assignments.find((a) => a.classId);
  if (!scoped || !scoped.classId)
    throw new Error("the guru teaches no class (TeacherSubject required)");

  return {
    session,
    teacherId: teacherRecord.id,
    subjectId: scoped.subjectId,
    classId: scoped.classId,
  };
}

test.describe("Terbitkan penilaian dari halaman detail", () => {
  test("status dan tombol berubah setelah Publikasikan", async ({ page }) => {
    test.setTimeout(120_000);
    const {
      session: teacher,
      teacherId,
      subjectId,
      classId,
    } = await guruWhoTeachesAClass();
    const me = teacher.user as { id: string; unitId: string };

    const { data: years } = await apiRequest<{
      data: Array<{ id: string; isActive: boolean }>;
    }>(teacher, "GET", "/academic-years?limit=100");
    const year = years.find((y) => y.isActive);
    expect(year, "an active academic year").toBeTruthy();

    // Create through the API (which sets SCHEDULED) and drop it to DRAFT, the
    // one state that shows the Publikasikan button.
    const created = await apiRequest<{ data: { id: string } }>(
      teacher,
      "POST",
      "/assessment/exams",
      {
        unitId: me.unitId,
        academicYearId: year!.id,
        subjectId,
        classId,
        teacherId,
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
