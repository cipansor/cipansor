import { test, expect, type Page } from "@playwright/test";
import { spmbFormContentFor } from "../src/config/spmb-form.i18n";
import { spmbContentFor } from "../src/config/spmb.i18n";

/**
 * A NIK carries its own birth date and sex (Dukcapil: digits 7–12 are
 * DD MM YY, +40 for girls), so a typo is caught in the browser without reading
 * any image and without a round trip. Step one must refuse to move on while the
 * 16 digits disagree with the birth date or the sex above them, and must move
 * on once they are fixed.
 *
 * Read-only: it never sends a registration, so it needs only an open intake,
 * which the base seed provides (SMP IT's).
 */

// 320123 | 01 10 23 | 0001 → lahir 1 Oktober 2023, laki-laki.
const NIK_MALE = "3201230110230001";
// Tanggal 1 + 40 = 41 menandai perempuan.
const NIK_FEMALE = "3201234110230001";

const t = spmbFormContentFor("id");
const intakes = spmbContentFor("id");

/** The input a label introduces. The form's labels carry no `htmlFor`. */
function fieldAfter(page: Page, label: string) {
  return page
    .getByText(label, { exact: true })
    .locator("xpath=following::input[1]");
}

async function openStudentStep(page: Page) {
  await page.goto("/public/spmb");
  await expect(
    page.getByRole("heading", { name: t.banner.title }),
  ).toBeVisible();

  // Starting from a unit's intake is what sets the admission period.
  await page
    .getByTestId("public-intake-register")
    .filter({ hasText: intakes.register })
    .first()
    .click();

  await expect(
    page.getByText(t.student.fullName, { exact: true }),
  ).toBeVisible();
}

/** Every required field of step one except the NIK. */
async function fillStudentStep(page: Page) {
  await page.getByPlaceholder(t.student.fullNamePlaceholder).fill("Anak Uji");
  await fieldAfter(page, t.student.birthPlace).fill("Bandung");
  await page.locator('input[type="date"]').first().fill("2023-10-01");

  await page
    .getByText(t.student.gender, { exact: true })
    .locator("xpath=following::button[1]")
    .click();
  await page.getByRole("option", { name: t.student.male }).click();
}

test.describe("SPMB — the NIK must agree with the birth date and the sex", () => {
  test("a mismatching NIK keeps step one open, with the reason under the field", async ({
    page,
  }) => {
    await openStudentStep(page);
    await fillStudentStep(page);

    // A female NIK against the male sex chosen above. The message waits for the
    // field to be left, so that a half-typed NIK is not called wrong.
    await fieldAfter(page, t.student.nationalId).fill(NIK_FEMALE);
    await page.keyboard.press("Tab");

    const error = page.getByTestId("spmb-nik-error");
    await expect(error).toHaveText(t.student.nikError("gender"));

    await page.getByRole("button", { name: t.actions.next }).click();

    // The same reason is toasted, not only written under the field.
    await expect(page.locator("[data-sonner-toast]").first()).toContainText(
      t.student.nikError("gender"),
    );

    // Still on step one: the parent's step was not reached.
    await expect(
      page.getByText(t.student.nationalId, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(t.parent.fatherName, { exact: true }),
    ).toHaveCount(0);
  });

  test("step one moves on once the NIK is corrected", async ({ page }) => {
    await openStudentStep(page);
    await fillStudentStep(page);

    await fieldAfter(page, t.student.nationalId).fill(NIK_FEMALE);
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("spmb-nik-error")).toBeVisible();

    await fieldAfter(page, t.student.nationalId).fill(NIK_MALE);
    await expect(page.getByTestId("spmb-nik-error")).toHaveCount(0);

    await page.getByRole("button", { name: t.actions.next }).click();
    await expect(
      page.getByText(t.parent.fatherName, { exact: true }),
    ).toBeVisible();
  });

  test("a half-typed NIK is not called wrong until the field is left", async ({
    page,
  }) => {
    await openStudentStep(page);
    await fillStudentStep(page);

    const nik = fieldAfter(page, t.student.nationalId);
    await nik.fill("3201");
    await expect(page.getByTestId("spmb-nik-error")).toHaveCount(0);

    await page.keyboard.press("Tab");
    await expect(page.getByTestId("spmb-nik-error")).toHaveText(
      t.student.nikError("format"),
    );

    // Refused by "next" too, not only by the message under the field.
    await page.getByRole("button", { name: t.actions.next }).click();
    await expect(
      page.getByText(t.parent.fatherName, { exact: true }),
    ).toHaveCount(0);
  });
});
