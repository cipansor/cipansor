import { test, expect } from "@playwright/test";

/**
 * The public sanad verification page — the one a printed certificate's QR
 * actually opens (`certificateVerificationUrl` → `/public/verify-sanad?code=…`).
 *
 * It runs with no session on purpose: the people checking a certificate — a
 * dinas office, a prospective employer, a wali — are never signed in. The
 * finding this covers is that the page verified the number but offered no way
 * to obtain the PDF; the download action now calls the session-free
 * `/certificates/public/{code}/download`, which answers only for an `isPublic`
 * certificate.
 *
 * Turnstile is disabled in this build (`NEXT_PUBLIC_TURNSTILE_SITE_KEY` unset),
 * so the verify button is enabled without a token — the same condition the other
 * public-verification specs rely on.
 */

test.use({ storageState: { cookies: [], origins: [] } });

/** The seeded public certificate (`prisma/seed.ts`). */
const PUBLIC_NUMBER = "CERT-TFZ-30-2024001";

test("the page is reachable without a session", async ({ page }) => {
  const response = await page.goto("/public/verify-sanad");
  expect(new URL(page.url()).pathname).toBe("/public/verify-sanad");
  expect(response?.status()).toBeLessThan(400);
  await expect(page.locator("body")).not.toContainText(/kata sandi/i);
});

test("a public certificate verifies and offers its PDF for download", async ({
  page,
}) => {
  await page.goto(`/public/verify-sanad?code=${PUBLIC_NUMBER}`);
  await page.getByRole("button", { name: "Verifikasi" }).click();

  await expect(page.getByText("Sertifikat Terverifikasi")).toBeVisible();

  // The recipient — who holds only the number — can obtain the file here, not
  // just read the verdict. The bytes are a PDF, not a redirect or JSON error.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Unduh Sertifikat/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

  const stream = await download.createReadStream();
  const first = await new Promise<Buffer>((resolve, reject) => {
    stream.once("data", (chunk: Buffer) => resolve(chunk));
    stream.once("error", reject);
  });
  expect(first.subarray(0, 5).toString()).toBe("%PDF-");
});

test("an unknown number is rejected and offers no download", async ({
  page,
}) => {
  await page.goto("/public/verify-sanad?code=THIS-IS-NOT-A-CERTIFICATE");
  await page.getByRole("button", { name: "Verifikasi" }).click();

  await expect(page.getByText("Verifikasi Gagal")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Unduh Sertifikat/i }),
  ).toHaveCount(0);
});
