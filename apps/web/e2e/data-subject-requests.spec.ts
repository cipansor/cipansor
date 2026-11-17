/**
 * Hak subjek data (UU PDP 27/2022 Pasal 30, 32, 40, 43) — tiga permukaan, tiga
 * cara masuk, satu alur.
 *
 * Yang diuji di sini adalah hal-hal yang tidak terbaca dari kode saja:
 *
 * 1. **Wali** mengajukan dari portal dan permintaannya benar-benar tercatat.
 *    Peladen memutuskan boleh atau tidak dari tautan `StudentParent`, jadi
 *    permukaan ini tidak punya langkah verifikasi.
 * 2. **Pendaftar SPMB tanpa akun** memakai formulir publik dua langkah:
 *    pengajuan mengembalikan nomor permintaan tanpa data subjek apa pun, dan
 *    kode yang salah ditolak tanpa memindahkan status (Pasal 33).
 * 3. **Petugas pelindungan data pribadi** membuka daftar kerja, menyaringnya,
 *    dan memindahkan status; akun tanpa `PDP_MANAGE` ditolak. Penunjukan itu
 *    tidak ikut dengan jabatan (Pasal 53), jadi yang diuji adalah penolakannya.
 *
 * `afterAll` menutup setiap permintaan yang dibuatnya lewat `REJECTED` — tidak
 * ada DELETE — sehingga menjalankannya dua kali tidak menumpuk baris terbuka.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
  type AuthSession,
} from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";
import { DEMO_ACCOUNTS } from "../../../packages/shared/src/types/demo-accounts";

const API_URL = process.env.API_URL || "http://localhost:3001/api";

function demoLogin(roleCode: string) {
  const account = DEMO_ACCOUNTS.find((a) => a.roleCode === roleCode);
  if (!account) throw new Error(`No demo account for ${roleCode}`);
  return { email: account.email, password: account.password };
}

async function signIn(page: Page, roleCode: string): Promise<AuthSession> {
  const session = await apiLogin(demoLogin(roleCode));
  await injectSession(page, session);
  return session;
}

/** Nomor pendaftaran SPMB dari basis data seed, beserta tanggal lahirnya. */
async function firstRegistrant(session: AuthSession) {
  const res = (await apiRequest(
    session,
    "GET",
    "/admissions/registrants?limit=1&page=1",
  )) as { data?: unknown[] | { data?: unknown[] } };
  const list = Array.isArray(res.data) ? res.data : res.data?.data;
  expect(list, "seed harus memuat sekurangnya satu pendaftar").toBeTruthy();
  const row = (list as Array<Record<string, unknown>>)[0];
  expect(
    row?.registrationNo,
    "pendaftar harus punya nomor pendaftaran",
  ).toBeTruthy();
  expect(row?.birthDate, "pendaftar harus punya tanggal lahir").toBeTruthy();
  return {
    registrationNo: String(row.registrationNo),
    birthDate: String(row.birthDate).slice(0, 10),
  };
}

test.describe.configure({ mode: "serial" });

test.describe("Hak subjek data pribadi", () => {
  const stamp = Date.now().toString(36);
  const cleanup: Array<{ id: string; session: AuthSession }> = [];

  test.beforeAll(async () => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini menulis permintaan, jadi dilewati",
    );
  });

  test.afterAll(async () => {
    for (const { id, session } of cleanup) {
      await apiRequest(
        session,
        "PATCH",
        `/data-subject-requests/${id}/status`,
        {
          status: "REJECTED",
          note: `Dibersihkan setelah uji e2e (${stamp})`,
        },
      ).catch(() => undefined);
    }
  });

  test("wali mengajukan permintaan dan melihatnya di daftar", async ({
    page,
  }) => {
    const wali = await signIn(page, "SMPIT_ORANG_TUA");
    const detail = `Minta salinan data pribadi anak (e2e ${stamp})`;

    await page.goto("/parent/permintaan-data", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Permintaan Data Pribadi" }),
    ).toBeVisible();

    await page.getByLabel("Jenis permintaan").click();
    await page.getByRole("option", { name: "Akses dan salinan data" }).click();
    await page.getByLabel("Hubungan dengan subjek").fill("Ayah");
    await page.getByLabel("Rincian permintaan").fill(detail);
    await page.getByRole("button", { name: "Kirim permintaan" }).click();

    await expect(page.getByText("Permintaan Anda tercatat")).toBeVisible({
      timeout: 15000,
    });

    // Barisnya muncul di daftar "Permintaan saya" — inilah yang membuktikan
    // permintaan tercatat, bukan sekadar toast yang lewat.
    const row = page
      .getByRole("row")
      .filter({ hasText: "Akses dan salinan data" });
    await expect(row.first()).toBeVisible({ timeout: 15000 });
    await expect(row.first()).toContainText("Diterima");

    const requestNo = (
      await row
        .first()
        .getByText(/^DSR-\d{4}-\d+$/)
        .innerText()
    ).trim();

    const mine = (await apiRequest(
      wali,
      "GET",
      "/data-subject-requests/mine",
    )) as { data?: Array<{ id: string; requestNo: string }> };
    const created = (mine.data ?? []).find((r) => r.requestNo === requestNo);
    expect(created, "permintaan wali harus tercatat di API").toBeTruthy();
    cleanup.push({ id: created!.id, session: wali });
  });

  test("pendaftar SPMB mengajukan lewat formulir publik; kode yang salah ditolak", async ({
    page,
  }) => {
    const officer = await apiLogin(SEED_USERS.superAdmin);
    const registrant = await firstRegistrant(officer);
    const detail = `Permintaan akses data pendaftaran (e2e ${stamp})`;

    await page.goto("/public/permintaan-data", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Permintaan Data Pribadi" }),
    ).toBeVisible();

    await page
      .getByLabel("Nomor pendaftaran SPMB")
      .fill(registrant.registrationNo);
    await page.getByLabel("Tanggal lahir pendaftar").fill(registrant.birthDate);
    await page.getByLabel("Nama Anda").fill(`Pemohon e2e ${stamp}`);
    await page
      .getByLabel("Email atau nomor telepon Anda")
      .fill("pemohon.e2e@example.com");
    await page.getByLabel("Rincian permintaan").fill(detail);
    await page.getByRole("button", { name: "Kirim permintaan" }).click();

    // Langkah pertama tidak mengungkap data subjek apa pun — hanya nomor
    // permintaan dan ke mana kode dikirim.
    const requestNo = (
      await page
        .getByText(/^DSR-\d{4}-\d+$/)
        .first()
        .innerText({ timeout: 15000 })
    ).trim();
    expect(requestNo).toMatch(/^DSR-/);

    // Kode dikirim ke kontak TERDAFTAR, bukan kontak yang dituliskan pemohon;
    // di sini kodenya tidak dibaca sama sekali — yang diuji adalah bahwa kode
    // yang salah TIDAK membuka apa pun.
    await page.getByRole("tab", { name: /Masukkan kode verifikasi/i }).click();
    // Id langsung: label "Kode verifikasi" juga menamai panel tab-nya, jadi
    // `getByLabel` cocok dengan dua elemen.
    await page.locator("#dsr-verifyRequestNo").fill(requestNo);
    await page.locator("#dsr-verifyCode").fill("000000");
    await page.getByRole("button", { name: "Verifikasi" }).click();
    await expect(
      // Toast Sonner menggandakan teks yang sama, jadi yang pertama saja.
      page.getByText("Kode verifikasi tidak berlaku").first(),
    ).toBeVisible({
      timeout: 15000,
    });

    const list = (await apiRequest(
      officer,
      "GET",
      "/data-subject-requests?limit=100",
    )) as { data?: Array<{ id: string; requestNo: string; status: string }> };
    const created = (list.data ?? []).find((r) => r.requestNo === requestNo);
    expect(created, "permintaan publik harus tercatat").toBeTruthy();
    expect(
      created!.status,
      "kode yang salah tidak boleh memindahkan status",
    ).toBe("RECEIVED");
    cleanup.push({ id: created!.id, session: officer });
  });

  test("petugas menyaring daftar kerja dan memindahkan status", async ({
    page,
  }) => {
    const officer = await apiLogin(SEED_USERS.superAdmin);

    // Dibuat lewat API supaya uji ini tidak bergantung pada urutan uji di atas.
    const created = (await apiRequest(
      officer,
      "POST",
      "/data-subject-requests",
      {
        type: "RECTIFICATION",
        subjectCategory: "GUARDIAN",
        detail: `Perbaiki ejaan nama (e2e ${stamp})`,
      },
    )) as { data?: { id: string; requestNo: string } };
    expect(created.data?.id).toBeTruthy();
    const id = created.data!.id;
    cleanup.push({ id, session: officer });

    await injectSession(page, officer);
    await page.goto("/settings/permintaan-data", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Permintaan Data Pribadi" }),
    ).toBeVisible();

    // Penyaring status menyempitkan daftar, dan baris yang dicari tetap ada.
    await page.getByLabel("Saring status").click();
    await page.getByRole("option", { name: "Diterima" }).click();
    const row = page
      .getByRole("row")
      .filter({ hasText: created.data!.requestNo });
    await expect(row).toBeVisible({ timeout: 15000 });

    await row.getByRole("link", { name: /Buka permintaan/i }).click();
    await expect(page).toHaveURL(new RegExp(`/settings/permintaan-data/${id}`));

    await page.getByLabel("Status berikutnya").click();
    await page.getByRole("option", { name: "Diproses" }).click();
    await page
      .getByLabel("Catatan / alasan penolakan")
      .fill(`Diperiksa (e2e ${stamp})`);
    await page.getByRole("button", { name: "Simpan status" }).click();

    await expect(page.getByText("Status permintaan diperbarui")).toBeVisible({
      timeout: 15000,
    });
    // Lencana status di halaman ini, bukan opsi di dalam dropdown pemilih:
    // setelah dipindahkan, layarnya harus menampilkan status yang baru.
    await expect(
      page.locator('[data-slot="badge"]').filter({ hasText: "Diproses" }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("akun tanpa PDP_MANAGE ditolak dari daftar petugas", async ({
    page,
  }) => {
    // Guru bukan petugas pelindungan data pribadi; penunjukan itu tidak ikut
    // dengan jabatan (Pasal 53).
    await signIn(page, "SMPIT_GURU");
    await page.goto("/settings/permintaan-data", {
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveURL(/\/unauthorized/, { timeout: 15000 });
  });

  test("pemohon anonim tidak dapat membaca daftar permintaan", async ({
    request,
  }) => {
    const res = await request.get(`${API_URL}/data-subject-requests`);
    expect(res.status()).toBe(401);
  });
});
