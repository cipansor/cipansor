import { test, expect, type Page } from "@playwright/test";
import zlib from "node:zlib";
import { loginAs, apiRequest } from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";
import { waitForLoadingComplete } from "./helpers/page-helpers";

/**
 * The printed sanad/syahadah and the PDF a recipient downloads must say the
 * same thing.
 *
 * The certificate preview (browser DOM) is what the musyrif hands over on
 * paper; the download is rendered separately, from the mint metadata, by
 * `generateCertificatePdfBuffer`. The two are built by different code, so a
 * detail can be printed on one and dropped from the other — the regression
 * Devin flagged (juz, qira'ah and silsilah missing from the download). This
 * drives the real page, mints a real 30-juz sanad, reads the details the
 * preview shows, then downloads the public PDF and asserts the *same* details
 * appear in its text. It also pins that a 30-juz list is reported as a count,
 * not a line that overflows the page.
 */

/**
 * The text drawn into a PDF's content streams. pdf-lib encodes each run as
 * `<hex> Tj` inside a Flate-compressed stream, so this is the only way to
 * assert what the downloaded file *says*. `zlib` is Node's, so the web e2e
 * needs no new dependency to read the file the API produced.
 */
function pdfText(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const lines: string[] = [];
  let stream: RegExpExecArray | null;
  while ((stream = streams.exec(raw))) {
    let content: string;
    try {
      content = zlib
        .inflateSync(Buffer.from(stream[1], "latin1"))
        .toString("latin1");
    } catch {
      continue;
    }
    const hexes = /<([0-9A-Fa-f]+)>\s*Tj/g;
    let hex: RegExpExecArray | null;
    while ((hex = hexes.exec(content))) {
      lines.push(Buffer.from(hex[1], "hex").toString("latin1"));
    }
  }
  return lines.join("\n");
}

/** The API base the web app calls; the public download route lives here. */
const API_URL = process.env.API_URL || "http://localhost:3001/api";

/**
 * `performPrint` opens a real popup and calls `print()` on it, which stalls
 * headless Chromium. The popup is not what this test checks, so replace
 * `window.open` with the exact surface `performPrint` touches: the print branch
 * still runs (so the number is generated) without a window.
 *
 * The stub records every `document.write` payload, so the test can assert what
 * the printed document *says* — the preview is copied into that payload by
 * `printDocument`, and the musyrif line lives only there.
 */
async function capturePrintPopup(page: Page) {
  await page.addInitScript(() => {
    const docs: string[] = [];
    (window as unknown as { __printedDocuments: string[] }).__printedDocuments =
      docs;
    (window as unknown as { open: () => unknown }).open = () => ({
      document: {
        write: (html: string) => docs.push(html),
        close() {},
      },
      focus() {},
      print() {},
      close() {},
    });
  });
}

/** The HTML handed to the print window, as the user's print dialog sees it. */
async function printedHtml(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (
        window as unknown as { __printedDocuments?: string[] }
      ).__printedDocuments?.join("\n") ?? "",
  );
}

async function pickFirstStudent(page: Page) {
  const card = page.locator("div.cursor-pointer.rounded-lg.border").first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.click();
}

async function pickType(page: Page, label: RegExp) {
  const card = page
    .locator("div.cursor-pointer.border-2")
    .filter({ hasText: label })
    .first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
}

test.describe("Sanad tahfidz — cetakan dan unduhan berbicara sama", () => {
  test("unduhan PDF memuat qira'ah, jumlah juz dan silsilah yang tercetak", async ({
    page,
  }) => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini menulis data, jadi dilewati",
    );
    test.setTimeout(180_000);

    const session = await loginAs(page, "superAdmin");
    await capturePrintPopup(page);

    await page.goto("/tahfidz/certificate");
    await waitForLoadingComplete(page);

    // Step 1 → 2 → 3: the real wizard, not a shortcut. A 30-juz sanad carries
    // every detail at once (qira'ah, a full juz list, and a silsilah), which is
    // exactly what the renderer dropped.
    await pickFirstStudent(page);
    await pickType(page, /Sanad Hafalan 30 Juz/i);

    // A single word with no spaces, so line wrapping in the PDF cannot split it
    // across a newline and make a content assertion fail for the wrong reason.
    const silsilah = "SilsilahUjiSanad";
    const musyrif = "Ust. Ahmad Fauzi";
    // The form's default; the printed preview and the PDF must agree on it.
    const qiraah = "Riwayat Hafs dari Ashim";

    await page.getByPlaceholder("Nama musyrif yang membimbing").fill(musyrif);
    await page.getByPlaceholder(/Ust. Muhammad Ridwan/).fill(silsilah);

    // Minting happens on the print click; capture the row it returns rather
    // than scraping the preview, so the download reads the stored metadata.
    // Two "Cetak Sertifikat" buttons exist (a sticky one and the form's); the
    // form's is inside the "Isi Detail" tab panel.
    const generate = page.waitForResponse(
      (r) =>
        r.url().includes("/tahfidz/certificates/generate") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("tabpanel", { name: "Isi Detail" })
      .getByRole("button", { name: /Cetak Sertifikat/i })
      .click();
    const body = (await (await generate).json()) as {
      data: { id: string; certificateNumber: string };
    };
    const number = body.data.certificateNumber;
    const id = body.data.id;
    expect(number, "generate should return a number").toBeTruthy();

    try {
      // What the paper shows: the preview renders these from the same form.
      const preview = page.locator('div[class*="297mm"]').first();
      await expect(preview).toContainText(qiraah);
      await expect(preview).toContainText("30 Juz");
      await expect(preview).toContainText(silsilah);
      await expect(preview).toContainText(musyrif);

      // What the print window receives: `performPrint` copies the preview's
      // innerHTML into the popup, so the musyrif line the paper carries must be
      // in that payload too — not only in the on-screen preview. A print button
      // that dropped it would still pass a preview-only assertion. `performPrint`
      // fires on a short timeout after minting, so poll for the payload.
      await expect
        .poll(async () => printedHtml(page), {
          message: "the print window never received a document",
        })
        .toContain("<body");
      await expect
        .poll(async () => printedHtml(page), {
          message: "the musyrif line is missing from the printed document",
        })
        .toContain(musyrif);
      expect(await printedHtml(page)).toMatch(
        /Musyrif:\s*<span[^>]*>Ust\. Ahmad Fauzi<\/span>/,
      );

      // What the download says: the public, session-free route a recipient's
      // printed QR opens.
      const response = await fetch(
        `${API_URL}/certificates/public/${encodeURIComponent(number)}/download`,
      );
      expect(response.status, "a public sanad should download").toBe(200);
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

      const text = pdfText(bytes);
      expect(
        text,
        "the qira'ah printed on the paper is missing from the PDF",
      ).toContain(qiraah);
      expect(
        text,
        "the juz count printed on the paper is missing from the PDF",
      ).toContain("Jumlah Juz: 30 Juz");
      expect(
        text,
        "the silsilah printed on the paper is missing from the PDF",
      ).toContain(silsilah);
      expect(
        text,
        "the musyrif printed on the paper is missing from the PDF",
      ).toContain(musyrif);
    } finally {
      await apiRequest(session, "DELETE", `/certificates/${id}`);
    }
  });
});
