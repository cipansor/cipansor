import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
} from "./helpers/auth-api";
import { gotoAuthedPage, waitForToast } from "./helpers/page-helpers";

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

    // Every mark-read call the page makes. The badge alone does not prove which
    // call cleared it — opening the thread refetches `GET /messages/:id`, which
    // marks read server-side — so assert the page's own `PATCH …/read`, which
    // only the mark-read effect makes.
    const markReadCalls: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PATCH" &&
        /\/messages\/[^/]+\/read$/.test(new URL(request.url()).pathname)
      ) {
        markReadCalls.push(request.url());
      }
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
    // Opening it reads the reply: the page marks it read, and the badge goes.
    await expect
      .poll(() => markReadCalls.some((url) => url.includes(opened.data.id)))
      .toBe(true);
    await expect(row.getByText("Baru")).toHaveCount(0);
    await page.reload();
    await expect(
      page
        .getByText(subject)
        .locator("xpath=ancestor::div[2]")
        .getByText("Baru"),
    ).toHaveCount(0);
  });

  /**
   * A reply that arrives while the wali already has the thread open. The
   * stored conversation object is the snapshot taken when the thread was
   * opened; the mark-read effect used to read the badge off that snapshot
   * only, so a reply that landed afterwards stayed unread. It now reads the
   * live list, so the badge clears without the wali reopening the thread.
   *
   * The badge alone does not prove which call cleared it: the reply's
   * invalidation refetches `GET /messages/:id` as well as the list, and that
   * read marks the reply read on the server — so the badge can clear without
   * the page's own call, depending on which response arrives first. To isolate
   * the effect, the thread-detail read is served from its first response for
   * every later request, so it can never mark the reply read. The only call
   * left that can clear it is the page's `PATCH /messages/:id/read`, which
   * nothing else in this flow makes.
   */
  test("balasan yang tiba selagi utas terbuka ikut ditandai terbaca", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const parent = await apiLogin(SEED_USERS.parent);
    const teacher = await apiLogin(SEED_USERS.teacher);
    const subject = `Uji balasan langsung ${Date.now()}`;

    const opened = await apiRequest<{ data: { id: string } }>(
      parent,
      "POST",
      "/messages",
      {
        recipientId: teacher.user.id,
        subject,
        content: "Assalamu'alaikum, mohon info kegiatan.",
        category: "GENERAL",
      },
    );
    // Read the thread first, so it opens with nothing unread.
    await apiRequest(parent, "GET", `/messages/${opened.data.id}`);

    // Pin the thread-detail read to its first response. The first read is the
    // wali opening the thread (nothing unread); the reply's invalidation
    // refetches it too, and that read would mark the reply read on the server
    // and clear the badge without the page's own call. Serving the first
    // response keeps the detail read from clearing anything.
    let detailBody: string | undefined;
    await page.route(`**/api/messages/${opened.data.id}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      if (detailBody === undefined) {
        const response = await route.fetch();
        detailBody = await response.text();
        return route.fulfill({ response, body: detailBody });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: detailBody,
      });
    });

    // Every mark-read call the page makes, in order.
    const markReadCalls: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PATCH" &&
        /\/messages\/[^/]+\/read$/.test(new URL(request.url()).pathname)
      ) {
        markReadCalls.push(request.url());
      }
    });

    await injectSession(page, parent);
    await gotoAuthedPage(page, "/parent/messages", /^Pesan$/);

    const row = page.getByText(subject).locator("xpath=ancestor::div[2]");
    await expect(row).toBeVisible();
    await expect(row.getByText("Baru")).toHaveCount(0);
    // Opening it (with nothing unread) must not have marked anything read.
    expect(markReadCalls).toHaveLength(0);

    // Open the thread, then have the guru answer while it stays open.
    await row.click();
    await expect(
      page.getByText("Assalamu'alaikum, mohon info kegiatan.").last(),
    ).toBeVisible();
    await apiRequest(teacher, "POST", `/messages/${opened.data.id}/reply`, {
      content: "Wa'alaikumussalam, kegiatan dimulai pukul 07.00.",
    });

    // The wali sends a line: the reply mutation invalidates the list, the live
    // conversation now carries the new reply as unread, and the mark-read
    // effect fires for the thread's newest message.
    const textarea = page.getByPlaceholder("Ketik pesan...");
    await textarea.fill("Baik, terima kasih.");
    await textarea.press("Enter");
    await waitForToast(page, /terkirim/i);

    await expect
      .poll(() => markReadCalls.length, { message: "a mark-read PATCH" })
      .toBeGreaterThan(0);
    expect(markReadCalls.some((url) => url.includes(opened.data.id))).toBe(
      true,
    );

    await expect(row.getByText("Baru")).toHaveCount(0);
    // And it is the API's state, not just local: a reload shows it read.
    await page.reload();
    await expect(
      page
        .getByText(subject)
        .locator("xpath=ancestor::div[2]")
        .getByText("Baru"),
    ).toHaveCount(0);
  });
});
