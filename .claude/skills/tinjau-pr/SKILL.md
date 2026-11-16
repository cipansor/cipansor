---
name: tinjau-pr
description: How a person or an agent other than the `Gerbang tinjau PR` automation reviews a pull request in this repository — judge first whether the change is needed and proportionate, then check it against its linked `ready` issues and the PR template, verify its claims against the code, check tests (same commit, failing before the fix, no self-skipping guard), the golden rules, release risks (migrations, paired PRs, CI scope) and UI evidence, and deliver a verdict with evidence and concrete fixes. Never APPROVE and never merge; only `cipansor-bot` approves and the owner merges. Use when asked to "review PR", "tinjau PR", "cek PR #n", "apakah PR ini perlu/layak/bermanfaat", or before recommending a merge.
---

# Meninjau pull request

**Alur kerja issue dan PR di repo ini:** `buat-issue` → triase (`Triase issue`; dibantu skill `triase-issue`) → `ready` → `buat-pr` → tinjauan (`Gerbang tinjau PR`; dibantu skill `tinjau-pr`) → merge oleh pemilik.

**Siapa memutuskan apa.** `Gerbang tinjau PR` (SDLC 18) adalah satu-satunya
yang boleh `APPROVE`, sebagai `cipansor-bot`; merge tetap di tangan pemilik
(`docs/LABELS.md` aturan 5–7; prompt-nya `TAILS["SDLC 18"]` di
`scripts/deploy-sdlc-agents.py`). Skill ini untuk tinjauan oleh orang atau agen
lain: hasilnya putusan beralasan untuk pemilik, atau komentar tinjauan bila
diminta. Ia tidak menggantikan gerbang.

## 1. Baca semuanya sekali

- Badan PR, berkas yang berubah, commit, check, review, dan komentar.
- Setiap issue yang ditutup atau dirujuk, beserta kriteria penerimaannya.
- **Diff diukur dari titik cabang:** `git fetch origin main <head-branch>`, lalu
  `git diff origin/main...origin/<head-branch>`. Hitung juga ketertinggalannya
  dari `main` (`.claude/memory/lessons/git-three-dot-diff-hides-stale-base.md`).

## 2. Perlu dan sepadan?

Jawab ini lebih dulu, karena PR yang tidak perlu tidak menjadi layak hanya
karena rapi:

- Apakah PR menyelesaikan issue tertautnya, tidak kurang dan tidak lebih?
- Apakah manfaatnya sepadan dengan biayanya: baris dan beban perawatan, jumlah
  putaran perbaikan, serta biaya CI (berkas yang dibaca uji menjadi "kode" di
  `.github/scripts/change-scope.sh` dan menjalankan CI penuh)?
- Apakah ada PR lain yang menutup issue yang sama (`duplicate-pr`), atau
  pekerjaan yang lebih mendesak menurut `.claude/memory/roadmap.md`?

## 3. Issue dan templat

- Setiap issue di `Fixes #<n>` terbuka dan berlabel `ready`/`in-progress`.
  Semuanya bertipe sama, dan prioritas PR tidak melebihi langit-langit
  (`docs/LABELS.md` aturan 1). Ada minimal satu `Fixes`; PR yang hanya `Refs`
  merah.
- Kriteria penerimaan disalin dari issue, dan setiap centang punya bukti yang
  benar-benar ada.
- Semua bagian templat terisi dalam Bahasa Indonesia. Ada `## Risiko` untuk
  `RISKY_PATHS` (`pr-template-guard.sh`). PR menuju `main`.

## 4. Kebenaran

- **Periksa klaim badan PR ke kode:** `berkas:baris`, nama uji yang disebut
  memang ada, dan angka memang terukur.
- **Aturan emas dan standar arsitektur `AGENTS.md`:**
  - routes → controller tipis → service → skema Zod;
  - enum basis data dari `@prisma/client`; `RoleCode`, bukan `UserRole`;
  - data santri dibaca dengan `select`, tidak pernah `include` relasi santri;
  - kontrak sekali di `@cipansor/shared`, tanpa data tiruan di web;
  - panggilan web ke rute yang dilayani (Guard_Kontrak), rute statis sebelum
    `/:id`;
  - teks layar berbahasa Indonesia dengan kata "santri".
- **Tanggal dan zona waktu:** kolom tanggal saja disimpan tengah malam UTC,
  jadi perbandingan harus per hari WIB
  (`.claude/memory/lessons/date-only-midnight-utc-vs-now.md`).
- **Teks yang menyatakan aturan** (dokumen, komentar, pesan galat) ikut
  diperbarui bila aturannya berubah.

## 5. Uji

- Uji ada dalam commit yang sama dengan perubahannya (aturan emas 7).
- Bug fix membawa uji yang **gagal sebelum** perbaikan. Bila bisa, buktikan di
  worktree commit dasar (`git worktree add --detach <dir> <commit-dasar>`).
- Waspadai uji yang tidak bisa merah: uji yang melewati dirinya sendiri, uji
  yang hanya membaca teks, atau uji yang masuk sebagai akun yang tidak pernah
  ditolak (`.claude/memory/lessons/guard-tests-that-measure-the-wrong-thing.md`).
- Alur web punya uji Playwright. Uji properti fase 2 memakai penanda
  `// Feature: …, Property <n>: …`.

## 6. Risiko rilis

- **Migrasi:**
  - stempel waktunya sesudah migrasi terakhir di `main`;
  - migrasi yang mengubah data produksi diputar dulu pada salinan produksi;
  - trigger yang gagal bila datanya sudah melanggar diperiksa lebih dulu
    terhadap data produksi.
- **PR lain yang menyentuh berkas yang sama** (aturan emas 9): gabungkan kedua
  head di worktree dan jalankan gerbang mutu sebelum PR kedua digabung.
- Cabang yang tertinggal jauh dari `main` perlu digabung ulang sebelum merge.

## 7. Perubahan UI

Tangkapan sebelum (dari `main`) dan sesudah untuk setiap tampilan yang berubah,
beserta jalur menunya (aturan emas 10 dan 11; skill `screenshot-roles`).

## 8. Putusan dan cara menyampaikannya

- **Putusan dulu, satu kalimat:** layak digabung, layak dengan perubahan, perlu
  dirampingkan, atau tidak perlu. Sesudah itu buktinya (`berkas:baris`, nama
  uji, id run), lalu perubahan yang **wajib** dipisahkan dari yang **disarankan**.
- **Usulkan perbaikannya, bukan hanya masalahnya.** Masalah lokal dan mekanis
  ditulis sebagai blok `suggestion` (`docs/LABELS.md` aturan 7) hanya di baris
  yang pasti; masalah besar dijelaskan dengan kata-kata.
- **Jangan pernah `APPROVE`, jangan merge, dan jangan push ke cabang orang
  lain.** Tinjauan dari akun selain `cipansor-bot` dikirim sebagai `COMMENT`.
- Posting ke GitHub hanya bila diminta. Bila tidak, sampaikan putusannya kepada
  yang bertanya. Prosa Bahasa Indonesia; bila agen menulis atas nama akun
  manusia, nyatakan itu dalam satu baris penutup.

## Ringkas

Baca semuanya (diff dari titik cabang) → perlu dan sepadan? → issue dan templat
→ kebenaran (klaim diperiksa ke kode, aturan emas) → uji yang bisa merah →
risiko rilis (migrasi, aturan emas 9, cabang usang) → bukti UI → **putusan
dulu**, bukti, perbaikan konkret → tanpa `APPROVE`, tanpa merge.
