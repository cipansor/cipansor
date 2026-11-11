/**
 * Portofolio, Resepsi and Anggaran writes (#749).
 *
 * The three modules' write forms answered `400 VALIDATION_ERROR`
 * ("body: expected object, received undefined") for any account and any input,
 * because their Zod schemas were wrapped in `z.object({ body: z.object({ … }) })`
 * while `validate()` parses `req.body` directly. The pages and menus existed, so
 * the defect was invisible until someone tried to save.
 *
 * These tests save a portfolio, a guest book entry and a budget through the real
 * forms and confirm the row exists afterwards, so a form that silently 400s
 * again fails here. Writes, so they skip themselves against a production API.
 */
import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
  type AuthSession,
} from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";
import { waitForLoadingComplete } from "./helpers/page-helpers";

const STAMP = Date.now().toString(36);

test.beforeAll(async () => {
  test.skip(
    await isProductionApi(),
    "API_URL menunjuk API produksi; uji ini menulis portofolio, buku tamu, dan anggaran",
  );
});

/** A unit-bound staff account: reception and budgeting both need a unit. */
async function loginUnitAdmin(page: import("@playwright/test").Page) {
  const session = await apiLogin(SEED_USERS.adminSdit);
  await injectSession(page, session);
  return session;
}

test("Portofolio: the form saves a portfolio", async ({ page }) => {
  const session = await loginUnitAdmin(page);
  const title = `Uji simpan portofolio ${STAMP}`;

  await page.goto("/portfolio");
  await waitForLoadingComplete(page);
  await page.getByRole("button", { name: "Tambah Portfolio" }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Siswa — the first Radix select in the dialog.
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option").first().click();

  await dialog.getByPlaceholder("Judul portfolio...").fill(title);
  await dialog.getByRole("button", { name: "Simpan" }).click();

  // On success the page pushes to the new portfolio's detail page.
  await expect(page).toHaveURL(/\/portfolio\/[0-9a-f-]{36}$/, {
    timeout: 10000,
  });

  // The row really exists on the API, not only on screen.
  const list = await apiRequest<{ data: Array<{ id: string; title: string }> }>(
    session,
    "GET",
    `/portfolio?search=${encodeURIComponent(title)}&limit=20`,
  );
  const created = list.data.find((p) => p.title === title);
  expect(created, "the saved portfolio is readable back").toBeTruthy();

  await apiRequest(session, "DELETE", `/portfolio/${created!.id}`).catch(
    () => {},
  );
});

test("Resepsi: the guest book form saves an entry", async ({ page }) => {
  const session = await loginUnitAdmin(page);
  const name = `Tamu Uji ${STAMP}`;

  await page.goto("/reception/guest-books");
  await waitForLoadingComplete(page);
  await page.getByRole("button", { name: "Catat Tamu" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Nama Tamu").fill(name);
  await dialog.getByLabel("Keperluan").fill("Dinas uji #749");
  await dialog.getByRole("button", { name: "Simpan" }).click();

  await expect(page.getByText("Data tamu berhasil disimpan")).toBeVisible({
    timeout: 10000,
  });

  // The guest book list is scoped to the day; the new name is on it.
  const list = await apiRequest<{ data: Array<{ id: string; name: string }> }>(
    session,
    "GET",
    "/reception/guests",
  );
  expect(
    list.data.some((g) => g.name === name),
    "the saved guest is readable back",
  ).toBe(true);
});

test("Anggaran: the budget form saves a budget", async ({ page }) => {
  const session = await loginUnitAdmin(page);

  // The read-back needs the same academic year the form will post to, so pick
  // the active one and select it by name in the UI.
  const years = await apiRequest<{
    data: Array<{ id: string; name: string; isActive: boolean }>;
  }>(session, "GET", "/academic-years?limit=100");
  const year = years.data.find((y) => y.isActive) ?? years.data[0];

  await page.goto("/finance/budgeting");
  await waitForLoadingComplete(page);

  // The unit and year selects gate the "Tambah Anggaran" button.
  await page.getByRole("combobox").first().click();
  await page.getByRole("option").first().click();
  await page.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: year.name, exact: true }).click();

  await page.getByRole("button", { name: "Tambah Anggaran" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("combobox").click();
  await page.getByRole("option").first().click();
  await dialog.locator('input[type="number"]').fill("1500000");
  await dialog.getByRole("button", { name: "Simpan" }).click();

  await expect(page.getByText("Budget created successfully")).toBeVisible({
    timeout: 10000,
  });

  const unitId = (session.user as { unitId?: string }).unitId;
  const list = await apiRequest<{
    data: { data: Array<{ id: string; amount: string | number }> };
  }>(
    session,
    "GET",
    `/finance-enhancement/budgets?unitId=${unitId}&academicYearId=${year.id}`,
  );
  expect(
    list.data.data.some((b) => Number(b.amount) === 1500000),
    "the saved budget is readable back",
  ).toBe(true);
});
