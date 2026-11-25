import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
} from "../helpers/auth-api";

interface SeedExam {
  id: string;
  title: string;
  status: string;
  unitId?: string;
  academicYearId?: string;
  subjectId?: string;
  classId?: string;
  teacherId?: string;
  _count?: { attempts: number };
}

test.describe("CBT Exams & Grading", () => {
  test("Should navigate to exams page and view list", async ({ page }) => {
    const session = await apiLogin(SEED_USERS.superAdmin);
    await injectSession(page, session);

    // Assert a real seeded exam renders in the list
    const exams = await apiRequest<{ data: SeedExam[] }>(
      session,
      "GET",
      "/cbt/exams?limit=50",
    );
    const exam = exams.data?.[0];
    expect(exam, "seed should provide at least one exam").toBeTruthy();

    await page.goto("/cbt/exams");
    await expect(
      page.getByRole("heading", { name: /jadwal ujian/i }),
    ).toBeVisible();
    await expect(page.getByText(exam!.title).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("Should be able to create and delete an exam", async ({ page }) => {
    const session = await apiLogin(SEED_USERS.superAdmin);
    await injectSession(page, session);

    const title = `UTS E2E ${Date.now()}`;

    await page.goto("/cbt/exams/new");
    await expect(
      page.getByRole("heading", { name: /buat ujian baru/i }),
    ).toBeVisible();

    await page
      .getByLabel(/Nama Ujian|Judul/i)
      .first()
      .fill(title)
      .catch(async () => {
        await page.locator('input[name="title"]').fill(title);
      });

    // The form's selects are independent Radix comboboxes rendered in order:
    // 0=Tipe Ujian (prefilled), 1=Unit, 2=Tahun Ajaran, 3=Mapel, 4=Kelas,
    // 5=Guru, 6=Bank Soal. Each is populated from the real API — pick the
    // first available option. Triggers/options animate; on starved runners
    // they never pass Playwright's "stable" gate, so force-click once visible.
    const pickFirst = async (index: number) => {
      const trigger = page.locator('button[role="combobox"]').nth(index);
      // Center it: the iOS install banner is fixed to the bottom and would
      // swallow the click on the last combobox (Bank Soal) on mobile Safari.
      await trigger.evaluate((el) =>
        el.scrollIntoView({ block: "center", inline: "center" }),
      );
      await trigger.click({ force: true });
      const listbox = page.getByRole("listbox");
      await expect(listbox).toBeVisible();
      const option = listbox.getByRole("option").first();
      await option.waitFor({ state: "visible" });
      await option.click({ force: true });
      await expect(listbox).toBeHidden();
    };

    for (const idx of [1, 2, 3, 4, 5, 6]) {
      await pickFirst(idx);
    }

    await page.locator('input[name="scheduledAt"]').fill("2026-12-10T08:00");
    await page
      .getByRole("button", { name: /Simpan|Buat|Jadwalkan/i })
      .first()
      .click();

    // Persisted through the real API — redirect back to the list
    await page.waitForURL("**/cbt/exams", { timeout: 15000 });

    // Verify the exam exists via the API, then clean it up through the new
    // guarded delete endpoint.
    const list = await apiRequest<{ data: SeedExam[] }>(
      session,
      "GET",
      "/cbt/exams?limit=100",
    );
    const created = list.data?.find((e) => e.title === title);
    expect(created, "created exam should be persisted").toBeTruthy();
    if (created) {
      await apiRequest(session, "DELETE", `/cbt/exams/${created.id}`);
    }
  });

  test("Should render item analysis for an exam with a question bank", async ({
    page,
  }) => {
    const session = await apiLogin(SEED_USERS.superAdmin);
    await injectSession(page, session);

    const exams = await apiRequest<{ data: SeedExam[] }>(
      session,
      "GET",
      "/cbt/exams?limit=50",
    );
    const reference = exams.data?.[0];
    expect(reference, "seed should provide an exam").toBeTruthy();

    const banks = await apiRequest<{ data: Array<{ id: string }> }>(
      session,
      "GET",
      "/cbt/banks?limit=1",
    );
    const bank = banks.data?.[0];
    expect(bank, "seed should provide a question bank").toBeTruthy();

    const created = await apiRequest<{ data: { id: string } }>(
      session,
      "POST",
      "/cbt/exams",
      {
        title: `Analisis Soal E2E ${Date.now()}`,
        unitId: reference!.unitId,
        academicYearId: reference!.academicYearId,
        subjectId: reference!.subjectId,
        classId: reference!.classId,
        teacherId: reference!.teacherId,
        questionBankId: bank!.id,
        type: "DAILY_TEST",
        scheduledAt: "2026-12-11T08:00:00.000Z",
        status: "DRAFT",
      },
    );
    const examId = created.data.id;

    try {
      await page.goto(`/cbt/exams/${examId}/monitoring`);
      await expect(
        page.getByRole("heading", { name: /monitoring ujian/i }),
      ).toBeVisible({ timeout: 15000 });

      const difficultyTab = page.getByRole("tab", { name: /analisis soal/i });
      await expect(difficultyTab).toBeVisible();
      await difficultyTab.click({ force: true });
      await expect(
        page.getByText(/rata-rata keberhasilan/i).first(),
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page.getByText(/analisis butir soal/i).first(),
      ).toBeVisible();
    } finally {
      await apiRequest(session, "DELETE", `/cbt/exams/${examId}`);
    }
  });

  test("Should monitor exam and grade an attempt", async ({ page }) => {
    const session = await apiLogin(SEED_USERS.superAdmin);
    await injectSession(page, session);

    // Find a real exam that has at least one attempt to monitor + grade
    const exams = await apiRequest<{ data: SeedExam[] }>(
      session,
      "GET",
      "/cbt/exams?limit=50",
    );
    const exam = exams.data?.find((e) => (e._count?.attempts ?? 0) > 0);
    expect(exam, "seed should provide an exam with an attempt").toBeTruthy();
    if (!exam) return;

    const monitoring = await apiRequest<{
      data: {
        attempts: Array<{ id: string; student?: { user?: { name: string } } }>;
      };
    }>(session, "GET", `/cbt/exams/${exam.id}/monitoring`);
    const attempt = monitoring.data.attempts?.[0];
    expect(attempt, "monitoring should list the attempt").toBeTruthy();
    const studentName = attempt?.student?.user?.name;

    await page.goto(`/cbt/exams/${exam.id}/monitoring`);
    await expect(
      page.getByRole("heading", { name: /monitoring ujian/i }),
    ).toBeVisible({
      timeout: 15000,
    });
    if (studentName) {
      await expect(page.getByText(studentName).first()).toBeVisible();
    }

    // The grading page loads the real attempt
    await page.goto(`/cbt/attempts/${attempt!.id}/grading`);
    await expect(
      page.getByRole("heading", { name: /penilaian manual/i }),
    ).toBeVisible({
      timeout: 15000,
    });
  });
});
