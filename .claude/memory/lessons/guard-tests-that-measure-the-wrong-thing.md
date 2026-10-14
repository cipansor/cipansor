# guard-tests-that-measure-the-wrong-thing

> A green test that measures a proxy instead of the property: presence instead of function, a walker that skips the root, pinned copy, the fix instead of the effect, a test that asserts the bug, text against text, fuzzing against a reference that shares the bug, a test that skips itself when its data is missing, a scanner blind to the shape the defect takes. The one question that catches all of them.

**The question to ask of every guard: what would have to change in the world
for this test to go red?** If the answer is "a comment", "a line of source" or
"a sentence of copy", it is not a guard.

## Presence is not function

A guard for the skip link checked `/<main[\s>]/` — "every page has a
`<main>`". Green; in production the landing page's `<main>` had **no id**, and
`SkipLink` (`getElementById` after `preventDefault`) became dead — worse than
the bug being fixed. Count the thing that ties the two together:
`<main\b[^>]*\bid="main-content"` exactly once, plus the invariant that every
`<main>` under `src/` carries the id.

## The walker never visited the root

A directory walker that only looked at `page.tsx` inside **sub**directories
never saw `src/app/page.tsx` — the one page that broke was outside the test's
universe. Start with the directory's own file, then recurse. The same shape:
menu guards that flattened one level went blind when submenus appeared
([rbac-nav-contract](./rbac-nav-contract.md)).

## A test that pins copy defends the lie

An e2e asserted the card title "AI-Driven Succession Recommendations" — the
very claim a PR removed because a weighted sum is not AI. The test failed *for
being right*, and the easy way past it was to put the lie back. Assert the
control, the role or the behaviour, not the sentence. When copy *is* the
invariant, invert it into a source guard that forbids the bad string (here:
"AI" may appear on those screens only within 40 characters after "bukan"),
and strip comments before matching, or the comment explaining the rule breaks
it.

## A guard that asserts the fix, not the effect

`dynamicParams = false` plus a test asserting the line existed — while the
page still answered 200 ([nextjs-loading-boundary-commits-200](./nextjs-loading-boundary-commits-200.md)).
**When the symptom is an HTTP status, the guard asserts the HTTP status.**

## A test that asserts the bug as correct behaviour

- **E-sign (#449).** Requesting a signing key demanded an already-verified
  identity; verification only happened when a request was decided. Nobody
  could ever obtain a key, so every signed naskah, the archive, verification
  and revocation were unreachable. 1,399 tests were green, and one was titled
  "rejects a request when the data is complete but unverified" — it asserted
  the deadlock. Each test checked half the chain against its own expectation.
  Found by walking the chain on a running system: three requests.
- **PK (#415), self-inflicted.** A new guard refused a PK with no supervisor;
  creating a subordinate PK required the supervisor's approved PK; approval
  required a proposed PK. The yayasan organs have no supervisor in the system,
  so the root of the chain could never be proposed — **no PK anywhere could be
  created**. 1,671 tests green.

**The reusable rule:** for every guard that demands a *precondition*, ask what
satisfies it for the **first** element of the chain. If the answer is "the
element before it", the chain has no root and the module is dead. A chain
across two modules needs a test across two modules
(`esign.identity-chain.test.ts`), and the business process run through the API
on an isolated stack finds what reading code does not.

## Text against text

`decommissioned-modules.guard.test.ts` once compared a number read from a
migration's **header comment** with a number pinned in the test itself. If the
real FK closure moved, it stayed green; text never met the catalog. Take the
evidence from what is actually deployed (`0_init`'s tables, unique indexes and
FKs), and pin what makes the number true (here, the order of the migration
folders).

## Fuzzing against a reference inherits the reference's blindness

A PR claimed its sanitizer passed "300k random inputs, 0 mismatches" against a
naive reference. 2,189 of those outputs still carried a live `<tag>`: the
reference modelled quotes with the same wrong assumption, so both were wrong
together. **Fuzz against an invariant**, not against a copy of yourself: no
output may match `/<[a-zA-Z\/!?][^<>]*>/`, and real text must come out
unchanged. The property test is pinned in `tests/email-transport.test.ts`.

## A distinction the server makes and no screen shows

The API distinguished "assistant busy" (503, `CHATBOT_BUSY`, `Retry-After`)
from "assistant down", with tests. The widget caught every error in one
`catch {}` and printed one sentence. A test of `isBusyError()` would be green
too — the function is right; nothing calls it. Render the widget and assert the
sentence the visitor reads, with the opposite case. Ask of every API change:
*who reads the message I just wrote?*

## A detector calibrated on invented examples

"If the model cites a source, it answered" looked robust, and its test was
green. One real call killed it: the persona tells the model to list topics and
the contact page *when it refuses*, so refusals cite sources too. Tests for such
detectors use **sentences the model actually wrote** (`refusal.test.ts`).

## E2E assertions that test the shell

`getByRole("heading", { name: /keuangan|finance/ })` after opening `/finance`
was green for months because the **sidebar group** "Keuangan" is on every page;
the page is titled "Tagihan & SPP". Scope assertions to `<main>`. Also: a
`test.skip("No students")` guard skipped two tests on every CI run because the
page was broken — **read the skipped count and names**, not only "0 failed";
and a `waitForToast` helper used 22 times looked for `role="status"`, which the
toast library does not render, so it never found any toast.

**An absence assertion that retries waits the thing out** (2026-09-29, the
password PR). `expect(toast).toHaveCount(0)` retries for five seconds; a Sonner
toast closes itself after four, so "no toast" passed while a toast was on the
screen — the screenshot showed it, the test did not. And the field assertion
beside it, `getByText(/nama Cipansor/)`, had passed on the toast's words while
the field itself said "Data yang dikirim tidak sesuai format". Scope the text
to the form, and check absence once, after a short settle:
`expect(await locator.count()).toBe(0)`. Then run it against the build that
has the defect and watch it go red.

Likewise a URL assertion after a redirect: #620's two-tabs test ended on
`/dashboard` only because a refused refresh bounced from `/login` straight
back. Assert the cause (the refresh answered 200), not the resting place.

## E2E that fails on a random spec each run

Three CI runs failed three different specs. The cause was one pattern in 15
specs: reading the DOM while the shell bounced to `/login` before the auth
store rehydrated, which only happens under load. `e2e/helpers/page-state.ts`
(`settledContent`) retries until the document settles; `page-state-helper.spec.ts`
forces the bounce to prove it. Retrying does not weaken the assertion — a page
settled on `/login` still fails the caller's URL check.

## The tools lie too

- `cmd | tail -20; st=$?` captures `tail`'s status. Capture first.
- `head -30` cut a findings list and hid the one remaining offender.
- A JSDoc block containing `{/* … */}` closes itself at the first `*/`; vitest
  then reports **"no tests"**, not a failure — a "red on main, green on the
  branch" proof over an unparsed file is void. Read how many tests *ran*.
- A rAF sampler invented a 152 px drift, stable across three runs; systematic
  bias is stable too ([radix-scrollarea-thumb-stalls](./radix-scrollarea-thumb-stalls.md)).
- A `401` does not prove a route exists — `router.use(authenticate)` answers
  before routing. Knock with a valid token.
- A claim in a PR body ("`findAll` now filters by status") was never committed.
  Every "X now does Y" needs a line in `git show <commit> --stat` and a test of
  the **effect**. A behaviour script run against the running system caught it
  — after first being run against the old build to prove it could go red.

When a tool gives the good news you wanted, that is the moment to check the
tool.

## A stale test that sides with the status quo

A test titled "gives the same message for a missing and a rejected Turnstile
token" was right about the old code and blocked the fix that told blocked
visitors something useful. Replace it with a test stating the new behaviour
and why; do not loosen it until both pass. A red test that blocks a fix is an
old decision asking for review.

## One fact in two places

When one fact is written in two files with no type binding them (a Turnstile
action name in `apps/web` and in `apps/api`), bind them with a test that reads
both files and requires the sets to be equal **in both directions**
(`middleware/turnstile-actions.contract.test.ts`). Prove it red by changing one
side.

## The rule

**Prove a guard red against the exact tree you are about to ship**, not
against a hand-made counterexample. Keep the new test and revert only the fix:

```
git add -A                                        # safety net first
git stash push -q -- apps/web/src/app apps/web/src/components
pnpm vitest run <file> -t '<the new describe>'
git stash pop -q
```

Or read the old tree without touching yours: run the predicates over
`git show main:<path>`. See [git-checkout-path-destroys-uncommitted](./git-checkout-path-destroys-uncommitted.md)
before restoring anything.

## A mock that accepts what the database refuses

The tahfidz milestone test asserted `prisma.notification.create` was called
with `type: 'TAHFIDZ'`. The mocked client accepted it; the real enum has no
such value, so in production every milestone notification failed Prisma's
check and was only logged (found 2026-10-03, #626). When a mock stands in for
the database, assert the value is one the database accepts — an enum member,
a column that exists — not merely the value the code happened to send.

## A test that skips itself when its data is missing

`tk-daily-report.spec.ts` found the class picker by its placeholder, and when
the picker was not visible it called `test.skip("No classes available")`. The
Select wrapper had hidden that placeholder, so the test skipped itself on every
run — for as long as the TK form's create request was refused by the API, and
the photos went to an endpoint that did not exist. Nothing went red; a skip
reads as "not applicable". Found on 2026-09-26, when a Select fix (#576) made
the placeholder visible and the test ran for the first time; repaired in #577.

**A missing precondition is something to set up, not a reason to pass.** Make
the data (seed it, or create it through the API in `beforeAll`) and assert it
is there; skip only on a condition that is really out of scope (the production
API), and say which. The e2e run reported 41 skipped tests on 2026-09-27 —
each is a candidate for this.

## A scanner blind to the shape the defect takes

`dead-links.test.ts` scanned `href=` and `router.push(`, and matched a literal
segment against any `[param]`. Mutabaah's "Buat Laporan" was an `href:` prop
(a PageHeader action), and pointed at `/daily-report/new` — which "existed",
because `/daily-report/[id]` took "new" for an id and rendered *Laporan tidak
ditemukan*. Teachers had never been able to open the form from their menu.
Widened in #577 (`href:` props; `new`/`create`/`edit` never match a
`[param]`), which surfaced five more. Ask what a dead link looks like **in this
codebase**, not in the scanner's model of it.

## A suite that signs in as someone who cannot be refused

`attendance.spec.ts` and `attendance-module.spec.ts` signed in as the super
admin. The write routes admitted admins only, so every teacher, wali kelas
and kepala sekolah got *Admin access required* when saving a register — the
daily task of every teacher — and the suite stayed green. The swagger text
even said "(Admin/Teacher)". Found on 2026-09-27 by calling the route as each
role on a local stack; fixed in #580, whose e2e signs in as the wali kelas, a
teacher of the class, a teacher of none, and the kepala sekolah.

**Test a flow as the role that does it**, and add at least one role that
must be refused. An account that passes every guard proves only that the
page renders.

## A delivery test that stops before delivery

A test for the e-mail size cap sent a maximum-length message and asserted it
reached `deliverEmail` — but the transport in the test environment is `log`,
and that branch returns **before** `htmlToText` or `composeRawMessage` runs.
Nothing was composed, so the test proved the body cleared a size check, not
that a configured transport builds and sends the accepted message — the path
the bug actually broke. Drive the real branch: generate a throwaway RSA key,
stub the token and send endpoints, and inspect the MIME that would leave the
building. `log` is a configuration state, not a transport.

## `toContain` on a body is a presence check, not a length check

The same test asserted the MIME contained `&quot;`. One escape satisfies that,
so a body silently truncated to a handful of characters passes: the escape is
present, the message is not. Count the occurrences and compare against the
number the input should produce (`decoded.match(/&quot;/g).length` equals the
maximum-length body), and undo the transfer encoding first — Nodemailer emits a
large body as quoted-printable with `=\n` soft breaks, so split escapes must be
rejoined before counting.

**A guard for "the whole thing arrived" has to measure the whole thing.** Both
defects here share one shape: the assertion tested that a *representative*
element was present rather than that the *entire* payload survived.

## A file that opens is not a page that reads

The Rapor Merdeka PDF test re-opened its output with `PDFDocument.load` and
said that this proved the embedded Amiri font was "structurally valid (a
corrupted font subset throws on load)". It does not throw. The font had been
subset by pdf-lib/fontkit, and its glyph offsets pointed past the end of its
own table. From 2026-09-12 every raport drew as "OR E R R OR" in Chrome's
viewer, poppler and mupdf, and the test stayed green (found 2026-10-02).

Measure what a reader sees:

- **Render the page.** `pdftoppm` or `mutool draw`; mupdf prints FreeType's
  `invalid outline` warning on a broken glyph.
- **Parse every glyph.** Load the embedded program (`FontFile2`) with fontkit
  and read each glyph's `path`. A broken one throws "Trying to access beyond
  buffer".
- **Spy on `PDFPage.prototype.drawText`** to assert what was drawn. An embedded
  font writes glyph ids, not letters, so searching the PDF's bytes finds
  nothing.

**`pdftotext` is no check here.** It read the correct words out of the broken
file through the font's `ToUnicode` map, while the glyphs themselves drew as
nothing.

The same font, embedded whole, drew Latin text with gaps ("( RAPORT)"). Amiri
is an Arabic font, and its Latin advances depend on positioning rules that
pdf-lib does not apply. Use a font designed for the script being printed.

## A guard for "it is carried" that only checked presence

The basmalah contract test read both issue forms and the PR template and
asserted each `toContain` the Arabic line. Green — but for the issue forms it
was green for the wrong reason: a form's `type: markdown` block is preview
only and never lands in the body, so the forms **show** the basmalah without
*carrying* it; the `Basmalah` workflow is what puts it in the body. The
assertion could not tell "carried" from "displayed", and the doc that said the
forms carry it was wrong in the same direction. (Found by a reviewer, PR #817,
2026-10-13.) Measure the mechanism: the PR template carries it (assert its
position in the preamble, before the first `## ` section), an issue form only
previews it (assert the line sits in a `type: markdown` block — a field would
be a defect), and the workflow covers `issues.opened`.

## A guard that skipped the root of the chain it guards

`label-guard.sh` removed a `ready` that contradicted an exclusion, but decided
the conflict from the raw label set and let one early exit stand in for the
whole decision: when the *event's own* label was an exclusion the standard path
would revoke, it left `ready` untouched — correct only if that was the **only**
exclusion. With `ready` + `needs-info` present and a human adding `question`,
revoking `question` left `ready` + `needs-info`, still contradictory. (Reviewer,
PR #817, 2026-10-13.) The fix computes the conflict from the **effective** set —
the event's label ignored only when it will actually be revoked — and asserts
the two-exclusion case, not just the single one. When a decision has an
exception, the guard must exercise the state *after* the exception is applied.

## An idempotence check that looked at the wrong first line

`basmalah.sh`'s "does this body already open with the basmalah?" test took the
first non-blank line. The pull-request template opens with a multi-line
`<!-- … -->` note, so that line was the comment, not the basmalah — the script
concluded the body lacked it and prepended a **second** copy to every templated
PR (review gate, PR #817, 2026-10-13). The guard test missed it because its
fixture body was `A plain report`; the "fleet contracts" test only asserted the
template *contains* the basmalah, never that the script recognizes it. Two
lessons: when a check means "the body starts with X", decide what "starts"
means against a real body (skip blanks **and** leading HTML comments), and drive
the guard with the **actual artefact** it protects (here, the template file),
not a hand-made string. Prove it red by running the old script against the real
template.
