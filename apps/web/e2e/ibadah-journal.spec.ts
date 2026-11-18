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
 * The record is filed by a unit admin, who may write it (a musyrif reads across
 * units but writes only its own — R27.2), so the spec depends on no seeded
 * record: a change to the seed cannot silently retire the regression by leaving
 * no row to look at.
 */

function account(roleCode: string) {
  const found = DEMO_ACCOUNTS.find((a) => a.roleCode === roleCode);
  if (!found) throw new Error(`No demo account for ${roleCode}`);
  return { email: found.email, password: found.password };
}

interface StudentRow {
  id: string;
  unitId: string;
  nis: string;
  user?: { name: string };
}

interface RecordRow {
  studentId: string;
  student?: { id: string; nis: string; user?: { name: string } };
}

interface RecordsResponse {
  data: RecordRow[];
  meta: { pagination: { total: number } };
}

/** The account that files the record — an Admin_Unit of the santri's unit. */
const WRITER_ROLE = "SMPIT_ADMIN";

async function signIn(page: Page, roleCode: string): Promise<AuthSession> {
  const session = await apiLogin(account(roleCode));
  await injectSession(page, session);
  return session;
}

/** The WIB calendar day the record is filed on, as the page lists it. */
const todayWib = () =>
  new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * File one ibadah record for a santri the writer reaches, on a target this run
 * creates itself, returning the santri and the ids to clean up.
 *
 * A fresh target per call keeps the two tests — which run in parallel — from
 * colliding on `DailyIbadahRecord`'s `(targetId, studentId, date)` unique key,
 * and leaves the spec depending on no seeded target or record.
 */
async function createRecordForScopedSantri(session: AuthSession) {
  const students = await apiRequest<{ data: StudentRow[] }>(
    session,
    "GET",
    "/students?limit=1",
  );
  const student = students.data[0];
  if (!student) {
    throw new Error(
      "the account reaches no santri — the seed is missing a santri for this scope",
    );
  }

  const target = await apiRequest<{ data: { id: string } }>(
    session,
    "POST",
    "/ibadah/targets",
    {
      unitId: student.unitId,
      name: `E2E Jurnal Ibadah ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      category: "TILAWAH",
      targetType: "DAILY",
      targetCount: 1,
      points: 10,
    },
  );
  const targetId = target.data.id;

  const record = await apiRequest<{ data: { id: string } }>(
    session,
    "POST",
    "/ibadah/records",
    {
      targetId,
      studentId: student.id,
      date: todayWib(),
      isCompleted: true,
    },
  );

  return { student, recordId: record.data.id, targetId };
}

async function cleanup(
  session: AuthSession,
  ids: { recordId: string; targetId: string },
) {
  await apiRequest(session, "DELETE", `/ibadah/records/${ids.recordId}`).catch(
    () => undefined,
  );
  await apiRequest(session, "DELETE", `/ibadah/targets/${ids.targetId}`).catch(
    () => undefined,
  );
}

/** The card whose body carries the "Total Catatan" figure. */
const totalCard = (page: Page) =>
  page.locator('[data-slot="card-content"]', { hasText: "Total Catatan" });

test.describe("Jurnal Ibadah — baris dan total dari API", () => {
  for (const roleCode of ["SMPIT_ADMIN", "MUSYRIF"] as const) {
    test(`sebagai ${roleCode}: nama santri per baris dan Total Catatan dari API`, async ({
      page,
    }) => {
      // File the record as an Admin_Unit of the santri's unit, then read it
      // back as the role under test — a musyrif reads across units but does
      // not write another unit's santri (R27.2).
      const writer = await apiLogin(account(WRITER_ROLE));
      const { student, recordId, targetId } =
        await createRecordForScopedSantri(writer);

      try {
        const session = await signIn(page, roleCode);
        const records = await apiRequest<RecordsResponse>(
          session,
          "GET",
          "/ibadah/records?limit=20",
        );
        const row = records.data.find((r) => r.studentId === student.id);
        expect(
          row,
          "the record just filed is in the first page of the API's own list",
        ).toBeTruthy();

        const name = row!.student!.user!.name;
        const nis = row!.student!.nis;

        // Read the total from the response the page itself fetches, so the
        // assertion cannot race another spec inserting a record in parallel.
        const recordsResponse = page.waitForResponse(
          (r) => r.url().includes("/ibadah/records") && r.status() === 200,
        );
        await page.goto("/ibadah");
        await expect(
          page.getByRole("heading", { name: "Jurnal Ibadah Harian" }),
        ).toBeVisible();
        const total = (await (await recordsResponse).json()).meta.pagination
          .total;

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
      } finally {
        await cleanup(writer, { recordId, targetId });
      }
    });
  }
});

/**
 * #989 (PR-03): the API allows a target with no `targetUnit` — the column is
 * nullable and `createTargetSchema` makes the field optional. Both the Jurnal
 * Ibadah page ("Target Aktif" tab) and the check-in page called
 * `target.targetUnit.toLowerCase()` on it and threw
 * "Cannot read properties of null", blanking the whole page. This walks the
 * two real surfaces with such a target.
 */
test.describe("Jurnal Ibadah — target tanpa satuan", () => {
  test("tab Target Aktif dan halaman check-in merender target tanpa satuan", async ({
    page,
  }) => {
    const writer = await apiLogin(account(WRITER_ROLE));

    const students = await apiRequest<{ data: StudentRow[] }>(
      writer,
      "GET",
      "/students?limit=1",
    );
    const student = students.data[0];
    if (!student) {
      throw new Error(
        "the writer reaches no santri — the seed is missing a santri for this scope",
      );
    }

    // The check-in page's santri list is filtered by the chosen unit, so pick
    // the santri's own unit by name.
    const units = await apiRequest<{ data: { id: string; name: string }[] }>(
      writer,
      "GET",
      "/units?limit=100",
    );
    const unit = units.data.find((u) => u.id === student.unitId);
    if (!unit) {
      throw new Error(
        `the writer reaches no unit ${student.unitId} — the seed is missing it`,
      );
    }

    // `targetUnit` is deliberately omitted: the API stores it as NULL.
    const name = `E2E Target Tanpa Satuan ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const target = await apiRequest<{ data: { id: string } }>(
      writer,
      "POST",
      "/ibadah/targets",
      {
        unitId: student.unitId,
        name,
        category: "TILAWAH",
        targetType: "DAILY",
        targetCount: 1,
        points: 10,
      },
    );
    const targetId = target.data.id;
    const targetName = name;

    try {
      await signIn(page, WRITER_ROLE);

      // 1. The Jurnal Ibadah "Target Aktif" tab — the card renders, with no
      //    unit printed after the count, instead of blanking the page.
      await page.goto("/ibadah");
      await expect(
        page.getByRole("heading", { name: "Jurnal Ibadah Harian" }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Target Aktif" }).click();
      const card = page
        .locator('[data-slot="card"]', { hasText: targetName })
        .first();
      await expect(card).toBeVisible();
      await expect(card).toContainText("Target: 1");

      // 2. The check-in page — pick the santri's unit and the santri, then the
      //    target list renders (it only draws once a santri is chosen).
      await page.goto("/ibadah/check-in");
      await expect(
        page.getByRole("heading", { name: "Check-in Ibadah Harian" }),
      ).toBeVisible();

      await page
        .locator('button[role="combobox"]')
        .filter({ hasText: "Pilih Unit" })
        .first()
        .click();
      await page
        .getByRole("option", { name: unit.name, exact: true })
        .first()
        .click();

      await page
        .locator('button[role="combobox"]')
        .filter({ hasText: "Pilih Santri" })
        .first()
        .click();
      await page
        .getByRole("option", { name: new RegExp(`\\(${student.nis}\\)`) })
        .first()
        .click();

      await expect(page.getByText(targetName)).toBeVisible();
    } finally {
      await apiRequest(writer, "DELETE", `/ibadah/targets/${targetId}`).catch(
        () => undefined,
      );
    }
  });
});
