# generated-docs-need-machine-checks

> A document builder that exits 0 and a self-review that says "compliant" prove nothing: the first generated technical document and manuals shipped with every table destroyed, invented routes and entities, and a wrong job count.

Found 2026-09-29, auditing the first run of the `dokumen-aplikasi-cipansor` skill.

- **The build was green and the file was broken.** The `.docx` tables came out
  empty (headers with no text, cells spilled out as loose paragraphs, a chapter
  heading swallowed into a cell) because LibreOffice in that environment lacked
  its Writer component and the TOC round-trip corrupted the file. Exit code 0,
  every warning ignorable, 67 pages instead of 24. Nobody opened the PDF.
  The builder now verifies its own output (table count against the source, no
  empty header cells, images present, PDF text) and fails.
- **Prose rules are not checks.** "Read the flow from code" produced
  `POST /admissions/public/register` (the route is `/public/registrants`), an ERD of
  entities that are not models (`ROLE_ASSIGNMENT`, `KELAS`), and an ERD workaround
  that hid a Mermaid keyword clash (`Class`). A script that greps the router, the
  schema and `apps/web/src` catches all of these and prints the nearest real name.
- **A count is a proxy until you read what it counts.** "14 scheduled jobs" was the
  number of `*.job.ts` files; `scheduler.ts` has 15 cron entries over 13 files and
  one file is called from a service. "66 of 93 modules fully layered" and the repo's
  own "22 of 93" were two definitions (four files vs five parts) mixed without saying so.
- **A template is an instruction, and the most faithfully followed one.** The template
  carried a duplicate Mermaid id, a removed Sentry box, "enum status of the module"
  (which became `Menunggu (PENDING)` in a staff manual) and "Tersedia: produksi /
  main" (which printed which fix production still lacks — a list the repo
  deliberately does not record).
- **Self-assessment against a standard, without checking the artefact, rated everything
  "compliant".** Judge a document by what a checker finds in it and by opening it.

Detail and the checker codes: `.claude/skills/dokumen-aplikasi-cipansor/references/kesalahan-yang-sudah-terjadi.md`.
