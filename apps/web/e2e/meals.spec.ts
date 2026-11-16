import { test, expect, type Page } from "@playwright/test";
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
  // hour. `date` is a calendar day ("yyyy-MM-dd"), the contract the create
  // route validates (#1081). A retry re-runs this setup, so a conflict means it
  // is already there.
  try {
    await apiRequest(admin, "POST", "/meals/menus", {
      unitId: sd.id,
      date: TODAY_WIB,
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
    // `date` is a calendar day ("yyyy-MM-dd") — the create route's contract
    // (#1081) — so a full ISO datetime would be a 400, not the 409 this setup
    // treats as "already there".
    fixtureDate = new Date(Date.UTC(2032, 11, 1) + (offset % 300) * 86_400_000)
      .toISOString()
      .slice(0, 10);

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

/**
 * The Edit flow, end to end (#1081).
 *
 * Saving the Edit form used to answer `500`: the form sent `name`, `dayType`
 * and `nutritionInfo`, none of which is a column of `MealMenu`, and the service
 * forwarded the body to Prisma raw. The form now follows the model's columns
 * (the `@cipansor/shared` contract) and the service maps them one by one, so
 * the same save must land and the detail page must show the new value.
 *
 * Its own fixture (a far-future DINNER on SD IT) keeps it off the other blocks;
 * the flow runs against a menu it creates and deletes itself, so it is serial
 * and self-contained.
 */
test.describe("Menu Makan — alur Edit menyimpan perubahan (#1081)", () => {
  test.describe.configure({ mode: "serial" });

  let writer: AuthSession;
  let unitId = "";
  let menuId = "";
  let fixtureDate = "";
  const originalDish = "Ikan Uji Edit 1081";
  const editedDish = "Ikan Uji Edit 1081 (diubah)";

  test.beforeAll(async () => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini menulis menu, jadi dilewati",
    );
    const offset = [...test.info().project.name].reduce(
      (n, c) => n + c.charCodeAt(0),
      0,
    );
    fixtureDate = new Date(Date.UTC(2033, 6, 1) + (offset % 300) * 86_400_000)
      .toISOString()
      .slice(0, 10);

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
          mealType: "DINNER",
          mainDish: originalDish,
          drink: "Air Hangat",
        },
      );
      menuId = created.data.id;
    } catch (error) {
      if (!String(error).includes("409")) throw error;
      const found = await apiRequest<{
        data: { id: string; mainDish: string }[];
      }>(
        writer,
        "GET",
        `/meals/menus?unitId=${unitId}&mealType=DINNER&limit=100`,
      );
      menuId = found.data.find((m) => m.mainDish === originalDish)?.id ?? "";
      expect(menuId, "the leftover fixture is found").toBeTruthy();
    }
  });

  test.afterAll(async () => {
    if (!writer || !menuId) return;
    await apiRequest(writer, "DELETE", `/meals/menus/${menuId}`).catch(
      () => undefined,
    );
  });

  test("menyimpan Edit menjawab 200 dan detail menampilkan nilai baru", async ({
    page,
  }) => {
    await loginAs(page, "adminSdit");

    // The request must be a 2xx — the whole point of the fix is that it is no
    // longer a 500.
    const saved = page.waitForResponse(
      (r) =>
        r.url().includes(`/meals/menus/${menuId}`) &&
        r.request().method() === "PUT",
    );

    await page.goto(`/meals/menus/${menuId}/edit`);

    // The Edit form has no `name` field any more — it edits the model's columns.
    const mainDish = page.getByLabel("Hidangan Utama");
    await expect(mainDish).toHaveValue(originalDish);
    await mainDish.fill(editedDish);
    await page.getByRole("button", { name: "Simpan" }).click();

    const response = await saved;
    expect(response.status()).toBe(200);

    // Back on the detail page, showing the saved value.
    await page.waitForURL((url) => url.pathname === `/meals/menus/${menuId}`);
    await expect(page.getByText(editedDish)).toBeVisible();

    // The API agrees, so the assertion is not just the UI's optimism.
    const reread = await apiRequest<{ data: { mainDish: string } }>(
      writer,
      "GET",
      `/meals/menus/${menuId}`,
    );
    expect(reread.data.mainDish).toBe(editedDish);
  });

  test("mengosongkan kalori menghapus nilai lama (#1081)", async ({ page }) => {
    // Beri fixture sebuah nilai kalori lewat API, lalu kosongkan di formulir dan
    // simpan. Sebelum perbaikan, isian kosong menjadi `undefined` yang hilang
    // dari JSON, sehingga angka lama tetap tersimpan dan formulir melaporkan
    // sukses — persis keluhan pemilik (#1081). Sekarang kosong dikirim `null`
    // dan kolomnya benar-benar dikosongkan.
    await apiRequest(writer, "PUT", `/meals/menus/${menuId}`, {
      calories: 650,
    });

    await loginAs(page, "adminSdit");
    const saved = page.waitForResponse(
      (r) =>
        r.url().includes(`/meals/menus/${menuId}`) &&
        r.request().method() === "PUT",
    );
    await page.goto(`/meals/menus/${menuId}/edit`);

    const calories = page.getByLabel("Kalori (kkal)");
    await expect(calories).toHaveValue("650");
    await calories.fill("");
    await page.getByRole("button", { name: "Simpan" }).click();

    const response = await saved;
    expect(response.status()).toBe(200);

    const reread = await apiRequest<{ data: { calories: number | null } }>(
      writer,
      "GET",
      `/meals/menus/${menuId}`,
    );
    expect(reread.data.calories ?? null).toBeNull();
  });
});

/**
 * The New-menu flow, end to end (#1081).
 *
 * The Edit flow above builds its fixture through the API, so it never exercises
 * the New form: a broken adapter there — a field the contract rejects, a date
 * the picker formats wrongly — would leave the Edit tests green while creating a
 * menu stayed broken. This block drives the real form (pick unit and date, fill
 * the dishes, save) and reads the result back through the API. It also pins the
 * two behaviours review asked for: empty calories is allowed on create, and an
 * invalid field is refused with an Indonesian message instead of a request.
 *
 * Each browser project gets its own dates within the current month — the picker
 * opens on the month of "today" — so the parallel projects never collide on the
 * model's unique (unit, date, meal type) key.
 */
test.describe("Menu Makan — alur Tambah Menu (#1081)", () => {
  test.describe.configure({ mode: "serial" });

  let writer: AuthSession;
  let unitName = "";
  let unitId = "";
  let offset = 0;
  let yearMonth = "";

  /** A day of the current month, distinct per project and per test index. */
  const dayFor = (index: number) => 1 + (((offset % 27) + index * 9) % 27);
  const isoFor = (index: number) =>
    `${yearMonth}-${String(dayFor(index)).padStart(2, "0")}`;
  const dishFor = (index: number) => `Menu Baru Uji ${offset} ${index}`;

  test.beforeAll(async () => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini menulis menu, jadi dilewati",
    );
    offset = [...test.info().project.name].reduce(
      (n, c) => n + c.charCodeAt(0),
      0,
    );
    // The date picker's default value is "today", so the calendar opens on this
    // month; the fixture dates must live in it. WIB, matching the browser.
    yearMonth = new Date()
      .toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })
      .slice(0, 7);

    writer = await apiLogin(SEED_USERS.adminSdit);
    unitId = writer.user.unitId as string;
    expect(unitId, "the SD IT admin belongs to a unit").toBeTruthy();
    const units = await apiRequest<{ data: { id: string; name: string }[] }>(
      writer,
      "GET",
      "/units?limit=100",
    );
    unitName =
      units.data.find((u) => u.id === unitId)?.name ??
      units.data[0]?.name ??
      "";

    // Clear leftovers from a previous run (a failure before teardown): a create
    // on a date that already holds a menu is a 409, not the 201 the test wants.
    const existing = await apiRequest<{
      data: { id: string; mainDish: string }[];
    }>(writer, "GET", `/meals/menus?unitId=${unitId}&limit=100`);
    for (const m of existing.data) {
      if (m.mainDish.startsWith(`Menu Baru Uji ${offset} `)) {
        await apiRequest(writer, "DELETE", `/meals/menus/${m.id}`).catch(
          () => undefined,
        );
      }
    }
  });

  test.afterAll(async () => {
    if (!writer) return;
    const existing = await apiRequest<{
      data: { id: string; mainDish: string }[];
    }>(writer, "GET", `/meals/menus?unitId=${unitId}&limit=100`);
    for (const m of existing.data) {
      if (m.mainDish.startsWith(`Menu Baru Uji ${offset} `)) {
        await apiRequest(writer, "DELETE", `/meals/menus/${m.id}`).catch(
          () => undefined,
        );
      }
    }
  });

  /** Pick the unit, fill the main dish, and choose this test's date. */
  const fillForm = async (page: Page, index: number) => {
    // The unit select renders no text until a unit is chosen, so it is found by
    // the card it sits in rather than by its placeholder.
    const unitCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Unit Pendidikan" });
    await unitCard.getByRole("combobox").click();
    await page.getByRole("option", { name: unitName, exact: true }).click();

    await page.getByLabel("Hidangan Utama").fill(dishFor(index));

    // The picker shows the date as dd/MM/yyyy; opening it and clicking the
    // day's grid cell sets both the value and the popover's label.
    await page.locator('button[data-slot="popover-trigger"]').click();
    await page.locator(`td[data-day="${isoFor(index)}"] button`).click();
    // Dismiss the popover by clicking the card title, so it cannot overlay the
    // submit button (Escape alone can leave it open).
    await unitCard.locator('[data-slot="card-title"]').click();
  };

  test("menyimpan Tambah Menu membuat menu baru lewat formulir", async ({
    page,
  }) => {
    await loginAs(page, "adminSdit");
    await page.goto("/meals/menus/new");

    const created = page.waitForResponse(
      (r) =>
        r.url().includes("/meals/menus") && r.request().method() === "POST",
    );
    await fillForm(page, 0);
    await page.getByRole("button", { name: "Simpan Menu" }).click();

    const response = await created;
    expect(response.status()).toBe(201);

    await page.waitForURL((url) => url.pathname === "/meals/menus");
    await expect(page.getByText(dishFor(0))).toBeVisible();

    // The API agrees — the row exists, on the date the picker was given.
    const found = await apiRequest<{
      data: { id: string; mainDish: string; date: string }[];
    }>(writer, "GET", `/meals/menus?unitId=${unitId}&limit=100`);
    const row = found.data.find((m) => m.mainDish === dishFor(0));
    expect(row, "the created menu is returned by the API").toBeTruthy();
    expect(row!.date.slice(0, 10)).toBe(isoFor(0));
  });

  test("Tambah Menu dengan kalori kosong tersimpan sebagai null", async ({
    page,
  }) => {
    await loginAs(page, "adminSdit");
    await page.goto("/meals/menus/new");

    const created = page.waitForResponse(
      (r) =>
        r.url().includes("/meals/menus") && r.request().method() === "POST",
    );
    await fillForm(page, 1);
    // Leave "Kalori (kkal)" empty: creation simply omits it.
    await page.getByRole("button", { name: "Simpan Menu" }).click();

    const response = await created;
    expect(response.status()).toBe(201);

    const found = await apiRequest<{
      data: { id: string; mainDish: string; calories: number | null }[];
    }>(writer, "GET", `/meals/menus?unitId=${unitId}&limit=100`);
    const row = found.data.find((m) => m.mainDish === dishFor(1));
    expect(row, "the created menu is returned by the API").toBeTruthy();
    expect(row!.calories ?? null).toBeNull();
  });

  test("Tambah Menu menolak isian tidak sah dengan pesan Indonesia", async ({
    page,
  }) => {
    await loginAs(page, "adminSdit");
    await page.goto("/meals/menus/new");

    let posted = false;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/meals/menus")) {
        posted = true;
      }
    });

    await page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Unit Pendidikan" })
      .getByRole("combobox")
      .click();
    await page.getByRole("option", { name: unitName, exact: true }).click();

    const mainDish = page.getByLabel("Hidangan Utama");
    // Over the 200-character limit: the message is Indonesian, not Zod's default
    // English (review finding).
    await mainDish.fill("x".repeat(201));
    await page.getByRole("button", { name: "Simpan Menu" }).click();
    await expect(page.getByText("Maksimal 200 karakter")).toBeVisible();

    // Empty is required: the form blocks the request entirely.
    await mainDish.fill("");
    await page.getByRole("button", { name: "Simpan Menu" }).click();
    await expect(page.getByText("Hidangan utama wajib diisi")).toBeVisible();

    expect(posted, "an invalid form sends no request").toBe(false);
  });
});
