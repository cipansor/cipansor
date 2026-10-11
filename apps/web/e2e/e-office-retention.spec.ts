import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth-api";

/**
 * Peninjauan Retensi Arsip.
 *
 * Halaman ini adalah permukaan yang selama ini hilang: penjadwal benar-benar
 * menjalankan peninjauan retensi tiap minggu, tetapi hasilnya hanya sampai ke
 * `logger` dan perintah CLI, sehingga seorang petugas arsip tidak punya layar
 * untuk melihat daftar naskah yang masa retensinya sudah lewat. Yang diuji di
 * sini bukan bahwa kartunya ada, melainkan bahwa halaman benar-benar membaca
 * endpoint retensi dan menawarkan ekspor yang berasal dari endpoint itu —
 * sekaligus bahwa tidak ada tombol yang memusnahkan arsip, sebab pemusnahan
 * menuntut penilaian dan berita acara (UU 43/2009 Pasal 51–52 dan PP 28/2012).
 */
test.describe("E-Office peninjauan retensi", () => {
  test("petugas arsip dapat membuka daftar retensi dari beranda e-office", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/e-office");

    // Kartu di beranda harus menuju halaman retensi — bukan rute yang belum
    // ada, yang dulu membuat "Arsip Surat" mendarat di 404.
    const card = page.getByText(/retensi arsip/i).first();
    await expect(card).toBeVisible();

    // Daftar dimuat dari endpoint yang sebenarnya. Tangkap permintaannya
    // SEBELUM menavigasi, karena jawabannya dapat tiba lebih dulu.
    const response = page.waitForResponse(
      (r) => r.url().includes("/correspondence/retention"),
      { timeout: 15000 },
    );
    await card.click();

    await expect(page).toHaveURL(/\/e-office\/retention$/);
    await expect(page.locator("h1")).toContainText(/Peninjauan Retensi Arsip/i);

    expect((await response).status()).toBeLessThan(400);
  });

  test("ekspor daftar retensi mengunduh CSV dari endpoint retensi", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/e-office/retention");

    await expect(page.locator("h1")).toContainText(/Peninjauan Retensi Arsip/i);

    const csvResponse = page.waitForResponse(
      (r) => r.url().includes("/correspondence/retention/export"),
      { timeout: 15000 },
    );
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 });

    await page.getByRole("button", { name: /ekspor csv/i }).click();

    const response = await csvResponse;
    expect(response.status()).toBeLessThan(400);

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/Peninjauan-Retensi\.csv$/i);
  });

  test("tidak ada kendali yang memusnahkan arsip", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/e-office/retention");

    await expect(page.locator("h1")).toContainText(/Peninjauan Retensi Arsip/i);

    // "Musnah" hanya boleh muncul sebagai keterangan ("bukan untuk dimusnahkan
    // otomatis"), tidak pernah sebagai tombol yang dapat ditekan.
    await expect(
      page.getByRole("button", { name: /musnah|hapus|destroy/i }),
    ).toHaveCount(0);
  });

  test("petugas Tata Usaha satu unit dapat membukanya (cakupan unit)", async ({
    page,
  }) => {
    await loginAs(page, "adminSdit");

    // Tangkap permintaan SEBELUM menavigasi, sama seperti uji pertama:
    // jawabannya dapat tiba lebih dulu daripada pemanggilan waitForResponse,
    // dan pendengar yang dipasang setelah `goto` kehilangan balasan itu.
    const response = page.waitForResponse(
      (r) => r.url().includes("/correspondence/retention"),
      { timeout: 15000 },
    );
    await page.goto("/e-office/retention");

    await expect(page.locator("h1")).toContainText(/Peninjauan Retensi Arsip/i);
    expect((await response).status()).toBeLessThan(400);
  });
});
