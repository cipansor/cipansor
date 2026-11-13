import { test, expect } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  loginAs,
  SEED_USERS,
  type AuthSession,
} from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";

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

test.describe("Menu Makan — tombol tulis hanya untuk penulis", () => {
  test("peran hanya-baca (Pengawas) tidak melihat tombol Tambah Menu", async ({
    page,
  }) => {
    // The write routes admit an explicit writer list, not the legacy UNIT_ADMIN
    // bucket that expanded to the yayasan organs. The page hides the buttons for
    // a role the API would answer 403 (CWE-863), so nobody presses a door that
    // does not open.
    await loginAs(page, "pengawas");
    await page.goto("/meals/menus");

    await expect(page.getByRole("link", { name: "Tambah Menu" })).toHaveCount(
      0,
    );
  });

  test("admin unit melihat tombol Tambah Menu", async ({ page }) => {
    await loginAs(page, "adminSdit");
    await page.goto("/meals/menus");

    await expect(page.getByRole("link", { name: "Tambah Menu" })).toBeVisible();
  });
});

/**
 * The button gate is not one page but three: the list (`/meals/menus`), the
 * day tab (`/meals`) and the detail (`/meals/menus/:id`) each read
 * `useCanManageMeals`. The list had a test; the other two did not, so a button
 * that `403`s could sit on the detail page unnoticed — the exact shape of the
 * CWE-863 this PR closes. This block walks every writer/reader surface, then
 * drives the real delete flow on the detail page so the button that *is* shown
 * is the button that *works*.
 *
 * Its own menu (a far-future SNACK on SD IT) keeps it off the other block's
 * fixture; the delete flow runs last, so the block is serial.
 */
test.describe("Menu Makan — gerbang tombol per peran di setiap layar", () => {
  test.describe.configure({ mode: "serial" });

  let writer: AuthSession;
  let unitId = "";
  let menuId = "";
  // The five browser projects run this block in parallel. Give each its own
  // date — the model is unique on (unitId, date, mealType) — so one project's
  // fixture (and its later delete) never touches another's.
  let mainDish = "";
  let fixtureDate = "";

  test.beforeAll(async () => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini menulis menu, jadi dilewati",
    );
    const offset = [...test.info().project.name].reduce(
      (n, c) => n + c.charCodeAt(0),
      0,
    );
    mainDish = `Puding Uji Gerbang ${offset}`;
    fixtureDate = new Date(
      Date.UTC(2032, 11, 1) + (offset % 300) * 86_400_000,
    ).toISOString();

    writer = await apiLogin(SEED_USERS.adminSdit);
    unitId = writer.user.unitId as string;
    expect(unitId, "the SD IT admin belongs to a unit").toBeTruthy();

    try {
      const created = await apiRequest<{ data: { id: string } }>(
        writer,
        "POST",
        "/meals/menus",
        {
          unitId,
          date: fixtureDate,
          mealType: "SNACK",
          mainDish,
          drink: "Air Hangat",
        },
      );
      menuId = created.data.id;
    } catch (error) {
      // A previous run may have left the row behind (a failure before teardown).
      if (!String(error).includes("409")) throw error;
      const found = await apiRequest<{
        data: { id: string; mainDish: string }[];
      }>(
        writer,
        "GET",
        `/meals/menus?unitId=${unitId}&mealType=SNACK&limit=100`,
      );
      menuId = found.data.find((m) => m.mainDish === mainDish)?.id ?? "";
      expect(menuId, "the leftover fixture is found").toBeTruthy();
    }
  });

  test.afterAll(async () => {
    if (!writer || !menuId) return;
    await apiRequest(writer, "DELETE", `/meals/menus/${menuId}`).catch(
      () => undefined,
    );
  });

  test("tab Menu Hari Ini (/meals): Pengawas tidak melihat Tambah Menu", async ({
    page,
  }) => {
    await loginAs(page, "pengawas");
    await page.goto("/meals");

    await expect(page.getByText("Manajemen Menu Makan")).toBeVisible();
    await expect(page.getByRole("link", { name: "Tambah Menu" })).toHaveCount(
      0,
    );
  });

  test("tab Menu Hari Ini (/meals): admin unit melihat Tambah Menu", async ({
    page,
  }) => {
    await loginAs(page, "adminSdit");
    await page.goto("/meals");

    await expect(page.getByRole("link", { name: "Tambah Menu" })).toBeVisible();
  });

  test("detail menu: Pengawas membaca tanpa tombol Edit/Hapus, dan API menolak", async ({
    page,
  }) => {
    const pengawas = await loginAs(page, "pengawas");
    await page.goto(`/meals/menus/${menuId}`);

    // The row is readable (foundation scope widens the read) ...
    await expect(page.getByText(mainDish)).toBeVisible();
    // ... but the write buttons are gone, not merely refused on click.
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Hapus" })).toHaveCount(0);

    // The API agrees: the hidden button is a door that does not open (CWE-863).
    await expect(
      apiRequest(pengawas, "PUT", `/meals/menus/${menuId}`, {
        mainDish: "Ditolak",
      }),
    ).rejects.toThrow(/→ 403/);
    await expect(
      apiRequest(pengawas, "DELETE", `/meals/menus/${menuId}`),
    ).rejects.toThrow(/→ 403/);
  });

  test("detail menu: admin unit melihat tombol Edit dan Hapus", async ({
    page,
  }) => {
    await loginAs(page, "adminSdit");
    await page.goto(`/meals/menus/${menuId}`);

    await expect(page.getByRole("link", { name: "Edit" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hapus" })).toBeVisible();
  });

  test("detail menu: admin unit menghapus lewat halaman detail", async ({
    page,
  }) => {
    await loginAs(page, "adminSdit");
    await page.goto(`/meals/menus/${menuId}`);

    await page.getByRole("button", { name: "Hapus" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Hapus" })
      .click();

    // The page returns to the list and the row is gone for real.
    await page.waitForURL((url) => url.pathname === "/meals/menus");
    await expect(
      apiRequest(writer, "GET", `/meals/menus/${menuId}`),
    ).rejects.toThrow(/→ 404/);
    menuId = "";
  });
});
