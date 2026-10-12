/**
 * An employee's HR record — personal data, bank account, contracts, leave,
 * documents, employment history — is read by the employee and by whoever
 * keeps HR records (a unit's admin and Tata Usaha, the foundation). A
 * colleague, the kepala sekolah included, sees the directory
 * (.claude/memory/decisions/akses-data-pegawai.md).
 *
 * Read-only: it opens records, it changes none.
 */
import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  type AuthSession,
} from "./helpers/auth-api";
import { DEMO_ACCOUNTS } from "../../../packages/shared/src/types/demo-accounts";

test.describe.configure({ mode: "serial" });

const creds = (roleCode: string) => {
  const a = DEMO_ACCOUNTS.find((x) => x.roleCode === roleCode)!;
  return { email: a.email, password: a.password };
};

const statusOf = (call: Promise<unknown>) =>
  call.then(
    () => 200,
    (error: Error) => Number(/→ (\d{3})/.exec(error.message)?.[1] ?? 0),
  );

let admin: AuthSession;
let guru: AuthSession;
let colleagueId = "";

test.beforeAll(async () => {
  admin = await apiLogin(creds("SMPIT_ADMIN"));
  guru = await apiLogin(creds("SMPIT_GURU"));
  const res = await apiRequest<{ data?: { id: string }[] }>(
    admin,
    "GET",
    "/hr/employees?role=TEACHER&limit=50",
  );
  const colleague = (res.data ?? []).find((e) => e.id !== guru.user.id);
  expect(colleague, "another SMP IT teacher to look at").toBeTruthy();
  colleagueId = colleague!.id;
});

const recordPaths = (userId: string) => [
  `/hr/contracts/user/${userId}`,
  `/hr/employees/${userId}/documents`,
  `/hr/employees/${userId}/history`,
  `/hr/leave-balances/user/${userId}?academicYearId=00000000-0000-0000-0000-000000000000`,
];

test("the API keeps a colleague's HR record from a teacher, not from the unit admin", async () => {
  for (const path of recordPaths(colleagueId)) {
    expect(await statusOf(apiRequest(guru, "GET", path)), path).toBe(404);
    expect(await statusOf(apiRequest(admin, "GET", path)), path).toBe(200);
  }
  // The teacher's own record stays theirs to read.
  for (const path of recordPaths(String(guru.user.id))) {
    expect(await statusOf(apiRequest(guru, "GET", path)), path).toBe(200);
  }
});

test("a teacher opening a colleague's profile sees the directory, no HR tabs and no actions", async ({
  page,
}) => {
  await injectSession(page, guru);
  await page.goto(`/hr/employees/${colleagueId}`);

  await expect(page.getByText("Data Kepegawaian")).toBeVisible();
  await expect(page.getByText("Data Pribadi")).toHaveCount(0);
  await expect(page.getByText("Informasi Bank")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Kontrak/ })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Dokumen/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Hapus/ })).toHaveCount(0);
});

test("the unit admin opening the same profile gets the record, its tabs and the actions", async ({
  page,
}) => {
  await injectSession(page, admin);
  await page.goto(`/hr/employees/${colleagueId}`);

  await expect(page.getByText("Data Pribadi")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Kontrak/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Dokumen/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Hapus/ })).toBeVisible();
});
