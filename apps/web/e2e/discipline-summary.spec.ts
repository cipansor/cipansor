import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
} from "./helpers/auth-api";
import { gotoAuthedPage } from "./helpers/page-helpers";

/**
 * The cards of Pelanggaran and Penghargaan read `GET /violations/summary` and
 * `GET /rewards/summary` (#764). Before those routes existed the request fell
 * to `/:id`, answered "not found", and every card read 0. The cards must show
 * what the API counts for the same account.
 */
test.describe("Kartu ringkasan pelanggaran dan penghargaan", () => {
  test("kartu Total Pelanggaran sama dengan hitungan API", async ({ page }) => {
    test.setTimeout(120_000);
    const admin = await apiLogin(SEED_USERS.adminSdit);
    const summary = await apiRequest<{ data: { totalViolations: number } }>(
      admin,
      "GET",
      "/violations/summary",
    );
    await injectSession(page, admin);
    await gotoAuthedPage(page, "/violations", /^Pelanggaran$/);
    const card = page
      .getByText("Total Pelanggaran", { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
    await expect(card).toContainText(String(summary.data.totalViolations));
  });

  test("kartu Total penghargaan sama dengan hitungan API", async ({ page }) => {
    test.setTimeout(120_000);
    const admin = await apiLogin(SEED_USERS.adminSdit);
    const summary = await apiRequest<{ data: { totalRewards: number } }>(
      admin,
      "GET",
      "/rewards/summary",
    );
    await injectSession(page, admin);
    await gotoAuthedPage(page, "/rewards", /^Penghargaan$/);
    const card = page
      .getByText("Total", { exact: true })
      .first()
      .locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
    await expect(card).toContainText(String(summary.data.totalRewards));
  });

  test("tab perilaku santri membaca kedua ringkasan tanpa galat", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const admin = await apiLogin(SEED_USERS.adminSdit);
    const students = await apiRequest<{ data: Array<{ id: string }> }>(
      admin,
      "GET",
      "/students?limit=1",
    );
    const student = students.data[0];
    test.skip(!student, "seed tanpa santri SD IT");
    const violations = await apiRequest<{ data: { totalPoints: number } }>(
      admin,
      "GET",
      `/violations/student/${student.id}/summary`,
    );
    await injectSession(page, admin);
    await page.goto(`/students/${student.id}`);
    await page.getByRole("tab", { name: "Behavior" }).click();
    await expect(page.getByText("Ringkasan Perilaku")).toBeVisible();
    // Scoped to <main>: Playwright pierces shadow DOM, so a page-wide
    // getByRole("alert") also matches Next.js' route announcer
    // (<next-route-announcer>), which is always present.
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    const points = page
      .getByText("Poin pelanggaran", { exact: true })
      .locator("xpath=..");
    await expect(points).toContainText(String(violations.data.totalPoints));
  });
});
