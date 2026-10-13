import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth-api";

/**
 * The WhatsApp page's "Tugas Terjadwal" tab lists the registered jobs and lets
 * a super admin run one by hand (#802).
 *
 * The backend's manual-trigger endpoint validates the task id against
 * `SCHEDULED_TASK_IDS`; the page used to send ids the endpoint did not know
 * (`monthly-spp-reminder`, and cards whose ids had drifted from a rename), so
 * "Jalankan" came back an unknown task. The card list is the contract, so it is
 * asserted here against the ids the endpoint accepts.
 */

const PAGE = "/notifications/whatsapp";

test.describe("Notification scheduler — manual trigger", () => {
  test("lists every registered task and runs one through the API", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");
    await page.goto(PAGE);

    await page.getByRole("tab", { name: "Tugas Terjadwal" }).click();

    // One row per registered task; the row is the only element carrying both
    // `justify-between` and the task name, so it does not collide with the
    // wrapping Card or the left-hand text group.
    const card = (name: string) =>
      page
        .locator("div.flex.items-center.justify-between")
        .filter({ hasText: name });

    for (const name of [
      "Pengingat Pembayaran Harian",
      "Pengingat Kegiatan",
      "Ringkasan Kehadiran Harian",
      "Laporan Tahfidz Mingguan",
      "Laporan Bulanan",
      "Peringatan Anggaran Berlebih",
    ]) {
      await expect(card(name)).toBeVisible();
    }

    // The daily payment reminder is the slot the bootstrap bug kept silent;
    // clicking its button must reach the API and return a success, not the
    // "unknown task" the stale ids produced.
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/notifications/scheduler/trigger") &&
          r.request().method() === "POST",
      ),
      card("Pengingat Pembayaran Harian")
        .getByRole("button", { name: "Jalankan" })
        .click(),
    ]);

    expect(response.ok()).toBe(true);
    expect(JSON.parse(response.request().postData() ?? "{}").task).toBe(
      "payment-reminder",
    );
    await expect(
      page.getByText("Task payment-reminder executed"),
    ).toBeVisible();
  });
});
