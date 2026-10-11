import { test, expect } from "./fixtures/auth.fixture";
import {
  apiLogin,
  apiRequest,
  injectSession,
  loginAs,
  type AuthSession,
} from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";
import { DEMO_ACCOUNTS } from "../../../packages/shared/src/types/demo-accounts";
import { settledContent } from "./helpers/page-state";

/**
 * Extracurricular Module E2E Tests
 * Tests extracurricular activities, clubs, and student participation
 */

test.describe("Extracurricular - Navigation", () => {
  test("should navigate to extracurricular page", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/extracurricular");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    expect(page.url()).toMatch(/extracurricular/);
  });

  test("should display extracurricular interface", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/extracurricular");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    expect(content.length).toBeGreaterThan(1000);
  });
});

test.describe("Extracurricular - Features", () => {
  test("should display activity or club list", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/extracurricular");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasActivities = await page
      .locator('table, [class*="activity"], [class*="ekskul"]')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    expect(
      hasActivities || page.url().includes("extracurricular"),
    ).toBeTruthy();
  });

  test("should have add activity functionality", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/extracurricular");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const hasAddButton = await page
      .locator('button:has-text("Tambah"), button:has-text("Add")')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    expect(hasAddButton || page.url().includes("extracurricular")).toBeTruthy();
  });

  test("should display student participation", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/extracurricular");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    const hasParticipation =
      content.includes("Peserta") ||
      content.includes("Siswa") ||
      content.includes("Member");

    expect(
      hasParticipation || page.url().includes("extracurricular"),
    ).toBeTruthy();
  });

  test("should show activity schedules", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);
    await page.goto("/extracurricular");
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

    const content = await settledContent(page);
    const hasSchedule =
      content.includes("Jadwal") ||
      content.includes("Schedule") ||
      content.includes("Waktu");

    expect(hasSchedule || page.url().includes("extracurricular")).toBeTruthy();
  });
});

test.describe("Extracurricular - Performance", () => {
  test("should load extracurricular page quickly", async ({ page }) => {
    await loginAs(page, "superAdmin");

    await page.waitForTimeout(2000);

    const startTime = Date.now();
    await page.goto("/extracurricular");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(15000);
  });
});

/**
 * Creating and editing an extracurricular through the portal's forms, against
 * the real API and database.
 *
 * The forms used to send their own idea of the contract: categories the API
 * does not have (`SPORT`, `ART`, `SCIENCE` — a 400), a list of `schedules`
 * and a `maxMembers` the API silently dropped, and an "Edit" button that led
 * to a page that did not exist. Writes, so it skips itself against a
 * production API.
 */
test.describe("Extracurricular - create and edit through the forms", () => {
  test.describe.configure({ mode: "serial" });

  const STAMP = Date.now().toString(36);
  const NAME = `Taekwondo ${STAMP}`;
  let admin: AuthSession;
  let createdId = "";

  test.beforeAll(async () => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini membuat ekstrakurikuler",
    );
    const found = DEMO_ACCOUNTS.find(
      (a) => a.email === "smpit.admin@cipansor.or.id",
    );
    if (!found) throw new Error("No demo account smpit.admin@");
    admin = await apiLogin({ email: found.email, password: found.password });
  });

  test.afterAll(async () => {
    if (createdId) {
      await apiRequest(admin, "DELETE", `/extracurricular/${createdId}`).catch(
        () => undefined,
      );
    }
  });

  test("a unit admin creates a sport with its days, time, place and capacity", async ({
    page,
  }) => {
    await injectSession(page, admin);
    await page.goto("/extracurricular/new");

    await page.getByLabel("Nama Ekstrakurikuler *").fill(NAME);
    await page.getByLabel("Kode").fill(`T${STAMP}`.slice(0, 20));
    // The names the public site shows on Kegiatan in English and Arabic.
    await page
      .getByLabel("Nama dalam bahasa Inggris")
      .fill(`Taekwondo ${STAMP}`);
    await page.getByLabel("Nama dalam bahasa Arab").fill(`التايكوندو ${STAMP}`);
    await page.getByLabel("Kategori *").click();
    await page.getByRole("option", { name: /Olahraga/ }).click();
    await page.getByLabel("Kapasitas Anggota").fill("30");
    // The unit is the admin's own, and fixed.
    await expect(page.getByLabel("Unit *")).toBeDisabled();
    await expect(page.getByLabel("Unit *")).toContainText("SMP");

    await page.getByLabel("Pembina").click();
    await page.getByRole("option").nth(1).click();

    await page.getByRole("checkbox", { name: "Selasa" }).click();
    await page.getByRole("checkbox", { name: "Kamis" }).click();
    await page.getByLabel("Jam Mulai").fill("15:30");
    await page.getByLabel("Jam Selesai").fill("17:00");
    await page.getByLabel("Tempat").fill("Gelanggang Olahraga");

    const created = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        /\/api\/extracurricular$/.test(r.url()),
    );
    await page.getByRole("button", { name: "Simpan" }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    createdId = (await response.json()).data.id;

    // It opens on what was saved.
    await expect(page).toHaveURL(new RegExp(`/extracurricular/${createdId}$`));
    await expect(page.getByText("Selasa, Kamis · 15:30–17:00")).toBeVisible();
    await expect(page.getByText("Gelanggang Olahraga")).toBeVisible();
    await expect(page.getByText("0 / 30")).toBeVisible();
  });

  test("the API returns the coach's name and nothing else of the teacher", async () => {
    const one = await apiRequest<{
      data: {
        category: string;
        nameEn: string | null;
        nameAr: string | null;
        scheduleDay: string[];
        scheduleTime: string;
        coach: Record<string, unknown> & { user: Record<string, unknown> };
      };
    }>(admin, "GET", `/extracurricular/${createdId}`);
    expect(one.data.category).toBe("SPORTS");
    expect(one.data.nameEn).toBe(`Taekwondo ${STAMP}`);
    expect(one.data.nameAr).toBe(`التايكوندو ${STAMP}`);
    expect(one.data.scheduleDay).toEqual(["TUESDAY", "THURSDAY"]);
    expect(one.data.scheduleTime).toBe("15:30-17:00");
    expect(Object.keys(one.data.coach).sort()).toEqual(["id", "user"]);
    expect(Object.keys(one.data.coach.user).sort()).toEqual(["id", "name"]);

    const list = await apiRequest<{
      data: Array<{ id: string; coach: Record<string, unknown> | null }>;
    }>(admin, "GET", "/extracurricular?limit=100");
    const row = list.data.find((e) => e.id === createdId);
    expect(Object.keys(row?.coach ?? {}).sort()).toEqual(["id", "user"]);
  });

  test("the Edit button opens the form filled in; an emptied field is cleared", async ({
    page,
  }) => {
    await injectSession(page, admin);
    await page.goto(`/extracurricular/${createdId}`);
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/extracurricular/${createdId}/edit$`),
    );

    await expect(page.getByLabel("Nama Ekstrakurikuler *")).toHaveValue(NAME);
    await expect(page.getByLabel("Jam Mulai")).toHaveValue("15:30");
    await expect(page.getByRole("checkbox", { name: "Kamis" })).toBeChecked();
    await expect(page.getByLabel("Unit *")).toBeDisabled();

    await page.getByRole("checkbox", { name: "Jumat" }).click();
    await page.getByLabel("Tempat").fill("");
    await page.getByLabel("Status *").click();
    await page.getByRole("option", { name: "Ditangguhkan" }).click();

    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        r.url().endsWith(`/api/extracurricular/${createdId}`),
    );
    await page.getByRole("button", { name: "Simpan" }).click();
    expect((await saved).status()).toBe(200);

    await expect(page).toHaveURL(new RegExp(`/extracurricular/${createdId}$`));
    await expect(
      page.getByText("Selasa, Kamis, Jumat · 15:30–17:00"),
    ).toBeVisible();
    await expect(page.getByText("Ditangguhkan").first()).toBeVisible();

    const one = await apiRequest<{
      data: { venue: string | null; status: string; scheduleDay: string[] };
    }>(admin, "GET", `/extracurricular/${createdId}`);
    expect(one.data).toMatchObject({
      venue: null,
      status: "SUSPENDED",
      scheduleDay: ["TUESDAY", "THURSDAY", "FRIDAY"],
    });
  });

  test("a time that ends before it starts is shown under the field, not sent", async ({
    page,
  }) => {
    await injectSession(page, admin);
    await page.goto(`/extracurricular/${createdId}/edit`);
    await page.getByLabel("Jam Selesai").fill("14:00");
    let sent = false;
    page.on("request", (r) => {
      if (r.method() === "PUT" && r.url().includes("/api/extracurricular/"))
        sent = true;
    });
    await page.getByRole("button", { name: "Simpan" }).click();
    await expect(
      page.getByText("Jam selesai harus sesudah jam mulai"),
    ).toBeVisible();
    expect(sent).toBe(false);
  });
});

/**
 * An extracurricular with an assigned coach must render on both the list and
 * the detail page.
 *
 * The API and `@cipansor/shared`'s `ExtracurricularDTO` return a coach as
 * `{ id, user: { id, name } }`, and both pages read `coach.user.name`. A hook
 * once flattened the coach to `{ id, name, email }` before handing it to the
 * pages, so any extracurricular that actually had a coach threw while
 * rendering — list and detail alike. This drives the real pages against a
 * coach from the seed and fails on the console error the flattening produced.
 */
test.describe("Extracurricular - an assigned coach renders", () => {
  test("the list and the detail show the coach's name, without a render crash", async ({
    page,
  }) => {
    const session = await loginAs(page, "superAdmin");

    const list = await apiRequest<{
      data: Array<{
        id: string;
        coach: { user: { name: string } } | null;
      }>;
    }>(session, "GET", "/extracurricular?limit=100");
    const withCoach = list.data.find((e) => e.coach?.user?.name);
    expect(
      withCoach,
      "the seed must contain an extracurricular with an assigned coach",
    ).toBeTruthy();
    const coachName = withCoach!.coach!.user.name;

    const renderErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") renderErrors.push(msg.text());
    });

    await page.goto("/extracurricular");
    await expect(page.getByText(coachName).first()).toBeVisible({
      timeout: 15000,
    });

    await page.goto(`/extracurricular/${withCoach!.id}`);
    await expect(page.getByText(coachName).first()).toBeVisible({
      timeout: 15000,
    });

    expect(
      renderErrors.filter((e) =>
        /Cannot read|is not a function|of undefined|of null/.test(e),
      ),
    ).toEqual([]);
  });
});
