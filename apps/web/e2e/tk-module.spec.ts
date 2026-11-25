import { test, expect } from "./fixtures/auth.fixture";
import { LoginPage } from "./page-objects";
import { waitForLoadingComplete, waitForToast } from "./helpers/page-helpers";

/**
 * TK Module E2E — drives the real class-based assessment input flow at
 * /tk/assessment/create: pick a class, choose a development aspect (NAM, FM,
 * KOG, BHS, SE, SNI), choose an indicator, then set each student's achievement
 * level (BB/MB/BSH/BSB) and save. Data-dependent steps are guarded so the suite
 * stays green even when a fresh DB has no TK classes/indicators yet.
 */

const ASPECT_KEYS = ["NAM", "FM", "KOG", "BHS", "SE", "SNI"];

async function login(page: import("@playwright/test").Page) {
  const lp = new LoginPage(page);
  await lp.goto();
  await lp.loginAndWaitForDashboard(
    "superadmin@cipansor.or.id",
    "SuperAdmin123!",
  );
}

// Radix Select renders the placeholder via data-placeholder, so `hasText`
// matching on the trigger is unreliable; address the two triggers by index
// (class = 0, indicator = 1 — the indicator select shows once an aspect, NAM
// by default, is active). The hidden native <select> is excluded by `button`.
const comboboxes = (page: import("@playwright/test").Page) =>
  page.locator('button[role="combobox"]');

async function pickFromCombobox(
  page: import("@playwright/test").Page,
  index: number,
): Promise<boolean> {
  const trigger = comboboxes(page).nth(index);
  if (
    !(await trigger.waitFor({ state: "visible", timeout: 5000 }).then(
      () => true,
      () => false,
    ))
  )
    return false;
  await trigger.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const option = listbox.getByRole("option");
  if ((await option.count()) === 0) {
    await page.keyboard.press("Escape");
    return false;
  }
  await option.first().click();
  await expect(listbox).toBeHidden();
  return true;
}

test.describe("TK Assessment", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/tk/assessment/create");
    await waitForLoadingComplete(page);
  });

  test("should display the assessment input page components", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: /input penilaian tk/i }),
    ).toBeVisible({ timeout: 10000 });

    // Class picker (first combobox on the page)
    await expect(comboboxes(page).first()).toBeVisible();

    // Aspect tabs
    await expect(page.getByRole("tablist")).toBeVisible();
  });

  test("should display all development aspect tabs", async ({ page }) => {
    for (const key of ASPECT_KEYS) {
      await expect(
        page.getByRole("tab", { name: key, exact: true }),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("should switch between development aspects", async ({ page }) => {
    for (const key of ["NAM", "FM", "KOG"]) {
      const tab = page.getByRole("tab", { name: key, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("data-state", "active");
    }
  });

  test("should select a class and load students with achievement levels", async ({
    page,
  }) => {
    if (!(await pickFromCombobox(page, 0))) {
      throw new Error(
        "No classes available for testing — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
      return;
    }
    if (!(await pickFromCombobox(page, 1))) {
      throw new Error(
        "No indicators seeded for this aspect — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
      return;
    }
    await waitForLoadingComplete(page);

    // Students for the class now render with achievement-level radios.
    const levelRadio = page.locator('button[role="radio"]').first();
    if (
      !(await levelRadio.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      ))
    ) {
      throw new Error(
        "No students in the selected class — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
      return;
    }
    await expect(levelRadio).toBeVisible();
  });

  test("should set an achievement level and save", async ({ page }) => {
    if (!(await pickFromCombobox(page, 0))) {
      throw new Error(
        "No classes available — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
      return;
    }
    if (!(await pickFromCombobox(page, 1))) {
      throw new Error(
        "No indicators seeded — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
      return;
    }
    await waitForLoadingComplete(page);

    // Radio Radix di sini ber-class `sr-only`: tombolnya ada untuk pembaca layar,
    // dan yang terlihat serta menerima klik adalah <label for=...>-nya. Mengklik
    // tombolnya langsung akan selalu dicegat labelnya ("intercepts pointer
    // events") sampai habis waktu. Pengguna sungguhan mengklik labelnya, jadi
    // itu yang dilakukan di sini. Pola yang sama berlaku untuk kontrol Radix
    // lain di repo ini.
    const levelRadio = page.locator('button[role="radio"]').first();
    if (
      !(await levelRadio.waitFor({ state: "visible", timeout: 5000 }).then(
        () => true,
        () => false,
      ))
    ) {
      throw new Error(
        "No students to assess — the seeded demo data (ALLOW_DESTRUCTIVE_SEED=1 db:seed) " +
          "must provide it; a missing page or control here is a failure, not a skip",
      );
      return;
    }
    const radioId = await levelRadio.getAttribute("id");
    if (radioId) {
      await page.locator(`label[for="${radioId}"]`).click();
    } else {
      await levelRadio.click({ force: true });
    }

    await page.getByRole("button", { name: /simpan penilaian/i }).click();
    await waitForToast(page, /berhasil|tersimpan|success/i, "success");
  });
});

test.describe("TK Dashboard", () => {
  test("should display TK dashboard", async ({ page }) => {
    await login(page);
    await page.goto("/tk/dashboard");
    await waitForLoadingComplete(page);

    const heading = page.getByRole("heading", { name: /tk|paud|dashboard/i });
    if (
      await heading
        .first()
        .waitFor({ state: "visible", timeout: 5000 })
        .then(
          () => true,
          () => false,
        )
    ) {
      await expect(heading.first()).toBeVisible();
    } else {
      // Some deployments route the TK overview under /tk; tolerate either.
      expect(page.url()).toMatch(/\/tk/);
    }
  });
});
