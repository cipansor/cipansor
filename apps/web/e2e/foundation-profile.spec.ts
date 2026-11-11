import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
} from "./helpers/auth-api";
import { gotoAuthedPage, waitForToast } from "./helpers/page-helpers";

interface Foundation {
  id: string;
  website: string | null;
}

/**
 * Profil Yayasan saves through `PUT /foundation/:id`. An emptied field used to
 * be dropped by the form, so the old value stayed while the page said
 * "berhasil"; it is now cleared. Only Super Admin, the Ketua and the
 * Sekretaris may change the profile, so only they get the Edit button.
 */
test.describe.configure({ mode: "serial" });

test.describe("Profil Yayasan", () => {
  test("mengosongkan Website benar-benar menghapusnya", async ({ page }) => {
    test.setTimeout(120_000);
    const admin = await apiLogin(SEED_USERS.superAdmin);
    const list = await apiRequest<{ data: Foundation[] }>(
      admin,
      "GET",
      "/foundation?limit=1",
    );
    const foundation = list.data[0];
    test.skip(!foundation, "seed tanpa data yayasan");
    // A known value to clear, put back afterwards.
    await apiRequest(admin, "PUT", `/foundation/${foundation.id}`, {
      website: "https://cipansor.or.id",
    });

    try {
      await injectSession(page, admin);
      await gotoAuthedPage(page, "/foundation", /^Yayasan$/);
      await page.getByRole("button", { name: "Edit" }).click();
      await page.getByLabel("Website").fill("");
      await page.getByRole("button", { name: "Simpan" }).click();
      await waitForToast(page, /berhasil diperbarui/i);

      const after = await apiRequest<{ data: Foundation[] }>(
        admin,
        "GET",
        "/foundation?limit=1",
      );
      expect(after.data[0].website).toBeNull();
    } finally {
      await apiRequest(admin, "PUT", `/foundation/${foundation.id}`, {
        website: foundation.website ?? null,
      });
    }
  });

  test("Pembina membaca profil tanpa tombol Edit", async ({ page }) => {
    test.setTimeout(120_000);
    const pembina = await apiLogin(SEED_USERS.pembina);
    await injectSession(page, pembina);
    await gotoAuthedPage(page, "/foundation", /^Yayasan$/);
    await expect(page.getByText("Profil Yayasan")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  });

  /**
   * No foundation row yet. `GET /foundation` lists foundations and the yayasan
   * has exactly one, so an empty list is the "belum ada" state: the card must
   * say so and hide Edit, rather than open a form that PUTs to an empty id.
   *
   * The seed always creates the one row and `DELETE /foundation/:id` refuses
   * while it still has units, so the state is not reachable from seed data; the
   * list is shaped to empty here, which is exactly the payload the fix guards.
   */
  test("tanpa baris yayasan: kartu menjelaskan dan Edit disembunyikan", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const admin = await apiLogin(SEED_USERS.superAdmin);
    await page.route("**/api/foundation**", async (route) => {
      const url = route.request().url();
      if (
        route.request().method() === "GET" &&
        /\/foundation(\?|$)/.test(url)
      ) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: [],
            meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await injectSession(page, admin);
    await gotoAuthedPage(page, "/foundation", /^Yayasan$/);
    await expect(page.getByText("Data yayasan belum ada")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  });
});
