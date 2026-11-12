import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  loginAs,
  SEED_USERS,
  type AuthSession,
} from "./helpers/auth-api";

/**
 * Menu Makan (/meals) — the "Menu Hari Ini" tab must load today's menu.
 *
 * The page used to call `GET /meals/menus/today?unitId=`, a path no route
 * answers: `/menus/:id` matched it with `id = "today"` and returned 404, so the
 * four cards were always empty (#849). The canonical route carries the unit in
 * the path (`GET /meals/menus/today/:unitId`), and "Semua Unit" has no
 * aggregation (K5) — the tab asks the user to pick one unit.
 */

interface Unit {
  id: string;
  name: string;
  type: string;
}

const TODAY_WIB = new Date().toLocaleDateString("en-CA", {
  timeZone: "Asia/Jakarta",
});

let admin: AuthSession;
let sd: Unit;

test.beforeAll(async () => {
  admin = await apiLogin(SEED_USERS.superAdmin);
  const units = await apiRequest<{ data: Unit[] }>(
    admin,
    "GET",
    "/units?limit=100",
  );
  const s = units.data.find((u) => u.type === "SD_IT");
  if (!s) throw new Error("The SD IT unit must exist");
  sd = s;

  // The seed's own menus use `new Date()`, which lands on the wrong `@db.Date`
  // day between 00:00 and 06:59 WIB — so this spec seeds its own menu for the
  // WIB day, on a unit the seed leaves menu-free, and is deterministic at any
  // hour. A retry re-runs this setup, so a conflict means it is already there.
  try {
    await apiRequest(admin, "POST", "/meals/menus", {
      unitId: sd.id,
      date: `${TODAY_WIB}T00:00:00.000Z`,
      mealType: "BREAKFAST",
      mainDish: "Bubur Ayam Spesial",
      drink: "Teh Hangat",
      calories: 400,
    });
  } catch (error) {
    if (!String(error).includes("409")) throw error;
  }
});

test.describe("Menu Makan — tab Menu Hari Ini", () => {
  test("meminta menu hari ini lewat rute ber-unitId dan menampilkannya", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");

    // The today-menu request must carry the unit in the PATH, not as a query on
    // a path the router does not serve.
    const todayRequest = page.waitForRequest((r) =>
      /\/meals\/menus\/today\/[^/?]+/.test(r.url()),
    );
    await page.goto("/meals");

    // "Semua Unit" is the initial state: no aggregation, so the tab asks for a
    // unit instead of firing a request.
    await expect(
      page.getByText("Pilih satu unit untuk melihat menu hari ini."),
    ).toBeVisible();

    // Pick SD IT.
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: sd.name, exact: true }).click();

    const requested = new URL((await todayRequest).url());
    expect(requested.pathname).toContain(`/meals/menus/today/${sd.id}`);
    expect(requested.searchParams.get("unitId")).toBeNull();

    // The menu created for today must render in the card, not an empty
    // "Belum ada menu".
    await expect(page.getByText("Bubur Ayam Spesial")).toBeVisible();
  });

  test("peran yayasan membaca menu unit yang dipilih, bukan 403 (#849)", async ({
    page,
  }) => {
    // A yayasan account carries no `unitId`; the service used to compare it to
    // the requested unit and answer 403, so the tab stayed empty for the one
    // role that can pick any unit. `actorReachesUnit` lets a foundation role
    // read the unit it names.
    await loginAs(page, "ketuaPengurus");

    const todayRequest = page.waitForResponse((r) =>
      /\/meals\/menus\/today\/[^/?]+/.test(r.url()),
    );
    await page.goto("/meals");

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: sd.name, exact: true }).click();

    const response = await todayRequest;
    expect(response.status()).toBe(200);
    await expect(page.getByText("Bubur Ayam Spesial")).toBeVisible();
  });
});
