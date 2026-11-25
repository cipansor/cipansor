import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Locale } from "@/locales";
import { spmbFormContentFor } from "@/config/spmb-form.i18n";

/**
 * The SPMB form's first step, as far as the NIK is concerned.
 *
 * The NIK carries its own birth date (Dukcapil: digits 7–12 are DD MM YY), so
 * the form can refuse to move on while those digits disagree with the birth
 * date filled in above them. The message must sit under the field, must not
 * appear while the NIK is still being typed, and must say the field may be
 * left blank — the public form has no other way past a real NIK that
 * disagrees. The sex half of the check is exercised in e2e, where the Radix
 * Select can be driven the way a person drives it.
 */

const intake = {
  unit: {
    id: "u-smp",
    name: "SMP IT",
    officialName: "SMP IT Cipansor",
    type: "SMP",
  },
  period: {
    id: "p-1",
    name: "SPMB 2027/2028 SMP IT",
    academicYear: "2027/2028",
    startDate: "2026-09-30T17:00:00.000Z",
    endDate: "2027-07-10T16:59:59.999Z",
    window: "open" as const,
    opensAt: null,
    closesAt: "2026-12-20T16:59:59.999Z",
    registrationFee: "200000.00",
    requirements: [],
    minAgeMonths: null,
    ageReferenceDate: null,
    contactName: "Panitia",
    contactPhone: "0812-0000-0000",
  },
  waves: [],
  fees: [],
};

vi.mock("@/hooks/use-admissions", () => ({
  usePublicIntakes: () => ({ data: [intake], isLoading: false }),
  useCreateRegistration: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-privacy-policy", () => ({
  usePrivacyPolicyCurrent: () => ({ data: null }),
}));

vi.mock("@/components/security/turnstile-widget", () => ({
  useTurnstile: () => ({ token: null, refresh: vi.fn(), blocked: false }),
  isTurnstileEnabled: () => false,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/admissions/registration-tracker", () => ({
  RegistrationTracker: () => null,
}));

vi.mock("@/components/admissions/document-capture-field", () => ({
  DocumentCaptureField: () => null,
}));

vi.mock("@/components/landing/navbar", () => ({ LandingNavbar: () => null }));
vi.mock("@/components/landing/footer", () => ({ LandingFooter: () => null }));

const { SpmbForm } = await import("./spmb-form");

// 320123 | 01 10 23 | 0001 → born 1 October 2023.
const NIK_DAY_1 = "3201230110230001";
// The same, with the day field 15: born 15 October 2023.
const NIK_DAY_15 = "3201231510230001";

function renderForm(locale: Locale = "id") {
  return render(
    <SpmbForm photo={{ src: "/x.jpg", alt: "santri" }} locale={locale} />,
  );
}

/** The input a label introduces; the form's labels carry no `htmlFor`. */
function fieldAfter(label: string) {
  return screen
    .getByText(label, { exact: true })
    .closest("div")!
    .querySelector("input")!;
}

/** Step one, filled for a child born 1 October 2023 (the NIK is left alone). */
function fillStepOne(locale: Locale = "id") {
  const t = spmbFormContentFor(locale);
  fireEvent.click(screen.getAllByTestId("public-intake-register")[0]);
  fireEvent.change(screen.getByPlaceholderText(t.student.fullNamePlaceholder), {
    target: { value: "Anak Uji" },
  });
  fireEvent.change(fieldAfter(t.student.birthPlace), {
    target: { value: "Bandung" },
  });
  fireEvent.change(document.querySelector('input[type="date"]')!, {
    target: { value: "2023-10-01" },
  });
  return fieldAfter(t.student.nationalId);
}

describe("SPMB form — the NIK against the birth date", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no layout: the form scrolls itself into view when a unit's
    // intake is picked, and that call is not what this file is about.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("keeps the message away while the NIK is still being typed", () => {
    renderForm();
    const nik = fillStepOne();

    fireEvent.change(nik, { target: { value: "3201" } });

    expect(screen.queryByTestId("spmb-nik-error")).toBeNull();
    expect(nik.getAttribute("aria-invalid")).toBe("false");
  });

  it("shows the reason under the field once the field is left", () => {
    renderForm();
    const nik = fillStepOne();

    fireEvent.change(nik, { target: { value: NIK_DAY_15 } });
    fireEvent.blur(nik);

    expect(screen.getByTestId("spmb-nik-error").textContent).toMatch(
      /Tanggal lahir pada NIK/,
    );
    expect(nik.getAttribute("aria-invalid")).toBe("true");
    expect(nik.getAttribute("aria-describedby")).toBe("spmb-nik-error");
  });

  it("says the NIK may be left blank, so a real but disagreeing NIK is not a dead end", () => {
    renderForm();
    const nik = fillStepOne();

    fireEvent.change(nik, { target: { value: NIK_DAY_15 } });
    fireEvent.blur(nik);

    expect(screen.getByTestId("spmb-nik-error").textContent).toMatch(
      /kosongkan/i,
    );
  });

  it("clears the message once the digits agree with the date", () => {
    renderForm();
    const nik = fillStepOne();

    fireEvent.change(nik, { target: { value: NIK_DAY_15 } });
    fireEvent.blur(nik);
    expect(screen.getByTestId("spmb-nik-error")).toBeTruthy();

    fireEvent.change(nik, { target: { value: NIK_DAY_1 } });
    expect(screen.queryByTestId("spmb-nik-error")).toBeNull();
  });

  it("speaks English and Arabic for the same mismatch", () => {
    const { unmount } = renderForm("en");
    const enNik = fillStepOne("en");
    fireEvent.change(enNik, { target: { value: NIK_DAY_15 } });
    fireEvent.blur(enNik);
    expect(screen.getByTestId("spmb-nik-error").textContent).toMatch(
      /leave the NIK field empty/i,
    );
    unmount();

    renderForm("ar");
    const arNik = fillStepOne("ar");
    fireEvent.change(arNik, { target: { value: NIK_DAY_15 } });
    fireEvent.blur(arNik);
    expect(screen.getByTestId("spmb-nik-error").textContent).toMatch(
      /تاريخ الميلاد/,
    );
  });
});
