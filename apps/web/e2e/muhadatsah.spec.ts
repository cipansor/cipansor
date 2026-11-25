import { test, expect } from "./fixtures/auth.fixture";
import {
  apiLoginNew,
  apiRequest,
  loginAs,
  SEED_USERS,
} from "./helpers/auth-api";
import { gotoAuthedPage } from "./helpers/page-helpers";

/**
 * Muhadatsah Module E2E Tests
 * Tests Arabic conversation practice module
 *
 * /muhadatsah wraps itself in MainLayout, so it renders nothing until
 * ProtectedRoute has rehydrated the session. These tests used to probe for
 * content at domcontentloaded with isVisible({ timeout }), which Playwright
 * ignores the timeout on — the probe samples the page once and returns. That
 * raced rehydration and lost on WebKit. Wait for the page's own <h1> first.
 *
 * Every action button on the list used to be inert: no onClick, no link, no
 * dialog. The detail page was reachable only by typing its URL, and "Edit"
 * pointed at a route that was never built. Each control below is driven for
 * real, so a button that stops doing something fails here instead of shipping.
 */
const HEADING = "Muhadatsah";
const NEW_HEADING = "Jadwalkan Muhadatsah";
const DETAIL_HEADING = "Detail Muhadatsah";

test.describe("Muhadatsah - Navigation", () => {
  test("should navigate to muhadatsah page", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);
    expect(page.url()).toMatch(/muhadatsah/);
  });

  test("should display muhadatsah list or empty state", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    // The stats cards and the sessions table are rendered unconditionally —
    // the table keeps its header row when there are no sessions — so both are
    // assertable without depending on what the seed happens to create.
    await expect(page.getByText("Total Sesi")).toBeVisible();

    const table = page.locator("table");
    await expect(table).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Peserta" }),
    ).toBeVisible();
  });
});

test.describe("Muhadatsah - Create", () => {
  test("should navigate to create muhadatsah page", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah/new", NEW_HEADING);
    expect(page.url()).toMatch(/muhadatsah\/new/);
  });

  test("should display create form elements", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah/new", NEW_HEADING);

    // Asserted on the rendered form rather than on page.content().length, which
    // clears 1000 characters from the Next.js script tags alone and so passed
    // even when the page body was empty.
    await expect(
      page.getByRole("button", { name: "Simpan Jadwal" }),
    ).toBeVisible();
  });

  test("Jadwalkan Muhadatsah opens the scheduling form", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    await page.getByRole("link", { name: "Jadwalkan Muhadatsah" }).click();

    await expect(
      page.getByRole("heading", { name: NEW_HEADING, level: 1 }),
    ).toBeVisible();
    expect(page.url()).toMatch(/muhadatsah\/new$/);
  });
});

test.describe("Muhadatsah - View & Evaluate", () => {
  test("should allow navigation from list to detail", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    // The seed creates sessions, so the list is never empty: the old
    // test.skip("No muhadatsah sessions seeded to open") hid a list whose rows
    // carried no link at all.
    const firstLink = page
      .getByRole("link", { name: "Lihat detail sesi muhadatsah" })
      .first();
    await expect(firstLink).toBeVisible();

    await firstLink.click();

    await expect(
      page.getByRole("heading", { name: DETAIL_HEADING, level: 1 }),
    ).toBeVisible();
    expect(page.url()).toMatch(/muhadatsah\/[^/]+$/);
  });

  test("does not offer an Edit link to the page that was never built", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    await expect(
      page.getByRole("link", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.locator('a[href*="/muhadatsah/"][href$="/edit"]'),
    ).toHaveCount(0);

    await page
      .getByRole("link", { name: "Lihat detail sesi muhadatsah" })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: DETAIL_HEADING, level: 1 }),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('a[href$="/edit"]')).toHaveCount(0);
  });

  test("Trash confirms, then deletes the session", async ({ page }) => {
    // A throwaway session of its own: the spec files run in parallel against
    // one seeded database, so deleting a seeded row would pull it out from
    // under another test.
    const session = await apiLoginNew(SEED_USERS.superAdmin);
    const existing = await apiRequest<{
      data: Array<{ unitId: string; studentId: string }>;
    }>(session, "GET", "/muhadatsah?limit=1");
    const seedRecord = existing.data[0];
    const topic = `E2E hapus ${Date.now()}`;
    const scheduledAt = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
    const created = await apiRequest<{ data: { id: string } }>(
      session,
      "POST",
      "/muhadatsah",
      {
        unitId: seedRecord.unitId,
        studentId: seedRecord.studentId,
        scheduledAt: scheduledAt.toISOString(),
        language: "English",
        topic,
      },
    );

    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    const row = page.getByRole("row").filter({ hasText: topic });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Hapus sesi muhadatsah" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();

    const deletion = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().includes(`/muhadatsah/${created.data.id}`),
    );
    await dialog.getByRole("button", { name: "Hapus" }).click();

    expect((await deletion).status()).toBe(200);
    await expect(page.getByRole("row").filter({ hasText: topic })).toHaveCount(
      0,
    );
  });
});

test.describe("Muhadatsah - Partner Matching", () => {
  test("the language dropdown changes the partners requested", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    await page.getByRole("tab", { name: "Cari Partner" }).click();

    const englishRequest = page.waitForRequest(
      (request) =>
        request.url().includes("/muhadatsah/match-partners") &&
        /[?&]language=English(&|$)/.test(request.url()),
    );

    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /Bahasa Inggris/ }).click();

    await englishRequest;
  });

  test("Pilih carries the santri into the form as the partner", async ({
    page,
  }) => {
    const session = await loginAs(page, "superAdmin");
    await gotoAuthedPage(page, "/muhadatsah", HEADING);

    await page.getByRole("tab", { name: "Cari Partner" }).click();

    const pick = page.getByRole("link", { name: "Pilih" }).first();
    await expect(pick).toBeVisible();
    const href = await pick.getAttribute("href");
    const partnerId = new URL(href!, "http://localhost").searchParams.get(
      "partnerId",
    );
    expect(partnerId).toBeTruthy();

    const partner = await apiRequest<{
      data: { name?: string; user?: { name?: string } };
    }>(session, "GET", `/students/${partnerId}`);
    const partnerName = partner.data.name ?? partner.data.user?.name;
    expect(partnerName).toBeTruthy();

    await pick.click();

    await expect(
      page.getByRole("heading", { name: NEW_HEADING, level: 1 }),
    ).toBeVisible();
    expect(page.url()).toContain(`partnerId=${partnerId}`);
    await expect(page.getByText(partnerName!).first()).toBeVisible();
  });
});

test.describe("Muhadatsah - Performance", () => {
  test("should load muhadatsah page within timeout", async ({ page }) => {
    await loginAs(page, "superAdmin");

    const startTime = Date.now();
    await gotoAuthedPage(page, "/muhadatsah", HEADING);
    expect(Date.now() - startTime).toBeLessThan(15000);
    expect(page.url()).toMatch(/muhadatsah/);
  });
});
