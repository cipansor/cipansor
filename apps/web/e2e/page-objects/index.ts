import type { Page } from "@playwright/test";
import { apiLogin, injectSession } from "../helpers/auth-api";

/**
 * Dashboard Page Object Model
 * Encapsulates dashboard page interactions
 */
export class DashboardPage {
  constructor(private page: Page) {}

  // Locators
  get heading() {
    return this.page.getByRole("heading", { name: /dashboard/i });
  }

  get quickStatsCards() {
    return this.page.locator('[data-testid="quick-stats-card"]');
  }

  get totalStudentsCard() {
    return this.page.getByText(/total (santri|students)/i);
  }

  get totalTeachersCard() {
    return this.page
      .getByRole("main")
      .getByText(/ustadz|guru|teachers/i)
      .first();
  }

  get todayAttendanceCard() {
    return this.page
      .getByRole("main")
      .getByText(/kehadiran|attendance/i)
      .first();
  }

  get realtimeIndicator() {
    return this.page.locator('[data-testid="realtime-indicator"]');
  }

  // Actions
  async goto() {
    await this.page.goto("/dashboard");
    await this.page.waitForLoadState("domcontentloaded");
  }

  async waitForDataLoad() {
    await this.page.waitForSelector(".animate-spin", {
      state: "hidden",
      timeout: 15000,
    });
  }

  async verifyQuickStats() {
    await this.totalStudentsCard.waitFor({ state: "visible" });
    await this.totalTeachersCard.waitFor({ state: "visible" });
    await this.todayAttendanceCard.waitFor({ state: "visible" });
  }

  async getStatValue(statName: string): Promise<string> {
    const card = this.page.getByText(new RegExp(statName, "i")).locator("..");
    const value = await card
      .locator('[data-testid="stat-value"]')
      .textContent();
    return value || "0";
  }
}

/**
 * Tahfidz Dashboard Page Object Model
 */
export class TahfidzDashboardPage {
  constructor(private page: Page) {}

  // Locators. Use .first() on text locators: empty-state messages
  // ("Tidak ada data progress per juz") repeat the section title text, so a bare
  // getByText would match two elements and trip strict mode.
  get heading() {
    return this.page.getByRole("heading", { name: /dashboard tahfidz/i });
  }

  get totalRecordsCard() {
    return this.page.getByText(/total catatan/i).first();
  }

  get activeSantriCard() {
    return this.page.getByText(/santri aktif/i).first();
  }

  get totalJuzCard() {
    return this.page.getByText(/total juz/i).first();
  }

  get recordTypeChart() {
    return this.page.getByText(/catatan per tipe/i).first();
  }

  get topSantriSection() {
    return this.page.getByText(/top 10 santri/i).first();
  }

  get progressPerJuzSection() {
    return this.page.getByText(/progress per juz/i).first();
  }

  get recentRecordsTable() {
    return this.page.locator("table").filter({ hasText: /catatan terbaru/i });
  }

  // Actions
  async goto() {
    await this.page.goto("/tahfidz/dashboard");
    await this.page.waitForLoadState("domcontentloaded");
  }

  async waitForDataLoad() {
    await this.page.waitForSelector(".animate-spin", {
      state: "hidden",
      timeout: 15000,
    });
  }

  async selectUnit(unitName: string | RegExp) {
    const unitSelect = this.page
      .locator('button[role="combobox"]')
      .filter({ hasText: /semua unit|unit/i })
      .first();

    await unitSelect.click();
    await this.page.getByRole("option", { name: unitName }).click();
    await this.waitForDataLoad();
  }

  async verifyAllSections() {
    await this.totalRecordsCard.waitFor({ state: "visible" });
    await this.activeSantriCard.waitFor({ state: "visible" });
    await this.recordTypeChart.waitFor({ state: "visible" });
    await this.topSantriSection.waitFor({ state: "visible" });
  }

  async clickRecentRecord(index = 0) {
    const row = this.recentRecordsTable.locator("tbody tr").nth(index);
    await row.click();
  }
}

/**
 * TK Assessment Page Object Model
 */
export class TKAssessmentPage {
  constructor(private page: Page) {}

  // Locators
  get heading() {
    return this.page.getByRole("heading", { name: /penilaian tk/i });
  }

  get studentSelect() {
    return this.page
      .locator('button[role="combobox"]')
      .filter({ hasText: /pilih santri|select student/i });
  }

  get aspectTabs() {
    return this.page.locator('[role="tablist"]');
  }

  get indicatorCheckboxes() {
    return this.page.locator('input[type="checkbox"]');
  }

  get achievementLevelRadios() {
    return this.page.locator('input[type="radio"][name*="achievementLevel"]');
  }

  get saveButton() {
    return this.page.getByRole("button", { name: /simpan|save/i });
  }

  // Actions
  async goto() {
    await this.page.goto("/tk/assessment");
    await this.page.waitForLoadState("domcontentloaded");
  }

  async selectStudent(studentName: string) {
    await this.studentSelect.click();
    await this.page.getByRole("option", { name: studentName }).click();
  }

  async selectAspect(aspectName: string) {
    await this.page
      .getByRole("tab", { name: new RegExp(aspectName, "i") })
      .click();
  }

  async selectIndicator(indicatorText: string | RegExp) {
    const checkbox = this.page
      .locator("label")
      .filter({ hasText: indicatorText })
      .locator('input[type="checkbox"]');
    await checkbox.check();
  }

  async setAchievementLevel(level: "BB" | "MB" | "BSH" | "BSB") {
    const radio = this.page.locator(`input[value="${level}"]`).first();
    await radio.check();
  }

  async saveAssessment() {
    await this.saveButton.click();
    // Wait for success toast
    await this.page
      .getByRole("status")
      .filter({ hasText: /berhasil|success/i })
      .waitFor({ state: "visible", timeout: 5000 });
  }
}

/**
 * Login Page Object Model
 */
export class LoginPage {
  constructor(private page: Page) {}

  // Locators
  get emailInput() {
    return this.page.getByLabel(/email/i);
  }

  get passwordInput() {
    return this.page.getByLabel(/password|kata sandi/i);
  }

  get loginButton() {
    return this.page.getByRole("button", { name: /sign in|masuk|login/i });
  }

  get errorMessage() {
    return this.page.getByText(/invalid|salah|gagal/i);
  }

  // Actions
  async goto() {
    await this.page.goto("/login");
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
    // Admin accounts are challenged for 2FA after the password step. Complete it
    // through the real UI using a TOTP from the fixed seed secret.
    await this.completeTwoFactorIfPrompted();
  }

  /**
   * If the 2FA verification screen appears, fill a freshly-generated TOTP and
   * submit. No-op when 2FA is not required. Requires the API seeded with
   * E2E_FIXED_2FA=1 (admin accounts share a known TOTP secret).
   */
  async completeTwoFactorIfPrompted() {
    const otpInput = this.page.getByPlaceholder("123456");
    const appeared = await otpInput
      .waitFor({ state: "visible", timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) return;

    const { generate } = await import("otplib");
    const secret =
      process.env.E2E_2FA_SECRET || "NTGHH5U5LDHIYARFFNGFQKQHARJU7GBE";
    const token = await generate({ secret });
    await otpInput.fill(token);
    await this.page
      .getByRole("button", { name: "Verifikasi", exact: true })
      .click();
  }

  /**
   * Authenticate and land on the dashboard. Used by the bulk of the suite where
   * the goal is simply to *be* logged in (not to exercise the login UI). Uses the
   * API-based helper — it authenticates against the real backend, completes the
   * admin 2FA gate via TOTP, and injects the session — which is far more reliable
   * and faster than driving the form (and avoids the 2FA login rate limiter). For
   * tests that specifically exercise the login UI, use `login()` instead.
   */
  async loginAndWaitForDashboard(email: string, password: string) {
    const session = await apiLogin({ email, password });
    await injectSession(this.page, session);
    await this.page.goto("/dashboard");

    // One URL read is not enough: the app shell bounces to /login for a beat
    // before the store rehydrates and /auth/me answers, so under WebKit load
    // the read landed mid-bounce and threw while the very next moment showed
    // the dashboard (the ~5 "Login failed - redirected to login" failures per
    // run, #852). Wait for the session to actually settle — the dashboard
    // content rendering — and only then judge the URL.
    //
    // ProtectedRoute renders nothing while `isAuthenticated` is still false
    // (cold start), so `#main-content` appearing is the signal that the store
    // has rehydrated and the authenticated page is on screen. The login form
    // renders `#main-content` too, but a settled bounce lands on `/login`,
    // which the timeout below reports rather than mistaking for success.
    try {
      await this.page.waitForFunction(
        () =>
          window.location.pathname !== "/login" &&
          document.querySelector("#main-content") !== null,
        undefined,
        { timeout: 15_000 },
      );
    } catch (error) {
      if (this.page.url().includes("/login")) {
        throw new Error(
          `Login failed - redirected to login: ${this.page.url()}`,
        );
      }
      throw error;
    }
  }
}
