import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, within, fireEvent } from "@testing-library/react";
import type { PublicIntakeDTO } from "@cipansor/shared";
import { spmbAnnouncementOf } from "@cipansor/shared";

/**
 * The SPMB announcement on the public site.
 *
 * The interesting part is the *rule*, not the markup: it must speak for a unit
 * whose registration is open, else for the one that opens soonest, else stay
 * silent — and it must never come back once dismissed for the intake it
 * announced, but must return for the next one. That last distinction is what a
 * permanent "1" in storage used to get wrong (the same bug the install banner
 * had), so it is pinned here.
 */

// --- fixtures -------------------------------------------------------------

/** The fields `spmbAnnouncementOf` reads; the rest is filled to satisfy the DTO. */
function intake(
  over: Partial<PublicIntakeDTO["period"]> & {
    unitName?: string;
  } = {},
): PublicIntakeDTO {
  const { unitName = "SMP IT Cipansor", ...period } = over;
  return {
    unit: { id: "u1", name: unitName, officialName: null, type: "SMP_IT" },
    period: {
      id: period.id ?? "p1",
      name: "SPMB",
      academicYear: "2027/2028",
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2027-07-10T00:00:00.000Z",
      window: "open",
      opensAt: null,
      closesAt: null,
      registrationFee: 0,
      requirements: [],
      minAgeMonths: null,
      ageReferenceDate: null,
      contactName: null,
      contactPhone: null,
      ...period,
    },
    waves: [],
    fees: [],
  };
}

describe("spmbAnnouncementOf", () => {
  it("speaks for a unit whose registration is open today", () => {
    const a = spmbAnnouncementOf([
      intake({ id: "closed", window: "closed" }),
      intake({ id: "open", window: "open", unitName: "SD IT Cipansor" }),
    ]);
    expect(a?.window).toBe("open");
    expect(a?.units).toEqual([{ name: "SD IT Cipansor" }]);
    expect(a?.period.id).toBe("open");
    expect(a?.period.academicYear).toBe("2027/2028");
  });

  it("names every unit that is open, not only the first", () => {
    // All four schools open (staging, 2027/2028): naming only the first in the
    // API's order told an SMA Qur'an family that TK Qur'an was open.
    const a = spmbAnnouncementOf([
      intake({ id: "tk", window: "open", unitName: "TK Qur'an Cipansor" }),
      intake({ id: "sd", window: "open", unitName: "SD IT Cipansor" }),
      intake({ id: "x", window: "closed", unitName: "Tutup" }),
      intake({ id: "sma", window: "open", unitName: "SMA Qur'an Cipansor" }),
    ]);
    expect(a?.units.map((u) => u.name)).toEqual([
      "TK Qur'an Cipansor",
      "SD IT Cipansor",
      "SMA Qur'an Cipansor",
    ]);
  });

  it("prefers an open intake over one that opens later", () => {
    // Otherwise the announcement would read "opens 1 January" while a sibling
    // school is taking registrations today.
    const a = spmbAnnouncementOf([
      intake({
        id: "later",
        window: "upcoming",
        opensAt: "2027-01-01T00:00:00.000Z",
      }),
      intake({ id: "now", window: "open", unitName: "SMP IT Cipansor" }),
    ]);
    expect(a?.window).toBe("open");
    expect(a?.period.id).toBe("now");
  });

  it("announces the soonest opening when nothing is open", () => {
    const a = spmbAnnouncementOf([
      intake({
        id: "mar",
        window: "upcoming",
        opensAt: "2027-03-08T00:00:00.000Z",
      }),
      intake({
        id: "jan",
        window: "upcoming",
        opensAt: "2027-01-01T00:00:00.000Z",
      }),
    ]);
    expect(a?.window).toBe("upcoming");
    expect(a?.period.id).toBe("jan");
    expect(a?.period.opensAt).toBe("2027-01-01T00:00:00.000Z");
  });

  it("announces nothing when every intake is closed", () => {
    expect(
      spmbAnnouncementOf([
        intake({ window: "closed" }),
        intake({ window: "closed" }),
      ]),
    ).toBeNull();
    expect(spmbAnnouncementOf([])).toBeNull();
  });

  it("ignores an upcoming intake with no opening date", () => {
    expect(
      spmbAnnouncementOf([intake({ window: "upcoming", opensAt: null })]),
    ).toBeNull();
  });
});

// --- the component --------------------------------------------------------

const defaultIntakes = () => ({
  data: [intake({ window: "open", id: "period-1" })],
});

const intakes = vi.fn<() => { data?: PublicIntakeDTO[] }>(defaultIntakes);

vi.mock("@/hooks/use-admissions", () => ({
  usePublicIntakes: () => intakes(),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: React.ReactNode }) => (
    <a {...rest}>{children}</a>
  ),
}));

import { SpmbAnnouncement } from "./spmb-announcement";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "spmb-banner-dismissed=; path=/; max-age=0";
  vi.useFakeTimers();
  intakes.mockReturnValue(defaultIntakes());
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("SpmbAnnouncement", () => {
  it("shows a dismissible banner when a unit is open", () => {
    render(<SpmbAnnouncement locale="id" />);
    expect(screen.getByTestId("spmb-announcement-banner")).toBeInTheDocument();
    expect(
      screen.getByText("Pendaftaran SPMB 2027/2028 telah dibuka"),
    ).toBeInTheDocument();
    // The banner links to the real registration page.
    expect(
      screen.getByRole("link", { name: "Daftar sekarang" }),
    ).toHaveAttribute("href", "/public/spmb");
  });

  it("shows nothing when no intake is open or upcoming", () => {
    intakes.mockReturnValue({ data: [intake({ window: "closed" })] });
    render(<SpmbAnnouncement locale="id" />);
    expect(screen.queryByTestId("spmb-announcement-banner")).toBeNull();
  });

  it("before it opens, offers info rather than a registration that cannot be made", () => {
    // An "upcoming" intake must not invite a registration the API would refuse:
    // the banner says when it opens and links to the details, and neither the
    // banner nor the dialog claims it is already open.
    intakes.mockReturnValue({
      data: [
        intake({
          window: "upcoming",
          opensAt: "2026-12-31T17:00:00.000Z",
          id: "period-upcoming",
        }),
      ],
    });
    render(<SpmbAnnouncement locale="id" />);

    const banner = screen.getByTestId("spmb-announcement-banner");
    expect(banner).toHaveTextContent("Pendaftaran SPMB 2027/2028 dibuka");
    expect(banner).not.toHaveTextContent("telah dibuka");
    // The link still goes to the SPMB page, but its label is not "Daftar sekarang".
    const link = screen.getByRole("link", { name: "Lihat info SPMB" });
    expect(link).toHaveAttribute("href", "/public/spmb");
    expect(screen.queryByRole("link", { name: "Daftar sekarang" })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const dialog = screen.getByTestId("spmb-announcement-dialog");
    expect(dialog).toHaveTextContent("belum dibuka");
    expect(dialog).not.toHaveTextContent("sudah dibuka");
    // The dialog's call to action is a link, not a button nested inside one —
    // a <button> inside an <a> is invalid HTML.
    const cta = within(dialog).getByRole("link", { name: "Lihat info SPMB" });
    expect(cta).toHaveAttribute("href", "/public/spmb");
  });

  it("scopes the opening date to the named unit, not to every school", () => {
    // Reviewer's example: TK opens 1 January, SD opens 1 February. Nothing is
    // open yet, so the announcement leads with TK — but the date is TK's, and
    // the dialog must not tell SD families that SD opens on 1 January too.
    intakes.mockReturnValue({
      data: [
        intake({
          id: "tk",
          window: "upcoming",
          opensAt: "2027-01-01T00:00:00.000Z",
          unitName: "TK Qur'an Cipansor",
        }),
        intake({
          id: "sd",
          window: "upcoming",
          opensAt: "2027-02-01T00:00:00.000Z",
          unitName: "SD IT Cipansor",
        }),
      ],
    });
    render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const dialog = screen.getByTestId("spmb-announcement-dialog");
    // The date belongs to the unit the announcement leads with…
    expect(dialog).toHaveTextContent("TK Qur'an Cipansor");
    expect(dialog).toHaveTextContent("1 Januari 2027");
    // …and the dialog does not attach it to the other units, which can differ.
    expect(dialog).not.toHaveTextContent("dan unit lainnya");
    expect(dialog).toHaveTextContent("Jadwal unit lainnya");
  });

  it("shows nothing on the portal (enabled={false})", () => {
    render(<SpmbAnnouncement locale="id" enabled={false} />);
    expect(screen.queryByTestId("spmb-announcement-banner")).toBeNull();
  });

  it("does not show a banner the visitor already dismissed for this intake", () => {
    document.cookie = "spmb-banner-dismissed=period-1; path=/";
    render(<SpmbAnnouncement locale="id" />);
    expect(screen.queryByTestId("spmb-announcement-banner")).toBeNull();
  });

  it("shows a later-intake announcement again after an earlier one was dismissed", () => {
    // The dismissal is remembered against the period id, so next year's intake
    // returns. A permanent "1" would hide it forever. The mock returns one
    // stable value, as React Query's cache does, so the second render sees the
    // same intake and the banner is not re-hidden.
    document.cookie = "spmb-banner-dismissed=period-1; path=/";
    intakes.mockReturnValue({
      data: [intake({ window: "open", id: "period-2" })],
    });
    render(<SpmbAnnouncement locale="id" />);
    expect(screen.getByTestId("spmb-announcement-banner")).toBeInTheDocument();
  });

  it("labels the dialog's close button in the reader's language", () => {
    // Radix's built-in X carries an English sr-only "Close" whatever the
    // locale; this surface is trilingual and carries its own labelled close.
    render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const dialog = screen.getByTestId("spmb-announcement-dialog");
    expect(
      within(dialog).getByRole("button", { name: "Tutup pengumuman" }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("opens as a non-modal notice, without an overlay over the page", () => {
    // Point 2 of the review: a full-screen overlay counts as an intrusive
    // interstitial even when delayed. Non-modal means Radix renders no
    // `DialogOverlay`, so the page under the notice stays readable.
    render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("spmb-announcement-dialog")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
  });

  it("does not remember a dismissal the visitor never made by clicking away", () => {
    // A non-modal dialog closes on an outside pointer by default; here that
    // would silently record "seen it" forever on any stray click. Clicking the
    // page must leave the notice (and its dismissal) untouched.
    render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.pointerDown(document.body);
    expect(screen.getByTestId("spmb-announcement-dialog")).toBeInTheDocument();
    expect(localStorage.getItem("spmb-announcement-dialog")).toBeNull();
  });

  it("is not dismissed for good by a Tab press on the page", () => {
    // A non-modal dialog also closes when focus moves outside it. One Tab
    // press anywhere on the page did that — and recorded a dismissal the
    // visitor never made, so a keyboard user could never reach the dialog.
    const outside = document.createElement("a");
    outside.href = "#main-content";
    outside.textContent = "Loncat ke konten utama";
    document.body.appendChild(outside);
    try {
      render(<SpmbAnnouncement locale="id" />);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      act(() => {
        outside.focus();
      });
      fireEvent.focusIn(outside);
      expect(
        screen.getByTestId("spmb-announcement-dialog"),
      ).toBeInTheDocument();
      expect(localStorage.getItem("spmb-announcement-dialog")).toBeNull();
    } finally {
      outside.remove();
    }
  });

  it("names every open unit in the reader's language", () => {
    intakes.mockReturnValue({
      data: [
        intake({ id: "tk", window: "open", unitName: "TK Qur'an Cipansor" }),
        intake({ id: "sd", window: "open", unitName: "SD IT Cipansor" }),
        intake({ id: "smp", window: "open", unitName: "SMP IT Cipansor" }),
      ],
    });
    render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("spmb-announcement-dialog")).toHaveTextContent(
      "TK Qur'an Cipansor, SD IT Cipansor, dan SMP IT Cipansor",
    );
  });

  it("appears once a visit, not on every page opened after it", () => {
    // Each public page mounts the announcement anew. Unanswered, the dialog
    // used to come back five seconds into every page.
    const first = render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("spmb-announcement-dialog")).toBeInTheDocument();
    first.unmount();

    render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("spmb-announcement-dialog")).toBeNull();
  });

  it("'Nanti saja' closes it for this visit only; the X closes it for the intake", () => {
    render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Nanti saja" }));
    expect(screen.queryByTestId("spmb-announcement-dialog")).toBeNull();
    // Later means later: nothing is remembered beyond this visit.
    expect(localStorage.getItem("spmb-announcement-dialog")).toBeNull();

    // A new visit (a fresh session) shows it again; its X closes it for good.
    sessionStorage.clear();
    const again = render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const dialog = screen.getByTestId("spmb-announcement-dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Tutup pengumuman" }),
    );
    expect(localStorage.getItem("spmb-announcement-dialog")).toBe("period-1");
    again.unmount();
  });

  it("renders the banner in the first paint from the server's intakes", () => {
    // Point 3 of the review: the banner is the first child of `<main>`, so
    // inserting it after the client query resolved pushed the page down — a
    // measured CLS of ~0.035. The server fetches the intakes and passes them
    // in, so the banner is in the HTML and the first client render; the
    // pending query (`data` undefined) must fall back to them, not to [].
    intakes.mockReturnValue({});
    render(
      <SpmbAnnouncement
        locale="id"
        initialIntakes={[intake({ window: "open", id: "period-1" })]}
      />,
    );
    expect(screen.getByTestId("spmb-announcement-banner")).toBeInTheDocument();
  });

  it("does not paint a banner the server did not announce, so nothing shifts after", () => {
    // The converse: the server found no open/upcoming intake, so it sent no
    // banner and its reserved space is zero. A later query result must not
    // pop one into the first paint's place.
    intakes.mockReturnValue({});
    render(<SpmbAnnouncement locale="id" initialIntakes={[]} />);
    expect(screen.queryByTestId("spmb-announcement-banner")).toBeNull();
  });

  it("omits the server-rendered banner a return visitor already dismissed", () => {
    // A returning visitor who closed the banner carries the cookie, which the
    // server and the browser both read — one store, so they cannot disagree
    // and paint a banner the browser then removes (the CLS this server
    // rendering exists to prevent).
    document.cookie = "spmb-banner-dismissed=period-1; path=/";
    intakes.mockReturnValue({});
    render(
      <SpmbAnnouncement
        locale="id"
        initialIntakes={[intake({ window: "open", id: "period-1" })]}
        initialBannerDismissed
      />,
    );
    expect(screen.queryByTestId("spmb-announcement-banner")).toBeNull();
  });

  it("records a banner dismissal in the cookie the server reads", () => {
    // Otherwise the next server render would send the banner back in the first
    // paint, and hydration would have to remove it.
    render(<SpmbAnnouncement locale="id" />);
    fireEvent.click(screen.getByRole("button", { name: "Tutup pengumuman" }));
    expect(document.cookie).toContain("spmb-banner-dismissed=period-1");
    expect(localStorage.getItem("spmb-announcement-banner")).toBeNull();
  });

  it("paints no banner from the server's intakes on the portal", () => {
    // `enabled={false}` still wins over server data: the portal never mounts it.
    intakes.mockReturnValue({});
    render(
      <SpmbAnnouncement
        locale="id"
        enabled={false}
        initialIntakes={[intake({ window: "open", id: "period-1" })]}
      />,
    );
    expect(screen.queryByTestId("spmb-announcement-banner")).toBeNull();
  });

  it("opens the dialog only after the delay, not at once", () => {
    render(<SpmbAnnouncement locale="id" />);
    expect(screen.queryByTestId("spmb-announcement-dialog")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("spmb-announcement-dialog")).toBeInTheDocument();
  });

  it("does not open the dialog when the visitor dismissed it for this intake", () => {
    localStorage.setItem("spmb-announcement-dialog", "period-1");
    render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("spmb-announcement-dialog")).toBeNull();
  });

  it("closes an open dialog when a refetch moves to an already-dismissed intake", () => {
    // The dialog opened for period-1; a refetch then announces period-2, which
    // the visitor already closed. The stale dialog must close with it rather
    // than keep speaking about an intake it no longer announces.
    const { rerender } = render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("spmb-announcement-dialog")).toBeInTheDocument();

    localStorage.setItem("spmb-announcement-dialog", "period-2");
    intakes.mockReturnValue({
      data: [intake({ window: "open", id: "period-2" })],
    });
    rerender(<SpmbAnnouncement locale="id" />);

    expect(screen.queryByTestId("spmb-announcement-dialog")).toBeNull();
  });

  it("does not open the dialog where the page asked for the banner only", () => {
    render(<SpmbAnnouncement locale="id" withDialog={false} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByTestId("spmb-announcement-dialog")).toBeNull();
  });
});

/**
 * WebKit ignores `scroll-padding-bottom` when focus scrolls the page, so a Tab
 * into the footer stopped with the link inside the card — the failure that kept
 * `main` red (#1177). The component now moves the focused element itself.
 */
describe("SpmbAnnouncement — keyboard focus stays clear of the card", () => {
  /** jsdom has no layout, so every rect is zero unless a test says otherwise. */
  function stubRect(el: Element, top: number, bottom: number) {
    Object.defineProperty(el, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top,
        bottom,
        left: 0,
        right: 200,
        width: 200,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }),
    });
  }

  function outsideLink() {
    const link = document.createElement("a");
    link.href = "#kontak";
    link.textContent = "Kontak";
    document.body.appendChild(link);
    return link;
  }

  it("scrolls a focused footer link out from behind the card", () => {
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    stubRect(screen.getByTestId("spmb-announcement-dialog"), 600, 800);
    const link = outsideLink();
    // The browser parked the link at the viewport edge, inside the card.
    stubRect(link, 770, 790);
    try {
      link.focus();
      fireEvent.focusIn(link);
      expect(scrollBy).toHaveBeenCalled();
      // 790 (link bottom) - 600 (card top) + 8 of clearance.
      expect(scrollBy.mock.calls[0][0]).toMatchObject({ top: 198 });
    } finally {
      link.remove();
    }
  });

  it("leaves a focused element above the card alone", () => {
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    stubRect(screen.getByTestId("spmb-announcement-dialog"), 600, 800);
    const link = outsideLink();
    stubRect(link, 300, 320);
    try {
      link.focus();
      fireEvent.focusIn(link);
      expect(scrollBy).not.toHaveBeenCalled();
    } finally {
      link.remove();
    }
  });

  it("does not scroll for focus inside the card itself", () => {
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const card = screen.getByTestId("spmb-announcement-dialog");
    stubRect(card, 600, 800);
    act(() => {
      within(card).getByRole("button", { name: "Nanti saja" }).focus();
    });
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("removes the reserve and the handler when the card closes", () => {
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    render(<SpmbAnnouncement locale="id" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    stubRect(screen.getByTestId("spmb-announcement-dialog"), 600, 800);
    act(() => {
      vi.advanceTimersByTime(16); // the requestAnimationFrame that measures
    });
    // 768 (jsdom's viewport height) - 600 + 8.
    expect(document.documentElement.style.scrollPaddingBottom).toBe("176px");
    expect(document.body.style.paddingBottom).toBe("176px");

    fireEvent.click(screen.getByRole("button", { name: "Nanti saja" }));
    expect(document.documentElement.style.scrollPaddingBottom).toBe("");
    expect(document.body.style.paddingBottom).toBe("");

    const link = outsideLink();
    stubRect(link, 770, 790);
    try {
      link.focus();
      fireEvent.focusIn(link);
      expect(scrollBy).not.toHaveBeenCalled();
    } finally {
      link.remove();
    }
  });
});
