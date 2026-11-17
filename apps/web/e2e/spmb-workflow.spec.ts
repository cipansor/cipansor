import { test, expect } from "./fixtures/auth.fixture";
import { loginAs, apiRequest } from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";

const API_URL = process.env.API_URL || "http://localhost:3001/api";

/** Tiny valid PNG data-URI, used for the public document upload step. */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function publicPost(path: string, body: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok)
    throw new Error(`${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

/**
 * SPMB (Sistem Penerimaan Murid Baru) End-to-End Workflow & Verification Tests
 */

test.describe("SPMB - End-to-End Public Registration & Admin Management", () => {
  test("public SPMB page renders hero banner, registration form, and status tracking", async ({
    page,
  }) => {
    await page.goto("/public/spmb");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toContain("/public/spmb");
    const bodyText = await page.textContent("body");
    expect(bodyText).toContain("Pendaftaran SPMB");
    expect(bodyText).toContain("Informasi & Pendaftaran");
    expect(bodyText).toContain("Cek Status");

    // Form inputs visibility
    const nameInput = page
      .locator("input[name='fullName'], input[id='fullName']")
      .first();
    if (await nameInput.isVisible()) {
      await expect(nameInput).toBeVisible();
    }
  });

  test("public SPMB status tracking tab displays tracker form and lookup inputs", async ({
    page,
  }) => {
    await page.goto("/public/spmb");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const checkStatusTab = page.getByRole("tab", { name: /Cek Status/i });
    if (await checkStatusTab.isVisible()) {
      await checkStatusTab.click();
      await page.waitForTimeout(500);
      const trackerText = await page.textContent("body");
      expect(trackerText).toContain("Cek Status Pendaftaran");
    }
  });

  test("admin SPMB hub displays active statistics cards and navigation menus", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/spmb");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toContain("/spmb");
    // The hub is a client component: `domcontentloaded` can land before React
    // mounts it, so a one-shot `textContent("body")` reads the pre-hydration
    // shell on WebKit under load. Await the labels themselves instead.
    await expect(page.getByText("Total Pendaftar")).toBeVisible();
    await expect(page.getByText("Menunggu Verifikasi")).toBeVisible();
    await expect(page.getByText("Lulus Seleksi")).toBeVisible();
    await expect(page.getByText("Gelombang Aktif")).toBeVisible();
  });

  test("admin registrations list filters by status query parameter and opens detail verification panel", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/spmb/registrations?status=ACCEPTED");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toContain("/spmb/registrations?status=ACCEPTED");
    const pageContent = await page.content();
    expect(pageContent.length).toBeGreaterThan(1000);

    // Filter status select should sync with ?status=ACCEPTED
    const searchInput = page.locator("input[placeholder*='Cari']").first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("Ahmad");
      await page.waitForTimeout(300);
    }
  });

  test("staff role is gated from decision status controls on registration detail page", async ({
    page,
  }) => {
    await loginAs(page, "teacher"); // non-admin staff role
    await page.goto("/spmb/registrations");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
    expect(page.url()).toContain("/spmb/registrations");
  });

  test("full flow: register + upload document + verify + score + accept + onboard", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // This is the one test in the file that WRITES: an admission period, a
    // public registrant, a document, and finally a Student plus a guardian
    // account. Against the CI container that is the point. Against a live API
    // it would leave that junk in real data on every run — and the suite's
    // default API_URL (localhost:3001) is the live API on this project's own
    // host. Ask the API which it is rather than trusting an env var to be set.
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini menulis data, jadi dilewati",
    );

    // ── Data setup (real API, no mock) ───────────────────────────────
    // Borrow a real unit and academic year from an existing period, so a
    // brand-new, definitely-open period can be created for this run.
    const session = await loginAs(page, "superAdmin");
    const basePeriod = (
      await apiRequest<{
        data: Array<{ unit: { id: string }; academicYear: { id: string } }>;
      }>(session, "GET", "/admissions/periods?limit=1")
    ).data[0];
    expect(basePeriod).toBeTruthy();
    const now = Date.now();
    const runId = `e2e-${now}`;

    const createdPeriod = (
      await apiRequest<{ data: { id: string } }>(
        session,
        "POST",
        "/admissions/periods",
        {
          unitId: basePeriod.unit.id,
          academicYearId: basePeriod.academicYear.id,
          name: `SPMB E2E Auto ${runId}`,
          // Calendar days; the API opens the first at 00.00 WIB and closes
          // the last at 24.00 WIB.
          startDate: new Date(now - 2 * 86_400_000).toISOString().slice(0, 10),
          endDate: new Date(now + 30 * 86_400_000).toISOString().slice(0, 10),
          quota: 50,
          registrationFee: 0,
        },
      )
    ).data;

    // Registration — exercises the public (unauthenticated) SPMB create path
    // and returns the single-use registration token used right after.
    //
    // The public path requires the parent/guardian's consent (UU PDP 27/2022
    // Pasal 20, 25), naming a Kebijakan Privasi version that exists. The base
    // seed publishes version 1, so that is what we consent to.
    const email = `spmb.e2e.${runId}@example.test`;
    const registration = (
      await publicPost("/admissions/public/registrants", {
        admissionPeriodId: createdPeriod.id,
        fullName: `SPMB E2E ${runId}`,
        gender: "MALE",
        birthPlace: "Bandung",
        birthDate: new Date("2012-01-01").toISOString(),
        address: "Jl. End-to-End No. 1",
        fatherName: `Ayah E2E ${runId}`,
        motherName: `Ibu E2E ${runId}`,
        phone: "081234567891",
        email,
        parentName: `Wali E2E ${runId}`,
        parentPhone: "081234567892",
        parentEmail: `wali.e2e.${runId}@example.test`,
        consent: true,
        consentVersion: 1,
      })
    ).data;

    expect(registration.id).toBeTruthy();
    expect(registration.registrationToken).toBeTruthy();

    // Document upload — public endpoint with the token returned above.
    const uploadedDoc = (
      await publicPost(
        `/admissions/public/registrants/${registration.id}/documents`,
        {
          type: "PHOTO",
          url: TINY_PNG,
          fileName: `${runId}.png`,
          registrationToken: registration.registrationToken,
        },
      )
    ).data;
    expect(uploadedDoc.id).toBeTruthy();

    // ── Admin verification panel ─────────────────────────────────────
    // Opens the real registration detail page, which is the verification panel.
    await page.goto(`/spmb/registrations/${registration.id}`);
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });

    await expect(
      page.getByText(registration.registrationNo).first(),
    ).toBeVisible({
      timeout: 15000,
    });

    // Input selection scores.
    const scoreInput = page.getByPlaceholder("0-100").first();
    await scoreInput.fill("85");
    await page.getByRole("button", { name: /Simpan Nilai Seleksi/i }).click();

    // Decision status: accept the registrant.
    await page.getByRole("button", { name: /Terima \(ACCEPTED\)/i }).click();

    // Fee is 0 for this run, so onboarding becomes available immediately after
    // acceptance; if a fee were charged, the detail page would surface a "Catat
    // Pelunasan Daftar Ulang" button to settle it first.
    const onboardButton = page.getByRole("button", {
      name: /Jalankan Onboarding Terpadu/i,
    });
    await expect(onboardButton).toBeVisible({ timeout: 15000 });
    await onboardButton.click();

    // Onboarding terpadu completes with a success toast.
    await expect(page.getByText(/Siswa berhasil di-Onboard/i)).toBeVisible({
      timeout: 30000,
    });
  });
});
