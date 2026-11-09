/**
 * How the portal shows an SPMB intake's dates and money.
 *
 * The API stores a registration window as moments: the first day's start and
 * the last day's end in WIB (`2026-12-20T16:59:59.999Z` is the end of
 * 20 December in Tasikmalaya). A date input wants the day back, so a moment is
 * read on the WIB clock, never the browser's. The sessions after registration
 * (test, results, re-registration) are plain calendar days.
 */

import { wibDayOf } from "./date";

/**
 * The WIB day a stored registration moment falls on, as a date input shows it.
 * Null/blank and unparseable values read as "" — a form field's empty state —
 * where `wibDayOf` would answer "" only for an unparseable instant.
 */
export function wibDay(iso: string | null | undefined): string {
  if (!iso) return "";
  return wibDayOf(iso);
}

/** A stored calendar day (`2026-12-20T00:00:00.000Z`) as a date input shows it. */
export function calendarDay(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

function parts(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}

/**
 * A day or a range of days, written the way the brochure writes them:
 * "28 Feb 2027", "20–25 Des 2026", "28 Des 2026 – 3 Jan 2027". Empty is "—".
 */
export function formatDays(start: string, end?: string): string {
  if (!start) return "—";
  const a = parts(start);
  const one = `${a.d} ${MONTHS[a.m - 1]} ${a.y}`;
  if (!end || end === start) return one;
  const b = parts(end);
  if (a.y === b.y && a.m === b.m)
    return `${a.d}–${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (a.y === b.y)
    return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return `${one} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

/** "Rp1.000.000"; empty for no amount. */
export function formatRupiah(amount: string | number | null | undefined) {
  if (amount === null || amount === undefined || amount === "") return "";
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
  return `Rp${Math.round(value).toLocaleString("id-ID")}`;
}

/** 84 → "7 tahun"; 66 → "5 tahun 6 bulan". */
export function formatAge(months: number | null | undefined): string {
  if (months === null || months === undefined) return "";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years} tahun ${rest} bulan` : `${years} tahun`;
}

/** One requirement per line, empty lines dropped. */
export function requirementLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
