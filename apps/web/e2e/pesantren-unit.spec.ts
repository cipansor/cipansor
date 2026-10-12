import { test, expect } from "./fixtures/auth.fixture";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
  type AuthSession,
} from "./helpers/auth-api";
import { DEMO_ACCOUNTS } from "../../../packages/shared/src/types/demo-accounts";

/**
 * The pesantren has its own unit: the Kiai heads it, and the Tata Usaha
 * Pesantren, ustadz, musyrif and muhafidz belong to it. The santri they serve
 * stay in their schools, so moving them must not cut them off — the asrama's
 * laundry, recorded under the unit whose business staff run it, and the
 * staff dashboard's counts, which used to be pinned to the reader's own unit.
 *
 * Against the real API and Postgres, with the seed as the migration leaves a
 * database that already had the four schools.
 */

const account = (email: string) => {
  const found = DEMO_ACCOUNTS.find((a) => a.email === email);
  if (!found) throw new Error(`No demo account ${email}`);
  return { email: found.email, password: found.password };
};

interface Unit {
  id: string;
  name: string;
  type: string;
}
interface LaundryTx {
  id: string;
  unitId: string;
  studentId: string;
}
interface Student {
  id: string;
}

const PESANTREN_EMAILS = [
  "pesantren.pengasuh@cipansor.or.id",
  "pesantren.tu@cipansor.or.id",
  "pesantren.ustadz@cipansor.or.id",
  "pesantren.musyrif@cipansor.or.id",
  "pesantren.muhafidz@cipansor.or.id",
];

let admin: AuthSession;
let pesantren: Unit;
let smp: Unit;

test.beforeAll(async () => {
  admin = await apiLogin(SEED_USERS.superAdmin);
  const units = await apiRequest<{ data: Unit[] }>(
    admin,
    "GET",
    "/units?limit=100",
  );
  const p = units.data.find((u) => u.type === "PESANTREN");
  const s = units.data.find((u) => u.type === "SMP_IT");
  if (!p || !s) throw new Error("The Pesantren and SMP IT units must exist");
  pesantren = p;
  smp = s;
});

test.describe("the Pesantren unit", () => {
  test("is the home of the Kiai, TU Pesantren and the pesantren's educators", async () => {
    expect(pesantren.name).toBe("Pesantren Cipansor");
    for (const email of PESANTREN_EMAILS) {
      const session = await apiLogin(account(email));
      expect(session.user.unitId, email).toBe(pesantren.id);
    }
    // The shared services stay where they were until the organisation tree
    // places them.
    const perawat = await apiLogin(account("sarana.perawat@cipansor.or.id"));
    expect(perawat.user.unitId).toBe(smp.id);
  });

  test("a musyrif still reads the asrama's laundry, recorded under SMP IT", async () => {
    const musyrif = await apiLogin(account("pesantren.musyrif@cipansor.or.id"));
    const res = await apiRequest<{ data: LaundryTx[] }>(
      musyrif,
      "GET",
      "/laundry/transactions",
    );
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.some((t) => t.unitId === smp.id)).toBe(true);
  });

  test("a wali reads only their own children's laundry", async () => {
    const wali = await apiLogin(account("smpit.ortu@cipansor.or.id"));
    const children = await apiRequest<{ data: Student[] }>(
      wali,
      "GET",
      "/parent/children",
    );
    const mine = new Set(children.data.map((s) => s.id));
    expect(mine.size).toBeGreaterThan(0);
    const all = await apiRequest<{ data: LaundryTx[] }>(
      admin,
      "GET",
      "/laundry/transactions",
    );
    // The seed has laundry for a santri who is not this wali's child, so an
    // unscoped list would show it.
    expect(all.data.some((t) => !mine.has(t.studentId))).toBe(true);
    const res = await apiRequest<{ data: LaundryTx[] }>(
      wali,
      "GET",
      "/laundry/transactions",
    );
    for (const t of res.data) expect(mine.has(t.studentId)).toBe(true);
  });

  test("TU Pesantren's dashboard counts every unit's santri, not its own unit's", async ({
    page,
  }) => {
    const tu = await apiLogin(account("pesantren.tu@cipansor.or.id"));
    await injectSession(page, tu);
    const summary = page.waitForRequest((r) =>
      r.url().includes("/api/attendance/summary"),
    );
    await page.goto("/staff");
    const url = new URL((await summary).url());
    expect(url.searchParams.has("unitId")).toBe(false);
  });

  test("a musyrif's Mutabaah Yaumiyah offers every unit, not only their own", async ({
    page,
  }) => {
    const musyrif = await apiLogin(account("pesantren.musyrif@cipansor.or.id"));
    await injectSession(page, musyrif);
    // The page asks for one unit's classes as soon as it knows the units — a
    // locked reader would ask for none, or only ever for their own.
    const classes = page.waitForRequest(
      (r) => r.url().includes("/api/classes") && r.url().includes("unitId="),
    );
    await page.goto("/daily-report");
    expect(
      new URL((await classes).url()).searchParams.get("unitId"),
    ).toBeTruthy();
    await page.getByRole("combobox", { name: "Unit" }).click();
    for (const school of [
      "SD IT Cipansor",
      "SMP IT Cipansor",
      "SMA Qur'an Cipansor",
    ]) {
      await expect(page.getByRole("option", { name: school })).toBeVisible();
    }
  });

  test("a school's TU still counts its own unit", async ({ page }) => {
    const tu = await apiLogin(account("smpit.tu@cipansor.or.id"));
    await injectSession(page, tu);
    const summary = page.waitForRequest((r) =>
      r.url().includes("/api/attendance/summary"),
    );
    await page.goto("/staff");
    const url = new URL((await summary).url());
    expect(url.searchParams.get("unitId")).toBe(smp.id);
  });
});
