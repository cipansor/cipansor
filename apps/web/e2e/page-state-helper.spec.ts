import { test, expect, type Page } from "@playwright/test";
import { settledContent } from "./helpers/page-state";

/**
 * Pins the contract of `settledContent` — the reason 28 call sites stopped
 * calling `page.content()` directly. Without the helper, one arbitrary spec per
 * CI run died on "Unable to retrieve content because the page is navigating":
 * the app bounces to /login until the auth store rehydrates, and under load the
 * read lands inside that bounce. Here the bounce is forced (no session at all),
 * so the failure is reproducible instead of load-dependent.
 */
test.describe("e2e helper: settledContent", () => {
  test("reading the DOM straight through a redirect is what breaks", async ({
    page,
  }) => {
    // A read during a navigation either throws ("Unable to retrieve content
    // because the page is navigating") or — WebKit and Firefox — returns the
    // empty placeholder document instead of the real page. Either is a broken
    // read; Chromium happened to parse by the time the loop ran, which is why
    // this used to pass there and fail on the other two. Assert the *contract*
    // (a read landed on a non-page) rather than the engine-specific symptom.
    const nav = page.goto("/inventory", { waitUntil: "commit" });
    let sawBrokenRead = false;
    try {
      for (let i = 0; i < 40; i += 1) {
        const html = await page.content();
        if (!html || /<body[^>]*>\s*<\/body>/i.test(html)) {
          sawBrokenRead = true;
          break;
        }
      }
    } catch {
      sawBrokenRead = true;
    }
    await nav.catch(() => {});

    expect(
      sawBrokenRead,
      "a read straight through a navigation is not a usable document",
    ).toBe(true);
  });

  test("settledContent reads the same moment without failing", async ({
    page,
  }) => {
    const nav = page.goto("/inventory", { waitUntil: "commit" });
    const html = await settledContent(page);
    await nav.catch(() => {});

    expect(html.length).toBeGreaterThan(100);
  });

  test("reports the last observation, not a stale navigation error", async ({
    page,
  }) => {
    // A page.content() that throws once and then returns an empty document
    // forever: the caller must see the empty document (the real final state),
    // not the earlier "page is navigating" error the retry loop moved past.
    const empty = "<html><head></head><body></body></html>";
    let calls = 0;
    const stub = page as Page & { content: Page["content"] };
    stub.content = async () => {
      calls += 1;
      if (calls === 1) throw new Error("page is navigating");
      return empty;
    };

    const html = await settledContent(page, 300);
    expect(calls).toBeGreaterThan(1);
    expect(html).toBe(empty);
  });
});
