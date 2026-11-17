/**
 * Sekretaris Pengurus cannot edit santri (#1020, Model A).
 *
 * The owner's decision (option A) removed `STUDENT_UPDATE` from
 * `YAYASAN_SEKRETARIS`. The roster page builds its row menu from
 * `usePermission("STUDENT_UPDATE")`, so the Sekretaris keeps the read — the
 * list still opens — but the row's *Edit* entry is gone. A unit admin, who
 * legitimately edits santri, still sees it. This spec proves the button
 * disappears for the role, and stays for the one that should have it.
 *
 * Read-only: it opens a list and a menu, and writes nothing.
 */
import { test, expect, type Page } from "@playwright/test";
import { apiLogin, injectSession } from "./helpers/auth-api";
import { DEMO_ACCOUNTS } from "../../../packages/shared/src/types/demo-accounts";

function byRole(roleCode: string) {
  const a = DEMO_ACCOUNTS.find((d) => d.roleCode === roleCode);
  if (!a) throw new Error(`No demo account for ${roleCode}`);
  return a;
}
const SEKRETARIS = byRole("YAYASAN_SEKRETARIS");
const SMP_ADMIN = byRole("SMPIT_ADMIN");

async function signIn(page: Page, who: { email: string; password: string }) {
  await injectSession(page, await apiLogin(who));
}

/** Open /students and wait for its list, so "no row" is not a race. */
async function openRoster(page: Page) {
  const listed = page.waitForResponse(
    (r) =>
      r.request().method() === "GET" &&
      new URL(r.url()).pathname.endsWith("/students") &&
      r.ok(),
  );
  await page.goto("/students");
  await listed;
}

/** Open the first row's actions menu (the trailing icon button). */
async function openRowMenu(page: Page) {
  const firstRow = page.locator("table tbody tr").first();
  await expect(firstRow).toBeVisible({ timeout: 15000 });
  await firstRow.getByRole("button").last().click();
  await expect(page.getByRole("menuitem", { name: "View" })).toBeVisible();
}

test.describe("Sekretaris Pengurus tidak boleh mengubah data santri", () => {
  test("daftar santri terbuka, tetapi barisnya tidak menawarkan Edit", async ({
    page,
  }) => {
    await signIn(page, SEKRETARIS);
    await openRoster(page);
    await openRowMenu(page);

    // The read stays: View is there for the oversight role.
    await expect(page.getByRole("menuitem", { name: "View" })).toBeVisible();
    // The write is gone.
    await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
  });

  test("admin unit masih melihat Edit pada baris yang sama", async ({
    page,
  }) => {
    await signIn(page, SMP_ADMIN);
    await openRoster(page);
    await openRowMenu(page);

    await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  });
});
