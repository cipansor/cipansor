import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
} from "./helpers/auth-api";
import { waitForLoadingComplete, gotoAuthedPage } from "./helpers/page-helpers";

async function firstPaymentType(
  session: Awaited<ReturnType<typeof apiLogin>>,
): Promise<{ id: string; name: string }> {
  const paymentTypes = await apiRequest<{
    data: Array<{ id: string; name: string }>;
  }>(session, "GET", "/finance/payment-types?limit=5&isActive=true");
  const paymentType = paymentTypes.data?.[0];
  expect(paymentType, "seed should provide a payment type").toBeTruthy();
  if (!paymentType) throw new Error("no payment type");
  return paymentType;
}

/**
 * The "Buat Tagihan" / "Tagihan Massal" screens must send the finance API a
 * contract it accepts.
 *
 * They used to post `{ billType, academicYearId, description }` — an imagined
 * contract. The API has no `billType` (a bill's kind is a per-unit
 * `PaymentType` row, sent as `paymentTypeId`) and no `academicYearId`; the
 * deadline is a calendar day (`dueDate`, "YYYY-MM-DD"), not a timestamp. Zod
 * stripped the unknown fields and rejected the missing ones, so every submit
 * failed at the edge with a validation error.
 *
 * The strongest regression these can carry is the outgoing request body: it
 * must carry `paymentTypeId` and no `billType`. That is asserted directly off
 * the request the page makes, and once more by checking the created bill is
 * readable back through the API.
 */

test.describe("Finance - create a bill from the web", () => {
  test("the single-bill screen sends paymentTypeId, not billType", async ({
    page,
  }) => {
    const session = await apiLogin(SEED_USERS.superAdmin);
    await injectSession(page, session);

    // A real santri and a real per-unit payment type, so the form has options.
    const students = await apiRequest<{ data: Array<{ id: string }> }>(
      session,
      "GET",
      "/students?limit=1",
    );
    const studentId = students.data?.[0]?.id;
    expect(studentId, "seed should provide a santri").toBeTruthy();
    if (!studentId) return;

    const paymentType = await firstPaymentType(session);

    await gotoAuthedPage(page, "/finance/bills/new", /buat tagihan/i);
    await waitForLoadingComplete(page);

    // The kind selector offers the real rows the API serves, by name.
    await page.locator("#paymentTypeId").click();
    await page.getByRole("option", { name: paymentType.name }).click();

    await page.locator("#amount").fill("125000");
    await page.locator("#dueDate").fill("2026-12-31");

    // The row itself toggles selection on this screen.
    await page.locator("table tbody tr").first().click();

    const requestPromise = page.waitForRequest(
      (req) =>
        req.method() === "POST" && req.url().includes("/finance/invoices"),
    );
    await page
      .getByRole("button", { name: /^Buat (Tagihan|\d+ Tagihan)$/ })
      .click();
    const request = await requestPromise;
    const body = request.postDataJSON() as Record<string, unknown>;

    // The contract the API accepts — and the old shape is gone.
    expect(body).toMatchObject({
      studentId,
      paymentTypeId: paymentType.id,
      amount: 125000,
      dueDate: "2026-12-31",
    });
    expect(body).not.toHaveProperty("billType");
    expect(body).not.toHaveProperty("academicYearId");
    // A calendar day, not an instant the API would refuse.
    expect(String(body.dueDate)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("the bulk screen sends paymentTypeId to /finance/invoices/bulk", async ({
    page,
  }) => {
    const session = await apiLogin(SEED_USERS.superAdmin);
    await injectSession(page, session);

    const paymentType = await firstPaymentType(session);

    await gotoAuthedPage(page, "/finance/bills/bulk", /tagihan massal/i);
    await waitForLoadingComplete(page);

    await page.locator("#paymentTypeId").click();
    await page.getByRole("option", { name: paymentType.name }).click();
    await page.locator("#amount").fill("125000");
    await page.locator("#dueDate").fill("2026-12-31");

    // Rows here are selected through their checkbox, not a row click.
    await page.getByRole("checkbox", { name: /select all students/i }).click();

    const requestPromise = page.waitForRequest(
      (req) =>
        req.method() === "POST" && req.url().includes("/finance/invoices/bulk"),
    );
    await page.getByRole("button", { name: /^Buat \d+ Tagihan$/ }).click();
    const request = await requestPromise;
    const body = request.postDataJSON() as Record<string, unknown>;

    expect(body).toMatchObject({
      paymentTypeId: paymentType.id,
      amount: 125000,
      dueDate: "2026-12-31",
    });
    expect(Array.isArray(body.studentIds)).toBe(true);
    expect((body.studentIds as string[]).length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty("billType");
    expect(body).not.toHaveProperty("academicYearId");
  });
});
