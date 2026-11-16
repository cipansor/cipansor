import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth-api";

/**
 * The Super Admin screen that publishes a new Kebijakan Privasi version
 * (UU PDP 27/2022 Pasal 30, 35).
 *
 * Menu path: Pengaturan → Kebijakan Privasi (`/settings/privacy-policy`). It
 * is the only place a version is written; the public page and the SPMB consent
 * both read what it publishes. The base seed publishes version 1, so the screen
 * shows the effective version and the history.
 */

test.describe("Pengaturan → Kebijakan Privasi (Super Admin)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "superAdmin");
  });

  test("shows the effective version, the publish form, and the version history", async ({
    page,
  }) => {
    await page.goto("/settings/privacy-policy");

    await expect(
      page.getByRole("heading", { name: "Kebijakan Privasi", level: 1 }),
    ).toBeVisible();

    // The seed's version 1 is the one in effect.
    await expect(page.getByText(/Versi 1/).first()).toBeVisible({
      timeout: 15000,
    });

    // Publishing is a new version, never an edit of the old one — the warning
    // says so, and the form's button is the only way to write.
    await expect(
      page.getByText("Versi lama tidak pernah disunting"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Terbitkan versi baru" }),
    ).toBeVisible();
  });

  test("is not reachable by a non-super-admin role", async ({ page }) => {
    // A unit admin must not publish the foundation's privacy policy; the shell
    // guards the route even though the sidebar hides the link.
    await loginAs(page, "adminSdit");
    await page.goto("/settings/privacy-policy");

    await expect(
      page.getByRole("heading", { name: "Kebijakan Privasi", level: 1 }),
    ).toHaveCount(0);
  });
});
