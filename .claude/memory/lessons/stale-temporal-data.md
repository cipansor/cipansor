# stale-temporal-data

> A seed that writes dates as literals rots: by July 2026 the public SPMB page said registration was closed for 2024/2025. Derive dates from "now", and never treat `isActive` as a schedule.

`seed.ts` used to write the calendar as literals — `'2024/2025'` and an
admission window of March–May 2024. Those were facts about the day the seed was
written, and every reseed reproduced them. By July 2026 the public SPMB page
read "Pendaftaran Telah Ditutup — Periode PSB 2024/2025 Gelombang 1" with no
form: nobody could register.

**Fixed in #370.** `apps/api/src/lib/academic-calendar.ts` derives the year
from `now` (mid-July → end of June; 15 July is the boundary) and anchors both
admission waves to the seed run, so wave 1 is open on the day it runs. A
second, inactive academic year is seeded as the intake the waves recruit for;
exactly one year may be active. Hard-coding 2026/2027 would only have moved
the expiry date.

**The second defect, which fixing the data alone would have exposed.**
`getPublicActiveAdmissionPeriod` trusted `isActive` and took the flagged
period with the latest `startDate` — the wrong record as soon as two waves are
flagged, which is exactly the shape the corrected seed creates. Old query →
"Gelombang 2 [BELUM DIBUKA]"; new query → "Gelombang 1 [OPEN]". Fixing data
without code gives a *different* wrong answer. It now prefers open → next
upcoming → most recently closed, the same three states the public SPMB page
shows. (The web helper first named here, `getPeriodWindow` in
`admission-period.ts`, went when admissions moved to intakes and waves;
`apps/web/src/lib/admission-intake.ts` holds what replaced it.)

**The rules:**

- `isActive` is administrative intent, never a schedule. Anything telling a
  visitor whether they can register compares dates.
- Real dates, fees and units for an actual intake are the yayasan's decision —
  never invent them. The derived windows are for demo data only.
- When auditing, check temporal data against today's date, not only
  referential integrity: all of this was internally consistent and still wrong.
- Check `/public/spmb` in a browser, not with `curl`: the server renders the
  pre-hydration state ("Belum Dibuka"); the period arrives on the client.
