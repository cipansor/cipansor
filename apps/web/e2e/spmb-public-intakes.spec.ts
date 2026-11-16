/**
 * The public SPMB page announces each unit's intake as the brochure prints it,
 * and a registration goes to the period of the unit the applicant chose.
 *
 * The page used to read one "active period" for the whole yayasan — the open
 * one closing first — and filed every registration under it, whatever unit
 * the applicant picked. Here SD IT's intake closes first (today) and the
 * applicant picks SMP IT: before the fix the registration landed in SD IT's
 * period.
 *
 * Between two waves a unit's period runs on, but the API refuses a
 * registration; the page must say when it opens again and offer no form.
 *
 * WRITES three periods, their waves, a fee table and one registration, then
 * deletes them; skipped against a production API. Passwords come from
 * DEMO_ACCOUNTS.
 */
import { test, expect, type Page } from "@playwright/test";
import { DEMO_ACCOUNTS } from "../../../packages/shared/src/types/demo-accounts";
import { apiLogin, apiRequest, type AuthSession } from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";

const SUPER = DEMO_ACCOUNTS.find((a) => a.roleCode === "SUPER_ADMIN")!;

/** A WIB calendar day, `offset` days from today. */
const wibDay = (offset: number) =>
  new Date(Date.now() + 7 * 3_600_000 + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** The input under a form label (the form's labels are not bound to inputs). */
const field = (page: Page, label: string) =>
  page
    .locator("div.space-y-2")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("input, textarea")
    .first();

/**
 * Fill steps 1–5 for one child and stop on the consent step (6). The unit is
 * already set by the intake's "Daftar" button. Steps are identical for every
 * child, so two consecutive registrations share this.
 */
async function fillRegistrationSteps(page: Page, childName: string) {
  // Step 1: student.
  await field(page, "Nama Lengkap").fill(childName);
  await field(page, "Tempat Lahir").fill("Tasikmalaya");
  await field(page, "Tanggal Lahir").fill("2014-05-01");
  await page.getByText("Pilih jenis kelamin").click();
  await page.getByRole("option", { name: /Laki/ }).click();
  await page.getByRole("button", { name: "Selanjutnya" }).click();
  // Step 2: parents.
  await field(page, "Nama Ayah").fill(`Ayah ${childName}`);
  await field(page, "Nama Ibu").fill(`Ibu ${childName}`);
  await field(page, "No. WhatsApp").fill("081234567890");
  await page.getByRole("button", { name: "Selanjutnya" }).click();
  // Step 3: address.
  await field(page, "Alamat Lengkap (Jalan, RT/RW)").fill(
    "Kp. Nyalindung RT 001 RW 001",
  );
  await field(page, "Kota/Kabupaten").fill("Tasikmalaya");
  await field(page, "Provinsi").fill("Jawa Barat");
  await page.getByRole("button", { name: "Selanjutnya" }).click();
  // Step 4: the Qur'an ability is stored as the code every other reader uses.
  await page.getByText("Pilih kemampuan").click();
  await page.getByRole("option", { name: "Sudah hafal beberapa juz" }).click();
  await page.getByRole("button", { name: "Selanjutnya" }).click();
  // Step 5 (documents) is optional.
  await page.getByRole("button", { name: "Selanjutnya" }).click();
}

test.describe("SPMB publik per unit", () => {
  test.describe.configure({ mode: "serial" });
  let admin: AuthSession;
  const runId = `e2e-${Date.now()}`;
  const created: { periods: string[]; registrants: string[] } = {
    periods: [],
    registrants: [],
  };
  let smp = { id: "", name: "" };
  let sma = { id: "", name: "" };
  let smpPeriod = "";

  test.beforeAll(async () => {
    test.skip(await isProductionApi(), "API produksi; uji ini menulis data");
    admin = await apiLogin(SUPER);
    const units = (
      await apiRequest<{
        data: Array<{ id: string; name: string; type: string }>;
      }>(admin, "GET", "/units")
    ).data;
    const sd = units.find((u) => u.type === "SD_IT")!;
    smp = units.find((u) => u.type === "SMP_IT")!;
    sma = units.find((u) => u.type === "SMA_QURAN")!;
    const year = (
      await apiRequest<{ data: Array<{ id: string }> }>(
        admin,
        "GET",
        "/academic-years?limit=1",
      )
    ).data[0];

    const period = async (
      unitId: string,
      name: string,
      endDate: string,
      extra = {},
    ) => {
      const { data } = await apiRequest<{ data: { id: string } }>(
        admin,
        "POST",
        "/admissions/periods",
        {
          unitId,
          academicYearId: year.id,
          name,
          startDate: wibDay(-1),
          endDate,
          // No fee billed at registration, so the run leaves no invoice
          // behind; the fee table below is what the page shows.
          registrationFee: 0,
          ...extra,
        },
      );
      created.periods.push(data.id);
      return data.id;
    };
    // SD IT closes first, so a yayasan-wide "active period" would be SD IT's.
    await period(sd.id, `SPMB SD ${runId}`, wibDay(0));
    smpPeriod = await period(smp.id, `SPMB SMP ${runId}`, wibDay(1), {
      requirements: [`Syarat uji ${runId}`, "NISN"],
      minAgeMonths: 144,
      contactName: `Panitia ${runId}`,
      contactPhone: "0812-0000-0000",
    });
    await apiRequest(admin, "POST", "/admissions/waves", {
      periodId: smpPeriod,
      waveNumber: 1,
      name: `Gelombang ${runId}`,
      startDate: wibDay(-1),
      endDate: wibDay(1),
      quota: 10,
      testStartDate: wibDay(2),
      fullPaymentDiscount: 1_000_000,
    });
    await apiRequest(admin, "PUT", `/admissions/periods/${smpPeriod}/fees`, {
      items: [
        {
          label: "Pendaftaran",
          maleAmount: 200_000,
          femaleAmount: 200_000,
          residency: "ALL",
          isMonthly: false,
        },
        {
          label: "Seragam",
          maleAmount: 1_250_000,
          femaleAmount: 1_500_000,
          residency: "ALL",
          isMonthly: false,
        },
        {
          label: "SPP Bulanan",
          maleAmount: 950_000,
          femaleAmount: 950_000,
          residency: "BOARDING",
          isMonthly: true,
        },
      ],
    });

    // SMA Qur'an between two waves: its period runs, but wave 1 ended
    // yesterday and wave 2 opens the day after tomorrow — the API would
    // refuse a registration today.
    const smaPeriod = await period(sma.id, `SPMB SMA ${runId}`, wibDay(30), {
      startDate: wibDay(-5),
    });
    for (const [waveNumber, startDate, endDate] of [
      [1, wibDay(-5), wibDay(-1)],
      [2, wibDay(2), wibDay(30)],
    ] as const) {
      await apiRequest(admin, "POST", "/admissions/waves", {
        periodId: smaPeriod,
        waveNumber,
        name: `Gelombang ${waveNumber}`,
        startDate,
        endDate,
        quota: 10,
      });
    }
  });

  test.afterAll(async () => {
    if (!admin) return;
    for (const id of created.registrants) {
      await apiRequest(admin, "DELETE", `/admissions/registrants/${id}`).catch(
        () => undefined,
      );
    }
    for (const id of created.periods) {
      const period = await apiRequest<{
        data: { waves: Array<{ id: string }> };
      }>(admin, "GET", `/admissions/periods/${id}`).catch(() => null);
      for (const w of period?.data.waves ?? []) {
        await apiRequest(admin, "DELETE", `/admissions/waves/${w.id}`).catch(
          () => undefined,
        );
      }
      await apiRequest(admin, "DELETE", `/admissions/periods/${id}`).catch(
        () => undefined,
      );
    }
  });

  test("a visitor reads SMP IT's waves, fees, requirements and contact", async ({
    page,
  }) => {
    await page.goto("/public/spmb");
    const section = page.getByTestId("public-intakes");
    await section.getByRole("tab", { name: smp.name }).click();

    const intake = section
      .getByTestId("public-intake")
      .filter({ hasText: `Panitia ${runId}` });
    await expect(intake).toBeVisible();
    await expect(intake.getByTestId("public-wave-table")).toContainText(
      `Gelombang ${runId}`,
    );
    await expect(intake.getByTestId("public-wave-table")).toContainText(
      "Rp1.000.000",
    );
    // Boarding total: 200.000 + 1.250.000 + 950.000 for ikhwan; 2.650.000 for akhwat.
    const total = intake.getByTestId("public-fee-total");
    await expect(total).toContainText("Jumlah mukim");
    await expect(total).toContainText("Rp2.400.000");
    await expect(total).toContainText("Rp2.650.000");
    await expect(intake).toContainText(`Syarat uji ${runId}`);
    await expect(intake.getByTestId("public-min-age")).toContainText(
      "Usia minimal 12 tahun",
    );
    // Never a quota or a registrant count.
    await expect(intake).not.toContainText("/10");
  });

  test("between two waves, a unit's form stays shut and says when it opens", async ({
    page,
  }) => {
    const reopens = new Intl.DateTimeFormat("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    }).format(new Date(`${wibDay(2)}T00:00:00+07:00`));

    await page.goto("/public/spmb");
    const section = page.getByTestId("public-intakes");
    await section.getByRole("tab", { name: sma.name }).click();
    const intake = section
      .getByTestId("public-intake")
      .filter({ hasText: `Dibuka ${reopens}` });
    await expect(intake).toBeVisible();
    await expect(intake.getByText("Belum dibuka").first()).toBeVisible();
    await expect(intake.getByTestId("public-intake-register")).toHaveCount(0);

    // And the form will not take SMA Qur'an today.
    await page.getByText("Pilih unit tujuan").click();
    await expect(
      page.getByRole("option", { name: /SMA Qur.an.*belum dibuka/ }),
    ).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
  });

  test("the registration goes to the chosen unit's period", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/public/spmb");
    const section = page.getByTestId("public-intakes");
    await section.getByRole("tab", { name: smp.name }).click();
    await section
      .getByTestId("public-intake")
      .filter({ hasText: `Panitia ${runId}` })
      .getByTestId("public-intake-register")
      .click();

    // The banner speaks of the chosen unit. Nothing is billed on registering
    // here, but its fee table has a "Pendaftaran" line: never "Gratis".
    await expect(page.locator("#spmb-form-start")).toContainText(
      `SPMB SMP ${runId}`,
    );
    await expect(page.getByTestId("spmb-registration-fee")).toHaveCount(0);

    // Steps 1–5: fill the child's data. The unit is already chosen.
    await fillRegistrationSteps(page, `Calon ${runId}`);
    // Step 6: the parent/guardian must consent before the form will send the
    // child's data (UU PDP 27/2022 Pasal 20, 25). The checkbox starts
    // unchecked, so tick it — the API refuses a submission without it.
    await page.getByRole("checkbox", { name: /Kebijakan Privasi/ }).check();
    await page.getByRole("button", { name: "Kirim Pendaftaran" }).click();

    await expect(page.getByText("Pendaftaran Berhasil!")).toBeVisible();

    const { data } = await apiRequest<{
      data: Array<{
        id: string;
        admissionPeriodId: string;
        fullName: string;
        quranAbility: string | null;
      }>;
    }>(
      admin,
      "GET",
      `/admissions/registrants?search=${encodeURIComponent(`Calon ${runId}`)}`,
    );
    expect(data).toHaveLength(1);
    created.registrants.push(data[0].id);
    expect(data[0].admissionPeriodId).toBe(smpPeriod);
    expect(data[0].quranAbility).toBe("TAHFIDZ");
  });

  test("a second registration on the same page asks for consent again", async ({
    page,
  }) => {
    // The reviewer's case: the guardian registers one child, then a sibling
    // without reloading the page. Consent is the lawful basis for THIS child
    // (UU PDP 27/2022 Pasal 25), so the box must come back empty — otherwise
    // the second child is filed under a consent the guardian never gave for
    // them. The reset lives beside the form-data reset in both success paths.
    test.setTimeout(180_000);
    await page.goto("/public/spmb");
    const section = page.getByTestId("public-intakes");
    await section.getByRole("tab", { name: smp.name }).click();
    const register = section
      .getByTestId("public-intake")
      .filter({ hasText: `Panitia ${runId}` })
      .getByTestId("public-intake-register");

    // First child: register, then close the success dialog without reloading.
    await register.click();
    await fillRegistrationSteps(page, `Kakak ${runId}`);
    const consent = page.getByRole("checkbox", { name: /Kebijakan Privasi/ });
    await consent.check();
    await page.getByRole("button", { name: "Kirim Pendaftaran" }).click();
    await expect(page.getByText("Pendaftaran Berhasil!")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Tutup" })
      .click();
    await expect(page.getByText("Pendaftaran Berhasil!")).toBeHidden();

    // Second child, same page. The unit is chosen again the way a guardian
    // would: through the intake's own button.
    await register.click();
    await fillRegistrationSteps(page, `Adik ${runId}`);
    await expect(consent).not.toBeChecked();
    await consent.check();
    await page.getByRole("button", { name: "Kirim Pendaftaran" }).click();
    await expect(page.getByText("Pendaftaran Berhasil!")).toBeVisible();

    // Both children are filed, each carrying its own recorded consent.
    for (const child of [`Kakak ${runId}`, `Adik ${runId}`]) {
      const { data } = await apiRequest<{
        data: Array<{ id: string; fullName: string }>;
      }>(
        admin,
        "GET",
        `/admissions/registrants?search=${encodeURIComponent(child)}`,
      );
      expect(data).toHaveLength(1);
      created.registrants.push(data[0].id);
    }
  });
});
