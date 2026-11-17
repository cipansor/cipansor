import { test, expect, type Page } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  type AuthSession,
} from "./helpers/auth-api";
import { DEMO_ACCOUNTS } from "../../../packages/shared/src/types/demo-accounts";

/**
 * Jurnal Ibadah (`/ibadah`) — what the table shows, against the real API and
 * Postgres (#732, #989, R27).
 *
 * The page used to print "-" in every row: it read the santri's name from
 * `student.name`, an identity field the API never sends — `ibadah.service.ts`
 * selects `id`, `nis` and `user.name` only. This spec opens the page as the two
 * accounts the requirement names — a unit admin and a musyrif — and asserts
 * each row's santri matches what `GET /ibadah/records` actually returns, and
 * that "Total Catatan" is the API's own count (`meta.pagination.total`), not a
 * flat `meta.total` that renders NaN.
 *
 * It writes nothing: the assertions are made against the rows the API returns,
 * so the seed is free to change names or counts.
 */

function account(roleCode: string) {
  const found = DEMO_ACCOUNTS.find((a) => a.roleCode === roleCode);
  if (!found) throw new Error(`No demo account for ${roleCode}`);
  return { email: found.email, password: found.password };
}

interface RecordRow {
  studentId: string;
  student?: { id: string; nis: string; user?: { name: string } };
}

interface RecordsResponse {
  data: RecordRow[];
  meta: { pagination: { total: number } };
}

async function signIn(page: Page, roleCode: string): Promise<AuthSession> {
  const session = await apiLogin(account(roleCode));
  await injectSession(page, session);
  return session;
}

/** The first record the API returns for this account, with its total count. */
async function firstRecord(session: AuthSession) {
  const res = await apiRequest<RecordsResponse>(
    session,
    "GET",
    "/ibadah/records?limit=20",
  );
  const row = res.data.find((r) => r.student?.user?.name);
  return { row, total: res.meta.pagination.total, rows: res.data };
}

/** The card whose body carries the "Total Catatan" figure. */
const totalCard = (page: Page) =>
  page.locator('[data-slot="card-content"]', { hasText: "Total Catatan" });

test.describe("Jurnal Ibadah — baris dan total dari API", () => {
  for (const roleCode of ["SMPIT_ADMIN", "MUSYRIF"] as const) {
    test(`sebagai ${roleCode}: nama santri per baris dan Total Catatan dari API`, async ({
      page,
    }) => {
      const session = await signIn(page, roleCode);
      const { row, total } = await firstRecord(session);
      test.skip(!row, "no ibadah record seeded for this account");

      const name = row!.student!.user!.name;
      const nis = row!.student!.nis;

      await page.goto("/ibadah");
      await expect(
        page.getByRole("heading", { name: "Jurnal Ibadah Harian" }),
      ).toBeVisible();

      // The row prints the santri's name — not the "-" the old field produced.
      const cell = page.getByRole("cell", { name }).first();
      await expect(cell).toBeVisible();
      await expect(cell).toContainText(nis);
      await expect(
        page.getByRole("cell", { name: "-", exact: true }),
      ).toHaveCount(0);

      // "Total Catatan" is the API's own total, and it is a number, not NaN.
      await expect(totalCard(page)).toContainText(String(total));
      await expect(totalCard(page)).not.toContainText("NaN");
    });
  }
});
