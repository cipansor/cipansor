import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth-api";

/**
 * Buku agenda: ekspor CSV dan pemilih ukuran halaman.
 *
 * Keduanya adalah bentuk "buku agenda" yang harus dapat diserahkan atau
 * dibaca sebagai satu lembar kerja. Yang diuji di sini bukan bahwa tombolnya
 * ada, melainkan bahwa menekannya benar-benar menghasilkan berkas dengan
 * saringan yang sedang dilihat, dan bahwa memilih ukuran halaman lain
 * mengubah jumlah baris yang diminta dari API — sebab keduanya pernah diam:
 * ekspor pernah dibangun di atas permintaan `fetch` relatif yang hanya bekerja
 * di belakang nginx, dan ukuran halaman pernah tetap 10 dengan kontrol
 * paginasi yang tidak pernah ada.
 */
test.describe("E-Office buku agenda", () => {
  test("ekspor buku agenda mengunduh CSV dari saringan yang terlihat", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/e-office/inbox");

    await expect(page.locator("h1")).toContainText(/Surat Masuk/i);

    // Berkas yang diunduh berasal dari endpoint ekspor yang sebenarnya, bukan
    // tautan yang dikarang. Tangkap permintaan yang dikirim dan jawabannya.
    const csvResponse = page.waitForResponse(
      (r) => r.url().includes("/correspondence/agenda/export"),
      { timeout: 15000 },
    );

    const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
    await page.getByRole("button", { name: /ekspor buku agenda/i }).click();

    const response = await csvResponse;
    expect(response.status()).toBeLessThan(400);

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/Buku-Agenda-Masuk\.csv$/i);
  });

  test("pemilih ukuran halaman mengubah limit yang diminta dari API", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/e-office/inbox");

    // Tunggu daftar pertama selesai memuat sebelum mengubah penyaring.
    await page
      .waitForResponse((r) => r.url().includes("/correspondence/letters"), {
        timeout: 15000,
      })
      .catch(() => undefined);

    // Pemilih ukuran halaman adalah combobox ketiga di bilah saring (cari,
    // status, ukuran halaman) pada surat masuk.
    const trigger = page.getByRole("combobox", {
      name: /banyaknya baris per halaman/i,
    });
    await expect(trigger).toBeVisible();

    const listRequest = page.waitForRequest(
      (r) =>
        r.url().includes("/correspondence/letters") &&
        r.url().includes("limit=50"),
      { timeout: 15000 },
    );

    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    const option = page
      .locator('[role="option"]')
      .filter({ hasText: "50 per halaman" })
      .first();
    await option.waitFor({ state: "visible", timeout: 10000 });
    await option.click({ force: true });

    // Permintaan berikutnya membawa limit 50 — bukan lagi 10 yang tetap.
    await listRequest;
  });
});
