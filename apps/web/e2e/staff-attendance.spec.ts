import { test, expect } from "@playwright/test";
import {
  SEED_USERS,
  apiLogin,
  apiRequest,
  injectSession,
  loginAs,
  type AuthSession,
} from "./helpers/auth-api";
import { waitForToast } from "./helpers/page-helpers";
import { DEMO_ACCOUNTS } from "../../../packages/shared/src/types/demo-accounts";

/**
 * Absensi pegawai — the pages the selfie/geotag work added, driven the way a
 * person drives them (golden rule #7).
 *
 * Before this suite the pages had no e2e, which is exactly how the bulk
 * register shipped broken: the page posts a date picker's `yyyy-MM-dd`, but the
 * schema demanded a datetime, so every save was a 400 and nobody noticed. The
 * bulk test below sends the page's real payload and reads the row back.
 *
 * The pages are:
 *   - Kepegawaian → Absensi Pegawai    (/hr/attendance)
 *   - Kepegawaian → Absensi Massal     (/hr/attendance/bulk)
 *   - Kepegawaian → Absen Saya         (/hr/attendance/me)
 *   - Kepegawaian → Pengaturan Absensi (/hr/attendance/settings)
 *
 * Writes go to a fixed past day so they cannot disturb today's register, which
 * the self-service test reads.
 */

/** Fixed, long-past WIB calendar days — safe to write. */
const PAST_DAY = "2025-01-02";
const PAST_DAY_2 = "2025-01-03";

/**
 * Unique names per run, so a re-run against the same database does not collide
 * with rows the previous run left behind (the settings writes are real).
 */
const RUN = Date.now().toString(36);
const SITE_NAME = `Gerbang E2E ${RUN}`;
const SHIFT_NAME = `Shift E2E ${RUN}`;
const RULE_CODE = `E2E_TELAT_${RUN}`;

/** The staff of the unit a unit admin is pinned to. */
async function firstStaff(session: AuthSession) {
  const list = await apiRequest<{ data: { id: string; unitId: string }[] }>(
    session,
    "GET",
    "/hr/staff?limit=1",
  );
  const staff = list.data[0];
  if (!staff) throw new Error("No seeded staff — seed the API first");
  return staff;
}

test.describe("Absensi Pegawai — pages render and navigate", () => {
  test("the admin attendance hub renders with its day picker", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/hr/attendance");

    await expect(
      page.getByRole("heading", { name: "Absensi Pegawai", level: 1 }),
    ).toBeVisible();

    // The day picker (an Indonesian date) and the link to the bulk register.
    await expect(
      page
        .getByRole("button", {
          name: /Pilih Tanggal|Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember/i,
        })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Absensi Massal" }),
    ).toBeVisible();
  });

  test("the bulk register renders a row per employee", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/hr/attendance/bulk");

    await expect(
      page.getByRole("heading", { name: "Absensi Massal", level: 1 }),
    ).toBeVisible();
    await expect(page.locator("#bulk-date")).toBeVisible();
    await expect(page.locator("table tbody tr").first()).toBeVisible();
  });

  test("self-service clock-in page is reachable for a teacher", async ({
    page,
  }) => {
    // Every employee clocks in for themselves; a teacher is not an admin and
    // still reaches Absen Saya (the API authorizes TEACHER there).
    await loginAs(page, "teacher");
    await page.goto("/hr/attendance/me");

    await expect(
      page.getByRole("heading", { name: "Absen Saya", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Status Hari Ini")).toBeVisible();
    await expect(page.getByText("Bukti Kehadiran")).toBeVisible();

    // Both punches and the evidence controls are on the page. The photo is
    // taken from the camera; picking a file is offered only once the camera
    // cannot be opened (decided 2026-10-09), so it is not on the page yet.
    await expect(
      page.getByRole("button", { name: "Absen Masuk" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Absen Pulang" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Buka Kamera" }),
    ).toBeVisible();
    await expect(page.getByText("Pilih Foto dari Perangkat")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Baca (Ulang )?Lokasi/ }),
    ).toBeVisible();
  });
});

test.describe("Absensi Massal — the save the register depends on", () => {
  test("the page's own payload saves a calendar day", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/hr/attendance/bulk");

    await expect(page.locator("table tbody tr").first()).toBeVisible();

    // Pick a past day and mark everyone present — the exact button a person
    // presses, and the exact `yyyy-MM-dd` the date input yields.
    await page.locator("#bulk-date").fill(PAST_DAY_2);
    await page.getByRole("button", { name: "Tandai Semua Hadir" }).click();
    await expect(page.getByText(/^\d+ dipilih$/)).toBeVisible();

    const saved = page.waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        new URL(res.url()).pathname.endsWith("/hr/attendance/bulk"),
    );
    await page.getByRole("button", { name: "Simpan" }).click();
    const response = await saved;

    // A 400 here is the regression this suite exists for.
    expect(response.status()).toBe(200);
    await waitForToast(page, /absensi disimpan/i);
  });

  test("the API accepts a date picker's day and stores it on that WIB day", async ({
    page,
  }) => {
    const admin = await loginAs(page, "superAdmin");
    const staff = await firstStaff(admin);

    const result = await apiRequest<{
      success: boolean;
      data: { count: number };
    }>(admin, "POST", "/hr/attendance/bulk", {
      date: PAST_DAY,
      records: [{ staffId: staff.id, status: "ABSENT" }],
    });
    expect(result.success).toBe(true);
    expect(result.data.count).toBe(1);

    const list = await apiRequest<{ data: { status: string }[] }>(
      admin,
      "GET",
      `/hr/attendance?staffId=${staff.id}&startDate=${PAST_DAY}&endDate=${PAST_DAY}&limit=100`,
    );
    expect(list.data.some((row) => row.status === "ABSENT")).toBe(true);
  });
});

test.describe("Pengaturan Absensi — settings save with the form's real values", () => {
  test.describe.configure({ mode: "serial" });

  test("a site is added from the Lokasi tab", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/hr/attendance/settings");

    await expect(
      page.getByRole("heading", { name: "Pengaturan Absensi", level: 1 }),
    ).toBeVisible();

    await page.getByPlaceholder("Gerbang utama").fill(SITE_NAME);
    await page.getByPlaceholder("-6.123456").fill("-6.5");
    await page.getByPlaceholder("106.123456").fill("106.8");
    await page.getByRole("button", { name: "Tambah Lokasi" }).click();

    await waitForToast(page, /Lokasi absen ditambahkan/i);
    await expect(
      page.getByRole("cell", { name: SITE_NAME }).first(),
    ).toBeVisible();
  });

  test("a shift is added from the Shift tab", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/hr/attendance/settings");
    await page.getByRole("tab", { name: "Shift" }).click();

    await page.getByPlaceholder("Pagi").fill(SHIFT_NAME);
    await page.getByRole("button", { name: "Tambah Shift" }).click();

    await waitForToast(page, /Shift ditambahkan/i);
    await expect(
      page.getByRole("cell", { name: SHIFT_NAME }).first(),
    ).toBeVisible();
  });

  test("the work week saves the defaults the form shows", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/hr/attendance/settings");
    await page.getByRole("tab", { name: "Hari Kerja" }).click();

    // An empty Friday time must not turn into a null the schema rejects.
    await page.getByRole("button", { name: "Simpan", exact: true }).click();

    await waitForToast(page, /Hari kerja disimpan/i);
  });

  test("the attendance policy saves", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/hr/attendance/settings");
    await page.getByRole("tab", { name: "Kebijakan" }).click();

    await page.getByRole("button", { name: "Simpan", exact: true }).click();

    await waitForToast(page, /Kebijakan disimpan/i);
  });

  test("the deduction guard saves without a configured UMK", async ({
    page,
  }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/hr/attendance/settings");
    await page.getByRole("tab", { name: "Potongan Gaji" }).click();

    // The UMK is optional and its input is empty by default; an empty field
    // must not send a null the schema rejects.
    await page
      .getByRole("button", { name: "Simpan", exact: true })
      .first()
      .click();

    await waitForToast(page, /Batas potongan disimpan/i);
  });

  test("a deduction rule saves and re-saves unchanged", async ({ page }) => {
    await loginAs(page, "superAdmin");
    await page.goto("/hr/attendance/settings");
    await page.getByRole("tab", { name: "Potongan Gaji" }).click();

    await page.getByPlaceholder("POTONGAN_TELAT").fill(RULE_CODE);
    await page.getByRole("button", { name: "Simpan Aturan" }).click();
    await waitForToast(page, /Aturan disimpan/i);
    await expect(
      page.getByRole("cell", { name: RULE_CODE }).first(),
    ).toBeVisible();

    // "Ubah" copies the stored rule (with its null fields) into the draft; a
    // second save of an unchanged rule must still be accepted.
    await page.getByRole("button", { name: "Ubah" }).first().click();
    await page.getByRole("button", { name: "Simpan Aturan" }).click();
    await waitForToast(page, /Aturan disimpan/i);
  });

  test("the holiday import has a review queue", async ({ page }) => {
    // An imported holiday waits in a draft queue before it can change a work
    // day (decisions/absensi-pegawai.md), so the queue must be on the page.
    await loginAs(page, "superAdmin");
    await page.goto("/hr/attendance/settings");
    await page.getByRole("tab", { name: "Hari Libur" }).click();

    await expect(page.getByText("Draf Libur Menunggu Tinjauan")).toBeVisible();
  });
});

test("a unit admin cannot change the yayasan-wide holiday source", async () => {
  // The source is yayasan-wide and every unit's sync reads it, so PUT is
  // super-admin only (calendar.routes.ts). A unit admin is refused.
  const admin = await apiLogin(SEED_USERS.adminSdit);
  const status = await apiRequest(admin, "PUT", "/calendar/holidays/config", {
    sourceUrl: "https://example.test/holidays",
  }).then(
    () => 200,
    (error: Error) => Number(/→ (\d{3})/.exec(error.message)?.[1] ?? 0),
  );
  expect(status).toBe(403);
});

// ---------------------------------------------------------------------------
// The punch itself, against the real API and a real Postgres. Until 2026-10-09
// every check-in answered 500: the staff lock went through `$queryRaw`, which
// cannot read the `void` that `pg_advisory_xact_lock` returns, and the unit
// tests mocked it away. Nothing here mocks it.
// ---------------------------------------------------------------------------

const API = process.env.API_URL || "http://localhost:3001/api";

const demo = (email: string) => {
  const found = DEMO_ACCOUNTS.find((a) => a.email === email);
  if (!found) throw new Error(`No demo account ${email}`);
  return { email: found.email, password: found.password };
};

const statusOf = (call: Promise<unknown>) =>
  call.then(
    () => 200,
    (error: Error) => Number(/→ (\d{3})/.exec(error.message)?.[1] ?? 0),
  );

/** A few bytes that start the way a JPEG does — what the store checks. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

async function uploadPhoto(session: AuthSession): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([JPEG], { type: "image/jpeg" }), "absen.jpg");
  const res = await fetch(`${API}/hr/attendance/photo`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.accessToken}` },
    body: form,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: { photoRef: string } }).data.photoRef;
}

async function photoStatus(session: AuthSession, recordId: string) {
  const res = await fetch(`${API}/hr/attendance/records/${recordId}/photo`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  return { status: res.status, type: res.headers.get("content-type") };
}

test.describe("Absen Saya — a punch is recorded", () => {
  test.describe.configure({ mode: "serial" });
  // The day is the yayasan's: the admin list opens on the browser's today.
  test.use({ timezoneId: "Asia/Jakarta" });

  let guru: AuthSession;
  let admin: AuthSession;
  let staffId = "";
  let shiftId = "";
  let assignmentId = "";
  let checkInRecordId = "";

  /** Remove whatever the teacher punched today, so a re-run starts clean. */
  async function clearToday() {
    const me = await apiRequest<{
      data: { attendance: { id: string } | null };
    }>(guru, "GET", "/hr/attendance/me");
    if (me.data.attendance) {
      await apiRequest(
        admin,
        "DELETE",
        `/hr/attendance/${me.data.attendance.id}`,
        {
          reason: "Uji e2e Absen Saya — dibersihkan",
        },
      );
    }
  }

  test.beforeAll(async () => {
    guru = await apiLogin(demo("smpit.guru@cipansor.or.id"));
    admin = await apiLogin(demo("smpit.admin@cipansor.or.id"));
    const staff = await apiRequest<{ data: { id: string; userId: string }[] }>(
      admin,
      "GET",
      `/hr/staff?limit=100&unitId=${String(guru.user.unitId ?? "")}`,
    );
    staffId = staff.data.find((s) => s.userId === guru.user.id)?.id ?? "";
    expect(staffId, "the teacher has a staff record").not.toBe("");

    // A shift for today makes it a working day for this person whatever the
    // calendar says — so the test does not depend on the weekday it runs on,
    // and it exercises the rule that a rostered shift beats a closed day.
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Jakarta",
    });
    const shift = await apiRequest<{ data: { id: string } }>(
      admin,
      "POST",
      "/hr/attendance/shifts",
      {
        name: `Shift Absen Saya ${RUN}`,
        startTime: "00:00",
        endTime: "23:59",
        graceMinutes: 0,
      },
    );
    shiftId = shift.data.id;
    const assignment = await apiRequest<{ data: { id: string } }>(
      admin,
      "POST",
      "/hr/attendance/shift-assignments",
      { staffId, shiftId, effectiveFrom: today, effectiveTo: today },
    );
    assignmentId = assignment.data.id;
    await clearToday();
  });

  test.afterAll(async () => {
    await clearToday();
    if (assignmentId)
      await apiRequest(
        admin,
        "DELETE",
        `/hr/attendance/shift-assignments/${assignmentId}`,
      );
    if (shiftId)
      await apiRequest(admin, "DELETE", `/hr/attendance/shifts/${shiftId}`);
  });

  test("the teacher clocks in with a selfie from the private store", async () => {
    const photoRef = await uploadPhoto(guru);
    const result = await apiRequest<{
      data: { record: { id: string; hasPhoto: boolean; photoRef?: string } };
    }>(guru, "POST", "/hr/attendance/check-in", {
      photoRef,
      photoSource: "CAMERA",
    });

    expect(result.data.record.hasPhoto).toBe(true);
    // The stored reference never leaves the server.
    expect(result.data.record.photoRef).toBeUndefined();
    checkInRecordId = result.data.record.id;
  });

  test("a photo backs one punch only, and only for the person who took it", async () => {
    const used = await apiRequest<{
      data: { attendance: { records: { id: string }[] } };
    }>(guru, "GET", "/hr/attendance/me");
    expect(used.data.attendance.records.map((r) => r.id)).toContain(
      checkInRecordId,
    );

    // Someone else's photo, for the teacher's checkout: refused.
    const kepala = await apiLogin(demo("smpit.kepala@cipansor.or.id"));
    const othersPhoto = await uploadPhoto(kepala);
    expect(
      await statusOf(
        apiRequest(guru, "POST", "/hr/attendance/check-out", {
          photoRef: othersPhoto,
        }),
      ),
    ).toBe(400);
  });

  test("the selfie opens for its owner and the unit admin, not for another unit", async () => {
    expect(await photoStatus(guru, checkInRecordId)).toEqual({
      status: 200,
      type: "image/jpeg",
    });
    expect((await photoStatus(admin, checkInRecordId)).status).toBe(200);

    const otherAdmin = await apiLogin(demo("sdit.admin@cipansor.or.id"));
    expect((await photoStatus(otherAdmin, checkInRecordId)).status).toBe(403);
    const colleague = await apiLogin(demo("smpit.tu@cipansor.or.id"));
    expect((await photoStatus(colleague, checkInRecordId)).status).toBe(403);
  });

  test("the teacher clocks out on screen, with the camera and the location", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "document.featurePolicy, read below, is Chromium's",
    );
    // A camera made of a canvas. The page's own path still runs as on a
    // phone — getUserMedia, the <video>, the canvas it draws on, the upload —
    // but CI's headless Chromium has no camera to fake, so the device itself
    // comes from here. That steps around the browser's own camera check, which
    // is why the policy is read from the document below.
    await page.addInitScript(() => {
      const devices = navigator.mediaDevices;
      const real = devices.getUserMedia.bind(devices);
      devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
        if (!constraints?.video) return real(constraints);
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 240;
        const ctx = canvas.getContext("2d")!;
        let hue = 0;
        const paint = () => {
          hue = (hue + 9) % 360;
          ctx.fillStyle = `hsl(${hue} 55% 45%)`;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        };
        paint();
        setInterval(paint, 100);
        return canvas.captureStream(10);
      };
    });
    // The position is the browser's own (Playwright's emulation), so it does
    // go through the document's policy.
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude: -7.2,
      longitude: 107.9,
      accuracy: 20,
    });
    await injectSession(page, guru);
    await page.goto("/hr/attendance/me");

    // The page's Permissions-Policy once said `camera=()` and
    // `geolocation=()`: the browser refused both without a prompt, every
    // selfie fell back to a file and no punch had a location.
    const allowed = await page.evaluate(() => {
      const doc = document as Document & {
        featurePolicy?: { allowsFeature(feature: string): boolean };
      };
      return {
        camera: doc.featurePolicy?.allowsFeature("camera"),
        geolocation: doc.featurePolicy?.allowsFeature("geolocation"),
      };
    });
    expect(allowed).toEqual({ camera: true, geolocation: true });

    await page.getByRole("button", { name: "Buka Kamera" }).click();
    await page.getByRole("button", { name: "Ambil Foto" }).click();
    await expect(
      page.getByRole("button", { name: "Foto Ulang" }),
    ).toBeVisible();
    // "Foto Ulang" must reopen a live camera, not an empty box: while the
    // preview showed the <video> was not rendered, so its ref was null and the
    // stream was never attached.
    await page.getByRole("button", { name: "Foto Ulang" }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const video = document.querySelector('video[aria-label="Kamera"]');
          return video
            ? { hasStream: Boolean(video.srcObject), width: video.videoWidth }
            : null;
        }),
      )
      .toEqual({ hasStream: true, width: 320 });
    await expect(
      page.getByRole("button", { name: "Ambil Foto" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ambil Foto" }).click();
    await expect(
      page.getByRole("button", { name: "Foto Ulang" }),
    ).toBeVisible();
    // The file picker is the fallback for a device with no camera only.
    await expect(
      page.getByRole("button", { name: "Pilih Foto dari Perangkat" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Baca Lokasi Saya" }).click();
    await expect(
      page.getByRole("button", { name: "Baca Ulang Lokasi" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Absen Pulang" }).click();
    await waitForToast(page, /Absen pulang tercatat/);

    const me = await apiRequest<{
      data: {
        attendance: {
          checkOut: string | null;
          records: {
            kind: string;
            hasPhoto: boolean;
            photoSource?: string | null;
            latitude?: number | null;
          }[];
        };
      };
    }>(guru, "GET", "/hr/attendance/me");
    expect(me.data.attendance.checkOut).not.toBeNull();
    const out = me.data.attendance.records.find((r) => r.kind === "CHECK_OUT");
    expect(out).toMatchObject({ hasPhoto: true, photoSource: "CAMERA" });
    expect(out?.latitude).toBeCloseTo(-7.2, 3);
  });

  test("the unit admin opens that punch's selfie and location", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "the punch with a camera photo is taken in chromium only",
    );
    const name = String(guru.user.name);
    await injectSession(page, admin);
    await page.goto("/hr/attendance");
    await page.getByRole("button", { name: `Bukti Pulang ${name}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("img", { name: `Swafoto ${name}` }),
    ).toBeVisible();
    await expect(
      dialog.getByText(/Lokasi -7\.20000, 107\.90000/),
    ).toBeVisible();
  });

  test("the teacher clocks out (browsers without a fake camera)", async ({
    browserName,
  }) => {
    test.skip(
      browserName === "chromium",
      "chromium clocks out on screen in the test above",
    );
    const out = await apiRequest<{
      data: { attendance: { checkOut: string | null } };
    }>(guru, "POST", "/hr/attendance/check-out", {});
    expect(out.data.attendance.checkOut).not.toBeNull();
  });
});

/** A 1×1 PNG: a picture a person could pick from the gallery. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Absen Saya — a photo picked from a file", () => {
  test.describe.configure({ mode: "serial" });

  let kepala: AuthSession;
  let admin: AuthSession;
  let shiftId = "";
  let assignmentId = "";

  async function clearToday() {
    const me = await apiRequest<{
      data: { attendance: { id: string } | null };
    }>(kepala, "GET", "/hr/attendance/me");
    if (me.data.attendance) {
      await apiRequest(
        admin,
        "DELETE",
        `/hr/attendance/${me.data.attendance.id}`,
        { reason: "Uji e2e foto dari berkas — dibersihkan" },
      );
    }
  }

  test.beforeAll(async () => {
    kepala = await apiLogin(demo("smpit.kepala@cipansor.or.id"));
    admin = await apiLogin(demo("smpit.admin@cipansor.or.id"));
    const staff = await apiRequest<{ data: { id: string; userId: string }[] }>(
      admin,
      "GET",
      `/hr/staff?limit=100&unitId=${String(kepala.user.unitId ?? "")}`,
    );
    const staffId = staff.data.find((s) => s.userId === kepala.user.id)?.id;
    expect(staffId, "the head of school has a staff record").toBeTruthy();
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Jakarta",
    });
    const shift = await apiRequest<{ data: { id: string } }>(
      admin,
      "POST",
      "/hr/attendance/shifts",
      {
        name: `Shift Foto Berkas ${RUN}`,
        startTime: "00:00",
        endTime: "23:59",
        graceMinutes: 0,
      },
    );
    shiftId = shift.data.id;
    const assignment = await apiRequest<{ data: { id: string } }>(
      admin,
      "POST",
      "/hr/attendance/shift-assignments",
      { staffId, shiftId, effectiveFrom: today, effectiveTo: today },
    );
    assignmentId = assignment.data.id;
    await clearToday();
  });

  test.afterAll(async () => {
    await clearToday();
    if (assignmentId)
      await apiRequest(
        admin,
        "DELETE",
        `/hr/attendance/shift-assignments/${assignmentId}`,
      );
    if (shiftId)
      await apiRequest(admin, "DELETE", `/hr/attendance/shifts/${shiftId}`);
  });

  test("with the camera refused, a picked photo is re-encoded and flagged", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "a refused camera prompt is deterministic in chromium only",
    );
    // No camera permission is granted, so opening the camera fails and the
    // file picker appears — the fallback a phone without a camera gets.
    await injectSession(page, kepala);
    await page.goto("/hr/attendance/me");
    await page.getByRole("button", { name: "Buka Kamera" }).click();
    await expect(
      page.getByText("Kamera tidak dapat dibuka", { exact: false }),
    ).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: "galeri.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await expect(
      page.getByText("Foto ini dari berkas, bukan dari kamera."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Absen Masuk" }).click();
    await waitForToast(page, /Absen masuk tercatat/);

    const me = await apiRequest<{
      data: {
        attendance: {
          records: {
            id: string;
            kind: string;
            hasPhoto: boolean;
            photoSource?: string | null;
          }[];
        };
      };
    }>(kepala, "GET", "/hr/attendance/me");
    const punch = me.data.attendance.records.find((r) => r.kind === "CHECK_IN");
    expect(punch).toMatchObject({ hasPhoto: true, photoSource: "FILE" });

    // What was stored is the page's own JPEG, not the PNG that was picked:
    // the file's bytes (and any metadata in them) never left the device.
    const res = await fetch(`${API}/hr/attendance/records/${punch!.id}/photo`, {
      headers: { authorization: `Bearer ${kepala.accessToken}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
  });
});

test("an employee with no staff record is told whom to ask", async ({
  page,
}) => {
  // The seed gives SMP IT's tata usaha no staff row. The page used to show
  // greyed-out buttons with no reason at all.
  const tu = await apiLogin(demo("smpit.tu@cipansor.or.id"));
  const me = await apiRequest<{ data: { hasProfile: boolean } }>(
    tu,
    "GET",
    "/hr/attendance/me",
  );
  expect(me.data.hasProfile).toBe(false);

  await injectSession(page, tu);
  await page.goto("/hr/attendance/me");
  await expect(
    page.getByText("Data kepegawaian Anda belum dibuat"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Absen Masuk" })).toHaveCount(
    0,
  );
});

test.describe("Pengaturan Absensi — who may write it", () => {
  test("a yayasan organ is refused, though it shares the admin bucket", async () => {
    // Before 2026-10-09 the Pengawas could rewrite every unit's policy and the
    // payroll guard: the organs fell into the super admin's branch.
    const pengawas = await apiLogin(demo("yayasan.pengawas@cipansor.or.id"));
    expect(
      await statusOf(
        apiRequest(pengawas, "PUT", "/hr/attendance/policies", {
          unitId: null,
        }),
      ),
    ).toBe(403);
    expect(
      await statusOf(
        apiRequest(pengawas, "PUT", "/hr/payroll/guard-config", {
          unitId: null,
          maxDeductionPercent: 50,
        }),
      ),
    ).toBe(403);
    expect(
      await statusOf(apiRequest(pengawas, "GET", "/hr/attendance?limit=5")),
    ).toBe(403);
  });

  test("an organ who opens the pages by URL is told who runs them", async ({
    page,
  }) => {
    // Neither page is on an organ's menu, but the bucket opens the URL. It used
    // to show the full form, a Simpan button, and a 403 toast for every tab.
    const pengawas = await apiLogin(demo("yayasan.pengawas@cipansor.or.id"));
    await injectSession(page, pengawas);
    for (const path of ["/hr/attendance/settings", "/hr/attendance"]) {
      await page.goto(path);
      await expect(
        page.getByText("Halaman ini dikelola super admin dan admin unit"),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Simpan" })).toHaveCount(0);
      await expect(page.getByRole("tab")).toHaveCount(0);
    }
  });

  test("a unit admin naming another unit is refused, not quietly redirected", async () => {
    const admin = await apiLogin(demo("smpit.admin@cipansor.or.id"));
    // A unit admin's /units lists their own unit only, so the other unit's id
    // comes from the super admin.
    const superAdmin = await apiLogin(SEED_USERS.superAdmin);
    const units = await apiRequest<{ data: { id: string; name: string }[] }>(
      superAdmin,
      "GET",
      "/units?limit=50",
    );
    const sdit = units.data.find((u) => /^SD IT/.test(u.name));
    expect(sdit).toBeDefined();
    expect(
      await statusOf(
        apiRequest(admin, "PUT", "/hr/attendance/policies", {
          unitId: sdit!.id,
        }),
      ),
    ).toBe(403);
  });

  test("deductions above 50% of a wage payment are refused (PP 36/2021 Ps. 65)", async () => {
    const superAdmin = await apiLogin(SEED_USERS.superAdmin);
    expect(
      await statusOf(
        apiRequest(superAdmin, "PUT", "/hr/payroll/guard-config", {
          unitId: null,
          maxDeductionPercent: 51,
        }),
      ),
    ).toBe(400);
  });

  test("an active deduction rule must name its legal basis", async () => {
    const superAdmin = await apiLogin(SEED_USERS.superAdmin);
    expect(
      await statusOf(
        apiRequest(superAdmin, "PUT", "/hr/payroll/policy-rules/new", {
          code: `E2E_TANPA_DASAR_${RUN}`,
          kind: "DEDUCTION",
          trigger: "LATE",
          basis: "TUNJANGAN_KEHADIRAN",
          mode: "NOMINAL",
          rate: 10000,
          isActive: true,
        }),
      ),
    ).toBe(400);
  });
});
