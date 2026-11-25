import { test, expect, type Page } from "@playwright/test";
import { spmbFormContentFor } from "../src/config/spmb-form.i18n";

/**
 * The SPMB form's own scan path: a parent chooses a KTP file in step 5, the
 * browser calls `POST /admissions/public/parse-document`, and the verdict is
 * rendered in the form. The workflow spec uploads through the API directly, so
 * this is the only case that exercises the form → endpoint wiring.
 *
 * Read-only for the database: it stops before consent and never submits.
 */

const field = (page: Page, label: string) =>
  page
    .locator("div.space-y-2")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("input, textarea")
    .first();

async function openDocumentsStep(page: Page) {
  await page.goto("/public/spmb");
  await page.getByTestId("public-intake-register").first().click();
  await expect(page.getByText("Nama Lengkap", { exact: true })).toBeVisible();

  await field(page, "Nama Lengkap").fill("Calon Scan");
  await field(page, "Tempat Lahir").fill("Tasikmalaya");
  await field(page, "Tanggal Lahir").fill("2014-05-01");
  await page.getByText("Pilih jenis kelamin").click();
  await page.getByRole("option", { name: /Laki/ }).click();
  await page.getByRole("button", { name: "Selanjutnya" }).click();

  await field(page, "Nama Ayah").fill("Ayah Scan");
  await field(page, "Nama Ibu").fill("Ibu Scan");
  await field(page, "No. WhatsApp").fill("081234567890");
  await page.getByRole("button", { name: "Selanjutnya" }).click();

  await field(page, "Alamat Lengkap (Jalan, RT/RW)").fill(
    "Kp. Scan RT 001 RW 001",
  );
  await field(page, "Kota/Kabupaten").fill("Tasikmalaya");
  await field(page, "Provinsi").fill("Jawa Barat");
  await page.getByRole("button", { name: "Selanjutnya" }).click();

  await page.getByText("Pilih kemampuan").click();
  await page.getByRole("option", { name: "Sudah hafal beberapa juz" }).click();
  await page.getByRole("button", { name: "Selanjutnya" }).click();
  await expect(page.getByText("KTP Orang Tua / Wali")).toBeVisible();
}

test("choosing a KTP reaches the parse endpoint and shows the verdict", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const documents = spmbFormContentFor("id").documents;
  await openDocumentsStep(page);

  await page.screenshot({
    path: "test-results/spmb-document-scan-before.png",
    fullPage: true,
  });

  const ktp = page
    .getByText("KTP Orang Tua / Wali", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'space-y-2')][1]");
  // Prove the form really reached the endpoint: a 404/500 also renders the
  // manual note, so the note alone would not catch a broken wiring.
  const responsePromise = page.waitForResponse(
    (res) =>
      res.url().includes("/admissions/public/parse-document") &&
      res.request().method() === "POST",
  );
  await ktp
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "ktp.png",
      mimeType: "image/png",
      // A real 1x1 PNG: the API accepts it, and with OCR off it answers WARNING.
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect((await response.json()).success).toBe(true);

  // Either note proves the verdict reached the reader: the manual note when the
  // engine is off, the engine note when it is on.
  const note = page
    .getByText(documents.uncheckedNote)
    .or(page.getByText(documents.ocrEngineNote));
  await expect(note.first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({
    path: "test-results/spmb-document-scan-after.png",
    fullPage: true,
  });
});
