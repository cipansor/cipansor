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
}, testInfo) => {
  test.setTimeout(90_000);
  const documents = spmbFormContentFor("id").documents;
  await openDocumentsStep(page);

  const beforeShot = testInfo.outputPath("before-scan.png");
  await page.screenshot({ path: beforeShot, fullPage: true });
  // `outputPath` is unique per test and project, so a parallel browser cannot
  // overwrite the file this attachment reads.
  await testInfo.attach("before-scan", {
    path: beforeShot,
    contentType: "image/png",
  });

  const ktp = page
    .getByText("KTP Orang Tua / Wali", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'space-y-2')][1]");

  let parseCalls = 0;
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      req.url().includes("/admissions/public/parse-document")
    ) {
      parseCalls += 1;
    }
  });

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
  const payload = await response.json();
  expect(payload.success).toBe(true);
  // A bare `data: {}` would also leave the manual note on screen; require the
  // validation the endpoint promises.
  expect(payload.data?.validation?.status).toBeTruthy();
  expect(Array.isArray(payload.data?.validation?.notes)).toBe(true);

  // The 1x1 PNG yields nothing to compare, so the server returns no extracted
  // fields and the form must show the localized manual note — not a stale one.
  expect(Object.keys(payload.data?.extractedData ?? {})).toHaveLength(0);
  const verdictNote = documents.uncheckedNote;
  await expect(page.getByText(verdictNote).first()).toBeVisible({
    timeout: 30_000,
  });
  expect(parseCalls).toBe(1);

  const afterShot = testInfo.outputPath("after-scan.png");
  await page.screenshot({ path: afterShot, fullPage: true });
  await testInfo.attach("after-scan", {
    path: afterShot,
    contentType: "image/png",
  });

  // Replacing the image with a PDF must drop the stale verdict and not scan it.
  await ktp
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "ktp.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n"),
    });
  await expect(page.getByText(verdictNote).first()).toBeHidden({
    timeout: 10_000,
  });
  // `processOcr` clears the note before reading the file; give a wrong POST a
  // chance to appear before asserting none was made.
  await page.waitForTimeout(1_000);
  expect(parseCalls).toBe(1);
});
