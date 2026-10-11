import { test, expect } from "@playwright/test";
import { loginAs, apiRequest } from "./helpers/auth-api";
import {
  ensureSuperAdminSigner,
  SIGNER_PASSPHRASE,
} from "./helpers/esign-signer";

test.describe("E-Office & Public Letter Verification E2E", () => {
  test("Public Letter Verification page loads and displays PDF upload form", async ({
    page,
  }) => {
    await page.goto("/public/verify-letter");

    await expect(page.locator("h1")).toContainText(
      "Verifikasi Tanda Tangan Elektronik",
    );
    await expect(page.locator("input[type='file']")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /verifikasi dokumen/i }),
    ).toBeVisible();

    // Verify button is disabled when no PDF file is selected
    await expect(
      page.getByRole("button", { name: /verifikasi dokumen/i }),
    ).toBeDisabled();
  });

  test("E-Office main page renders and displays stats for authenticated users", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");

    // Navigate to e-office page
    await page.goto("/e-office");

    // Expect E-Office header
    await expect(page.locator("h1")).toContainText("E-Office");
    await expect(
      page.getByRole("button", { name: /buat surat baru/i }),
    ).toBeVisible();
  });

  test("Integration test against real backend /api/esign/verify-pdf endpoint", async ({
    page,
  }) => {
    await page.goto("/public/verify-letter");

    const buffer = Buffer.from(
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
    );
    await page.setInputFiles("input[type='file']", {
      name: "sample-document.pdf",
      mimeType: "application/pdf",
      buffer,
    });

    // Tidak ada langkah captcha di sini lagi. Tantangan aritmetika sudah
    // diganti Cloudflare Turnstile, dan Turnstile MATI di lingkungan e2e —
    // NEXT_PUBLIC_TURNSTILE_SITE_KEY kosong, jadi widget-nya tidak dirender
    // dan peladen (TURNSTILE_SECRET_KEY kosong) tidak menuntut token.

    await page.getByRole("button", { name: /verifikasi dokumen/i }).click();

    // With real backend, uploading random PDF buffer should return DOKUMEN TIDAK VALID or result
    await expect(
      page.locator("text=/DOKUMEN TIDAK VALID|DOKUMEN SAH & TERVERIFIKASI/"),
    ).toBeVisible();
  });

  test("Valid public PDF verification displays success status and TTE signer details", async ({
    page,
  }) => {
    await page.route("**/api/esign/verify-pdf", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            isValid: true,
            isRevoked: false,
            signer: {
              name: "Dr. H. Ahmad",
              nip: "19800101",
              position: "Kepala Sekolah",
            },
            letter: {
              letterNumber: "001/SK/Y-CPS/VIII/2026",
              subject: "Pengumuman Resmi",
              date: "2026-08-01",
              status: "SIGNED",
              unitName: "SMA Al-Qur'an",
            },
            signedAt: "2026-08-01T16:40:31Z",
            digest:
              "a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890",
          },
        }),
      });
    });

    await page.goto("/public/verify-letter");

    const buffer = Buffer.from(
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
    );
    await page.setInputFiles("input[type='file']", {
      name: "surat-resmi.pdf",
      mimeType: "application/pdf",
      buffer,
    });

    // Tidak ada langkah captcha di sini lagi. Tantangan aritmetika sudah
    // diganti Cloudflare Turnstile, dan Turnstile MATI di lingkungan e2e —
    // NEXT_PUBLIC_TURNSTILE_SITE_KEY kosong, jadi widget-nya tidak dirender
    // dan peladen (TURNSTILE_SECRET_KEY kosong) tidak menuntut token.

    await page.getByRole("button", { name: /verifikasi dokumen/i }).click();

    await expect(page.getByText(/DOKUMEN SAH & TERVERIFIKASI/i)).toBeVisible();
    await expect(page.getByText("Dr. H. Ahmad")).toBeVisible();
    await expect(page.getByText("001/SK/Y-CPS/VIII/2026")).toBeVisible();
    /**
     * 16:40:31Z is 23:40:31 in WIB (UTC+7), and that conversion is what this
     * line is for.
     *
     * The separator is not. `id-ID` renders time parts with dots — "23.40.31",
     * which is how Indonesian writes a clock time — so an assertion pinned to
     * colons failed against a page that was formatting correctly. Kept loose on
     * the separator, exact on every digit: a page that forgot the timezone
     * would print 16.40.31 and still fail here.
     */
    await expect(page.getByText(/23[.:]40[.:]31 WIB/i)).toBeVisible();
  });

  /**
   * Garis kewenangan (a.n.) yang tercetak pada naskah ikut terbaca publik.
   *
   * Surat yang ditandatangani "a.n. Kepala …" menyatakan dari mana wewenang
   * penandatangannya berasal, dan pembaca yang memegang naskahnya berhak tahu
   * hal itu. Nilainya bagian dari payload yang ditandatangani, jadi yang
   * tampil di sini adalah yang benar-benar ditandatangani.
   */
  test("Verification of a letter signed a.n. shows the signing authority", async ({
    page,
  }) => {
    await page.route("**/api/esign/verify-pdf", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            isValid: true,
            isRevoked: false,
            signer: { name: "Ust. Fulan", position: "Sekretaris Yayasan" },
            signingAuthorityForm: "ATAS_NAMA",
            representedOffice: "Ketua Yayasan Cipansor",
            letter: {
              letterNumber: "002/SK/Y-CPS/VIII/2026",
              subject: "Surat Tugas",
              date: "2026-08-01",
              status: "SIGNED",
              unitName: "Yayasan Pesantren Cipansor",
            },
            signedAt: "2026-08-01T16:40:31Z",
          },
        }),
      });
    });

    await page.goto("/public/verify-letter");

    const buffer = Buffer.from(
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
    );
    await page.setInputFiles("input[type='file']", {
      name: "surat-tugas.pdf",
      mimeType: "application/pdf",
      buffer,
    });

    await page.getByRole("button", { name: /verifikasi dokumen/i }).click();

    await expect(page.getByText(/Garis Kewenangan/i)).toBeVisible();
    await expect(page.getByText(/Atas nama \(a\.n\.\)/i)).toBeVisible();
    await expect(
      page.getByText(/mewakili Ketua Yayasan Cipansor/i),
    ).toBeVisible();
  });

  test("Revoked PDF verification displays revoked notice", async ({ page }) => {
    await page.route("**/api/esign/verify-pdf", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            isValid: false,
            isRevoked: true,
            revokedAt: "2026-08-02T10:00:00Z",
            revokedReason: "Dibatalkan oleh pimpinan",
            signer: {
              name: "H. Ustadz Abdullah",
              nip: "19750202",
              position: "Sekretaris",
            },
            letter: {
              letterNumber: "002/SK/Y-CPS/VIII/2026",
              subject: "SK Pengangkatan",
              date: "2026-08-01",
              status: "REVOKED",
              unitName: "Yayasan Pesantren Cipansor",
            },
            signedAt: "2026-08-01T12:00:00Z",
          },
        }),
      });
    });

    await page.goto("/public/verify-letter");

    const buffer = Buffer.from(
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
    );
    await page.setInputFiles("input[type='file']", {
      name: "surat-revoked.pdf",
      mimeType: "application/pdf",
      buffer,
    });

    // Tidak ada langkah captcha di sini lagi. Tantangan aritmetika sudah
    // diganti Cloudflare Turnstile, dan Turnstile MATI di lingkungan e2e —
    // NEXT_PUBLIC_TURNSTILE_SITE_KEY kosong, jadi widget-nya tidak dirender
    // dan peladen (TURNSTILE_SECRET_KEY kosong) tidak menuntut token.

    await page.getByRole("button", { name: /verifikasi dokumen/i }).click();

    await expect(page.getByText(/NASKAH TELAH DICABUT/i)).toBeVisible();
    await expect(page.getByText(/Keterangan Pencabutan/i)).toBeVisible();
  });

  test("Invalid PDF displays invalid document error", async ({ page }) => {
    await page.route("**/api/esign/verify-pdf", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            isValid: false,
            isRevoked: false,
            reason:
              "Dokumen PDF ini tidak terdaftar dalam sistem resmi Yayasan Pesantren Cipansor.",
          },
        }),
      });
    });

    await page.goto("/public/verify-letter");

    const buffer = Buffer.from(
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
    );
    await page.setInputFiles("input[type='file']", {
      name: "surat-invalid.pdf",
      mimeType: "application/pdf",
      buffer,
    });

    // Tidak ada langkah captcha di sini lagi. Tantangan aritmetika sudah
    // diganti Cloudflare Turnstile, dan Turnstile MATI di lingkungan e2e —
    // NEXT_PUBLIC_TURNSTILE_SITE_KEY kosong, jadi widget-nya tidak dirender
    // dan peladen (TURNSTILE_SECRET_KEY kosong) tidak menuntut token.

    await page.getByRole("button", { name: /verifikasi dokumen/i }).click();

    await expect(page.getByText(/DOKUMEN TIDAK VALID/i)).toBeVisible();
    await expect(
      page.getByText(/tidak terdaftar dalam sistem resmi/i),
    ).toBeVisible();
  });

  test("Authenticated user can navigate to Create Letter and search participants in real flow", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");

    await page.goto("/e-office/create");
    await expect(page.locator("h1")).toContainText("Buat Surat Baru");

    await expect(page.getByLabel(/Perihal/i)).toBeVisible();
    await page.getByLabel(/Perihal/i).fill("Undangan Rapat Evaluasi E2E");

    const searchInput = page.getByPlaceholder(/Cari pejabat\/staf/i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill("Ahmad");
  });

  /**
   * Alur kewenangan penandatanganan, dari naskah sampai verifikasi publik.
   *
   * Versi sebelumnya mengganti `POST /esign/verify-pdf` dengan jawaban palsu
   * dan memeriksa render-nya. Yang dibuktikan hanya bahwa halaman dapat
   * menampilkan JSON — bukan bahwa PDF yang ditandatangani dan jawaban
   * verifikasi saling cocok, padahal itulah seluruh klaim sebuah tanda tangan.
   * Uji ini menandatangani naskah sungguhan lewat rantai yang sesungguhnya
   * (identitas → KTP → permohonan kunci → persetujuan → passphrase), mengambil
   * PDF yang ditandatangani, lalu mengunggahnya ke halaman verifikasi publik
   * dan memastikan jawabannya mengakui naskah itu sah beserta garis
   * kewenangan a.n. yang benar-benar ditandatangani.
   */
  test("signed a.n. letter verifies as valid against the real endpoint", async ({
    page,
  }) => {
    const { session } = await ensureSuperAdminSigner();

    const unit = (
      await apiRequest<{ data: Array<{ id: string }> }>(
        session,
        "GET",
        "/units",
      )
    ).data[0];
    const me = (
      await apiRequest<{ data: { id: string } }>(session, "GET", "/auth/me")
    ).data;

    const created = await apiRequest<{ data: { id: string } }>(
      session,
      "POST",
      "/correspondence/letters",
      {
        unitId: unit.id,
        direction: "OUTGOING",
        date: new Date().toISOString(),
        subject: "E2E alur kewenangan penandatanganan",
        content:
          "Naskah uji yang ditandatangani a.n. lalu diverifikasi publik.",
        urgency: "NORMAL",
        nature: "PUBLIC",
        status: "DRAFT",
        recipientName: "Pihak Eksternal",
        reviewerIds: [me.id],
      },
    );
    const letterId = created.data.id;

    await apiRequest(
      session,
      "POST",
      `/correspondence/letters/${letterId}/submit`,
      {
        reviewerIds: [me.id],
      },
    );
    await apiRequest(
      session,
      "POST",
      `/correspondence/letters/${letterId}/review`,
      {
        action: "APPROVE",
        isFinalSigner: true,
      },
    );
    await apiRequest(session, "POST", `/esign/letters/${letterId}/sign`, {
      passphrase: SIGNER_PASSPHRASE,
      signingAuthorityForm: "ATAS_NAMA",
      representedOffice: "Ketua Yayasan Cipansor",
    });

    const pdfRes = await fetch(
      `${process.env.API_URL || "http://localhost:3001/api"}/correspondence/letters/${letterId}/pdf`,
      { headers: { authorization: `Bearer ${session.accessToken}` } },
    );
    expect(pdfRes.status).toBeLessThan(400);
    const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
    expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");

    const letterNumber = (
      await apiRequest<{ data: { letterNumber: string } }>(
        session,
        "GET",
        `/correspondence/letters/${letterId}`,
      )
    ).data.letterNumber;

    await page.goto("/public/verify-letter");
    await page.setInputFiles("input[type='file']", {
      name: "surat-an.pdf",
      mimeType: "application/pdf",
      buffer: pdfBytes,
    });
    await page.getByRole("button", { name: /verifikasi dokumen/i }).click();

    // The signature is genuine and the uploaded bytes are exactly the archived
    // ones, so the public verifier must accept it.
    await expect(page.getByText(/DOKUMEN SAH & TERVERIFIKASI/i)).toBeVisible();
    await expect(page.getByText(letterNumber)).toBeVisible();
    await expect(page.getByText(/Garis Kewenangan/i)).toBeVisible();
    await expect(page.getByText(/Atas nama \(a\.n\.\)/i)).toBeVisible();
    await expect(
      page.getByText(/mewakili Ketua Yayasan Cipansor/i),
    ).toBeVisible();
  });
});
