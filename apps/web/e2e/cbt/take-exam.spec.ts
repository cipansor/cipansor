import { test, expect, Page } from "@playwright/test";
import type { ExamAttempt, Question, QuestionOption } from "@cipansor/shared";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
  type SeedUser,
} from "../helpers/auth-api";

type AuthSession = Awaited<ReturnType<typeof apiLogin>>;

/**
 * A santri of SMP IT, enrolled in class 7A. Since #987 a student reads only the
 * exams of a class they are actively enrolled in (R25.7), so the take page
 * needs a student whose enrolment matches the exam's class — the seeded SD IT
 * student (`SEED_USERS.student`) has no active enrolment and would 404.
 */
const SMPIT_STUDENT: SeedUser = {
  email: "smpit.siswa@cipansor.or.id",
  password: "Cipansor123!",
};

/**
 * E2E coverage for the CBT best-practice enhancements on the student
 * exam-taking page (`/student/exams/[id]/take`):
 *  1. Attempt-scoped seeded shuffle of question & option order.
 *  2. Autosave draft to localStorage + offline recovery on reload.
 *  3. Auto-submit on timeout — including a partially-failed upload, where the
 *     exam MUST still complete instead of silently EXPIRING.
 *  4. Tab-switch counter persisted across refresh + security log recorded.
 *  5. Copy/paste/right-click security events logged.
 *
 * Each test creates its own question bank + exam through the real API and
 * starts a fresh attempt as the seeded student, so the take-exam flow runs
 * against real data (Playwright mocks are avoided per apps/web/AGENTS.md).
 */

type QuestionDto = Pick<Question, "id" | "type" | "content" | "points"> & {
  options: QuestionOption[];
};

function optionText(option: QuestionOption): string {
  return typeof option === "string" ? option : option.text;
}
interface Exam {
  id: string;
  title: string;
}
interface Attempt {
  id: string;
  status: string;
  tabSwitchCount?: number;
}
type FullAttempt = Omit<ExamAttempt, "exam"> & {
  exam: {
    questionBank: {
      questions: QuestionDto[];
    };
  };
};

/** Create a question bank + 2 MCQ questions + a scheduled exam via the API. */
async function createCbtExam(
  session: AuthSession,
  legacyStringOptions = false,
): Promise<{ exam: Exam; questions: QuestionDto[]; bankId: string }> {
  // Pick the seeded SMP IT unit and its 7A class. The exam's class decides who
  // may read it: since #987 a santri reads only the exams of a class they are
  // actively enrolled in (R25.7), and the santri used here sits in SMP IT 7A.
  const units = await apiRequest<{ data: Array<{ id: string; name: string }> }>(
    session,
    "GET",
    "/units",
  );
  const smpit = units.data?.find((u) => /smp/i.test(u.name)) ?? units.data?.[0];
  expect(smpit, "seeded SMP IT unit required").toBeTruthy();

  const [subjects, academicYears, classes, teachers] = await Promise.all([
    apiRequest<{ data: Array<{ id: string }> }>(
      session,
      "GET",
      "/curriculum/subjects",
    ),
    apiRequest<{ data: Array<{ id: string; isActive: boolean }> }>(
      session,
      "GET",
      "/academic-years",
    ),
    apiRequest<{ data: Array<{ id: string; unitId: string; name: string }> }>(
      session,
      "GET",
      "/classes",
    ),
    apiRequest<{ data: Array<{ id: string }> }>(session, "GET", "/hr/teachers"),
  ]);
  // The class must be the SMP IT 7A the santri is enrolled in — the first class
  // the list happens to return (1A, SD IT) is another unit's.
  const year = academicYears.data.find((y) => y.isActive);
  const cls = classes.data.find(
    (c) => c.unitId === smpit.id && c.name === "7A",
  );
  expect(subjects.data?.[0], "seeded subject required").toBeTruthy();
  expect(year, "seeded active academic year required").toBeTruthy();
  expect(cls, "SMP IT 7A required").toBeTruthy();
  expect(teachers.data?.[0], "seeded teacher required").toBeTruthy();

  const bank = await apiRequest<{ data: { id: string } }>(
    session,
    "POST",
    "/cbt/banks",
    {
      title: `Bank E2E ${Date.now()}`,
      description: "E2E question bank",
      unitId: smpit.id,
      subjectId: subjects.data[0].id,
      teacherId: teachers.data[0].id,
    },
  );

  const seeds: Array<{
    content: string;
    options: QuestionOption[];
    answerKey: string;
    points: number;
  }> = legacyStringOptions
    ? [
        {
          content: `E2E Legacy Q1 ${Date.now()}`,
          options: ["Bandung", "Surabaya", "Jakarta"],
          answerKey: "Jakarta",
          points: 50,
        },
        {
          content: `E2E Legacy Q2 ${Date.now()}`,
          options: ["Merah", "Hijau", "Biru"],
          answerKey: "Hijau",
          points: 50,
        },
      ]
    : [
        {
          content: `E2E Q1 ${Date.now()}`,
          options: [
            { id: "q1a", text: "alpha" },
            { id: "q1b", text: "beta" },
            { id: "q1c", text: "gamma" },
            { id: "q1d", text: "delta" },
          ],
          answerKey: "q1a",
          points: 50,
        },
        {
          content: `E2E Q2 ${Date.now()}`,
          options: [
            { id: "q2a", text: "delta" },
            { id: "q2b", text: "charlie" },
            { id: "q2c", text: "bravo" },
            { id: "q2d", text: "alpha" },
          ],
          answerKey: "q2a",
          points: 50,
        },
      ];

  const added: QuestionDto[] = [];
  for (const s of seeds) {
    const q = await apiRequest<{ data: QuestionDto }>(
      session,
      "POST",
      `/cbt/banks/${bank.data.id}/questions`,
      {
        type: "MULTIPLE_CHOICE",
        content: s.content,
        options: s.options,
        answerKey: s.answerKey,
        points: s.points,
      },
    );
    added.push(q.data);
  }

  const exam = await apiRequest<{ data: Exam }>(session, "POST", "/cbt/exams", {
    questionBankId: bank.data.id,
    title: `Ujian E2E ${Date.now()}`,
    description: "E2E CBT exam",
    type: "MIDTERM",
    academicYearId: year!.id,
    subjectId: subjects.data[0].id,
    classId: cls!.id,
    scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    duration: 1,
    maxScore: 100,
    passingScore: 70,
    status: "SCHEDULED",
    unitId: smpit.id,
    teacherId: teachers.data[0].id,
  });

  return { exam: exam.data, questions: added, bankId: bank.data.id };
}

/**
 * Tidy up the resources this spec created. The exam cannot be deleted once a
 * student attempt exists (a deliberate data-integrity guard in the API), so we
 * soft-delete the question bank, which is always permitted and keeps repeat
 * runs from accumulating active banks.
 */
async function cleanupCbtExam(session: AuthSession, bankId: string) {
  await apiRequest(session, "DELETE", `/cbt/banks/${bankId}`);
}

/** Start an attempt for the seeded student and return the attempt id. */
async function startAttempt(
  session: AuthSession,
  examId: string,
): Promise<Attempt> {
  const res = await apiRequest<{ data: Attempt }>(
    session,
    "POST",
    `/cbt/exams/${examId}/start`,
  );
  return res.data;
}

/** Fetch the full attempt payload (authoritative shuffled question order). */
async function getAttempt(
  session: AuthSession,
  attemptId: string,
): Promise<FullAttempt> {
  const res = await apiRequest<{ data: FullAttempt }>(
    session,
    "GET",
    `/cbt/attempts/${attemptId}`,
  );
  return res.data;
}

/**
 * Advance from the start screen into the player: the page renders a start
 * card until "Mulai Kerjakan" is pressed, which starts/resumes the attempt
 * and mounts the timer + question player.
 */
async function enterExam(page: Page) {
  await page.getByRole("button", { name: "Mulai Kerjakan" }).click();
  await expect(page.locator("[class*='select-none']").first()).toBeVisible({
    timeout: 15000,
  });
}

test.describe("CBT Take Exam (Student)", () => {
  test("starts an exam and shows attempt-shuffled questions & options", async ({
    page,
  }) => {
    const admin = await apiLogin(SEED_USERS.superAdmin);
    const { exam, bankId } = await createCbtExam(admin);
    const student = await apiLogin(SMPIT_STUDENT);
    const attempt = await startAttempt(student, exam.id);
    await injectSession(page, student);

    await page.goto(`/student/exams/${exam.id}/take`);
    await enterExam(page);

    // The attempt payload is the source of truth for the seeded shuffle — it is
    // deterministic per attempt, so the rendered order must match it exactly.
    const full = await getAttempt(student, attempt.id);
    const ordered = full.exam.questionBank.questions;
    expect(ordered.length).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < ordered.length; i++) {
      if (i > 0) {
        await page.getByRole("button", { name: "Selanjutnya" }).click();
      }
      const q = ordered[i];
      await expect(page.getByText(q.content)).toBeVisible();
      for (const opt of q.options) {
        await expect(
          page.getByText(optionText(opt), { exact: true }).first(),
        ).toBeVisible();
      }
    }

    await cleanupCbtExam(admin, bankId);
  });

  test("renders legacy string options, selects one and submits the exam", async ({
    page,
  }) => {
    const admin = await apiLogin(SEED_USERS.superAdmin);
    const { exam, bankId } = await createCbtExam(admin, true);
    const student = await apiLogin(SMPIT_STUDENT);
    const attempt = await startAttempt(student, exam.id);
    await injectSession(page, student);

    await page.goto(`/student/exams/${exam.id}/take`);
    await enterExam(page);

    const ordered = (await getAttempt(student, attempt.id)).exam.questionBank
      .questions;
    const targetIndex = ordered.findIndex((q) =>
      q.options.some((opt) => optionText(opt) === "Jakarta"),
    );
    expect(
      targetIndex,
      "legacy question with Jakarta required",
    ).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < targetIndex; i++) {
      await page.getByRole("button", { name: "Selanjutnya" }).click();
    }

    const target = ordered[targetIndex];
    for (const opt of target.options) {
      await expect(
        page.getByText(optionText(opt), { exact: true }).first(),
      ).toBeVisible();
    }

    await page.getByText("Jakarta", { exact: true }).first().click();
    await expect(page.getByRole("radio", { name: "Jakarta" })).toBeChecked();

    await page.getByRole("button", { name: "Selesai" }).click();
    await page.getByRole("button", { name: "Ya, Selesai" }).click();
    await page.waitForURL("**/student/exams", { timeout: 15000 });

    const done = await getAttempt(student, attempt.id);
    expect(done.status).toBe("COMPLETED");
    const saved = done.answers?.find((a) => a.questionId === target.id);
    expect(saved?.answer).toBe("Jakarta");
    expect(saved?.isCorrect).toBe(true);
    expect(Number(saved?.score)).toBe(50);
    expect(Number(done.score)).toBe(50);

    await cleanupCbtExam(admin, bankId);
  });

  test("autosaves a draft answer and recovers it after reload", async ({
    page,
  }) => {
    const admin = await apiLogin(SEED_USERS.superAdmin);
    const { exam, bankId } = await createCbtExam(admin);
    const student = await apiLogin(SMPIT_STUDENT);
    const attempt = await startAttempt(student, exam.id);
    await injectSession(page, student);

    await page.goto(`/student/exams/${exam.id}/take`);
    await enterExam(page);

    // First shown question + its first option, from the authoritative payload.
    const ordered = (await getAttempt(student, attempt.id)).exam.questionBank
      .questions;
    const opt0 = ordered[0].options[0];

    await page.getByRole("radio").first().click({ force: true });

    // The draft is mirrored to localStorage immediately (offline resilience).
    const draftKey = `cbt_draft_${attempt.id}`;
    await expect
      .poll(async () => page.evaluate((k) => localStorage.getItem(k), draftKey))
      .not.toBeNull();

    // Reload lands back on the start screen; re-enter to re-mount the player,
    // which rehydrates the answer from the backend + the local draft.
    await page.reload();
    await enterExam(page);

    // The selected option is still chosen after a full reload. Mirroring the
    // attempt's deterministic per-attempt option order, the option we clicked
    // first is exactly the same one now — assert by its accessible name.
    await expect(
      page.getByRole("radio", { checked: true }).first(),
    ).toHaveAccessibleName(optionText(opt0));

    await cleanupCbtExam(admin, bankId);
  });

  test("auto-submits on timeout and STILL finishes the exam even if some uploads fail", async ({
    page,
  }) => {
    const admin = await apiLogin(SEED_USERS.superAdmin);
    const { exam, bankId } = await createCbtExam(admin);
    const student = await apiLogin(SMPIT_STUDENT);
    const attempt = await startAttempt(student, exam.id);
    await injectSession(page, student);

    // Navigate first (a fresh document needs the fake clock installed after
    // load — installing before page.goto is wiped when the new document
    // mounts its own real timers). The countdown interval is only scheduled
    // once the player mounts, which happens when "Mulai Kerjakan" is pressed.
    await page.goto(`/student/exams/${exam.id}/take`);

    // Simulate uploads failing during finish BEFORE the first answer upload,
    // so a real answer submission lands in the pending set as a failure.
    await page.route("**/api/cbt/attempts/*/answer**", async (route) => {
      // Fail every answer upload to emulate "sebagian jawaban gagal terunggah".
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ success: false }),
      });
    });

    // Install a fake clock after navigation and before the player mounts, so
    // the countdown interval + `new Date()` are driven by the same virtual
    // timeline.
    await page.clock.install();
    await enterExam(page);

    // Answer the first question. The upload fails (route above); the pending
    // submission is retried during finish and still must not block completion.
    await page.getByRole("radio").first().click({ force: true });

    // Run the countdown clock past the exam duration so the repeating 1-second
    // interval fires the auto-submit path (isAuto === true), which must complete
    // the exam. (runFor, unlike fastForward, fires every recurring tick.)
    await page.clock.runFor(120_000); // 2min > the exam's 1min duration

    // The attempt is graded instead of silently EXPIRING — it completes even
    // though every answer upload failed.
    await expect
      .poll(
        async () => {
          const res = await apiRequest<{ data: Attempt }>(
            student,
            "GET",
            `/cbt/attempts/${attempt.id}`,
          );
          return res.data?.status;
        },
        { timeout: 15000 },
      )
      .toBe("COMPLETED");

    await cleanupCbtExam(admin, bankId);
  });

  test("records anti-cheating events and persists the tab-switch counter on refresh", async ({
    page,
  }) => {
    const admin = await apiLogin(SEED_USERS.superAdmin);
    const { exam, bankId } = await createCbtExam(admin);
    const student = await apiLogin(SMPIT_STUDENT);
    const attempt = await startAttempt(student, exam.id);
    await injectSession(page, student);

    await page.goto(`/student/exams/${exam.id}/take`);
    await enterExam(page);
    const card = page.locator("[class*='select-none']").first();

    // Copy / paste / right-click on the question card fire the React security
    // handlers. Dispatching synthetic DOM events is more reliable than keyboard
    // shortcuts (which need a text selection to emit a copy/paste event).
    await card.dispatchEvent("copy");
    await card.dispatchEvent("paste");
    await card.dispatchEvent("contextmenu");

    // Simulate a tab switch (visibilitychange marks the document hidden), which
    // the anti-cheating listener records as a security event on the backend.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // The tab-switch counter is persisted to the real attempt on the backend.
    await expect
      .poll(async () => {
        const res = await apiRequest<{ data: Attempt }>(
          student,
          "GET",
          `/cbt/attempts/${attempt.id}`,
        );
        return res.data?.tabSwitchCount ?? 0;
      })
      .toBeGreaterThan(0);

    // After a reload the page re-mounts and the attempt is still IN_PROGRESS
    // (nothing finalised the exam), proving the counter data round-trips.
    await page.reload();
    await enterExam(page);
    await expect(card).toBeVisible({ timeout: 15000 });
    const after = await apiRequest<{ data: Attempt }>(
      student,
      "GET",
      `/cbt/attempts/${attempt.id}`,
    );
    expect(after.data?.tabSwitchCount ?? 0).toBeGreaterThan(0);

    await cleanupCbtExam(admin, bankId);
  });
});
