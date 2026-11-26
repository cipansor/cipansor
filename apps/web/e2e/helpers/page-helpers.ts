import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Page Helper Utilities
 * Reusable functions for common page interactions
 */

/**
 * Wait for loading spinner to disappear.
 *
 * Deliberately does NOT match [role="progressbar"]. A progress bar is content
 * here, not a loading state: the tahfidz dashboard renders one per santri to
 * show hafalan progress, and Radix marks a bar whose value is not yet known as
 * `data-state="indeterminate"` — which never resolves and is not supposed to.
 * Matching it made this helper wait out its full timeout on any page that
 * happened to have data, so the tahfidz tests only passed while the seed left
 * those tables empty.
 */
export async function waitForLoadingComplete(page: Page, timeout = 15000) {
  const spinner = page.locator('.animate-spin, [aria-busy="true"], .loading');
  await expect(spinner).not.toBeVisible({ timeout });
}

/**
 * Navigate to an authenticated page and wait for it to actually render.
 *
 * Two traps make the obvious `goto` + `waitForLoadState("domcontentloaded")`
 * unreliable, and they compound:
 *
 * 1. Pages that wrap themselves in MainLayout render *nothing* until
 *    ProtectedRoute has rehydrated the persisted session, so domcontentloaded
 *    fires against an empty shell.
 * 2. `locator.isVisible` with a timeout does not wait. Playwright marks that
 *    option `@deprecated — This option is ignored` and returns immediately, so
 *    a probe that looks like it allows 5s actually samples the page once.
 *
 * Together they turn "check the page has content" into a coin flip that lands
 * right on Chromium and wrong on WebKit, which rehydrates a little later.
 * Waiting for the page's own <h1> is the signal that the gate has opened;
 * assert real content only after this resolves.
 */
export async function gotoAuthedPage(
  page: Page,
  path: string,
  heading: string | RegExp,
  timeout = 15000,
) {
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: heading, level: 1 }),
  ).toBeVisible({ timeout });
}

/**
 * Wait for toast notification
 *
 * sonner 2 merender toast sebagai `<li data-sonner-toast data-type="…">` TANPA
 * `role="status"`. Versi lama helper ini mencari `getByRole("status")`, jadi ia
 * tidak pernah menemukan toast apa pun: setiap uji yang benar-benar sampai ke
 * sini merah, dan yang lain hijau hanya karena dilewati lebih dulu (ditemukan
 * lewat tk-module.spec, yang menyimpan penilaian dengan sukses lalu gagal
 * menunggu toast-nya). `type` sekarang dipakai: toast galat yang teksnya
 * kebetulan cocok tidak bisa lolos sebagai sukses.
 */
export async function waitForToast(
  page: Page,
  message?: string | RegExp,
  type: "success" | "error" | "info" = "success",
) {
  const semua = page.locator(`[data-sonner-toast][data-type="${type}"]`);
  const toast = message ? semua.filter({ hasText: message }) : semua;

  await expect(toast.first()).toBeVisible({ timeout: 5000 });
  return toast;
}

/**
 * Dismiss every visible toast and wait for them to clear.
 *
 * A sonner toast pauses its own auto-dismiss timer while the pointer rests on
 * it, and the toaster is anchored bottom-right — right where a form's submit
 * button sits. After a save the pointer is left hovering the success toast, so
 * it never leaves, keeps covering the button, and the *next* click lands on the
 * toast instead of the button (WebKit, #852). Move the pointer off it first.
 */
export async function dismissToasts(page: Page, timeout = 12000) {
  await page.mouse.move(0, 0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout });
}

/**
 * Fill form fields by label
 */
export async function fillForm(page: Page, fields: Record<string, string>) {
  for (const [label, value] of Object.entries(fields)) {
    const input = page.getByLabel(new RegExp(label, "i"));
    await input.fill(value);
  }
}

/**
 * Select from shadcn/ui Select (combobox)
 */
export async function selectOption(
  page: Page,
  triggerText: string | RegExp,
  optionText: string | RegExp,
) {
  // Click the combobox trigger
  const trigger = page
    .locator('button[role="combobox"]')
    .filter({ hasText: triggerText })
    .first();
  await trigger.click();

  // Select the option
  const option = page.getByRole("option", { name: optionText });
  await option.click();

  // Radix returns focus to the trigger asynchronously as the menu closes.
  // Filling the next field while that is in flight loses the keystrokes on
  // Firefox (the value lands and is then cleared), so wait for the listbox to
  // leave the DOM before the caller touches the next field.
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

/**
 * Click table row by index or text
 */
export async function clickTableRow(
  page: Page,
  identifier: number | string | RegExp,
  tableSelector = "table",
) {
  const table = page.locator(tableSelector);

  if (typeof identifier === "number") {
    const row = table.locator("tbody tr").nth(identifier);
    await row.click();
  } else {
    const row = table.locator("tbody tr").filter({ hasText: identifier });
    await row.first().click();
  }
}

/**
 * Wait for API call to complete
 */
export async function waitForAPICall(
  page: Page,
  urlPattern: string | RegExp,
  timeout = 10000,
): Promise<any> {
  const response = await page.waitForResponse(
    (resp) => {
      const url = resp.url();
      if (typeof urlPattern === "string") {
        return url.includes(urlPattern);
      }
      return urlPattern.test(url);
    },
    { timeout },
  );

  return response.json();
}

/**
 * Navigate to page and wait for load
 */
export async function navigateTo(page: Page, path: string) {
  await page.goto(path);
  // Wait for the DOM, not networkidle — the app keeps long-lived connections
  // (realtime socket / periodic connectivity ping / React Query), so the network
  // never goes idle and networkidle would always time out.
  await page.waitForLoadState("domcontentloaded");
  await waitForLoadingComplete(page);
}

/**
 * Check if element has data
 */
export async function hasData(locator: Locator): Promise<boolean> {
  try {
    await expect(locator).toBeVisible({ timeout: 3000 });
    const text = await locator.textContent();
    return text !== null && text.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Take screenshot with timestamp
 */
export async function takeScreenshot(page: Page, name: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await page.screenshot({
    path: `test-results/screenshots/${name}-${timestamp}.png`,
    fullPage: true,
  });
}

/**
 * Verify page has no console errors
 */
export async function checkNoConsoleErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  return {
    getErrors: () => errors,
    hasErrors: () => errors.length > 0,
  };
}

/**
 * Get table data as array
 */
export async function getTableData(
  page: Page,
  tableSelector = "table",
): Promise<string[][]> {
  const table = page.locator(tableSelector);
  const rows = await table.locator("tbody tr").all();

  const data: string[][] = [];
  for (const row of rows) {
    const cells = await row.locator("td").allTextContents();
    data.push(cells);
  }

  return data;
}
