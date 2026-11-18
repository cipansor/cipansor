/**
 * A santri mukim going home, or off the pondok overnight, is decided by the
 * koordinator of their asrama; a few hours out, or sick in the UKS, by the
 * musyrif of their kamar (decided 2026-09-27, decisions/pemutus-izin-santri.md).
 * The form says who will decide before it is sent, and asks where a sick
 * santri mukim will be.
 *
 * The seed makes the musyrif persona koordinator of the putra asrama and the
 * wali kamar persona pembina of one kamar in it; the santri used here is found
 * through the API's own answer to "who would decide", so the test does not
 * depend on how the seed fills the kamar. Passwords come from DEMO_ACCOUNTS.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  apiLogin,
  apiRequest,
  injectSession,
  type AuthSession,
} from "./helpers/auth-api";
import { isProductionApi } from "./helpers/api-env";
import { DEMO_ACCOUNTS } from "../../../packages/shared/src/types/demo-accounts";

function account(email: string) {
  const a = DEMO_ACCOUNTS.find((d) => d.email === email);
  if (!a) throw new Error(`No demo account ${email}`);
  return a;
}
const WALI_KAMAR = account("pesantren.walikamar@cipansor.or.id");
const KOORDINATOR = account("pesantren.musyrif@cipansor.or.id");

async function signIn(
  page: Page,
  who: { email: string; password: string },
): Promise<AuthSession> {
  const session = await apiLogin({ email: who.email, password: who.password });
  await injectSession(page, session);
  return session;
}

/** A `datetime-local` value `days` from now at `hour`:00, in the browser's zone. */
function localInput(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
}

/**
 * An instant `days` from now at `hour`:00 WIB — the rule counts nights in
 * WIB, and the test process may run in another zone.
 */
function wib(days: number, hour: number): string {
  const d = new Date(Date.now() + days * 86_400_000 + 7 * 3_600_000);
  return `${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00:00+07:00`;
}

interface Decider {
  boarder: boolean;
  decision: { mentorKind: string; mentors: { name: string }[] };
}

test.describe.configure({ mode: "serial" });

test.describe("Izin pulang santri mukim — koordinator asrama", () => {
  const stamp = Date.now().toString(36);
  // Far enough ahead that no other run's permit shares the dates.
  const offset = 1200 + (Date.now() % 3000);
  let kamar: AuthSession;
  let santri = { id: "", nis: "" };
  const filed: string[] = [];

  test.beforeAll(async () => {
    test.skip(
      await isProductionApi(),
      "API_URL menunjuk API produksi; uji ini menulis izin, jadi dilewati",
    );
    kamar = await apiLogin(WALI_KAMAR);
    // A santri of the wali kamar's own kamar: one whose afternoon out the API
    // says is theirs to decide. The seed puts few in that kamar, so every
    // page of the roster may have to be read.
    const q = (studentId: string) =>
      new URLSearchParams({
        studentId,
        type: "KELUAR",
        startDate: wib(offset, 13),
        endDate: wib(offset, 17),
      });
    search: for (let page = 1; page <= 30; page++) {
      const students = await apiRequest<{
        data: { id: string; nis: string }[];
      }>(kamar, "GET", `/students?limit=100&page=${page}`);
      if (!students.data.length) break;
      for (const s of students.data) {
        const preview = await apiRequest<{ data: Decider }>(
          kamar,
          "GET",
          `/permits/decider?${q(s.id)}`,
        );
        const d = preview.data.decision;
        if (
          d.mentorKind === "MUSYRIF" &&
          d.mentors.some((m) => m.name === WALI_KAMAR.name)
        ) {
          santri = { id: s.id, nis: s.nis };
          break search;
        }
      }
    }
    expect(santri.id, "a santri in the wali kamar's kamar").toBeTruthy();
  });

  test.afterAll(async () => {
    for (const id of filed) {
      await apiRequest(kamar, "POST", `/permits/${id}/cancel`).catch(
        () => undefined,
      );
    }
  });

  async function openForm(page: Page) {
    await page.goto("/permits/new");
    await page.getByLabel("Cari nama atau NIS").fill(santri.nis);
    await page.getByRole("row", { name: new RegExp(santri.nis) }).click();
  }

  async function chooseType(page: Page, label: string) {
    await page.getByLabel("Jenis izin").click();
    await page.getByRole("option", { name: label, exact: true }).click();
    // Radix restores focus to the trigger asynchronously; the date/reason fills
    // right after this lose their keystrokes on Firefox when they land first
    // (the value is written, then the close clears it). Wait for the listbox to
    // leave the DOM, as `selectOption` does.
    await expect(page.getByRole("listbox")).toHaveCount(0);
  }

  test("izin pulang: the form names the koordinator, and the wali kamar cannot decide it", async ({
    page,
  }) => {
    await signIn(page, WALI_KAMAR);
    await openForm(page);
    await chooseType(page, "Pulang");
    await page
      .getByLabel("Berangkat", { exact: true })
      .fill(localInput(offset, 13));
    await page
      .getByLabel("Kembali", { exact: true })
      .fill(localInput(offset + 2, 17));
    // Not asked where: going home is off the pondok by what it is.
    await expect(page.getByText("Selama izin, santri berada di")).toHaveCount(
      0,
    );
    const hint = page.getByText(/^Koordinator asrama: /);
    await expect(hint).toContainText(KOORDINATOR.name);
    await expect(hint).not.toContainText(WALI_KAMAR.name);

    await page
      .getByLabel("Alasan")
      .fill(`Pulang untuk acara keluarga (e2e ${stamp})`);
    await page.getByRole("button", { name: "Ajukan" }).click();
    await page.waitForURL(/\/permits\/[0-9a-f-]{36}$/);
    filed.push(page.url().split("/").pop()!);

    await expect(page.getByText(/^Koordinator asrama: /)).toBeVisible();
    await expect(page.getByRole("button", { name: "Setujui" })).toHaveCount(0);
  });

  test("the koordinator approves it, recorded as koordinator asrama", async ({
    page,
  }) => {
    await signIn(page, KOORDINATOR);
    await page.goto(`/permits/${filed[0]}`);
    // Their own permit to decide: no takeover, so no confirmation step.
    await page.getByRole("button", { name: "Setujui" }).click();
    await expect(page.getByText("Izin disetujui")).toBeVisible();
    await expect(page.getByTestId("permit-decider")).toContainText(
      "sebagai koordinator asrama",
    );
  });

  test("sick in the UKS: the form asks where, and it stays with the wali kamar", async ({
    page,
  }) => {
    await signIn(page, WALI_KAMAR);
    await openForm(page);
    await chooseType(page, "Sakit");
    await page
      .getByLabel("Berangkat", { exact: true })
      .fill(localInput(offset + 10, 7));
    await page
      .getByLabel("Kembali", { exact: true })
      .fill(localInput(offset + 12, 17));
    await page
      .getByLabel("Alasan")
      .fill(`Demam, istirahat di UKS (e2e ${stamp})`);

    // Unanswered, the form will not send it.
    await expect(page.getByText("Selama izin, santri berada di")).toBeVisible();
    await page.getByRole("button", { name: "Ajukan" }).click();
    await expect(
      page.getByText("Pilih di mana santri berada selama izin"),
    ).toBeVisible();

    await page.getByLabel("Pondok — UKS atau asrama").check();
    await expect(page.getByText(/^Musyrif: /)).toContainText(WALI_KAMAR.name);
    // Changing the answer changes who decides, before anything is sent.
    await page
      .getByLabel("Luar pondok — rumah, klinik, atau rumah sakit")
      .check();
    await expect(page.getByText(/^Koordinator asrama: /)).toBeVisible();
    await page.getByLabel("Pondok — UKS atau asrama").check();

    await page.getByRole("button", { name: "Ajukan" }).click();
    await page.waitForURL(/\/permits\/[0-9a-f-]{36}$/);
    filed.push(page.url().split("/").pop()!);
    await expect(
      page.getByText("Sakit · di pondok (UKS/asrama)"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Setujui" })).toBeVisible();
  });

  test("a day pupil's wali is not asked where: the wali kelas decides", async ({
    page,
  }) => {
    const sdWali = DEMO_ACCOUNTS.find((d) => d.roleCode === "SDIT_ORANG_TUA");
    if (!sdWali) throw new Error("No SD IT wali persona");
    await signIn(page, sdWali);
    await page.goto("/parent/permits");
    await page.getByRole("button", { name: "Ajukan Izin" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Jenis izin").click();
    await page.getByRole("option", { name: "Sakit", exact: true }).click();
    await dialog.getByLabel("Berangkat").fill(localInput(offset + 20, 7));
    await dialog.getByLabel("Kembali").fill(localInput(offset + 22, 17));
    await expect(dialog.getByText(/^Wali kelas: /)).toBeVisible();
    await expect(dialog.getByText("Selama izin, santri berada di")).toHaveCount(
      0,
    );
  });
});
