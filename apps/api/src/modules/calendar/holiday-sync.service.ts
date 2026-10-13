import { prisma } from '../../lib/prisma';
import { Errors } from '../../middleware/error';
import { dayOf } from '../../utils/wib';
import type { Prisma } from '@prisma/client';

/**
 * National-holiday calendar sync.
 *
 * Indonesia has no official holiday API, so the holidays are fetched from a
 * configurable public source and *stored* in `CalendarEvent`. Storing them is
 * the point: the attendance and payroll engines read the calendar, and they
 * must keep working when the source is down. The source is data, not code —
 * Super Admin can point it elsewhere, and a source that returns nothing usable
 * is refused rather than allowed to silently empty the calendar.
 */

export const HOLIDAY_SYNC_KEY = 'HOLIDAY_SYNC';

/** Default source. Public, no key, maintained from SKB 3 Menteri. */
export const DEFAULT_HOLIDAY_SOURCE_URL = 'https://api-hari-libur.vercel.app/api';

export interface HolidaySyncConfig {
  sourceUrl: string;
  /** Years fetched by the scheduled job, on top of the current year. */
  years: number[];
  /** Whether the scheduled job runs at all. */
  enabled: boolean;
  lastSyncedAt: string | null;
}

export interface HolidayEntry {
  date: string;
  description: string;
}

export interface HolidaySyncResult {
  year: number;
  created: number;
  updated: number;
  skipped: number;
  entries: number;
}

export async function getHolidaySyncConfig(): Promise<HolidaySyncConfig> {
  const setting = await prisma.setting.findFirst({ where: { key: HOLIDAY_SYNC_KEY } });
  const value = (setting?.value ?? {}) as Partial<HolidaySyncConfig>;
  return {
    sourceUrl: value.sourceUrl || DEFAULT_HOLIDAY_SOURCE_URL,
    years: Array.isArray(value.years) ? value.years : [],
    enabled: value.enabled ?? true,
    lastSyncedAt: value.lastSyncedAt ?? null,
  };
}

export async function updateHolidaySyncConfig(
  input: Partial<Omit<HolidaySyncConfig, 'lastSyncedAt'>>
) {
  const current = await getHolidaySyncConfig();
  const next: HolidaySyncConfig = {
    ...current,
    ...input,
    lastSyncedAt: current.lastSyncedAt,
  };
  if (!next.sourceUrl.startsWith('https://')) {
    throw Errors.badRequest('URL sumber libur harus https');
  }
  const existing = await prisma.setting.findFirst({ where: { key: HOLIDAY_SYNC_KEY } });
  if (existing) {
    await prisma.setting.update({
      where: { id: existing.id },
      data: { value: next as unknown as Prisma.InputJsonValue },
    });
  } else {
    const unit = await prisma.unit.findFirst({ select: { id: true } });
    if (!unit) throw Errors.badRequest('Belum ada unit untuk menyimpan pengaturan');
    await prisma.setting.create({
      data: {
        unitId: unit.id,
        key: HOLIDAY_SYNC_KEY,
        value: next as unknown as Prisma.InputJsonValue,
      },
    });
  }
  return next;
}

/**
 * Parse the `api-hari-libur` shape: `{ status, code, data: [{ date,
 * description }] }`. A response that is not that shape is rejected, so a
 * changed or hijacked source cannot write junk into the calendar.
 */
export function parseHolidayResponse(body: unknown): HolidayEntry[] {
  if (typeof body !== 'object' || body === null) {
    throw Errors.badRequest('Respons sumber libur bukan objek');
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw Errors.badRequest('Respons sumber libur tidak memuat daftar libur');
  }
  const entries: HolidayEntry[] = [];
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) continue;
    const date = (raw as { date?: unknown }).date;
    const description = (raw as { description?: unknown }).description;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (typeof description !== 'string' || description.trim() === '') continue;
    entries.push({ date, description: description.trim() });
  }
  return entries;
}

/** Fetch one year's holidays from the configured source. */
export async function fetchHolidaysForYear(
  year: number,
  sourceUrl = DEFAULT_HOLIDAY_SOURCE_URL
): Promise<HolidayEntry[]> {
  const url = `${sourceUrl}?year=${year}`;
  let response: Response;
  try {
    // `redirect: 'error'`: the source must be https when it is saved, and that
    // check means nothing if a redirect may take the request anywhere else.
    response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
  } catch {
    throw Errors.badRequest(`Tidak dapat menghubungi sumber libur (${url})`);
  }
  if (!response.ok) {
    throw Errors.badRequest(`Sumber libur menjawab ${response.status}`);
  }
  return parseHolidayResponse(await response.json());
}

/**
 * Store a year's holidays as **draft** calendar events for a unit (null = all
 * units). A draft is invisible to the attendance and payroll engines until an
 * admin approves it: the source is third-party, and a holiday that silently
 * arrives would change which days count as work days (decisions/absensi-pegawai.md).
 *
 * Idempotent: a holiday already present by title and date is left alone, and a
 * holiday that no longer appears in the source is kept — the yayasan may have
 * added it by hand, and deleting a holiday would silently turn it into an
 * absence.
 */
export async function syncHolidaysForYear(
  year: number,
  options: { unitId?: string | null; createdById: string; sourceUrl?: string }
): Promise<HolidaySyncResult> {
  const config = await getHolidaySyncConfig();
  const entries = await fetchHolidaysForYear(year, options.sourceUrl ?? config.sourceUrl);
  const unitId = options.unitId ?? null;

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const entry of entries) {
    const startDate = dayOf(entry.date);
    const existing = await prisma.calendarEvent.findFirst({
      where: {
        eventType: 'HOLIDAY',
        deletedAt: null,
        unitId,
        startDate,
        title: entry.description,
      },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }
    const sameDay = await prisma.calendarEvent.findFirst({
      where: { eventType: 'HOLIDAY', deletedAt: null, unitId, startDate },
      select: { id: true },
    });
    if (sameDay) {
      // A holiday already sits on that date; keep the admin's wording.
      skipped++;
      continue;
    }
    await prisma.calendarEvent.create({
      data: {
        unitId,
        title: entry.description,
        eventType: 'HOLIDAY',
        scope: unitId ? 'SPECIFIC_UNIT' : 'ALL_UNITS',
        startDate,
        isAllDay: true,
        isPublic: true,
        isDraft: true,
        createdById: options.createdById,
      },
    });
    created++;
  }

  return { year, created, updated, skipped, entries: entries.length };
}

/**
 * Draft holiday events awaiting review. A unit-scoped caller sees only its own
 * unit's drafts — a yayasan-wide draft changes every unit's work days, so it is
 * the foundation's to review, not one school's.
 */
export async function listHolidayDrafts(unitId?: string | null) {
  return prisma.calendarEvent.findMany({
    where: {
      eventType: 'HOLIDAY',
      deletedAt: null,
      isDraft: true,
      ...(unitId ? { unitId } : {}),
    },
    orderBy: { startDate: 'asc' },
  });
}

/** The draft row, when it is still open and inside the caller's unit. */
async function findReviewableDraft(id: string, unitId?: string | null) {
  const draft = await prisma.calendarEvent.findFirst({
    where: {
      id,
      eventType: 'HOLIDAY',
      isDraft: true,
      deletedAt: null,
      ...(unitId ? { unitId } : {}),
    },
    select: { id: true },
  });
  if (!draft) throw Errors.notFound('Draf libur');
  return draft;
}

/** Approve a draft: it joins the live calendar and starts affecting work days. */
export async function approveHolidayDraft(id: string, unitId?: string | null) {
  await findReviewableDraft(id, unitId);
  return prisma.calendarEvent.update({ where: { id }, data: { isDraft: false } });
}

/** Reject a draft: drop it, so it never affects a work day or a payslip. */
export async function rejectHolidayDraft(id: string, unitId?: string | null) {
  await findReviewableDraft(id, unitId);
  await prisma.calendarEvent.update({ where: { id }, data: { deletedAt: new Date() } });
  return { id };
}

/** Sync the years the scheduled job covers: this year and the configured ones. */
export async function syncConfiguredHolidays(createdById: string) {
  const config = await getHolidaySyncConfig();
  if (!config.enabled) return { ran: false as const, results: [] };

  const years = new Set<number>([new Date().getUTCFullYear(), ...config.years]);
  const results: HolidaySyncResult[] = [];
  for (const year of years) {
    results.push(await syncHolidaysForYear(year, { createdById, sourceUrl: config.sourceUrl }));
  }

  const existing = await prisma.setting.findFirst({ where: { key: HOLIDAY_SYNC_KEY } });
  if (existing) {
    await prisma.setting.update({
      where: { id: existing.id },
      data: {
        value: {
          ...config,
          lastSyncedAt: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }
  return { ran: true as const, results };
}
