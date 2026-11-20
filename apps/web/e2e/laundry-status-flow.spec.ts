import { test, expect } from "@playwright/test";
import {
  LAUNDRY_STATUS_LABELS,
  LAUNDRY_STATUS_VALUES,
  laundryStatusOptions,
  type LaundryStatusCode,
} from "@cipansor/shared";
import {
  apiLoginNew,
  apiRequest,
  injectSession,
  type AuthSession,
} from "./helpers/auth-api";
import { gotoAuthedPage } from "./helpers/page-helpers";

/**
 * Property 31, Portal side (#1010): the status menu offers exactly the moves
 * `LAUNDRY_STATUS_FLOW` names — the same table `PATCH …/status` validates
 * against (#989). Before this the page printed a hardcoded list of every
 * status, so it offered moves the API refused with 409.
 *
 * The actor is the SMP IT admin: laundry rows belong to that unit, and a
 * super admin has no `unitId` to create one with.
 */
const LAUNDRY_ADMIN = {
  email: "smpit.admin@cipansor.or.id",
  password: "Cipansor123!",
};

interface CreatedTransaction {
  id: string;
  transactionNo: string;
  status: LaundryStatusCode;
}

async function createReceivedTransaction(
  session: AuthSession,
): Promise<CreatedTransaction> {
  const pricing = await apiRequest<{ data: Array<{ id: string }> }>(
    session,
    "GET",
    "/laundry/pricing",
  );
  const students = await apiRequest<{ data: Array<{ id: string }> }>(
    session,
    "GET",
    "/students?limit=1",
  );
  expect(pricing.data.length, "seed tanpa tarif laundry").toBeGreaterThan(0);
  expect(students.data.length, "seed tanpa santri").toBeGreaterThan(0);

  const created = await apiRequest<{ data: CreatedTransaction }>(
    session,
    "POST",
    "/laundry/transactions",
    {
      studentId: students.data[0].id,
      pricingId: pricing.data[0].id,
      weight: 2,
      paymentMethod: "CASH",
      items: [{ itemType: "Seragam", quantity: 2 }],
    },
  );
  return created.data;
}

async function openTransactionDetail(
  page: import("@playwright/test").Page,
  transactionNo: string,
) {
  const row = page.getByRole("row").filter({ hasText: transactionNo });
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.getByRole("button", { name: "Lihat detail" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(transactionNo);
  return dialog;
}

test.describe("Menu status laundry mengikuti LAUNDRY_STATUS_FLOW", () => {
  // Each test creates a transaction, and `generateTransactionNo` reads the last
  // number and adds one — two creates in the same second race for the same
  // `transactionNo` and one loses with a 409. Serial keeps this file's own
  // creates apart; the numbering race itself is a separate API issue.
  test.describe.configure({ mode: "serial" });

  let session: AuthSession;
  let transaction: CreatedTransaction;

  test.beforeEach(async ({ page }) => {
    session = await apiLoginNew(LAUNDRY_ADMIN);
    transaction = await createReceivedTransaction(session);
    await injectSession(page, session);
  });

  test("hanya transisi yang tercatat di flow yang ditawarkan", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await gotoAuthedPage(page, "/laundry", /^Laundry$/);
    const dialog = await openTransactionDetail(page, transaction.transactionNo);

    const offered = new Set(
      laundryStatusOptions(transaction.status).map((option) => option.value),
    );
    for (const status of LAUNDRY_STATUS_VALUES) {
      await expect(
        dialog.getByRole("button", {
          name: LAUNDRY_STATUS_LABELS[status],
          exact: true,
        }),
        `${LAUNDRY_STATUS_LABELS[status]} ${
          offered.has(status) ? "harus" : "tidak boleh"
        } ditawarkan untuk status ${transaction.status}`,
      ).toHaveCount(offered.has(status) ? 1 : 0);
    }
  });

  test("tombol yang ditawarkan diterima API dan statusnya berpindah", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await gotoAuthedPage(page, "/laundry", /^Laundry$/);
    const dialog = await openTransactionDetail(page, transaction.transactionNo);

    const [next] = laundryStatusOptions(transaction.status);
    expect(next, `flow tanpa tujuan dari ${transaction.status}`).toBeTruthy();
    await dialog.getByRole("button", { name: next.label, exact: true }).click();

    // The API is the record, so poll it: the dialog's buttons carry the same
    // labels as the badge, so any text assertion here could be satisfied by a
    // button that has not re-rendered yet.
    await expect
      .poll(
        async () =>
          (
            await apiRequest<{ data: { status: LaundryStatusCode } }>(
              session,
              "GET",
              `/laundry/transactions/${transaction.id}`,
            )
          ).data.status,
        { timeout: 20000 },
      )
      .toBe(next.value);

    // The menu moved with the transaction: the new status' own options only.
    const offered = new Set(
      laundryStatusOptions(next.value).map((option) => option.value),
    );
    for (const status of LAUNDRY_STATUS_VALUES) {
      await expect(
        dialog.getByRole("button", {
          name: LAUNDRY_STATUS_LABELS[status],
          exact: true,
        }),
      ).toHaveCount(offered.has(status) ? 1 : 0);
    }
  });

  test("transaksi selesai tidak menawarkan status lanjutan", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Walk the flow to DELIVERED through the API, then read the menu.
    let status: LaundryStatusCode = transaction.status;
    while (status !== "DELIVERED") {
      const [step] = laundryStatusOptions(status);
      expect(step, `flow berhenti di ${status}`).toBeTruthy();
      const moved = await apiRequest<{ data: { status: LaundryStatusCode } }>(
        session,
        "PATCH",
        `/laundry/transactions/${transaction.id}/status`,
        { status: step.value },
      );
      status = moved.data.status;
    }

    await gotoAuthedPage(page, "/laundry", /^Laundry$/);
    const dialog = await openTransactionDetail(page, transaction.transactionNo);
    for (const candidate of LAUNDRY_STATUS_VALUES) {
      await expect(
        dialog.getByRole("button", {
          name: LAUNDRY_STATUS_LABELS[candidate],
          exact: true,
        }),
      ).toHaveCount(0);
    }
    await expect(
      dialog.getByText(
        "Transaksi ini sudah selesai; tidak ada status lanjutan.",
      ),
    ).toBeVisible();
  });
});
