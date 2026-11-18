/**
 * A unit's SPMB intake, entered in the portal the way the brochure prints it
 * (decisions/spmb-2027-2028.md): the period with its requirements, minimum age
 * and contact person, then a wave with its test, results and re-registration
 * days and the discount for paying in full.
 *
 * Menu: Administrasi → Penerimaan (SPMB) → Periode & Gelombang.
 *
 * WRITES a period and a wave, then deletes both; skipped against a production
 * API. Passwords come from DEMO_ACCOUNTS.
 */
import { test, expect } from "@playwright/test";
import { DEMO_ACCOUNTS } from "../../../packages/shared/src/types/demo-accounts";
import {
  apiLogin,
  apiRequest,
  injectSession,
  type AuthSession,
} from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";

const byRole = (code: string) => {
  const a = DEMO_ACCOUNTS.find((d) => d.roleCode === code);
  if (!a) throw new Error(`No demo account for ${code}`);
  return a;
};
const ADMIN = byRole("SMPIT_ADMIN");
const KETUA = byRole("YAYASAN_KETUA");

test.describe("Periode & Gelombang SPMB", () => {
  test.describe.configure({ mode: "serial" });
  // A laptop screen, menu open: the width an admin enters the brochure on.
  test.use({ viewport: { width: 1280, height: 800 } });
  let admin: AuthSession;
  let periodId = "";

  test.beforeAll(async () => {
    admin = await apiLogin(ADMIN);
  });

  test.afterAll(async () => {
    if (periodId) {
      await apiRequest(
        admin,
        "DELETE",
        `/admissions/periods/${periodId}`,
      ).catch(() => undefined);
    }
  });

  test("a unit's admin enters an intake and its first wave", async ({
    page,
  }) => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini menulis data, jadi dilewati",
    );
    test.setTimeout(120_000);
    const runId = `e2e-${Date.now()}`;

    await injectSession(page, admin);
    await page.goto("/spmb/periods");
    await expect(
      page.getByRole("heading", { name: "Periode & Gelombang SPMB" }),
    ).toBeVisible();
    await page.getByTestId("period-add").click();

    // The admin's own unit is already chosen.
    await expect(page.getByTestId("period-unit")).toContainText("SMP");
    await page.getByTestId("period-year").click();
    await page.getByRole("option").first().click();
    // Radix returns focus to the trigger asynchronously when the menu closes.
    // Filling the next field while that is in flight loses the keystrokes on
    // Firefox (the value lands and is then cleared), so wait for the listbox to
    // leave the DOM first — the same guard `selectOption` uses.
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.getByTestId("period-name").fill(`SPMB ${runId}`);
    await page.getByTestId("period-start").fill("2026-10-01");
    await page.getByTestId("period-end").fill("2027-07-10");
    await page
      .getByTestId("period-requirements")
      .fill("Tes seleksi\nNISN\n\nSurat Keterangan Lulus");
    await page.getByTestId("period-min-age").fill("12");
    await page.getByTestId("period-contact-name").fill("Panitia SPMB SMP IT");
    await page.getByTestId("period-save").click();

    await expect(page).toHaveURL(/\/spmb\/periods\/[0-9a-f-]{36}$/);
    periodId = page.url().split("/").pop() ?? "";
    await expect(
      page.getByTestId("period-requirements-list").locator("li"),
    ).toHaveText(["Tes seleksi", "NISN", "Surat Keterangan Lulus"]);
    await expect(page.getByTestId("period-min-age-text")).toContainText(
      "Usia minimal 12 tahun pada hari mendaftar",
    );
    await expect(page.getByTestId("period-contact")).toContainText(
      "Panitia SPMB SMP IT",
    );

    // Wave 1 as the brochure prints it. A test that ends before it starts is
    // refused beside the field, before anything is sent.
    await page.getByTestId("wave-add").click();
    const form = page.getByTestId("wave-form");
    await form.getByTestId("wave-startDate").fill("2026-10-01");
    await form.getByTestId("wave-endDate").fill("2026-12-20");
    await form.getByTestId("wave-quota").fill("60");
    await form.getByTestId("wave-testStartDate").fill("2026-12-20");
    await form.getByTestId("wave-testEndDate").fill("2026-12-19");
    await form.getByTestId("wave-save").click();
    await expect(
      form.getByText(
        "Tanggal selesai tes tidak boleh sebelum tanggal mulainya",
      ),
    ).toBeVisible();

    await form.getByTestId("wave-testEndDate").fill("2026-12-25");
    await form.getByTestId("wave-resultsStartDate").fill("2026-12-26");
    await form.getByTestId("wave-resultsEndDate").fill("2026-12-27");
    await form.getByTestId("wave-reRegistrationStartDate").fill("2026-12-28");
    await form.getByTestId("wave-reRegistrationEndDate").fill("2027-01-03");
    await form.getByTestId("wave-discount").fill("1000000");
    await form.getByTestId("wave-save").click();
    await expect(form).toBeHidden();

    const row = page.getByTestId("wave-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Gelombang 1");
    await expect(row).toContainText("1 Okt – 20 Des 2026");
    await expect(row).toContainText("20–25 Des 2026");
    await expect(row).toContainText("28 Des 2026 – 3 Jan 2027");
    await expect(row).toContainText("Rp1.000.000");
    // The row fits beside the menu: nothing, the delete button included,
    // hides behind a sideways scroll on a laptop screen.
    const overflow = await page
      .locator("table")
      .first()
      .evaluate(
        (t) => t.parentElement!.scrollWidth - t.parentElement!.clientWidth,
      );
    expect(overflow).toBeLessThanOrEqual(0);
    // A new wave's status is read from its dates, not left "Belum dibuka".
    const today = new Date(Date.now() + 7 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    await expect(row).toContainText(
      today < "2026-10-01"
        ? "Belum dibuka"
        : today > "2026-12-20"
          ? "Ditutup"
          : "Dibuka",
    );

    // Stored as the API's calendar days, closing at the end of the day in WIB.
    const { data } = await apiRequest<{
      data: {
        waves: Array<{
          endDate: string;
          testEndDate: string;
          fullPaymentDiscount: string;
        }>;
      };
    }>(admin, "GET", `/admissions/periods/${periodId}`);
    expect(data.waves[0].endDate).toBe("2026-12-20T16:59:59.999Z");
    expect(data.waves[0].testEndDate.slice(0, 10)).toBe("2026-12-25");
    expect(Number(data.waves[0].fullPaymentDiscount)).toBe(1_000_000);
  });

  test("the admin enters the fee table, and its totals follow the lines", async ({
    page,
  }) => {
    test.skip(!periodId, "the period was not created");

    await injectSession(page, admin);
    await page.goto(`/spmb/periods/${periodId}`);
    await expect(page.getByText("Rincian biaya belum diisi.")).toBeVisible();
    await page.getByTestId("fee-edit").click();

    const lines: Array<[string, string, string, string, boolean]> = [
      ["Pendaftaran", "200000", "200000", "", false],
      ["Seragam", "1250000", "1500000", "", false],
      ["SPP Bulanan", "800000", "800000", "Mukim", true],
      ["SPP Bulanan", "350000", "350000", "Tidak mukim", true],
    ];
    for (const [
      i,
      [label, male, female, residency, monthly],
    ] of lines.entries()) {
      await page.getByTestId("fee-add-line").click();
      await page.getByLabel(`Uraian baris ${i + 1}`).fill(label);
      await page.getByLabel(`Ikhwan baris ${i + 1}`).fill(male);
      await page.getByLabel(`Akhwat baris ${i + 1}`).fill(female);
      if (residency) {
        await page.getByLabel(`Berlaku untuk baris ${i + 1}`).click();
        await page
          .getByRole("option", { name: residency, exact: true })
          .click();
      }
      if (monthly) await page.getByLabel(`Bulanan baris ${i + 1}`).click();
    }
    // The totals follow as the lines are typed.
    await expect(page.getByTestId("fee-form-total-BOARDING-male")).toHaveText(
      "Rp2.250.000",
    );
    await page.getByTestId("fee-save").click();

    const totals = page.getByTestId("fee-total");
    await expect(totals).toHaveCount(2);
    await expect(totals.nth(0)).toContainText("Jumlah mukim");
    await expect(totals.nth(0)).toContainText("Rp2.250.000");
    await expect(totals.nth(0)).toContainText("Rp2.500.000");
    await expect(totals.nth(1)).toContainText("Jumlah tidak mukim");
    await expect(totals.nth(1)).toContainText("Rp1.800.000");
    await expect(totals.nth(1)).toContainText("Rp2.050.000");
  });

  test("the admin edits the period, and removes a wave nobody registered in", async ({
    page,
  }) => {
    test.skip(!periodId, "the period was not created");

    await injectSession(page, admin);
    await page.goto(`/spmb/periods/${periodId}`);
    await page.getByTestId("period-edit").click();
    await expect(page.getByTestId("period-unit")).toBeDisabled();
    await page
      .getByTestId("period-contact-name")
      .fill("Ustadz Penanggung Jawab");
    await page.getByTestId("period-save").click();

    await expect(page).toHaveURL(new RegExp(`/spmb/periods/${periodId}$`));
    await expect(page.getByTestId("period-contact")).toContainText(
      "Ustadz Penanggung Jawab",
    );
    // An edit keeps what it did not touch.
    await expect(
      page.getByTestId("period-requirements-list").locator("li"),
    ).toHaveCount(3);

    await page.getByRole("button", { name: "Hapus Gelombang 1" }).click();
    await page.getByRole("button", { name: "Hapus", exact: true }).click();
    await expect(page.getByTestId("wave-row")).toHaveCount(0);
  });

  test("the yayasan's organs read the intakes but do not enter them", async ({
    page,
  }) => {
    const ketua = await apiLogin(KETUA);
    await injectSession(page, ketua);
    await page.goto("/spmb/periods");

    await expect(
      page.getByRole("heading", { name: "Periode & Gelombang SPMB" }),
    ).toBeVisible();
    await expect(page.getByTestId("period-row").first()).toBeVisible();
    await expect(page.getByTestId("period-add")).toHaveCount(0);
  });

  test("the old waves address leads to the new page", async ({ page }) => {
    await injectSession(page, admin);
    await page.goto("/admissions/waves");
    await expect(page).toHaveURL(/\/spmb\/periods$/);
  });
});
