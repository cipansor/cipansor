/**
 * Users & Roles: the list pages through every account, and a unit admin's
 * actions on other accounts stay inside the unit and off the accounts that
 * must use 2FA (`apps/api/src/utils/account-scope.ts`).
 *
 * The scope checks act on throwaway accounts created here and removed at the
 * end, so a guard that regresses deletes nothing another spec relies on.
 * Writes, so it skips itself against a production API.
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

const STAMP = Date.now().toString(36);
const PASSWORD = "angin gunung di pagi hari";

let superAdmin: AuthSession;
let sditAdmin: AuthSession;
const created: string[] = [];

const statusOf = (call: Promise<unknown>) =>
  call.then(
    () => 200,
    (error: Error) => Number(/→ (\d{3})/.exec(error.message)?.[1] ?? 0),
  );

test.beforeAll(async () => {
  test.skip(
    await isProductionApi(),
    "API_URL menunjuk API produksi; uji ini membuat dan menghapus akun",
  );
  superAdmin = await apiLogin(SEED_USERS.superAdmin);
  sditAdmin = await apiLogin(SEED_USERS.adminSdit);
});

test.afterAll(async () => {
  for (const id of created)
    await apiRequest(superAdmin, "DELETE", `/users/${id}`).catch(
      () => undefined,
    );
});

test("Users & Roles shows the real total and pages past the first ten", async ({
  page,
}) => {
  await injectSession(page, superAdmin);
  await page.goto("/users");

  const footer = page.getByText(/Menampilkan \d+[–-]\d+ dari [\d.]+ data/);
  await expect(footer).toBeVisible();
  const total = Number(
    /dari ([\d.]+) data/
      .exec((await footer.textContent()) ?? "")?.[1]
      .replace(/\./g, ""),
  );
  // The seed has dozens of accounts; the list used to say "of 0".
  expect(total).toBeGreaterThan(10);
  await expect(page.getByText(/Halaman\s*1\s*dari\s*\d+/)).toBeVisible();

  const firstRow = await page.getByRole("row").nth(1).textContent();
  await page.getByRole("button", { name: "Halaman berikutnya" }).click();
  await expect(page.getByText(/Halaman\s*2\s*dari\s*\d+/)).toBeVisible();
  await expect(page.getByRole("row").nth(1)).not.toHaveText(firstRow ?? "");

  // A search started on page 2 shows its results from page one. It used to
  // stay on page 2: an empty table and "Halaman 2 dari 1".
  const searched = page.waitForResponse(
    (r) => r.url().includes("/users?") && r.url().includes("search="),
  );
  await page
    .getByPlaceholder("Search by name or email...")
    .fill(SEED_USERS.teacher.email);
  await searched;
  await expect(page.getByText(/Halaman\s*1\s*dari\s*1\b/)).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: SEED_USERS.teacher.email }),
  ).toHaveCount(1);
});

test("the realm filter narrows the whole list, not the page shown", async ({
  page,
}) => {
  await injectSession(page, superAdmin);
  await page.goto("/users");
  const footer = page.getByText(/Menampilkan \d+[–-]\d+ dari [\d.]+ data/);
  const totalOf = async () =>
    Number(
      /dari ([\d.]+) data/
        .exec((await footer.textContent()) ?? "")?.[1]
        .replace(/\./g, ""),
    );
  await expect(footer).toBeVisible();
  const all = await totalOf();

  const filtered = page.waitForResponse(
    (r) => r.url().includes("/users?") && r.url().includes("realm=SD_IT"),
  );
  await page.getByRole("combobox").filter({ hasText: "All Realms" }).click();
  await page.getByRole("option", { name: "SD IT" }).click();
  await filtered;
  await expect(footer).toBeVisible();
  const sdit = await totalOf();

  // Fewer than all, more than nothing — counted by the API, so the footer
  // and the pages agree.
  expect(sdit).toBeGreaterThan(0);
  expect(sdit).toBeLessThan(all);
});

test("a unit admin acts only on accounts of the unit that need no 2FA", async () => {
  const units = await apiRequest<{ data: Array<{ id: string; type: string }> }>(
    superAdmin,
    "GET",
    "/units?limit=50",
  );
  const unitOf = (type: string) => units.data.find((u) => u.type === type)!.id;
  const create = async (role: string, unitType: string, tag: string) => {
    const res = await apiRequest<{ data: { id: string } }>(
      superAdmin,
      "POST",
      "/users",
      {
        name: `Uji Cakupan ${tag}`,
        email: `cakupan.${tag}.${STAMP}@example.test`,
        password: PASSWORD,
        role,
        unitId: unitOf(unitType),
      },
    );
    created.push(res.data.id);
    return res.data.id;
  };

  const otherUnit = await create("TEACHER", "SMP_IT", "smp");
  const peerAdmin = await create("UNIT_ADMIN", "SD_IT", "admin");
  const ownTeacher = await create("TEACHER", "SD_IT", "guru");

  // Another unit's account: nothing.
  expect(
    await statusOf(apiRequest(sditAdmin, "DELETE", `/users/${otherUnit}`)),
  ).toBe(403);
  expect(
    await statusOf(
      apiRequest(
        sditAdmin,
        "POST",
        `/users/${otherUnit}/require-password-change`,
      ),
    ),
  ).toBe(403);
  expect(
    await statusOf(
      apiRequest(sditAdmin, "POST", "/auth/send-password-reset", {
        userId: otherUnit,
      }),
    ),
  ).toBe(403);

  // A peer who must use 2FA: not deleted, not switched off, email unchanged.
  expect(
    await statusOf(apiRequest(sditAdmin, "DELETE", `/users/${peerAdmin}`)),
  ).toBe(403);
  expect(
    await statusOf(
      apiRequest(sditAdmin, "PUT", `/users/${peerAdmin}`, { isActive: false }),
    ),
  ).toBe(403);
  expect(
    await statusOf(
      apiRequest(sditAdmin, "PUT", `/users/${peerAdmin}`, {
        email: `diambil.${STAMP}@example.test`,
      }),
    ),
  ).toBe(403);

  // Not one's own account either.
  expect(
    await statusOf(
      apiRequest(sditAdmin, "DELETE", `/users/${sditAdmin.user.id}`),
    ),
  ).toBe(400);

  // A teacher of the unit: yes.
  expect(
    await statusOf(apiRequest(sditAdmin, "DELETE", `/users/${ownTeacher}`)),
  ).toBe(200);
});
