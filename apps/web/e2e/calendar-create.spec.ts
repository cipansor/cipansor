import { test, expect } from "./fixtures/auth.fixture";
import { SEED_USERS, apiLogin, apiRequest, loginAs } from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";

/**
 * Tambah Agenda — the form that could not save (#1155).
 *
 * The page posted `category`, `recurrence` and a `recurrenceEnd`, none of which
 * the model has: `POST /calendar` reached Prisma with `eventType: undefined` and
 * answered 500 for every role, every unit. The list also rendered a blank
 * category badge, because it looked up `event.category` on a response that
 * carries `eventType`.
 *
 * These drive the real form against the real API and read the result back, so a
 * renamed field fails here and not in a teacher's browser. Writes, so it skips
 * itself against a production API.
 */

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);

interface Created {
  data: { id: string; eventType: string; startDate: string };
}
interface Listed {
  data: { id: string; title: string; eventType: string }[];
}

test.beforeAll(async () => {
  test.skip(
    await isProductionApi(),
    "menulis data; tidak dijalankan di produksi",
  );
});

test.describe("Kalender Akademik — Tambah Agenda", () => {
  test("form Tambah menyimpan agenda dengan kategori yang dipilih", async ({
    page,
  }) => {
    const title = `Ujian e2e ${STAMP}`;
    const session = await apiLogin(SEED_USERS.superAdmin);
    let createdId = "";

    try {
      await loginAs(page, "superAdmin");
      await page.goto("/calendar/events/new");

      await page.getByLabel("Judul Event *").fill(title);

      // The category is a Radix Select: its trigger carries the label's `for`.
      const categoryId = await page
        .locator("label")
        .filter({ hasText: /^Kategori \*/ })
        .first()
        .getAttribute("for");
      await page.locator(`[id="${categoryId}"]`).click();
      await page.getByRole("option", { name: /Ujian\/Asesmen/ }).click();

      await page.getByRole("button", { name: /Simpan/ }).click();

      // A successful save navigates back to the list and the row is there.
      await expect(page).toHaveURL(/\/calendar\/events$/, { timeout: 15000 });
      await expect(page.getByText(title)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText("Ujian/Asesmen").first()).toBeVisible();

      // And the API stored the category the form showed, not a default.
      const listed = await apiRequest<Listed>(
        session,
        "GET",
        "/calendar?limit=100&eventType=EXAM",
      );
      const found = listed.data.find((e) => e.title === title);
      expect(found?.eventType).toBe("EXAM");
      createdId = found!.id;
    } finally {
      if (createdId)
        await apiRequest(session, "DELETE", `/calendar/${createdId}`);
    }
  });

  test("kategori tersimpan dapat disaring dari daftar", async ({ page }) => {
    const title = `Rapat e2e ${STAMP}`;
    const session = await apiLogin(SEED_USERS.superAdmin);
    const created = await apiRequest<Created>(session, "POST", "/calendar", {
      title,
      eventType: "MEETING",
      startDate: new Date().toISOString().slice(0, 10),
      isAllDay: true,
      isPublic: true,
    });

    try {
      await loginAs(page, "superAdmin");
      await page.goto("/calendar/events");

      const filterId = await page
        .locator("label")
        .filter({ hasText: /Kategori/ })
        .first()
        .getAttribute("for")
        .catch(() => null);
      const trigger = filterId
        ? page.locator(`[id="${filterId}"]`)
        : page.getByRole("combobox").first();
      await trigger.click();
      await page.getByRole("option", { name: /^Rapat$/ }).click();

      // The filter is `eventType`: a `category` filter returned everything.
      await expect(page.getByText(title)).toBeVisible({ timeout: 15000 });
      const url = page.url();
      expect(url).not.toContain("category=");
    } finally {
      await apiRequest(session, "DELETE", `/calendar/${created.data.id}`);
    }
  });
});
