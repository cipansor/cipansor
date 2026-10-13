# Attendance-system traps

Eight shapes that made a working-looking attendance feature wrong, found across
the 2026-09-29 audit and the Devin review that followed it. Each is generic:
look for it wherever a policy, a date, a pay rule or a retention period is read.

## A policy read as `policy?.flag` fails open

`if (policy?.requireSelfie && !photo) throw …` — when no policy row exists,
`policy` is `null`, the check is skipped, and the punch passes with no
evidence. The model's default (`requireSelfie = true`) never applies, because
no row means no default. A policy that decides whether evidence is *required*
must default to the safe side in code, not to "off". Ask of every policy read:
what happens when the row is missing? And what seeds the row? If the answer to
the second is "nobody", the feature is off in a fresh database while the code
looks like it enforces it.

The same shape turns a geofence into a no-op: no site means the distance is
unknown (`null`), and `null` never satisfies a `REJECT`.

## A Zod `datetime()` field refuses the browser's own date value

`z.string().datetime()` rejects `"2026-09-29"`, which is exactly what
`<input type="date">` produces. A create/update endpoint whose date comes from
a date picker and whose schema says `datetime()` is a 400 in production and a
green unit test, because the test sends the ISO string the schema wants. A
calendar-day field is `z.coerce.date()` or a `yyyy-MM-dd` string with a
validator; keep `datetime()` for an instant.

## Two codes for one concept

The engine excluded the basic salary by the literal code `'GAJI_POKOK'`, while
the seed created it as `'BASIC_SALARY'`. On a seeded database the basic salary
was therefore an allowance — counted in the deduction basis and again in gross.
The schema even carried the field meant to settle it (`classification`) and
nothing read it. One concept, one code, and the classification read from the
row rather than guessed from a string. A rule expressed as "everything except
X" breaks the day X is spelled differently.

## A derived counter that is initialised and never incremented

`earlyLeaveDays` and `overtimeMinutes` were set to 0, offered as triggers in
the schema and the UI, and never written — so the rules that used them did
nothing, silently. A trigger enum is a promise; if a branch cannot produce its
number, the trigger should not be offered.

## A retention setting with no job

`photoRetentionDays` and a `RetentionPolicy` table existed, the settings page
had the fields, and no job read either. A stored retention number with nothing
that acts on it is worse than none: it reads as compliance. Retention needs a
job, one source for the number, and a test that the job deletes.

## "Recorded" that no one records

Payroll refused to run while any work day had no attendance row, and nothing
in the system ever wrote an absence — so the two halves deadlocked and no
payslip could be produced. Time-and-attendance practice is the other way
round: record the exception, assume present. Before blocking on "the data is
incomplete", ask who is supposed to complete it and whether that writer
exists.

## A punch written in two statements with no transaction

`selfCheckIn` saved the day row, then created its evidence row. The two writes
were sequential, so a failure between them left a recorded punch with no
selfie — and the retry was then refused as "already checked in", stranding the
row for good. `selfCheckOut` had the same split. Worse, the "already checked
in" read sat *before* the write, so two concurrent requests could both see an
empty day and both write. The fix is one transaction around both writes plus a
per-staff advisory lock (`pg_advisory_xact_lock`, namespaced) held for the
whole unit of work, with the existence check re-read inside the lock. A state
change whose precondition is another row must make both writes and the check
one atomic step; a guard read outside the write is a race, and a partial write
is a stranded record.

## The lock that made every punch fail, behind a mock that answered for it

The advisory lock above went through `tx.$queryRaw`. `pg_advisory_xact_lock`
returns `void`, and Prisma's `$queryRaw` cannot deserialize a `void` column, so
on a real Postgres **every** check-in and check-out answered 500. The unit
tests mocked `$queryRaw` to return `[]` and asserted it was called, and the
e2e only checked that the page opened — so a feature whose one job is to
record a punch shipped without ever recording one. Use `$executeRaw` for a
statement whose result you do not read. More generally: a mock of the database
call is the one place the database's refusal cannot appear, so the path that
writes must have one e2e that writes against the real database (found
2026-10-09, `staff-attendance.spec.ts` "a punch is recorded").

## A browser feature the site's own header denies

Absen Saya asks for the camera (`getUserMedia({ video })`) and the position
(`navigator.geolocation`), and the web's `Permissions-Policy` said
`camera=()` and `geolocation=()` — written when no page used either. The
browser refuses both *without a prompt*, so every selfie fell back to the file
picker and no punch ever carried a location. Unit tests mock the component's
inputs and the e2e punched through the API, so nothing was red; the first
person to open the camera in a real browser would have found it. Two checks
now hold it: `security-headers.test.ts` reads the components for those calls
and fails when the header denies one, and a Chromium e2e reads
`document.featurePolicy` in the page, then takes the photo and reads the
location on screen. Its camera is a canvas stream injected by the test: CI's
headless Chromium (the headless shell) opens no fake camera even with
`--use-fake-device-for-media-stream`, which passed on a full Chromium locally
and failed every try in CI. The policy belongs to the *document*, so allowing it on one
path is not enough: a client-side navigation keeps the policy of the page the
session was loaded on. When a page starts using a powerful feature, change the
header in the same change — and test the flow in a browser, not only its API.

## A retention sweep that loads the whole history

The selfie retention job read *every* record that had a photo on each daily
run to decide which shared uploads could still be referenced — memory and scan
time grew with the full retained history, not with the day's work. Only rows
that can have expired need reading, and "expired" is per unit: run the due-scan
once per distinct retention window (each query filtered to that window's units
and cutoff), so a unit with a long window is never revisited day after day
before its deadline. A sweep that runs daily must cost O(what is due), not
O(all history) — and with mixed policies, O(what is due *under each policy*),
not O(everything past the shortest one).

## A shared file judged only within the current window

Narrowing the due-scan per window also narrowed the *eligibility* check if you
reuse it: the grouped count of "still referenced" records saw only the units in
the current window, so a file shared with a record in another unit's window was
deleted out from under it. The two questions are different and must not share
one scope: **what is due** is per policy (a window), **whether a file may be
removed** is global (any live reference anywhere, judged by *that record's own*
policy). Keep the candidate set bounded — the URLs of the rows actually due —
and resolve their live references in one query across every window (`OR` of
per-window clauses), rather than loading the whole photo history. A URL on a
still-live record must survive even when the row that triggered the sweep is
past its own deadline.

## A file is deleted at most once per run

When several expired rows share one upload, the first deletes the bytes and the
rest must only drop their reference — but the "already deleted" set has to be
per *file*, checked before every delete, not per row.
