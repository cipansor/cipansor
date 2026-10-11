import { test, expect, type Page } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
  type AuthSession,
} from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";
import { gotoAuthedPage } from "./helpers/page-helpers";

/**
 * Certificates — the download and verification flows users actually click.
 *
 * The list and detail pages stopped opening a stored `pdfUrl` and now fetch the
 * bytes from the scoped `/certificates/:id/download` route; the public
 * verification page stopped linking to the sanad *verification form* and now
 * downloads the real PDF from the session-free
 * `/certificates/public/:code/download`. The access-control fix that made the
 * public route answer only for an `isPublic` certificate is pinned here too: a
 * private certificate must not verify and must not download, and it must answer
 * exactly as an unknown number does so the route cannot confirm its existence.
 *
 * These are real browser flows, not mocked handlers: the download assertion
 * reads the bytes Playwright received and checks the `%PDF-` header.
 */

/** The seeded public certificate (`prisma/seed.ts`). */
const PUBLIC_NUMBER = "CERT-TFZ-30-2024001";

/**
 * The portal's verification page. It is the page the Devin finding points at
 * (`/certificates/verify/:code`), and it lives inside the portal, so it needs a
 * session — the *printed* QR opens `/public/verify-sanad` instead, which is a
 * different, genuinely session-free page. Signed in, it is the same code the
 * recipient's download button runs, and the private/unknown assertions below do
 * not depend on who is signed in.
 */
test.describe("Sertifikat publik — verifikasi dan unduh", () => {
  let session: AuthSession;

  test.beforeAll(async () => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini membaca data, jadi dilewati",
    );
    session = await apiLogin(SEED_USERS.superAdmin);
  });

  test("halaman verifikasi mengunduh PDF asli, bukan membuka formulir verifikasi", async ({
    page,
  }) => {
    await injectSession(page, session);
    await page.goto(`/certificates/verify/${PUBLIC_NUMBER}`);
    // CardTitle renders a `div`, not an ARIA heading.
    await expect(page.getByText("Sertifikat Terverifikasi")).toBeVisible();

    // The button fetches the file, not `/public/verify-sanad` — the bug was a
    // download action that only re-opened the verification form.
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Unduh Sertifikat" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

    // The bytes are a PDF, not a redirect page or a JSON error envelope.
    const stream = await download.createReadStream();
    const first = await new Promise<Buffer>((resolve, reject) => {
      stream.once("data", (chunk: Buffer) => resolve(chunk));
      stream.once("error", reject);
    });
    expect(first.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("nomor yang tidak dikenal ditolak dan tidak menawarkan unduhan", async ({
    page,
  }) => {
    await injectSession(page, session);
    await page.goto("/certificates/verify/THIS-IS-NOT-A-CERTIFICATE");
    await expect(page.getByText("Sertifikat Tidak Valid")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Unduh Sertifikat" }),
    ).toHaveCount(0);
  });

  test("nomor yang mengandung garis miring tetap terverifikasi", async ({
    page,
  }) => {
    await injectSession(page, session);

    // `POST /certificates` mints `OTH/09/2026/<hex>` — slashes and all. The
    // route segment must be percent-encoded or Express splits it and the page
    // reports "tidak valid" for a certificate that plainly exists.
    const anyStudent = await apiRequest<{ data: Array<{ id: string }> }>(
      session,
      "GET",
      "/students?limit=1",
    );
    const created = await apiRequest<{
      data: { id: string; certificateNumber: string };
    }>(session, "POST", "/certificates", {
      studentId: anyStudent.data[0]?.id,
      certificateType: "OTHER",
      title: "Sertifikat Publik (uji garis miring)",
      issueDate: new Date().toISOString(),
      signatoryName: "Uji Akses",
      signatoryTitle: "Penguji",
      isPublic: true,
    });
    const number = created.data.certificateNumber;
    expect(number).toContain("/");

    try {
      await page.goto(`/certificates/verify/${encodeURIComponent(number)}`);
      await expect(page.getByText("Sertifikat Terverifikasi")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Unduh Sertifikat" }),
      ).toBeVisible();
    } finally {
      await apiRequest(session, "DELETE", `/certificates/${created.data.id}`);
    }
  });
});

/**
 * The private/unknown half of the same route, driven through the API the page
 * calls. The API is asked directly because the seed exposes no private
 * certificate to click, and the property under test — a private number is
 * indistinguishable from an unknown one — is exactly what a browser would see.
 *
 * The private fixture is a certificate this test *creates* and deletes, not the
 * seeded `PUBLIC_NUMBER` toggled private and restored. Playwright runs files
 * fully parallel, and another test here downloads `PUBLIC_NUMBER`; flipping a
 * shared row made the two race, and a failed restore leaked into every later
 * test. A cert minted for this test and removed in `finally` touches no shared
 * state.
 */
test.describe("Sertifikat privat — akses publik ditolak", () => {
  test.beforeAll(async () => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini membaca/menulis data, jadi dilewati",
    );
  });

  test("nomor privat tidak terverifikasi dan tidak terunduh, persis seperti nomor tak dikenal", async ({
    page,
  }) => {
    const session = await apiLogin(SEED_USERS.superAdmin);
    await injectSession(page, session);

    // Borrow a real student but mint a private certificate for this test alone.
    const anyStudent = await apiRequest<{ data: Array<{ id: string }> }>(
      session,
      "GET",
      "/students?limit=1",
    );
    const studentId = anyStudent.data[0]?.id;
    expect(studentId, "seed should provide a student").toBeTruthy();

    const created = await apiRequest<{
      data: { id: string; certificateNumber: string };
    }>(session, "POST", "/certificates", {
      studentId,
      certificateType: "OTHER",
      title: "Sertifikat Internal (uji akses publik)",
      issueDate: new Date().toISOString(),
      signatoryName: "Uji Akses",
      signatoryTitle: "Penguji",
      isPublic: false,
    });
    const privateNumber = created.data.certificateNumber;
    expect(privateNumber, "create should return a number").toBeTruthy();

    try {
      // A certificate number may itself contain slashes (`OTH/09/2026/…`), so
      // the path segment has to be percent-encoded — the same way the web
      // download hook builds it — or Express reads each slash as a new
      // segment and the route never matches ("route not found").
      const code = encodeURIComponent(privateNumber);

      // Verification: the public answer is `valid: false`, byte-for-byte the
      // same shape an unknown number gets — no holder, unit or grade.
      const privateVerify = await apiRequest<{
        data: { valid: boolean; certificate?: unknown; message?: string };
      }>(session, "GET", `/certificates/verify/${code}`);
      const unknownVerify = await apiRequest<typeof privateVerify>(
        session,
        "GET",
        "/certificates/verify/NO-SUCH-NUMBER-0000",
      );
      expect(privateVerify.data.valid).toBe(false);
      expect(privateVerify.data.certificate).toBeFalsy();
      expect(privateVerify.data.message).toBe(unknownVerify.data.message);

      // Download: the public PDF route must 404 a private certificate.
      const download = await fetch(
        `${process.env.API_URL || "http://localhost:3001/api"}/certificates/public/${code}/download`,
      );
      expect(download.status).toBe(404);
    } finally {
      await apiRequest(session, "DELETE", `/certificates/${created.data.id}`);
    }
  });
});

/**
 * The authenticated list → detail → download chain. A regression here (a
 * download button that toasts an error, a detail page that does not open)
 * would otherwise only be caught by a human clicking through.
 */
test.describe("Sertifikat — daftar dan detail mengunduh PDF", () => {
  let session: AuthSession;

  test.beforeAll(async () => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini melewati data produksi",
    );
    session = await apiLogin(SEED_USERS.superAdmin);
  });

  const signIn = (page: Page) => injectSession(page, session);

  test("daftar sertifikat mengunduh PDF dari baris", async ({ page }) => {
    await signIn(page);
    await gotoAuthedPage(page, "/certificates", /Sertifikat Digital/i);

    // The per-row action trigger is an icon-only button; open it, then choose
    // Download PDF from the menu. The menu is a Radix popover that animates in,
    // so wait for the item to be visible before clicking — a bare click right
    // after opening it races the mount under CI load ("element not stable").
    await page.locator("table tbody tr").first().getByRole("button").click();
    const downloadItem = page.getByRole("menuitem", { name: "Download PDF" });
    await expect(downloadItem).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await downloadItem.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^sertifikat-.*\.pdf$/i);
  });

  test("detail sertifikat mengunduh PDF dari kartu aksi", async ({ page }) => {
    await signIn(page);

    const list = await apiRequest<{ data: Array<{ id: string }> }>(
      session,
      "GET",
      "/certificates?limit=1",
    );
    const id = list.data[0]?.id;
    expect(id, "seed should provide a certificate").toBeTruthy();

    // A larger timeout: under CI load `next dev` compiles this route on its
    // first hit, and 15s is not always enough for the cold compile + fetch.
    await gotoAuthedPage(
      page,
      `/certificates/${id}`,
      /Detail Sertifikat/i,
      30000,
    );

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  });
});

/**
 * The address a printed certificate's QR actually opens.
 *
 * `certificateVerificationUrl` embeds `config.publicSiteUrl`, so the recipient
 * lands on the apex (`cipansor.or.id`) — a host this suite never otherwise
 * visits. The other specs run on `localhost`, where `hostSplitActionFor`
 * deliberately returns null, so a regression in the matcher or the host split
 * would leave the printed link broken with every spec still green.
 *
 * The split is a `proxy.ts`/`middleware.ts` concern, and **`next dev` under
 * Turbopack does not run it** — verified: on `pnpm dev` even `/dashboard` with
 * no session answers 200, while a production build (`next start`, what CI runs)
 * answers 404 for the apex and 307 for the session wall. A probe request tells
 * the two apart, and the test skips where the split cannot run rather than
 * asserting something that is not there.
 */
test.describe("Halaman verifikasi sanad publik — host publik", () => {
  /** The split runs only when the proxy/middleware is active (production). */
  async function splitIsActive(
    request: import("@playwright/test").APIRequestContext,
  ): Promise<boolean> {
    const webUrl = process.env.WEB_URL || "http://localhost:3000";
    // An unknown host is left alone by the split, so it hits the session wall
    // and redirects to /login. With the proxy off it reaches the page and 200s.
    const probe = await request.get(`${webUrl}/dashboard`, {
      headers: { host: "__split_probe__.invalid" },
      maxRedirects: 0,
    });
    return probe.status() >= 300 && probe.status() < 400;
  }

  test("the printed address resolves on the apex and the split holds", async ({
    request,
  }) => {
    const webUrl = process.env.WEB_URL || "http://localhost:3000";
    const splitActive = await splitIsActive(request);

    // Locally, `pnpm dev` (Turbopack) does not run the proxy, so skip visibly
    // rather than assert nothing. In CI `playwright.config.ts` runs `pnpm start`
    // (a production build) where the split must be active — a skip there would
    // hide the very regression this test exists to catch, so it fails instead.
    test.skip(
      !splitActive && !process.env.CI,
      "host split inactive (next dev)",
    );
    expect(
      splitActive,
      "host split must be active in CI (production build)",
    ).toBe(true);

    // The printed QR's page answers on the apex with no session — the whole
    // point of the host split.
    const printed = await request.get(`${webUrl}/public/verify-sanad`, {
      headers: { host: "cipansor.or.id" },
      maxRedirects: 0,
    });
    expect(printed.status()).toBe(200);

    // The control that proves the split is doing the work: an application path
    // on the same host is a 404, not the login form (which is what the apex
    // used to serve, and what got the Ad Grants application rejected).
    const appPath = await request.get(`${webUrl}/dashboard`, {
      headers: { host: "cipansor.or.id" },
      maxRedirects: 0,
    });
    expect(appPath.status()).toBe(404);
  });
});
