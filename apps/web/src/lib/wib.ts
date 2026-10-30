/**
 * The pesantren's wall clock: WIB (Asia/Jakarta, UTC+7), no daylight saving.
 *
 * The API schedules every school day on the WIB calendar (`Schedule.dayOfWeek`
 * is filled from the WIB week), but a browser's `new Date()` reads the device
 * clock. A device set to UTC — or any non-WIB zone — then resolves "today" to a
 * different weekday between 17:00 and midnight UTC, so the "Jadwal Hari Ini"
 * widget asks for the wrong day. Indonesia has no DST, so UTC+7 is a constant
 * and the day is read by shifting the instant and taking the UTC fields.
 *
 * The server has its own equivalent (`apps/api/src/utils/wib.ts`); this is the
 * web's single home for the same conversion.
 */

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Today's calendar day in WIB, "yyyy-MM-dd". */
export const todayWib = (now: Date = new Date()): string =>
  new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);

/** Day of week (0=Sunday … 6=Saturday) of a WIB calendar day, "yyyy-MM-dd". */
export const wibWeekday = (day: string): number =>
  new Date(`${day}T00:00:00.000Z`).getUTCDay();

/** Day of week (0=Sunday … 6=Saturday) an instant falls on in WIB. */
export const wibWeekdayOf = (instant: Date): number =>
  wibWeekday(todayWib(instant));
