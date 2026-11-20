# A date-only column at midnight UTC, compared to `now`

## The other half: a *month bucket* built from the server clock

The same 07:00 WIB offset that shifts a day bound also shifts a **month
bucket**. `getCashFlowForecast` built its projection with
`new Date(now.getFullYear(), now.getMonth() + i, 1)` — plausible, and wrong on a
UTC container for the first seven hours of every month: on 1 Nov 00:30 WIB the
server is still in October, so the first bucket was labelled `Oct 26` and the
last requested month fell off the end. The invoice query's `endDate` was seven
months short for the same reason.

What makes this one worth its own paragraph: **`wibMonthRange(year, month)` does
not roll a month over.** It pads `month + 1` into a date string
(`String(month + 1).padStart(2, '0')`), so `month = 12` asks for `"13"` and
throws `RangeError`. Callers must normalise first —
`year + Math.floor(m / 12)` and `((m % 12) + 12) % 12` — and the issue text says
so explicitly. A test that only covers *one* month past the base will not catch
it.

Two related rules that came out of the same fix:

- **A label is not a date.** `monthLabel` must not be read off `start`
  (`toLocaleString` on a WIB instant shifts again in another zone) nor left to
  the host locale. `new Date(Date.UTC(year, month, 1))` with `timeZone: 'UTC'`
  and an explicit `'en-US'` is the shape that survives every `TZ`.
- **`@db.Date` columns want equality, not a lower bound.** `getQuickStats`
  bounded a WIB-day column with `gte: setHours(0,0,0,0)` — which is the UTC day
  — and so counted yesterday *and every later day*. `dayOf(todayWib())` by
  equality is the only correct reader.

The guard now covers both shapes: `GUARDED` (local `setHours(0,0,0,0)`) plus
`MONTH_GUARDED` (local `new Date(x.getFullYear(), x.getMonth() + …)`) in
`apps/api/src/utils/wib-day-bounds.guard.test.ts`. When a guard test gains a
list, **mutation-check it** — reverting the two production files to their old
bodies made exactly the expected rows go red, which is the only evidence that a
new predicate is not a no-op. It also has a false-negative shape worth knowing:
the guard's import assertion matches only the *alias* form
(`from '@/utils/wib'`), so a relative import in the same directory silently
fails it — that is why `holiday-sync.service.ts` was realigned.

## Writing and reading a date-only column

`Invoice.dueDate` is a `DateTime` column kept as a **calendar day**: `dayDate()`
in `apps/api/src/utils/wib.ts` writes `new Date("2026-08-10T00:00:00.000Z")`.
The `spp-reminder.job` and `utcMonthRange` bound it the same way (midnight UTC),
and the codebase comment says so — "a `DateTime` column kept as a calendar day".

Two consequences that bite:

1. **07.00 WIB, not the end of the day.** Midnight UTC *is* 07:00 WIB. A reader
   that compares the column to `new Date()` (the current instant) treats an
   invoice as overdue from 07:00 WIB on its due date, not after the day ends:
   `getStudentOutstandingBalances` (`dueDate: { lt: new Date() }`),
   `getSppMatrix` (`new Date(inv.dueDate) < now`), `dashboard.service.ts`,
   `analytics/alerts.service.ts`, `analytics/forecast.service.ts`. If the intent
   is "one calendar day", compare against the **next** midnight UTC
   (`dueDate + 24h`), or a WIB helper — never against `now`. Tracked in #1050.

2. **Reading serializes as an ISO timestamp, not `YYYY-MM-DD`.** A service that
   returns the Prisma `Invoice` object unchanged (`parentService.getChildFinance`)
   hands `res.json` a `Date`, which becomes `2026-08-10T00:00:00.000Z`. The
   *write* contract is `z.string().date` (`YYYY-MM-DD`); the *read* shape is ISO.
   Document them separately — a client told only "`YYYY-MM-DD`" will parse the
   read wrong.

The trap in writing the doc: the #775 sweep made the column *date-only*, and it
is tempting to describe that as "a whole day, no particular hour". It is not a
whole day in the readers' arithmetic. Check the comparator, not the column type,
before claiming a boundary. `check_docs.py` cannot see this — it checks numbers,
labels and paths, not whether a sentence matches a comparison operator.
