/**
 * Ajukan Cuti, end to end (#1061).
 *
 * The form at `/hr/leaves/new` used to bind each employee `<SelectItem>` to the
 * **user** id (`normalizeEmployee` sets `id` from the User) and post it as
 * `staffId`. `createLeave` resolves `staffId` against the `staff` profile, so a
 * user id matched nothing: a unit admin got 404 "Staff not found", a Super
 * Admin a foreign-key 500. The form now keys the option on the Staff profile id
 * (`staff.id`) and sends it as `staffId`, and the API turns a user id sent as
 * `staffId` into a clear 400 instead of the ambiguous 404.
 *
 * This walks both halves: the API answer to a user id, and the form filing a
 * real leave the API accepts. It writes a leave, so it cleans up its own rows
 * (by `e2e ` reason prefix) — a retry or a second run would otherwise collide
 * with the first on the API's "overlaps with an existing request" check.
 */
import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
  type AuthSession,
} from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";

test.describe.configure({ mode: "serial" });

/** A row of `GET /hr/employees`: the User with its profile relations. */
interface EmployeeRow {
  id: string;
  name?: string;
  staff?: { id: string; position?: string | null } | null;
  teacher?: { id: string } | null;
}

interface LeaveRow {
  id: string;
  reason: string;
  staffId: string | null;
}

/**
 * The `<SelectItem>` label `page.tsx` renders for a staff-backed employee,
 * mirroring `normalizeEmployee` (`position` is the Staff row's). Only such
 * employees are selectable — the form drops the rest.
 */
const optionLabel = (e: EmployeeRow) =>
  `${e.name ?? ""} - ${e.staff?.position}`;

/** A `date` input value `days` from now (YYYY-MM-DD). */
function dateInput(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Our rows are the only ones with an `e2e ` reason; never touch seeded data. */
const E2E_REASON = "e2e ";

let admin: AuthSession;
/** A user id the form once sent as `staffId`, and their real Staff profile id. */
let employee: EmployeeRow;
let option: string;

/** Delete every leave this spec left behind for one staff, so reruns are clean. */
async function deleteE2eLeaves(staffId: string): Promise<void> {
  const list = await apiRequest<{ data: LeaveRow[] }>(
    admin,
    "GET",
    `/hr/leaves?staffId=${staffId}&limit=100`,
  );
  for (const leave of list.data ?? []) {
    if (leave.reason.startsWith(E2E_REASON)) {
      await apiRequest(admin, "DELETE", `/hr/leaves/${leave.id}`);
    }
  }
}

test.beforeAll(async () => {
  test.skip(
    await isProductionApi(),
    "API_URL menunjuk API produksi; uji ini menulis cuti, jadi dilewati",
  );
  admin = await apiLogin(SEED_USERS.adminSdit);
  // The exact list the form renders: `useEmployees({ status: "ACTIVE" })` sends
  // `status=ACTIVE` and the API's default `limit` (20).
  const list = await apiRequest<{ data: EmployeeRow[] }>(
    admin,
    "GET",
    "/hr/employees?status=ACTIVE",
  );
  const rows = (list.data ?? []).filter((e) => e.staff?.id);
  // Pick a row whose dropdown label is unique, so the click below is exact.
  employee = rows.find(
    (e) => rows.filter((o) => optionLabel(o) === optionLabel(e)).length === 1,
  )!;
  expect(
    employee,
    "an employee with a Staff profile in the admin's unit",
  ).toBeTruthy();
  option = optionLabel(employee);
  await deleteE2eLeaves(employee.staff!.id);
});

test.afterAll(async () => {
  if (employee?.staff?.id) await deleteE2eLeaves(employee.staff.id);
});

test("the API answers a user id sent as staffId with a clear 400, not 404 'Staff not found'", async () => {
  const error = await apiRequest(admin, "POST", "/hr/leaves", {
    // The very mistake the old form made: the user id, not the staff id.
    staffId: employee.id,
    type: "SICK",
    startDate: `${dateInput(900)}T00:00:00.000Z`,
    endDate: `${dateInput(901)}T00:00:00.000Z`,
    reason: `e2e ${Date.now().toString(36)} user id as staffId`,
  }).then(
    () => null,
    (e: Error) => e,
  );

  expect(error, "a user id must be refused").toBeTruthy();
  expect(error!.message).toContain("400");
  expect(error!.message).toMatch(/id pengguna/i);
  expect(error!.message).not.toContain("404");
});

test("the form files a leave the API accepts, against the profile id", async ({
  page,
}) => {
  const reason = `e2e ${Date.now().toString(36)} cuti sakit`;
  // A retry re-enters this test; clear the first attempt's row before writing.
  await deleteE2eLeaves(employee.staff!.id);

  await injectSession(page, admin);
  await page.goto("/hr/leaves/new");

  await page
    .getByRole("combobox")
    .filter({ hasText: "Pilih karyawan" })
    .click();
  await page.getByRole("option", { name: option, exact: true }).click();

  await page
    .getByRole("combobox")
    .filter({ hasText: "Pilih jenis cuti" })
    .click();
  await page.getByRole("option", { name: "Sakit", exact: true }).click();

  await page.getByLabel("Tanggal Mulai").fill(dateInput(910));
  await page.getByLabel("Tanggal Selesai").fill(dateInput(911));
  await page.getByLabel("Alasan Cuti").fill(reason);

  await page.getByRole("button", { name: "Ajukan Cuti" }).click();

  // The form navigates back to the HR hub on success.
  await expect(page).toHaveURL(/\/hr(\/|$|\?)/);

  // And the API holds the row, filed against the Staff profile — never the user.
  const leaves = await apiRequest<{ data: LeaveRow[] }>(
    admin,
    "GET",
    `/hr/leaves?staffId=${employee.staff!.id}&limit=100`,
  );
  const created = (leaves.data ?? []).find((l) => l.reason === reason);
  expect(created, "the submitted leave is stored").toBeTruthy();
  expect(created!.staffId).toBe(employee.staff!.id);
  expect(created!.staffId).not.toBe(employee.id);
});
