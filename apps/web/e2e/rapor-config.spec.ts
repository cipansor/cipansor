import { test, expect } from "@playwright/test";
import { apiLogin, injectSession, SEED_USERS } from "./helpers/auth-api";
import { gotoAuthedPage } from "./helpers/page-helpers";

/**
 * Rapor configuration is stored per unit. A yayasan-level user (super admin)
 * has no unit of their own, so `user.unitId` is null and the page used to stop
 * at "Unit ID tidak ditemukan pada profil user." with the form unreachable.
 * Such a user now gets a unit picker and the real form; a unit user stays
 * pinned to their unit with no picker.
 */
test.describe("Konfigurasi Rapor Pesantren", () => {
  test("super admin tanpa unit dapat memilih unit dan melihat form", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const session = await apiLogin(SEED_USERS.superAdmin);
    await injectSession(page, session);

    await gotoAuthedPage(
      page,
      "/rapor-pesantren/config",
      /Konfigurasi Rapor Pesantren/i,
    );

    // The regression: foundation users no longer see the "no unit" dead end.
    await expect(page.getByText(/Unit ID tidak ditemukan/i)).toHaveCount(0);

    // A unit picker lets them choose which unit's config to edit.
    const unitPicker = page.getByRole("combobox", { name: "Pilih unit" });
    await expect(unitPicker).toBeVisible();
    await expect(unitPicker).not.toBeEmpty();

    // The real form renders once a unit is selected.
    await expect(page.getByText(/Bobot Penilaian/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Simpan Perubahan" }),
    ).toBeVisible();
  });

  test("admin unit terkunci ke unitnya tanpa pemilih unit", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const session = await apiLogin(SEED_USERS.adminSdit);
    await injectSession(page, session);

    await gotoAuthedPage(
      page,
      "/rapor-pesantren/config",
      /Konfigurasi Rapor Pesantren/i,
    );

    await expect(
      page.getByRole("combobox", { name: "Pilih unit" }),
    ).toHaveCount(0);
    await expect(page.getByText(/Bobot Penilaian/i)).toBeVisible();
  });
});
