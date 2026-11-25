"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import Link from "next/link";
import { Megaphone, X } from "lucide-react";
import { spmbAnnouncementOf, type PublicIntakeDTO } from "@cipansor/shared";
import { usePublicIntakes } from "@/hooks/use-admissions";
import { announcementContentFor } from "@/config/announcement.i18n";
import { dateFormatterFor } from "@/lib/locale-format";
import {
  readBannerDismissCookie,
  writeBannerDismissCookie,
} from "@/lib/announcement-cookies";
import type { Locale } from "@/locales";
import {
  Dialog,
  DialogClose,
  DialogPortal,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Where the dialog's answers are remembered, per period: closed for good
 * (`localStorage`), and already shown during this visit (`sessionStorage`).
 * The banner's dismissal lives in a cookie (`lib/announcement-cookies.ts`),
 * because the server has to read it too.
 */
const DIALOG_KEY = "spmb-announcement-dialog";
const DIALOG_SHOWN_KEY = "spmb-announcement-dialog-shown";

/**
 * How long the page is readable before the dialog appears. Not zero: a dialog
 * at the instant of arrival is the intrusive interstitial Google demotes and
 * Baymard's testers reflexively close without reading. A few seconds in, the
 * visitor has the content and the announcement reads as a notice, not a gate.
 */
const DIALOG_DELAY_MS = 5000;

/**
 * `useLayoutEffect` warns during the server render of a client component; this
 * is a quiet `useEffect` there and the real thing in the browser, where it must
 * run *before paint* so a hidden banner is never painted (and never shifts the
 * page in reverse).
 */
const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Set by the announcement's own e2e spec so it can see the notice under
 * automation; absent everywhere else.
 */
const FORCE_KEY = "spmb-announcement-force";

/**
 * Whether the notice should stay hidden because the page is under browser
 * automation.
 *
 * The e2e suite that is not about this notice would otherwise race it: a dialog
 * that opens five seconds in, and a sticky bar that can sit over a link
 * Playwright scrolls to. The component still mounts and derives its message in
 * every run — only the visible surface is withheld — so a fault in the logic
 * still fails those specs. The announcement's own spec sets `FORCE_KEY` to
 * bring it back. This mirrors `ServiceWorkerRegister`, which skips registration
 * under `navigator.webdriver` for a related reason.
 */
function hiddenUnderAutomation(): boolean {
  if (typeof navigator === "undefined" || !navigator.webdriver) return false;
  try {
    return localStorage.getItem(FORCE_KEY) !== "1";
  } catch {
    return true;
  }
}

function isDismissed(key: string, periodId: string): boolean {
  try {
    // A dismissal stores the period's id, so the announcement returns for next
    // year's intake and not before.
    return localStorage.getItem(key) === periodId;
  } catch {
    // Private mode or blocked storage: better to stay quiet than to nag.
    return true;
  }
}

function rememberDismissed(key: string, periodId: string) {
  try {
    localStorage.setItem(key, periodId);
  } catch {
    // Storage unavailable. The notice still closes for this page-session;
    // dropping the click entirely would be worse than forgetting it later.
  }
}

/**
 * Whether the dialog already appeared during this visit. The request was a
 * window "every time the public site is opened" — once a visit, not on every
 * page: unanswered, it used to come back five seconds into each page the
 * visitor opened.
 */
function shownThisVisit(periodId: string): boolean {
  try {
    return sessionStorage.getItem(DIALOG_SHOWN_KEY) === periodId;
  } catch {
    return true;
  }
}

function rememberShownThisVisit(periodId: string) {
  try {
    sessionStorage.setItem(DIALOG_SHOWN_KEY, periodId);
  } catch {
    // Without session storage the dialog may appear on the next page too.
  }
}

/**
 * While the card is open, keep the content a keyboard user moves to from
 * hiding behind it (WCAG 2.2 SC 2.4.11, technique C43): the page's
 * `scroll-padding-bottom` makes the browser scroll a focused element clear of
 * the card, and the same space at the end of the body lets the last links of
 * the footer scroll above it too. Both are removed when the card closes.
 *
 * `scroll-padding-bottom` alone is not enough: WebKit ignores it when focus
 * scrolls the page, so a Tab into the footer stopped with the link exactly at
 * the viewport edge — inside the card. The `focusin` handler therefore moves a
 * focused element out of the card itself, on every engine; the body padding is
 * the scroll room that makes the last links reachable. It runs once on the
 * event and once in the next frame, because an engine may scroll the element
 * into view only after dispatching the event; the second run is a no-op when
 * the first one already cleared it.
 */
function useReserveBottom(
  open: boolean,
  ref: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const body = document.body;
    const before = {
      scroll: root.style.scrollPaddingBottom,
      pad: body.style.paddingBottom,
    };
    const apply = () => {
      const card = ref.current;
      if (!card) return;
      const space =
        Math.ceil(window.innerHeight - card.getBoundingClientRect().top) + 8;
      root.style.scrollPaddingBottom = `${space}px`;
      body.style.paddingBottom = `${space}px`;
    };

    const clearFocused = () => {
      const card = ref.current;
      const focused = document.activeElement;
      if (!card || !focused || focused === document.body) return;
      if (card.contains(focused)) return;
      const box = card.getBoundingClientRect();
      const rect = focused.getBoundingClientRect();
      const overlaps = rect.bottom > box.top && rect.top < box.bottom;
      if (!overlaps) return;
      window.scrollBy({ top: Math.ceil(rect.bottom - box.top) + 8 });
    };

    let focusFrame = 0;
    const onFocusIn = () => {
      clearFocused();
      window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(clearFocused);
    };

    const frame = window.requestAnimationFrame(apply);
    window.addEventListener("resize", apply);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("resize", apply);
      document.removeEventListener("focusin", onFocusIn);
      root.style.scrollPaddingBottom = before.scroll;
      body.style.paddingBottom = before.pad;
    };
  }, [open, ref]);
}

/** "TK Qur'an, SD IT, dan SMP IT" — the units joined in the reader's language. */
function joinUnits(locale: Locale, names: string[]): string {
  try {
    return new Intl.ListFormat(locale, {
      style: "long",
      type: "conjunction",
    }).format(names);
  } catch {
    return names.join(", ");
  }
}

/**
 * The SPMB announcement on the public site: a banner, and a dialog that appears
 * a few seconds into a visit — once a visit, until the visitor closes it for
 * the intake (the X, Escape, or the call to action). "Later" closes it for the
 * visit only.
 *
 * What it says is derived from the units' intakes (`findPublicIntakes`), the
 * same source the SPMB page and the chatbot read, so they cannot disagree. It
 * is never typed by hand, so it cannot outlive the intake it announces the way
 * the old hardcoded "SPMB 2026 Telah Dibuka" badge did — a badge the hero used
 * to carry until this announcement replaced it (the banner says the same thing,
 * so the badge was removed rather than repeated).
 *
 * The shape follows the standards, deliberately:
 * - Google Search Central says to "use banners instead of interstitials" and
 *   counts only overlays that obstruct content as intrusive. The banner is the
 *   primary surface; the dialog is small, appears after a delay, gives two ways
 *   out, and never blocks the pages it would interrupt most (`/public/spmb`,
 *   the verification pages — those do not mount this at all).
 * - The dialog is **non-modal** (`modal={false}`): Radix renders no overlay and
 *   the page under it stays readable and clickable, so it is a notice rather
 *   than an interstitial. It keeps `role="dialog"` with a labelled title and
 *   description and a visible, labelled close; a non-modal dialog deliberately
 *   does not trap focus or steal it on open.
 * - Both are trilingual (`config/announcement.i18n.ts`); the dialog's close
 *   button carries its own localized label rather than the built-in English
 *   `sr-only` "Close".
 *
 * `enabled` is the host gate, decided by the server that mounts it: the public
 * site (and staging, and `pnpm dev`) show it, the staff portal does not.
 */
export function SpmbAnnouncement({
  locale,
  enabled = true,
  withDialog = true,
  initialIntakes,
  initialBannerDismissed = false,
}: {
  locale: Locale;
  enabled?: boolean;
  withDialog?: boolean;
  /**
   * The intakes the server already fetched, so the banner is in the first
   * paint. The component is the first child of `<main>`, so rendering it only
   * after the client query resolves pushed the page down — a measured CLS of
   * 0.035 on `/`, `/profil` and `/wakaf-infaq`. The client still owns
   * freshness; this is only what the first paint starts from.
   */
  initialIntakes?: PublicIntakeDTO[];
  /**
   * Whether this visitor already dismissed the banner for the announced intake,
   * read server-side from the cookie mirror (`lib/announcement-cookies.ts`).
   * The initial state must match the server's, or a return visitor sees the
   * banner flash in and the page shift up at hydration.
   */
  initialBannerDismissed?: boolean;
}) {
  const { data } = usePublicIntakes({
    // The announcement's whole job is to appear the moment an intake opens (or
    // to go away when it closes). The global defaults — 1-minute stale time and
    // no refetch on focus — let a tab open since morning still show yesterday's
    // status, so tighten freshness for this surface only: a quarter-hour poll
    // plus a refetch whenever the visitor returns to the tab. The global
    // defaults are untouched for every other `usePublicIntakes` caller.
    staleTime: 15 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const copy = announcementContentFor(locale);
  // The server's value (`initialIntakes`) and the client query's fresher one
  // describe the same intakes; `data` is undefined until the query resolves, so
  // the first client render falls back to the server's — which is what keeps
  // hydration identical and the banner present from the first paint. The
  // fallback stays inside the memo: `[]` is a fresh array each render and would
  // otherwise re-run the derivation (and re-fire the effects below) forever.
  const announcement = useMemo(
    () => spmbAnnouncementOf(data ?? initialIntakes ?? []),
    [data, initialIntakes],
  );
  const periodId = announcement?.period.id ?? "";
  const canShow = enabled && !!announcement;

  // Initialised from the server's decision, not `false`: the server already
  // knows the announcement, so the banner is in the HTML it sends and the first
  // client render must match it — including a banner this visitor had already
  // dismissed, which the server learned from the cookie mirror. The layout
  // effect below then applies the two things only the browser can know (the
  // automation guard, and the live `localStorage` dismissal) before the browser
  // paints, so nothing below the banner moves either way.
  const [bannerOpen, setBannerOpen] = useState(
    canShow && !initialBannerDismissed,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useReserveBottom(dialogOpen, dialogRef);
  const [hidden, setHidden] = useState(false);

  useIsoLayoutEffect(() => {
    setHidden(hiddenUnderAutomation());
  }, []);

  useIsoLayoutEffect(() => {
    if (hidden || !canShow) {
      setBannerOpen(false);
      return;
    }
    setBannerOpen(readBannerDismissCookie() !== periodId);
  }, [hidden, canShow, announcement, periodId]);

  useEffect(() => {
    if (hidden || !enabled || !withDialog || !announcement) {
      setDialogOpen(false);
      return;
    }
    // A refetch can move the announcement to a period the visitor already
    // closed; the open dialog belongs to that period, so close it too rather
    // than leave it speaking about an intake it no longer announces.
    if (isDismissed(DIALOG_KEY, periodId)) {
      setDialogOpen(false);
      return;
    }
    // Once a visit: a page opened after it appeared does not bring it back.
    if (shownThisVisit(periodId)) return;
    const timer = window.setTimeout(() => {
      rememberShownThisVisit(periodId);
      setDialogOpen(true);
    }, DIALOG_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hidden, enabled, withDialog, announcement, periodId]);

  if (!enabled || !announcement) return null;

  const date = announcement.period.opensAt
    ? dateFormatterFor(locale).format(new Date(announcement.period.opensAt))
    : "";
  const year = announcement.period.academicYear ?? "";
  const open = announcement.window === "open";
  const bannerText = open
    ? copy.bannerOpen(year)
    : copy.bannerOpens(year, date);
  const bannerCta = open ? copy.bannerCtaOpen : copy.bannerCtaOpens;
  const dialogTitle = open
    ? copy.dialogTitleOpen(year)
    : copy.dialogTitleOpens(year, date);
  const unitNames = joinUnits(
    locale,
    announcement.units.map((unit) => unit.name),
  );
  const dialogBody = open
    ? copy.dialogBodyOpen(unitNames)
    : copy.dialogBodyOpens(unitNames, date);
  const dialogCta = open ? copy.dialogCtaOpen : copy.dialogCtaOpens;
  const headingId = "spmb-announcement-text";

  const closeBanner = () => {
    // The cookie is read by the next server render too, so the banner is left
    // out of that first paint instead of flashing in and shifting up.
    writeBannerDismissCookie(periodId);
    setBannerOpen(false);
  };
  // Closed for good: the X, Escape, or following the call to action.
  const closeDialog = () => {
    rememberDismissed(DIALOG_KEY, periodId);
    setDialogOpen(false);
  };
  // "Later" means later: closed for this visit only, back on the next one.
  const closeDialogForThisVisit = () => setDialogOpen(false);

  return (
    <>
      {bannerOpen && (
        <div
          role="region"
          aria-labelledby={headingId}
          data-testid="spmb-announcement-banner"
          // `sticky top-16` (64px = the navbar's height) parks the bar directly
          // under the fixed header on every public page. The bar is the first
          // child of `<main>`, so its flow box already starts below the navbar
          // (`PublicPage`/`/wakaf-infaq` put `pt-16` on `<main>`; the homepage's
          // hero carries its own `pt-24`), and sticky pins it there on scroll.
          className="sticky top-16 z-40 border-b border-primary/20 bg-primary/10"
        >
          <div className="container mx-auto flex items-start gap-3 px-4 py-3 sm:items-center sm:px-6 lg:px-8">
            <Megaphone
              className="mt-0.5 h-5 w-5 shrink-0 text-primary sm:mt-0"
              aria-hidden="true"
            />
            <p
              id={headingId}
              className="min-w-0 flex-1 text-sm font-medium text-foreground"
            >
              {bannerText}
            </p>
            <Link
              href="/public/spmb"
              className="shrink-0 text-sm font-semibold text-primary underline-offset-4 hover:underline"
            >
              {bannerCta}
            </Link>
            {/* 36 px hit area around a 16 px glyph: WCAG 2.5.8 asks for at
                least 24 px, and this sits under a thumb on a phone. */}
            <button
              type="button"
              onClick={closeBanner}
              aria-label={copy.dismiss}
              className="-m-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      {withDialog && (
        <Dialog
          // Non-modal on purpose. Google Search Central counts an overlay that
          // covers the page while the reader is in it as an intrusive
          // interstitial, and a five-second delay does not change that. With
          // `modal={false}` Radix renders no `DialogOverlay` at all — the page
          // under it stays visible and interactive — so this is a small notice,
          // not a gate. See `decisions/spmb-announcement-publik.md`.
          modal={false}
          open={dialogOpen}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
        >
          <DialogPortal>
            <DialogPrimitive.Content
              ref={dialogRef}
              data-testid="spmb-announcement-dialog"
              // A card at the bottom, not a box in the middle of the page
              // (decided 2026-10-09). Centred, it covered the reading area — a
              // third of a phone screen — and hid five links a keyboard user
              // tabbed to (WCAG 2.2 SC 2.4.11, measured at 1280 px). Phones: the
              // full width above the assistant's launcher. Wider screens: the
              // reading-start corner (left; right in Arabic), across from the
              // launcher. `bottom-24` clears the launcher on either side, so the
              // two never overlap whichever corner the launcher takes. While it
              // is open, `useReserveBottom` keeps focused content scrolled clear
              // of it (technique C43).
              className="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 fixed inset-x-4 bottom-24 z-50 grid gap-3 rounded-lg border p-5 shadow-lg duration-200 sm:inset-x-auto sm:start-4 sm:w-full sm:max-w-sm"
              // A non-modal dialog must not steal focus when it appears mid-read;
              // it is a notice, not a step the visitor has to answer.
              onOpenAutoFocus={(event) => event.preventDefault()}
              // A non-modal dialog dismisses on any interaction outside it — a
              // pointer, and also *focus* moving to the page. Either would write
              // the dismissal for a notice the visitor never answered: a single
              // Tab press anywhere closed it for good, so a keyboard user could
              // never reach its buttons. The ways out are the buttons, the X and
              // Escape. (`onInteractOutside` covers both pointer and focus.)
              onInteractOutside={(event) => event.preventDefault()}
            >
              {/* `text-start`: the shared header aligns physically left, which
                put Arabic text against the wrong edge. `pe-8` keeps the title
                clear of the close button. */}
              <DialogHeader className="pe-8 text-start sm:text-start">
                <DialogTitle>{dialogTitle}</DialogTitle>
                <DialogDescription>{dialogBody}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={closeDialogForThisVisit}>
                  {copy.dialogLater}
                </Button>
                <Button asChild>
                  <Link href="/public/spmb" onClick={closeDialog}>
                    {dialogCta}
                  </Link>
                </Button>
              </DialogFooter>
              <DialogClose
                aria-label={copy.dismiss}
                className="ring-offset-background focus:ring-ring absolute top-4 end-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </DialogClose>
            </DialogPrimitive.Content>
          </DialogPortal>
        </Dialog>
      )}
    </>
  );
}
