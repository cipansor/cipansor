import { test, expect } from "@playwright/test";
import { apiLogin, apiRequest, injectSession } from "./helpers/auth-api";
import { gotoAuthedPage, waitForToast } from "./helpers/page-helpers";
import { DEMO_ACCOUNTS } from "../../../packages/shared/src/types/demo-accounts";

/**
 * Tumbuh kembang (`/health/growth`), the way the nurse works it.
 *
 * The page used to read and write `/health/growth` with a bare `fetch`, which
 * sent no session cookie and no CSRF header — every read 401'd and every save
 * was refused, so the chart and the table stayed empty. It now goes through
 * `useGrowthRecords` / `useCreateGrowthRecord`, which ride the shared axios
 * client (cookie + CSRF) like every other call. This spec reads a seeded
 * weighing and records a new one, asserting both land in the table — the two
 * things the hook change had to make work.
 */
function account(roleCode: string) {
  const found = DEMO_ACCOUNTS.find((a) => a.roleCode === roleCode);
  if (!found) throw new Error(`No demo account for ${roleCode}`);
  return found;
}

test.describe("Tumbuh kembang — baca dan catat dari halaman", () => {
  test("perawat melihat riwayat dan mencatat penimbangan baru", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const nurse = await apiLogin(account("PERAWAT"));
    const unitId = (nurse.user as { unitId: string }).unitId;

    // A class of the nurse's own unit, and a santri in it that already has a
    // seeded weighing — so the read path has something to show.
    const { data: classes } = await apiRequest<{
      data: Array<{ id: string; name: string }>;
    }>(nurse, "GET", `/classes?unitId=${unitId}&limit=100`);
    expect(classes.length, "a class in the nurse's unit").toBeGreaterThan(0);

    let chosen:
      { classId: string; className: string; studentName: string } | undefined;
    for (const cls of classes) {
      const { data: enrollments } = await apiRequest<{
        data: Array<{ student: { id: string; user: { name: string } } }>;
      }>(nurse, "GET", `/classes/${cls.id}/enrollments`);
      for (const e of enrollments) {
        const { data: records } = await apiRequest<{
          data: Array<unknown>;
        }>(nurse, "GET", `/health/growth?studentId=${e.student.id}&limit=100`);
        if (records.length) {
          chosen = {
            classId: cls.id,
            className: cls.name,
            studentName: e.student.user.name,
          };
          break;
        }
      }
      if (chosen) break;
    }
    expect(chosen, "a santri with a growth record").toBeTruthy();

    await injectSession(page, nurse);
    await gotoAuthedPage(page, "/health/growth", /Pantau Tumbuh Kembang/);

    // The class select carries only the nurse's unit's classes.
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: chosen!.className }).click();
    await page.getByRole("combobox").nth(1).click();
    await page
      .getByRole("option", { name: chosen!.studentName })
      .first()
      .click();

    // The seeded weighing renders: the read path reaches the API.
    await expect(page.getByText("Riwayat Pengukuran")).toBeVisible();
    await expect(page.getByRole("cell", { name: /^\d/ }).first()).toBeVisible();

    // Record a new weighing through the dialog (the write path: cookie + CSRF).
    const notes = `Uji tumbuh ${Date.now().toString(36).toUpperCase()}`;
    await page.getByRole("button", { name: "Catat Data" }).click();
    await page.locator("#weight").fill("31.5");
    await page.locator("#height").fill("133.2");
    await page.locator("#notes").fill(notes);
    await page.getByRole("button", { name: "Simpan" }).click();
    await waitForToast(page, /tumbuh kembang berhasil disimpan/i);

    // The list invalidates and shows the new row without a reload.
    await expect(page.getByRole("cell", { name: notes })).toBeVisible();
  });
});
