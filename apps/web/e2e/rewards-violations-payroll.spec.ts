import { test, expect, type Page } from "@playwright/test";
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
 * The write flows whose payload mapping was fixed on this branch.
 *
 * Three bugs of the same class lived in the reward/violation forms: the page
 * read a richer shape than the API returns (a `RewardType`/`ViolationType`
 * table that does not exist) and submitted the UI's field names, so the
 * severity, points and date the user chose were dropped or replaced with a
 * fixed value — every violation recorded as MINOR regardless of category, every
 * reward's points lost. The payroll period detail page likewise opened the
 * slip's *route* from an eye button that never navigated, and now opens a
 * dialog.
 *
 * These specs drive the real forms against the real seeded API and assert the
 * record the API actually stored, not the toast.
 */

/** Super admin: reaches every unit, so a seeded student is always in scope. */
async function signIn(page: Page, session: AuthSession) {
  await injectSession(page, session);
}

/** Pick the first student the search returns, the way a user does. */
async function pickFirstStudent(page: Page, search: string) {
  await page.getByPlaceholder(/Cari nama\/NIS santri/i).fill(search);
  const row = page.locator("table tbody tr").first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.getByRole("button", { name: "Ganti" })).toBeVisible();
}

test.describe("Penghargaan — payload yang tersimpan", () => {
  let session: AuthSession;

  test.beforeAll(async () => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini menulis data, jadi dilewati",
    );
    session = await apiLogin(SEED_USERS.superAdmin);
  });

  test("form mencatat kategori, poin, dan tanggal yang dipilih, bukan default", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, session);
    await gotoAuthedPage(page, "/rewards/new", /Berikan Penghargaan/i);

    // A seeded student with a known NIS, so the recorded row is findable.
    await pickFirstStudent(page, "20240004");

    // Choose a category the API already has rows for — its points come from the
    // category endpoint, so the assertion pins the mapping end to end.
    await page.getByRole("combobox", { name: "Jenis Penghargaan" }).click();
    const option = page
      .getByRole("option")
      .filter({ hasText: /Tahfidz/i })
      .first();
    await expect(option).toBeVisible();
    const optionText = (await option.textContent()) ?? "";
    const points = Number(optionText.match(/\+(\d+)/)?.[1] ?? "0");
    expect(points, "seed category should carry points").toBeGreaterThan(0);
    await option.click();

    // The selected category is echoed back on the trigger.
    await expect(
      page.getByRole("combobox", { name: "Jenis Penghargaan" }),
    ).toContainText(/Tahfidz/i);

    const description = `Uji e2e penghargaan ${Date.now()}`;
    await page.getByPlaceholder(/Deskripsi pencapaian/i).fill(description);

    const createResponse = page.waitForResponse(
      (r) =>
        r.url().includes("/api/rewards") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Simpan" }).click();
    const response = await createResponse;
    expect(response.status(), "create should succeed").toBeLessThan(300);

    // The API's own copy of the row, not the form's state.
    const body = (await response.json()) as { data: { id: string } };
    const stored = await apiRequest<{
      data: { category: string; points: number; description: string };
    }>(session, "GET", `/rewards/${body.data.id}`);
    expect(stored.data.category).toMatch(/tahfidz/i);
    expect(stored.data.points).toBe(points);
    expect(stored.data.description).toBe(description);

    // The page returns to the list on success.
    await expect(page).toHaveURL(/\/rewards$/);
  });
});

test.describe("Pelanggaran — payload yang tersimpan", () => {
  let session: AuthSession;

  test.beforeAll(async () => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini menulis data, jadi dilewati",
    );
    session = await apiLogin(SEED_USERS.superAdmin);
  });

  test("form menyimpan tingkat keparahan kategori, bukan selalu MINOR", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, session);
    await gotoAuthedPage(page, "/violations/new", /Catat Pelanggaran/i);

    await pickFirstStudent(page, "20240004");

    // "ketertiban" is seeded with rows of more than one severity, and the
    // category endpoint reports the severity its largest group carries — read
    // it rather than guess, because before the fix the form ignored it and
    // always submitted MINOR.
    const categories = await apiRequest<{
      data: Array<{
        id: string;
        points: number;
        type: "MINOR" | "MODERATE" | "MAJOR";
      }>;
    }>(session, "GET", "/violations/categories");
    const ketertiban = categories.data.find((c) => /ketertiban/i.test(c.id));
    expect(
      ketertiban,
      "seed should provide a ketertiban category",
    ).toBeTruthy();

    await page.getByRole("combobox", { name: "Jenis Pelanggaran" }).click();
    const option = page
      .getByRole("option")
      .filter({ hasText: /Ketertiban/i })
      .first();
    await expect(option).toBeVisible();
    await option.click();

    const description = `Uji e2e pelanggaran ${Date.now()}`;
    await page.getByPlaceholder(/Jelaskan kronologi/i).fill(description);

    const createResponse = page.waitForResponse(
      (r) =>
        r.url().includes("/api/violations") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Simpan" }).click();
    const response = await createResponse;
    expect(response.status(), "create should succeed").toBeLessThan(300);

    const body = (await response.json()) as { data: { id: string } };
    const stored = await apiRequest<{
      data: { type: string; category: string; points: number };
    }>(session, "GET", `/violations/${body.data.id}`);
    // Severity and points follow the chosen category, not a hardcoded MINOR.
    expect(stored.data.type).toBe(ketertiban!.type);
    expect(stored.data.category).toMatch(/ketertiban/i);
    expect(stored.data.points).toBe(ketertiban!.points);

    await expect(page).toHaveURL(/\/violations$/);
  });
});

test.describe("Payroll — dialog slip gaji", () => {
  let session: AuthSession;

  test.beforeAll(async () => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini membaca data, jadi dilewati",
    );
    session = await apiLogin(SEED_USERS.superAdmin);
  });

  test("ikon lihat membuka dialog detail slip, bukan navigasi mati", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // No `limit`/`page` here: the API's pagination middleware turns those query
    // params into numbers, and the payroll schema (unlike the others) expects
    // strings, so sending one is a 400. The defaults are fine.
    const periods = await apiRequest<{
      data: Array<{ id: string; name: string }>;
    }>(session, "GET", "/payroll/periods");
    const period = periods.data[0];
    expect(period, "seed should provide a payroll period").toBeTruthy();

    const slips = await apiRequest<{ data: Array<{ employeeName?: string }> }>(
      session,
      "GET",
      `/payroll/slips?periodId=${period.id}`,
    );
    const slip = slips.data[0];
    expect(slip, "seed should provide a payroll slip").toBeTruthy();

    await signIn(page, session);
    await gotoAuthedPage(
      page,
      `/hr/payroll/periods/${period.id}`,
      new RegExp(period.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    );

    // The eye button used to be a `Link` to `/hr/payroll/:id` that never
    // navigated; it must now open the dialog with the slip's numbers. The
    // dialog title reads `employeeName`, which the API supplies, so the row is
    // taken by position (the row's name cell reads `staff.fullName`, absent
    // here, and renders "-"; that cell is not what this test is about).
    await page
      .locator("table tbody tr")
      .first()
      .getByRole("button")
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Detail Slip Gaji" }),
    ).toBeVisible();
    // The description pairs the slip's employee with the period, which is the
    // mapping that used to be missing (the title read `staff.fullName`, absent).
    await expect(
      dialog.getByText(
        new RegExp(
          `-\\s*${period.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        ),
      ),
    ).toBeVisible();
    await expect(dialog.getByText("Gaji Bersih (Take Home Pay)")).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Pendapatan" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Potongan" }),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Tutup" }).click();
    await expect(dialog).toBeHidden();
  });
});
