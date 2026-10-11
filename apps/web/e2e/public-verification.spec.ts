import { test, expect } from "@playwright/test";

/**
 * The public verification surface.
 *
 * This file exists because the feature once shipped unreachable: the API route
 * was correctly registered before `authenticate` and the page was written with
 * `no-store` and `noindex` — but the Next middleware, which nobody updated,
 * bounced every visitor to /login. A verification page that answers with a
 * staff login form is not a verification feature, and nothing in the suite
 * noticed.
 *
 * The surface has since moved. Verification is no longer "scan the QR and read
 * a verdict": a token attests that *some* letter was signed, never that the
 * document in the reader's hand is that letter, so a forger could keep the
 * genuine QR and edit the body. The public answer now comes from uploading the
 * PDF itself, whose bytes are hashed and matched. These tests follow it there.
 *
 * They run with no session on purpose: that is the only state the people
 * checking a letter are ever in.
 */

test.use({ storageState: { cookies: [], origins: [] } });

test("the verification page is reachable without a session", async ({
  page,
}) => {
  const response = await page.goto("/public/verify-letter");

  // The old failure was a 307 to /login?redirect=… — assert on where we ended
  // up, which is what the person checking a letter actually sees.
  expect(new URL(page.url()).pathname).toBe("/public/verify-letter");
  expect(response?.status()).toBeLessThan(400);
});

test("it asks for the document, not for who you are", async ({ page }) => {
  await page.goto("/public/verify-letter");

  await expect(page.locator("input[type='file']")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/kata sandi|password/i);
  await expect(page.getByRole("textbox", { name: /email/i })).toHaveCount(0);
});

test("an already-printed QR path lands on the upload form, not a dead end", async ({
  page,
}) => {
  // Letters in circulation were printed when verification lived at
  // /verifikasi/<token>. That page is gone on purpose, but the paper is not:
  // the path must still lead somewhere useful, and never to a login wall.
  await page.goto("/verifikasi/e2e-token-that-does-not-exist");

  expect(new URL(page.url()).pathname).toBe("/public/verify-letter");
  await expect(page.locator("input[type='file']")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /email/i })).toHaveCount(0);
});

/**
 * The key-status surface (AATL ICA7).
 *
 * It answers a question the document-upload page cannot: a recipient holding
 * an old archive can ask whether the *key* that signed it is still valid,
 * without the PDF in hand. It must be reachable with no session — that is the
 * only state the person asking is ever in.
 */
test("the key-status page is reachable without a session", async ({ page }) => {
  const response = await page.goto("/public/verify-key");

  expect(new URL(page.url()).pathname).toBe("/public/verify-key");
  expect(response?.status()).toBeLessThan(400);
});

test("it asks for a fingerprint, not for who you are", async ({ page }) => {
  await page.goto("/public/verify-key");

  await expect(
    page.getByRole("textbox", { name: /sidik jari kunci/i }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/kata sandi|password/i);
  await expect(page.getByRole("textbox", { name: /email/i })).toHaveCount(0);
});

test("an unknown fingerprint is reported as unknown, not as an error", async ({
  page,
}) => {
  // A fingerprint that is not registered is a legitimate answer — a mistyped
  // value must not be dressed up as "broken system".
  await page.route("**/api/esign/public/key-status**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { found: false, status: "UNKNOWN" },
      }),
    });
  });

  await page.goto("/public/verify-key");
  await page
    .getByRole("textbox", { name: /sidik jari kunci/i })
    .fill("AB:CD:EF:00");
  await page.getByRole("button", { name: /periksa status kunci/i }).click();

  await expect(page.getByText(/sidik jari tidak dikenal/i)).toBeVisible();
});

test("a revoked key shows its reason code and whether old letters are affected", async ({
  page,
}) => {
  await page.route("**/api/esign/public/key-status**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          found: true,
          status: "REVOKED",
          algorithm: "Ed25519",
          revocationCode: "KEY_COMPROMISE",
          // An internal note an older API still sent; the page must not print it.
          revokedReason: "Catatan internal: laptop bendahara.",
          revokedAt: "2026-08-02T10:00:00Z",
          expiresAt: "2027-08-01T00:00:00Z",
        },
      }),
    });
  });

  await page.goto("/public/verify-key");
  await page
    .getByRole("textbox", { name: /sidik jari kunci/i })
    .fill("AB:CD:EF:00");
  await page.getByRole("button", { name: /periksa status kunci/i }).click();

  await expect(page.getByText(/kunci dicabut/i)).toBeVisible();
  // The distinction that matters: a key compromise, unlike an office change,
  // puts letters already signed in doubt. Assert the compromise-specific
  // sentence — "kebocoran kunci" alone also appears in the standing note that
  // is shown for every revocation, so matching it would not prove the point.
  await expect(
    page.getByText(
      /keaslian naskah yang ditandatangani dengan kunci ini perlu diverifikasi ulang/i,
    ),
  ).toBeVisible();
  // The public page shows the RFC 5280 code, never the admin's free-text note.
  await expect(page.getByText(/laptop bendahara/i)).toHaveCount(0);
});
