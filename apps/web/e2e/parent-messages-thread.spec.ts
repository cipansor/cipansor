import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
} from "./helpers/auth-api";
import { gotoAuthedPage } from "./helpers/page-helpers";

/**
 * Pesan wali (`/parent/messages`) reads the `messages` module, the same store
 * Buku Penghubung and the wali kelas write to. A wali who writes first is the
 * sender of the thread's first message; the guru's reply to them used to stay
 * unread for good, and the list showed the first message, not the last.
 */
test.describe("Pesan wali — utas yang dimulai wali", () => {
  test("balasan wali kelas tampil sebagai pesan baru, lalu terbaca saat dibuka", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const parent = await apiLogin(SEED_USERS.parent);
    const teacher = await apiLogin(SEED_USERS.teacher);
    const subject = `Uji utas wali ${Date.now()}`;
    const reply = `Baik, Pak. Terima kasih ${Date.now()}`;

    const opened = await apiRequest<{ data: { id: string } }>(
      parent,
      "POST",
      "/messages",
      {
        recipientId: teacher.user.id,
        subject,
        content: "Assalamu'alaikum, anak kami izin besok.",
        category: "GENERAL",
      },
    );
    await apiRequest(teacher, "POST", `/messages/${opened.data.id}/reply`, {
      content: reply,
    });

    await injectSession(page, parent);
    await gotoAuthedPage(page, "/parent/messages", /^Pesan$/);

    const row = page.getByText(subject).locator("xpath=ancestor::div[2]");
    await expect(row).toBeVisible();
    // The list shows the newest message of the thread, and that it is new.
    await expect(row.getByText(reply)).toBeVisible();
    await expect(row.getByText("Baru")).toBeVisible();

    await row.click();
    await expect(page.getByText(reply).last()).toBeVisible();
    // Opening it reads the reply: the badge goes and stays gone.
    await expect(row.getByText("Baru")).toHaveCount(0);
    await page.reload();
    await expect(
      page
        .getByText(subject)
        .locator("xpath=ancestor::div[2]")
        .getByText("Baru"),
    ).toHaveCount(0);
  });
});
