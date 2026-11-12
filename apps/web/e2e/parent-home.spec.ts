import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
} from "./helpers/auth-api";
import { gotoAuthedPage } from "./helpers/page-helpers";

/**
 * Beranda wali (`/parent`) reads `GET /parent/dashboard`. It used to look each
 * child's figures up by `c.studentId`, a field the API never sends — the
 * summary carries `child.id` — so every tile fell back to `0` / `—` and the
 * "Harmony Asrama" tile showed even for a santri who lives in no asrama
 * (issue #869, decision K13).
 */
test.describe("Beranda wali — angka dari API, bukan karangan (#869)", () => {
  test("kartu anak menampilkan angka yang benar-benar dikirim /parent/dashboard", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const parent = await apiLogin(SEED_USERS.parent);

    // The API is the source of truth: read the child the page must render.
    const children = await apiRequest<{
      data: Array<{ id: string; name: string }>;
    }>(parent, "GET", "/parent/children");
    expect(children.data.length).toBeGreaterThan(0);
    const child = children.data[0];

    const dashboard = await apiRequest<{
      data: {
        children: Array<{
          child: { id: string };
          recentAttendance: Array<{ status: string }>;
          lastTahfidz: { juz: number } | null;
          memorizedJuz: number | null;
        }>;
      };
    }>(parent, "GET", "/parent/dashboard");
    const summary = dashboard.data.children.find(
      (c) => c.child.id === child.id,
    );
    expect(summary).toBeDefined();

    await injectSession(page, parent);
    await gotoAuthedPage(page, "/parent", /^Selamat Datang/);

    const card = page
      .getByText(child.name, { exact: false })
      .locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
    await expect(card).toBeVisible();

    // Tahfidz must show the memorized total (`memorizedJuz`), not the last
    // setoran's juz number: the pre-fix page printed `lastTahfidz.juz`, so a
    // single ayah of juz 30 read as "30 Juz" (issue #869 review).
    if (summary!.memorizedJuz == null) {
      await expect(card.getByText(/Tahfidz:\s*—/)).toBeVisible();
    } else {
      await expect(
        card.getByText(new RegExp(`Tahfidz:\\s*${summary!.memorizedJuz} Juz`)),
      ).toBeVisible();
    }

    // The English label is gone; the tile is Indonesian and conditional.
    await expect(page.getByText("Harmony Asrama")).toHaveCount(0);
  });
});
