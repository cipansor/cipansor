# A date-only column at midnight UTC, compared to `now`

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
