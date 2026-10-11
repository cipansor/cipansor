import { test, expect } from "./fixtures/auth.fixture";
import {
  apiLogin,
  apiRequest,
  injectSession,
  SEED_USERS,
  type AuthSession,
} from "./helpers/auth-api";
import { gotoAuthedPage } from "./helpers/page-helpers";
import { DEMO_ACCOUNTS } from "../../../packages/shared/src/types/demo-accounts";

/**
 * The pesantren's ustadz, musyrif and muhafidz serve the santri of every
 * school — the asrama houses SD IT, SMP IT and SMA Qur'an together — so their
 * muhadhoroh, muhadatsah, kitab and ibadah screens reach every unit's santri,
 * and a record they write belongs to the santri's unit. A school's teacher
 * reaches their school; a santri their own records.
 *
 * Against the real API and Postgres: the unit pickers, the cross-unit write
 * and the refusals are what the services' unit tests cannot see wired.
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
interface Student {
  id: string;
  userId?: string;
  user?: { id: string; name: string };
}

const STAMP = Date.now().toString(36);
const topic = `Adab bertetangga ${STAMP}`;

let admin: AuthSession;
let ustadz: AuthSession;
let musyrif: AuthSession;
let guruSmp: AuthSession;
let santriSma: AuthSession;
let sma: Unit;
let smaSantri: Student;

test.beforeAll(async () => {
  admin = await apiLogin(SEED_USERS.superAdmin);
  ustadz = await apiLogin(account("pesantren.ustadz@cipansor.or.id"));
  musyrif = await apiLogin(account("pesantren.musyrif@cipansor.or.id"));
  guruSmp = await apiLogin(account("smpit.guru@cipansor.or.id"));
  santriSma = await apiLogin(account("smaq.siswa@cipansor.or.id"));

  const units = await apiRequest<{ data: Unit[] }>(
    admin,
    "GET",
    "/units?limit=100",
  );
  const found = units.data.find((u) => u.type === "SMA_QURAN");
  if (!found) throw new Error("No SMA Qur'an unit seeded");
  sma = found;
  const students = await apiRequest<{ data: Student[] }>(
    admin,
    "GET",
    `/students?unitId=${sma.id}&status=active&limit=5`,
  );
  // Not the santri account used below, so its own list proves a boundary.
  const other = students.data.find(
    (s) => (s.userId ?? s.user?.id) !== santriSma.user.id,
  );
  if (!other) throw new Error("No SMA Qur'an santri seeded");
  smaSantri = other;
});

test.describe("the pesantren's staff reach every school's santri", () => {
  test("the ustadz is offered every school in the muhadhoroh form", async ({
    page,
  }) => {
    await injectSession(page, ustadz);
    await gotoAuthedPage(page, "/muhadhoroh/new", "Jadwalkan Muhadhoroh");
    await page
      .getByRole("combobox")
      .filter({ hasText: /^Pilih unit\.\.\.$/ })
      .click();
    await expect(page.getByRole("option", { name: sma.name })).toBeVisible();
    await expect(page.getByRole("option", { name: /^SD IT/ })).toBeVisible();
  });

  test("the ustadz schedules one for an SMA Qur'an santri; it is the santri's unit's and on their list", async ({
    page,
  }) => {
    const created = await apiRequest<{ data: { id: string; unitId: string } }>(
      ustadz,
      "POST",
      "/muhadhoroh",
      {
        studentId: smaSantri.id,
        scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        topic,
      },
    );
    expect(created.data.unitId).toBe(sma.id);

    await injectSession(page, ustadz);
    await gotoAuthedPage(page, "/muhadhoroh", "Muhadhoroh");
    await expect(page.getByText(topic).first()).toBeVisible();

    // The musyrif reads it as well; a school's teacher elsewhere does not.
    const seen = await apiRequest<{ data: Array<{ topic: string }> }>(
      musyrif,
      "GET",
      "/muhadhoroh?limit=100",
    );
    expect(seen.data.map((r) => r.topic)).toContain(topic);
    const notSeen = await apiRequest<{ data: Array<{ topic: string }> }>(
      guruSmp,
      "GET",
      "/muhadhoroh?limit=100",
    );
    expect(notSeen.data.map((r) => r.topic)).not.toContain(topic);
  });

  test("a school's teacher cannot schedule one for another school's santri", async () => {
    await expect(
      apiRequest(guruSmp, "POST", "/muhadhoroh", {
        studentId: smaSantri.id,
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        topic: `Tidak boleh ${STAMP}`,
      }),
    ).rejects.toThrow(/→ 404/);
  });

  test("a santri reads their own muhadhoroh, not their unit's", async () => {
    const own = await apiRequest<{ data: Array<{ topic: string }> }>(
      santriSma,
      "GET",
      `/muhadhoroh?unitId=${sma.id}&limit=100`,
    );
    expect(own.data.map((r) => r.topic)).not.toContain(topic);
  });

  test("the musyrif's ibadah ranking offers every school", async ({ page }) => {
    await injectSession(page, musyrif);
    await gotoAuthedPage(page, "/ibadah/leaderboard", "Papan Peringkat Ibadah");
    await page.getByRole("combobox", { name: "Unit" }).click();
    await expect(page.getByRole("option", { name: sma.name })).toBeVisible();
  });
});

test.describe("the ibadah ranking", () => {
  test("names each santri as the API does — never 'Unknown'", async ({
    page,
  }) => {
    const units = await apiRequest<{ data: Unit[] }>(
      admin,
      "GET",
      "/units?limit=100",
    );
    let rows: Array<{ studentName: string }> = [];
    let unitName = "";
    for (const u of units.data) {
      const lb = await apiRequest<{
        data: { data: Array<{ studentName: string }> };
      }>(
        admin,
        "GET",
        `/ibadah/leaderboard?unitId=${u.id}&periodType=SEMESTER&limit=10`,
      );
      if (lb.data.data.length > 0) {
        rows = lb.data.data;
        unitName = u.name;
        break;
      }
    }
    test.skip(rows.length === 0, "No ibadah records seeded in any unit");

    await injectSession(page, admin);
    await gotoAuthedPage(page, "/ibadah/leaderboard", "Papan Peringkat Ibadah");
    const unit = page.getByRole("combobox", { name: "Unit" });
    if (await unit.isVisible()) {
      await unit.click();
      await page.getByRole("option", { name: unitName }).click();
    }
    await page.getByRole("combobox").filter({ hasText: "Minggu Ini" }).click();
    await page.getByRole("option", { name: "Semester" }).click();
    await expect(page.getByText(rows[0].studentName).first()).toBeVisible();
    await expect(page.getByText("Unknown")).toHaveCount(0);
  });
});

test.describe("the ibadah ranking reads the santri an account reaches", () => {
  interface Row {
    rank: number;
    studentId: string;
    studentName: string;
    userId: string | null;
  }
  let smp: Unit;
  let santriSmp: AuthSession;
  let ownId: string;

  const ranking = async (who: AuthSession, unitId?: string) =>
    (
      await apiRequest<{ data: { data: Row[] } }>(
        who,
        "GET",
        `/ibadah/leaderboard?periodType=WEEKLY&limit=100${unitId ? `&unitId=${unitId}` : ""}`,
      )
    ).data.data;

  test.beforeAll(async () => {
    santriSmp = await apiLogin(account("smpit.siswa@cipansor.or.id"));
    const units = await apiRequest<{ data: Unit[] }>(
      admin,
      "GET",
      "/units?limit=100",
    );
    const found = units.data.find((u) => u.type === "SMP_IT");
    if (!found) throw new Error("No SMP IT unit seeded");
    smp = found;

    const name = String(santriSmp.user.name ?? "");
    const mine = await apiRequest<{ data: Student[] }>(
      admin,
      "GET",
      `/students?unitId=${smp.id}&search=${encodeURIComponent(name)}&limit=20`,
    );
    const own = mine.data.find(
      (s) => (s.userId ?? s.user?.id) === santriSmp.user.id,
    );
    if (!own) throw new Error("The SMP IT santri account has no santri row");
    ownId = own.id;
    const others = await apiRequest<{ data: Student[] }>(
      admin,
      "GET",
      `/students?unitId=${smp.id}&status=active&limit=5`,
    );
    const other = others.data.find((s) => s.id !== ownId);
    if (!other) throw new Error("No second SMP IT santri seeded");

    // The other santri's last three days in full (3 × 45 points), the
    // santri's own today in part (10, plus at most 35 the seed gives): the
    // santri's place is then below someone they must not see.
    const day = (ago: number) =>
      new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
    for (const ago of [0, 1, 2]) {
      await apiRequest(admin, "POST", "/ibadah/check-in", {
        studentId: other.id,
        date: day(ago),
        sholatTahajud: true,
        sholatDhuha: true,
        tilawahPages: 5,
      });
    }
    await apiRequest(admin, "POST", "/ibadah/check-in", {
      studentId: ownId,
      date: day(0),
      sholatDhuha: true,
    });
  });

  test("a santri reads only their own row, at their place in the unit", async ({
    page,
  }) => {
    const rows = await ranking(santriSmp);
    expect(rows).toHaveLength(1);
    expect(rows[0].studentId).toBe(ownId);

    const unit = await ranking(admin, smp.id);
    const place = unit.find((r) => r.studentId === ownId);
    expect(unit.length).toBeGreaterThan(1);
    expect(rows[0].rank).toBe(place?.rank);
    expect(rows[0].rank).toBeGreaterThan(1);

    // The page says it is their place, and names no one else.
    const ahead = unit.find((r) => r.studentId !== ownId)!;
    await injectSession(page, santriSmp);
    await gotoAuthedPage(page, "/ibadah/leaderboard", "Papan Peringkat Ibadah");
    await expect(page.getByText("Peringkatmu")).toBeVisible();
    await expect(page.getByText(rows[0].studentName).first()).toBeVisible();
    await expect(page.getByText(ahead.studentName)).toHaveCount(0);
  });

  test("a santri's records are their own", async () => {
    const records = await apiRequest<{ data: Array<{ studentId: string }> }>(
      santriSmp,
      "GET",
      "/ibadah/records?limit=100",
    );
    expect(records.data.length).toBeGreaterThan(0);
    expect(new Set(records.data.map((r) => r.studentId))).toEqual(
      new Set([ownId]),
    );
  });

  test("a school's teacher reads their school, not another, and picks no unit", async ({
    page,
  }) => {
    const ownSchool = await ranking(guruSmp);
    const smpIds = new Set(
      (await ranking(admin, smp.id)).map((r) => r.studentId),
    );
    expect(ownSchool.length).toBeGreaterThan(0);
    for (const r of ownSchool) expect(smpIds).toContain(r.studentId);
    expect(await ranking(guruSmp, sma.id)).toHaveLength(0);

    await injectSession(page, guruSmp);
    await gotoAuthedPage(page, "/ibadah/leaderboard", "Papan Peringkat Ibadah");
    await expect(page.getByRole("combobox", { name: "Unit" })).toHaveCount(0);
  });

  test("the musyrif reads every unit and narrows to one", async () => {
    const all = (await ranking(musyrif)).map((r) => r.studentId).sort();
    expect(all).toEqual((await ranking(admin)).map((r) => r.studentId).sort());
    const narrowed = (await ranking(musyrif, smp.id)).map((r) => r.studentId);
    expect(narrowed.sort()).toEqual(
      (await ranking(admin, smp.id)).map((r) => r.studentId).sort(),
    );
    expect(narrowed).toContain(ownId);
  });
});
