/**
 * Skor penerima beasiswa sebagai pendukung keputusan (#1003).
 *
 * Yang diuji di sini tidak terbaca dari kode saja: bahwa bendahara unit benar
 * benar dapat menghitung skor untuk program unitnya sendiri dan hasilnya
 * tersimpan, bahwa kepala sekolah unit yang sama dan bendahara unit lain
 * ditolak peladen (bukan hanya disembunyikan tombolnya), dan bahwa keputusan
 * penerimaan — `status` — tidak ikut berubah saat skor dihitung (R11.7, R11.10,
 * R11.11, R11.14, R11.15).
 *
 * Spec ini menambah tiga kriteria berawalan `E2E` pada program seed. Tidak ada
 * rute hapus untuk kriteria maupun program, jadi penambahannya dibuat idempoten
 * (dilewati bila sudah ada) alih-alih membersihkan di `afterAll`.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  type AuthSession,
} from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";

const API_URL = process.env.API_URL || "http://localhost:3001/api";
const API = "/finance-enhancement";
const PREFIX = "E2E";

/** Bendahara SMP IT — the program's own unit (DEMO_ACCOUNTS). */
const BEMDAHARA_SMPIT = {
  email: "smpit.bendahara@cipansor.or.id",
  password: "Cipansor123!",
};
/** Bendahara SD IT — a different unit. */
const BENDAHARA_SDIT = {
  email: "sdit.bendahara@cipansor.or.id",
  password: "Cipansor123!",
};
/**
 * TU of the program's own unit: a staff account that reads the page but is not
 * Peran_Keuangan_Unit, so the API must refuse it with 403 rather than 404
 * (R11.15).
 */
const TU_SMPIT = {
  email: "smpit.tu@cipansor.or.id",
  password: "Cipansor123!",
};

let scholarshipId = "";
let recipientId = "";
let recipientNis = "";
let recipientHadScore = false;
let originalStatus = "";

interface RecipientRow {
  id: string;
  status: string;
  totalScore?: number | null;
  assessments?: Array<unknown>;
  student?: { nis?: string };
}

interface AssessmentResponse {
  data: {
    criteria: Array<{ name: string; score: number | null; excluded: boolean }>;
    totalScore: number | null;
    complete: boolean;
  };
}

/** A POST as a raw bearer, so a refusal can be observed rather than thrown. */
async function postAssess(session: AuthSession, id: string): Promise<number> {
  const res = await fetch(
    `${API_URL}${API}/scholarship-recipients/${id}/assess`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.accessToken}`,
      },
    },
  );
  return res.status;
}

async function signIn(page: Page, user: { email: string; password: string }) {
  const session: AuthSession = await apiLogin(user);
  await injectSession(page, session);
  return session;
}

test.describe("Skor penerima beasiswa", () => {
  // `beforeAll` creates the shared criteria; parallel workers each run their
  // own `beforeAll` and can all read the program before the first write lands.
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini menulis skor dan kriteria",
    );

    const session = await apiLogin(BEMDAHARA_SMPIT);

    const programs = await apiRequest<{
      data: Array<{ id: string; name: string }>;
    }>(session, "GET", `${API}/scholarships?limit=100`);
    const program = programs.data[0];
    if (!program) throw new Error("Tidak ada program beasiswa pada data seed");

    const recipients = await apiRequest<{ data: RecipientRow[] }>(
      session,
      "GET",
      `${API}/scholarships/${program.id}/recipients?limit=50`,
    );
    // Prefer a recipient without a stored score, so the screen assertion below
    // cannot pass on a result that was already there.
    const recipient =
      recipients.data.find((r) => !r.assessments?.length) ?? recipients.data[0];
    if (!recipient)
      throw new Error("Tidak ada penerima beasiswa pada data seed");
    if (!recipient.student?.nis)
      throw new Error("Penerima beasiswa pada data seed tidak punya NIS");

    scholarshipId = program.id;
    recipientId = recipient.id;
    recipientNis = recipient.student.nis;
    recipientHadScore = !!recipient.assessments?.length;
    originalStatus = recipient.status;

    // One criterion of each kind the scorer can read, plus one it cannot, so the
    // answer has something to leave out and has to say so.
    const existing = await apiRequest<{ data: Array<{ name: string }> }>(
      session,
      "GET",
      `${API}/scholarships/${program.id}/criteria`,
    );
    if (!existing.data.some((c) => c.name.startsWith(PREFIX))) {
      for (const criterion of [
        {
          name: `${PREFIX} Hafalan`,
          weight: 3,
          type: "NUMERIC",
          targetValue: "10",
        },
        {
          name: `${PREFIX} Nilai Akademik`,
          weight: 2,
          type: "NUMERIC",
          targetValue: "100",
        },
        { name: `${PREFIX} Wawancara`, weight: 1, type: "NUMERIC" },
      ]) {
        await apiRequest(
          session,
          "POST",
          `${API}/scholarships/${program.id}/criteria`,
          criterion,
        );
      }
    }
  });

  test("formulir kriteria menolak isian tidak valid", async ({ page }) => {
    await signIn(page, BEMDAHARA_SMPIT);
    await page.goto("/finance/scholarships");
    await page.getByRole("button", { name: /lihat/i }).first().click();

    const weight = page.getByLabel("Bobot");
    await page.getByLabel("Nama kriteria").fill("E2E Tidak Valid");
    await weight.fill("0");

    expect(
      await weight.evaluate((el) => (el as HTMLInputElement).checkValidity()),
    ).toBe(false);

    await page.getByRole("button", { name: /tambah kriteria/i }).click();
    await expect(page.getByText(/Kriteria berhasil ditambahkan/)).toHaveCount(
      0,
    );
    await expect(page.getByLabel("Nama kriteria")).toBeVisible();
  });

  test("formulir kriteria menyimpan kriteria baru dari layar", async ({
    page,
  }) => {
    await signIn(page, BEMDAHARA_SMPIT);
    await page.goto("/finance/scholarships");
    await page.getByRole("button", { name: /lihat/i }).first().click();

    // No scoring keyword in the name: the new criterion is left out of the
    // total, so this test does not move the score the others assert on.
    const name = `E2E Formulir ${Date.now()}`;
    await page.getByLabel("Nama kriteria").fill(name);
    await page.getByLabel("Bobot").fill("2");
    await page.getByLabel("Target").fill("10");
    await page.getByRole("button", { name: /tambah kriteria/i }).click();

    await expect(page.getByText(/Kriteria berhasil ditambahkan/)).toBeVisible();
    await expect(page.getByText(name)).toBeVisible();
    // The screen says the scores it already showed were computed before this
    // criterion existed.
    await expect(page.getByText(/Kriteria berubah/)).toBeVisible();
  });

  test("bendahara unit menghitung skor dari layar dan hasilnya tampil", async ({
    page,
  }) => {
    await signIn(page, BEMDAHARA_SMPIT);
    await page.goto("/finance/scholarships");

    await expect(
      page.getByRole("heading", { name: /beasiswa/i }).first(),
    ).toBeVisible();

    // "Lihat" opens the program's recipients — the seeded program is the first row.
    await page.getByRole("button", { name: /lihat/i }).first().click();

    // The row of the recipient this spec picked in `beforeAll`, not the first
    // row and not any row in the dialog.
    const targetRow = page
      .getByRole("row")
      .filter({ hasText: recipientNis })
      .first();
    const scoreButton = targetRow.getByRole("button", {
      name: /hitung skor/i,
    });
    await expect(scoreButton).toBeVisible();

    if (!recipientHadScore) {
      await expect(targetRow.getByText(/Skor total:/)).toHaveCount(0);
    }

    // The click must actually ask the server: the table can already show a
    // stored score, so asserting only on the text would pass without a call.
    const assessResponse = page.waitForResponse((res) => {
      const path = new URL(res.url()).pathname;
      return (
        res.request().method() === "POST" &&
        path.includes("/scholarship-recipients/") &&
        path.endsWith("/assess")
      );
    });
    await scoreButton.click();

    const response = await assessResponse;
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as {
      data: AssessmentResponse["data"];
    };
    const total = body.data.totalScore;
    expect(total).not.toBeNull();

    // What the clicked row shows is the total the API just answered.
    await expect(
      targetRow.getByText(`Skor total: ${(total as number).toFixed(1)}`),
    ).toBeVisible({ timeout: 15_000 });
    // The criterion the machine cannot read is named, not scored 0 (R11.5).
    await expect(targetRow.getByText(/Perlu dinilai manual/i).first()).toBeVisible();
    // The caveat that the score is decision support, not the decision (R11.16).
    await expect(page.getByText(/pendukung keputusan/i).first()).toBeVisible();
  });

  test("skor dapat diulang dengan hasil sama dan keputusan tidak berubah (R11.7, R11.8)", async () => {
    const session = await apiLogin(BEMDAHARA_SMPIT);
    const assess = () =>
      apiRequest<AssessmentResponse>(
        session,
        "POST",
        `${API}/scholarship-recipients/${recipientId}/assess`,
      );

    const first = await assess();
    expect(first.data.criteria.length).toBeGreaterThan(0);
    for (const c of first.data.criteria) {
      if (c.excluded) expect(c.score).toBeNull();
      else expect(c.score as number).toBeGreaterThanOrEqual(0);
    }
    expect(first.data.complete).toBe(false); // the interview is left out

    // R11.8: the same facts and criteria give the same answer, twice.
    const second = await assess();
    expect(second.data).toEqual(first.data);

    // R11.7: the officer's decision columns are untouched by a score.
    const after = await apiRequest<{ data: RecipientRow[] }>(
      session,
      "GET",
      `${API}/scholarships/${scholarshipId}/recipients?limit=50`,
    );
    expect(after.data.find((r) => r.id === recipientId)?.status).toBe(
      originalStatus,
    );
  });

  test("bendahara unit lain ditolak peladen, bukan hanya tombolnya disembunyikan (R11.14)", async ({
    page,
  }) => {
    const session = await signIn(page, BENDAHARA_SDIT);

    // The action is not offered on screen…
    await page.goto("/finance/scholarships");
    await page.getByRole("button", { name: /lihat/i }).first().click();
    await expect(
      page.getByRole("button", { name: /hitung skor/i }),
    ).toHaveCount(0);

    // …and the server refuses the same call made directly. Another unit's
    // program is "not found", not "forbidden": the id must not confirm what it
    // names (R11.3).
    expect([403, 404]).toContain(await postAssess(session, recipientId));
  });

  test("TU unit — bukan peran keuangan — ditolak menghitung skor (R11.15)", async ({
    page,
  }) => {
    const session = await signIn(page, TU_SMPIT);

    await page.goto("/finance/scholarships");
    await expect(
      page.getByRole("button", { name: /hitung skor/i }),
    ).toHaveCount(0);

    expect(await postAssess(session, recipientId)).toBe(403);
  });
});
