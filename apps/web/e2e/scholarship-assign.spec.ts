/**
 * Penetapan beasiswa hanya memasangkan santri dan program dari unit yang sama.
 *
 * Dengan filter unit "semua", daftar santri dan daftar program datang dari dua
 * kueri terpisah; memilih program harus menyempitkan daftar santri ke unit
 * program itu, bukan membiarkan pasangan beda unit dikirim lalu ditolak API.
 */
import { test, expect, type Page } from "@playwright/test";
import { apiLogin, apiRequest, injectSession } from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";

const SUPER_ADMIN = {
  email: "superadmin@cipansor.or.id",
  password: "SuperAdmin123!",
};

let programName = "";
let programUnitId = "";
let otherUnitStudentNis = "";

async function signIn(page: Page) {
  const session = await apiLogin(SUPER_ADMIN);
  await injectSession(page, session);
}

test.beforeAll(async () => {
  test.skip(
    await isProductionApi(),
    "API_URL menunjuk API produksi; uji ini membuka formulir tulis",
  );

  const session = await apiLogin(SUPER_ADMIN);
  const programs = await apiRequest<{
    data: Array<{ id: string; name: string; unitId: string }>;
  }>(session, "GET", "/finance-enhancement/scholarships?limit=100");
  const program = programs.data.find(
    (p) =>
      p.unitId &&
      programs.data.filter((other) => other.name === p.name).length === 1,
  );
  if (!program) throw new Error("Tidak ada program beasiswa pada data seed");

  const students = await apiRequest<{
    data: Array<{ nis: string; unitId: string }>;
  }>(session, "GET", "/students?limit=100");
  const otherUnitStudent = students.data.find(
    (s) => s.unitId !== program.unitId,
  );
  if (!otherUnitStudent)
    throw new Error("Data seed tidak punya santri dari unit lain");

  programName = program.name;
  programUnitId = program.unitId;
  otherUnitStudentNis = otherUnitStudent.nis;
});

test("memilih program menyempitkan daftar santri ke unit program", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/finance/scholarships");
  await page.getByRole("button", { name: /assign santri/i }).click();

  const dialog = page.getByRole("dialog");
  const comboboxes = dialog.getByRole("combobox");

  // Program is the second picker: santri, program, tahun ajaran.
  const studentsResponse = page.waitForResponse((res) => {
    const url = new URL(res.url());
    return (
      res.request().method() === "GET" &&
      url.pathname.endsWith("/students") &&
      url.searchParams.get("unitId") === programUnitId
    );
  });
  await comboboxes.nth(1).click();
  await page
    .getByRole("option", { name: programName, exact: true })
    .first()
    .click();
  await studentsResponse;

  await comboboxes.nth(0).click();
  await expect(
    page.getByRole("option", { name: new RegExp(otherUnitStudentNis) }),
  ).toHaveCount(0);
});
