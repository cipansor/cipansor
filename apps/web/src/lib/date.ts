/**
 * Date formatting utilities
 * Consistent date formatting throughout the application
 */
import { format as dateFnsFormat } from "date-fns";

/**
 * Safe wrapper around date-fns `format`. Returns a placeholder instead of
 * throwing `RangeError: Invalid time value` when the input is null/undefined or
 * an unparseable date — which would otherwise crash the whole page (e.g. a list
 * column rendering a record with a missing date).
 */
export function safeFormat(
  date: Date | string | null | undefined,
  pattern: string,
  options?: Parameters<typeof dateFnsFormat>[2],
  fallback = "-",
): string {
  if (!date) return fallback;
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return fallback;
  return dateFnsFormat(d, pattern, options);
}

/**
 * Format date to Indonesian locale
 */
export function formatDate(
  date: Date | string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!date) return "-";

  const d = typeof date === "string" ? new Date(date) : date;

  if (isNaN(d.getTime())) return "-";

  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...options,
  };

  return d.toLocaleDateString("id-ID", defaultOptions);
}

/**
 * Format date with time
 */
export function formatDateTime(
  date: Date | string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!date) return "-";

  const d = typeof date === "string" ? new Date(date) : date;

  if (isNaN(d.getTime())) return "-";

  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  };

  return d.toLocaleDateString("id-ID", defaultOptions);
}

/**
 * Format time only
 */
export function formatTime(
  date: Date | string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!date) return "-";

  const d = typeof date === "string" ? new Date(date) : date;

  if (isNaN(d.getTime())) return "-";

  const defaultOptions: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  };

  return d.toLocaleTimeString("id-ID", defaultOptions);
}

/**
 * Format date for input fields (YYYY-MM-DD)
 */
export function formatDateInput(
  date: Date | string | null | undefined,
): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;

  if (isNaN(d.getTime())) return "";

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * Format date for display (DD/MM/YYYY)
 */
export function formatDateShort(
  date: Date | string | null | undefined,
): string {
  if (!date) return "-";

  const d = typeof date === "string" ? new Date(date) : date;

  if (isNaN(d.getTime())) return "-";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

/**
 * Get relative time (e.g., "2 jam yang lalu")
 */
export function formatRelativeTime(
  date: Date | string | null | undefined,
): string {
  if (!date) return "-";

  const d = typeof date === "string" ? new Date(date) : date;

  if (isNaN(d.getTime())) return "-";

  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (seconds < 60) return "Baru saja";
  if (minutes < 60) return `${minutes} menit yang lalu`;
  if (hours < 24) return `${hours} jam yang lalu`;
  if (days < 7) return `${days} hari yang lalu`;
  if (weeks < 4) return `${weeks} minggu yang lalu`;
  if (months < 12) return `${months} bulan yang lalu`;
  return `${years} tahun yang lalu`;
}

/**
 * Get day name in Indonesian
 */
export function getDayName(date: Date | string, short = false): string {
  const d = typeof date === "string" ? new Date(date) : date;

  return d.toLocaleDateString("id-ID", {
    weekday: short ? "short" : "long",
  });
}

/**
 * Get month name in Indonesian
 */
export function getMonthName(month: number, short = false): string {
  const date = new Date(2000, month - 1, 1);
  return date.toLocaleDateString("id-ID", {
    month: short ? "short" : "long",
  });
}

/**
 * Check if date is today
 */
export function isToday(date: Date | string): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  const today = new Date();

  return (
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  );
}

/**
 * The WIB calendar day (YYYY-MM-DD) a moment falls on. WIB is a fixed UTC+7
 * with no daylight saving, so shifting the instant and reading the UTC fields
 * derives the pesantren's day from any clock — `new Date().toISOString()` reads
 * the UTC day, which is still yesterday in Tasikmalaya until 07:00 local.
 */
export function wibDayOf(moment: Date | string = new Date()): string {
  const d = typeof moment === "string" ? new Date(moment) : moment;
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Check if date is in the past
 */
export function isPast(date: Date | string): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  return d < new Date();
}

/**
 * Check if date is in the future
 */
export function isFuture(date: Date | string): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  return d > new Date();
}

/**
 * Get start of day
 */
export function startOfDay(date: Date | string): Date {
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get end of day
 */
export function endOfDay(date: Date | string): Date {
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Get start of month
 */
export function startOfMonth(date: Date | string): Date {
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get end of month
 */
export function endOfMonth(date: Date | string): Date {
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Add days to date
 */
export function addDays(date: Date | string, days: number): Date {
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Add months to date
 */
export function addMonths(date: Date | string, months: number): Date {
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Get difference in days between two dates
 */
export function diffInDays(date1: Date | string, date2: Date | string): number {
  const d1 = typeof date1 === "string" ? new Date(date1) : date1;
  const d2 = typeof date2 === "string" ? new Date(date2) : date2;

  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Get age from birthdate
 */
export function getAge(birthDate: Date | string): number {
  const d = typeof birthDate === "string" ? new Date(birthDate) : birthDate;
  const today = new Date();

  let age = today.getFullYear() - d.getFullYear();
  const monthDiff = today.getMonth() - d.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d.getDate())) {
    age--;
  }

  return age;
}
