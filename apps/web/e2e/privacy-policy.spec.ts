import { test, expect } from "@playwright/test";
import { LOCALE_COOKIE, type Locale } from "../src/locales";
import { pagesContentFor } from "../src/config/pages.i18n";

/**
 * /kebijakan-privasi is the page the SPMB consent checkbox points at
 * (UU PDP 27/2022 Pasal 20, 25): a parent must be able to read the notice
 * before consenting. It is public — reachable with no session — and it speaks
 * the visitor's language, like every other public page.
 *
 * Read-only: nothing is written, so it runs against any environment. The base
 * seed publishes version 1, so the version badge is present; the page must
 * still resolve when no version exists, which is why the assertion is written
 * against either state rather than assuming a published one.
 */

// A visitor: no session.
test.use({ storageState: { cookies: [], origins: [] } });

for (const locale of ["id", "en", "ar"] as Locale[]) {
  test(`the privacy policy is readable in ${locale}`, async ({
    page,
    context,
    baseURL,
  }) => {
    const url = new URL(baseURL ?? "http://localhost:3000");
    await context.addCookies([
      { name: LOCALE_COOKIE, value: locale, domain: url.hostname, path: "/" },
    ]);
    const copy = pagesContentFor(locale).privacy;

    const response = await page.goto("/kebijakan-privasi");
    expect(response?.status()).toBeLessThan(400);

    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(
      page.getByRole("heading", { name: copy.title, level: 1 }),
    ).toBeVisible();

    // Either a published version is shown (badge + effective date) or the
    // honest "not yet" notice — never a blank page or a crash.
    const published = page.getByText(copy.versionLabel(1));
    const notYet = page.getByText(copy.notPublishedTitle);
    await expect(published.or(notYet).first()).toBeVisible();
  });
}

test("the privacy policy is reachable without a session", async ({ page }) => {
  // A session wall would redirect to /login before the page renders; the
  // storageState above is anonymous, so reaching the heading proves it does not.
  await page.goto("/kebijakan-privasi");
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a pinned version shows that exact version, not the current one", async ({
  page,
}) => {
  // The SPMB consent link is `/kebijakan-privasi?version=N`, so a parent reads
  // the same text the form records. The seed publishes version 1.
  const copy = pagesContentFor("id").privacy;
  await page.goto("/kebijakan-privasi?version=1");
  await expect(page.getByText(copy.versionLabel(1)).first()).toBeVisible();
});

test("a pinned version that does not exist degrades to the honest 'not yet'", async ({
  page,
}) => {
  // A stale or mistyped link must not crash the one page the consent points at.
  const copy = pagesContentFor("id").privacy;
  const response = await page.goto("/kebijakan-privasi?version=999999");
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByText(copy.notPublishedTitle)).toBeVisible();
});

for (const locale of ["id", "en", "ar"] as Locale[]) {
  test(`the privacy policy links the data subject request form in ${locale}`, async ({
    page,
    context,
    baseURL,
  }) => {
    // Before #1111 the page named the rights (access, correction, erasure,
    // withdrawal) and then told the reader to email the SPMB committee: a right
    // with no route to exercise it and no record that a request arrived. The
    // link is now the route, and it must exist in every language the notice is
    // published in — a label added to one translation only would leave the
    // other two readers with the old dead end.
    const url = new URL(baseURL ?? "http://localhost:3000");
    await context.addCookies([
      { name: LOCALE_COOKIE, value: locale, domain: url.hostname, path: "/" },
    ]);
    const copy = pagesContentFor(locale).privacy;

    await page.goto("/kebijakan-privasi");
    const link = page.getByRole("link", { name: copy.requestLinkLabel });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/public/permintaan-data");
  });
}
