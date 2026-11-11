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
 *
 * The weighing it writes is removed again through the same page (the row's
 * Hapus button): every browser project runs this spec, and `useGrowthRecords`
 * reads only the 100 newest records, so an uncleaned run would push the seeded
 * history out of the nurse's view.
 */
function account(roleCode: string) {
  const found = DEMO_ACCOUNTS.find((a) => a.roleCode === roleCode);
  if (!found) throw new Error(`No demo account for ${roleCode}`);
  return found;
}

/** A class of the account's own unit with a santri that already has a weighing. */
async function findSeeded(
  session: Awaited<ReturnType<typeof apiLogin>>,
  unitId?: string | null,
) {
  const scope = unitId ? `unitId=${unitId}&` : "";
  const { data: classes } = await apiRequest<{
    data: Array<{ id: string; name: string }>;
  }>(session, "GET", `/classes?${scope}limit=100`);
  expect(classes.length, "a class in the account's unit").toBeGreaterThan(0);

  let chosen:
    | {
        classId: string;
        className: string;
        studentId: string;
        studentName: string;
      }
    | undefined;
  for (const cls of classes) {
    const { data: enrollments } = await apiRequest<{
      data: Array<{ student: { id: string; user: { name: string } } }>;
    }>(session, "GET", `/classes/${cls.id}/enrollments`);
    for (const e of enrollments) {
      const { data: records } = await apiRequest<{
        data: Array<unknown>;
      }>(session, "GET", `/health/growth?studentId=${e.student.id}&limit=100`);
      if (records.length) {
        chosen = {
          classId: cls.id,
          className: cls.name,
          studentId: e.student.id,
          studentName: e.student.user.name,
        };
        break;
      }
    }
    if (chosen) break;
  }
  expect(chosen, "a santri with a growth record").toBeTruthy();
  return chosen!;
}

/** Choose the class and the santri, and wait for the history to render. */
async function openStudent(
  page: import("@playwright/test").Page,
  chosen: { className: string; studentName: string },
) {
  await page.getByRole("combobox").first().click();
  // Cross-unit readers see several classes of the same name (7A in each
  // school), so take the first match rather than tripping strict mode.
  await page.getByRole("option", { name: chosen.className }).first().click();
  await page.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: chosen.studentName }).first().click();
  await expect(page.getByText("Riwayat Pengukuran")).toBeVisible();
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
    const chosen = await findSeeded(nurse, unitId);

    await injectSession(page, nurse);
    await gotoAuthedPage(page, "/health/growth", /Pantau Tumbuh Kembang/);
    await openStudent(page, chosen);

    // The seeded weighing renders: the read path reaches the API.
    await expect(page.getByRole("cell", { name: /^\d/ }).first()).toBeVisible();

    // Record a new weighing through the dialog (the write path: cookie + CSRF).
    const notes = `Uji tumbuh ${Date.now().toString(36).toUpperCase()}`;
    try {
      await page.getByRole("button", { name: "Catat Data" }).click();
      await page.locator("#weight").fill("31.5");
      await page.locator("#height").fill("133.2");
      await page.locator("#notes").fill(notes);
      await page.getByRole("button", { name: "Simpan" }).click();
      await waitForToast(page, /tumbuh kembang berhasil disimpan/i);

      // The list invalidates and shows the new row without a reload.
      await expect(page.getByRole("cell", { name: notes })).toBeVisible();

      // Remove it again through the row's Hapus button: the page's own delete
      // path, and the cleanup. Left behind, the record would accumulate across
      // browser projects and crowd the seeded history out of the 100-record
      // window the page reads.
      const row = page.getByRole("row").filter({ hasText: notes });
      await row.getByRole("button", { name: "Hapus" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Hapus" })
        .click();
      await waitForToast(page, /tumbuh kembang berhasil dihapus/i);
      await expect(page.getByRole("cell", { name: notes })).toHaveCount(0);
    } finally {
      // If the run failed before the button, take the record out by API so a
      // red test does not leave test data behind.
      const { data: records } = await apiRequest<{
        data: Array<{ id: string; notes: string | null }>;
      }>(
        nurse,
        "GET",
        `/health/growth?studentId=${chosen!.studentId}&limit=100`,
      );
      for (const record of records) {
        if (record.notes === notes) {
          await apiRequest(
            nurse,
            "DELETE",
            `/health/growth/${record.id}`,
          ).catch(() => {});
        }
      }
    }
  });

  /**
   * The pengawas holds HEALTH_VIEW but not HEALTH_MANAGE: the route guard
   * (health.routes.ts) refuses every non-GET with 403. Before this, the write
   * controls rendered anyway and each confirmation ended in a server error, so
   * both must be hidden for a reader.
   */
  test("pengawas membaca riwayat tanpa tombol kelola", async ({ page }) => {
    test.setTimeout(120_000);
    const reader = await apiLogin(account("YAYASAN_PENGAWAS"));
    const unitId = (reader.user as { unitId: string | null }).unitId;
    const chosen = await findSeeded(reader, unitId);

    await injectSession(page, reader);
    await gotoAuthedPage(page, "/health/growth", /Pantau Tumbuh Kembang/);
    await openStudent(page, chosen);

    // The reader sees the history…
    await expect(page.getByRole("cell", { name: /^\d/ }).first()).toBeVisible();
    // …and neither write control: the API would refuse both.
    await expect(page.getByRole("button", { name: "Catat Data" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "Hapus" })).toHaveCount(0);
  });

  /**
   * The class whose unit the page could not read. The unit the record goes
   * under is derived from the chosen class (`classesData` → `unitId`); with
   * none, the create call used to leave with no unit and the API refused it.
   * Simpan must be disabled and explain why, so the call never leaves.
   *
   * A class always carries its unit (unit_id is NOT NULL in the schema), so the
   * only way to reach the state is to drop the field from the list response —
   * exactly the payload the guard is written against.
   */
  test("kelas tanpa unit termuat menonaktifkan Simpan", async ({ page }) => {
    test.setTimeout(120_000);
    const nurse = await apiLogin(account("PERAWAT"));
    const unitId = (nurse.user as { unitId: string }).unitId;
    const chosen = await findSeeded(nurse, unitId);

    await page.route("**/api/classes?**", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const cls of body.data ?? []) delete cls.unitId;
      await route.fulfill({ response, json: body });
    });

    await injectSession(page, nurse);
    await gotoAuthedPage(page, "/health/growth", /Pantau Tumbuh Kembang/);
    await openStudent(page, chosen);

    await page.getByRole("button", { name: "Catat Data" }).click();
    await expect(page.getByRole("button", { name: "Simpan" })).toBeDisabled();
  });
});
