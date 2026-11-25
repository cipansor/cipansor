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
  _count?: { attempts: number };
}

interface QuestionOption {
  id: string;
  text: string;
}

interface BankQuestion {
  id: string;
  options: QuestionOption[];
  answerKey: string;
}

type AuthSession = Awaited<ReturnType<typeof apiLogin>>;

async function createQuestionBank(
  session: AuthSession,
  label: string,
): Promise<string> {
  const [units, subjects, teachers] = await Promise.all([
    apiRequest<{ data: Array<{ id: string; name: string }> }>(
      session,
      "GET",
      "/units",
    ),
    apiRequest<{ data: Array<{ id: string }> }>(
      session,
      "GET",
      "/curriculum/subjects",
    ),
    apiRequest<{ data: Array<{ id: string }> }>(session, "GET", "/hr/teachers"),
  ]);
  expect(subjects.data?.[0], "seeded subject required").toBeTruthy();
  expect(teachers.data?.[0], "seeded teacher required").toBeTruthy();

  const bank = await apiRequest<{ data: { id: string } }>(
    session,
    "POST",
    "/cbt/banks",
    {
      title: `Bank ${label} E2E ${Date.now()}`,
      description: `E2E ${label}`,
      unitId: units.data?.[0]?.id,
      subjectId: subjects.data[0].id,
      teacherId: teachers.data[0].id,
    },
  );
  return bank.data.id;
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
      await trigger.scrollIntoViewIfNeeded();
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

  test("Should keep option ids unique after deleting and adding an option", async ({
    page,
  }) => {
    const session = await apiLogin(SEED_USERS.superAdmin);
    await injectSession(page, session);

    const bankId = await createQuestionBank(session, "opsi");

    try {
      await page.goto(`/cbt/banks/${bankId}`);
      await page.getByRole("button", { name: /Tambah Soal/i }).click();

      await page
        .locator('textarea[name="content"]')
        .fill(`Soal opsi E2E ${Date.now()}`);

      // Start from A/B/C/D, remove B, then add one: the new option must fill
      // the gap with B, not create a second D.
      const optionRow = (index: number) =>
        page
          .locator(`input[name="options.${index}.text"]`)
          .locator(
            'xpath=ancestor::div[contains(@class,"flex items-center gap-3")]',
          );
      await optionRow(1).getByRole("button").click();
      await page.getByRole("button", { name: /Tambah Opsi/i }).click();

      await expect(
        page.locator('input[name="options.3.text"]'),
      ).toHaveAttribute("placeholder", /Teks pilihan B/);
      for (const [index, text] of [
        [0, "satu"],
        [1, "tiga"],
        [2, "empat"],
        [3, "dua"],
      ] as const) {
        await page.locator(`input[name="options.${index}.text"]`).fill(text);
      }

      // Choose the newly added B as the key. The saved order is A/C/D/B, so a
      // list that marks by position would point at C instead.
      await page.getByRole("dialog").getByRole("combobox").nth(1).click();
      await page
        .getByRole("listbox")
        .getByRole("option", { name: "Opsi B" })
        .click();

      await page.getByRole("button", { name: /Simpan Pertanyaan/i }).click();
      await expect(page.getByRole("dialog")).toBeHidden();

      const saved = await apiRequest<{
        data: { questions: BankQuestion[] };
      }>(session, "GET", `/cbt/banks/${bankId}`);
      const question = saved.data.questions.find((q) =>
        q.options.some((o) => o.text === "satu"),
      );
      expect(question, "question should be persisted").toBeTruthy();
      const ids = question!.options.map((o) => o.id);
      expect(ids).toEqual(["A", "C", "D", "B"]);
      expect(new Set(ids).size).toBe(ids.length);
      expect(question!.answerKey).toBe("B");

      await expect(
        page.locator('[data-option-id="B"][data-correct="true"]'),
      ).toContainText("dua");
      await expect(
        page.locator('[data-option-id="C"][data-correct="false"]'),
      ).toContainText("tiga");
    } finally {
      await apiRequest(session, "DELETE", `/cbt/banks/${bankId}`);
    }
  });

  test("Should clear the key when the keyed option is removed", async ({
    page,
  }) => {
    const session = await apiLogin(SEED_USERS.superAdmin);
    await injectSession(page, session);

    const bankId = await createQuestionBank(session, "kunci");

    try {
      await page.goto(`/cbt/banks/${bankId}`);
      await page.getByRole("button", { name: /Tambah Soal/i }).click();

      await page
        .locator('textarea[name="content"]')
        .fill(`Soal kunci E2E ${Date.now()}`);

      const optionRow = (index: number) =>
        page
          .locator(`input[name="options.${index}.text"]`)
          .locator(
            'xpath=ancestor::div[contains(@class,"flex items-center gap-3")]',
          );

      // A is the default key. Removing it must leave the key empty rather than
      // silently promoting B.
      await optionRow(0).getByRole("button").click();
      for (const [index, text] of [
        [0, "dua"],
        [1, "tiga"],
        [2, "empat"],
      ] as const) {
        await page.locator(`input[name="options.${index}.text"]`).fill(text);
      }

      await page.getByRole("button", { name: /Simpan Pertanyaan/i }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByText("Kunci jawaban wajib diisi")).toBeVisible();

      await page.getByRole("dialog").getByRole("combobox").nth(1).click();
      await page
        .getByRole("listbox")
        .getByRole("option", { name: "Opsi C" })
        .click();
      await page.getByRole("button", { name: /Simpan Pertanyaan/i }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
    } finally {
      await apiRequest(session, "DELETE", `/cbt/banks/${bankId}`);
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
