---
name: buat-pr
description: The one procedure for opening a pull request in this repository — find the open `ready` issue it resolves (or open one with the `buat-issue` skill through the matching issue form and wait for `Triase issue` to mark it `ready`), check that every issue it closes shares one type, prove the change locally (tests in the same commit, the `gate` skill, before/after screenshots), fill the repository PR template exactly, open it as a draft against `main`, and mark it ready for review once green. Refuse to open a PR that has no open `ready` issue, that only `Refs` an issue, whose linked number is a pull request or a closed issue, or that is missing a template section. Use when asked to "buat PR", "open a pull request", "submit a PR", "ajukan PR", or before running `gh pr create` / `POST /repos/…/pulls` for any change.
---

# Membuat pull request

**Alur kerja issue dan PR di repo ini:** `buat-issue` → triase (`Triase issue`; dibantu skill `triase-issue`) → `ready` → `buat-pr` → tinjauan (`Gerbang tinjau PR`; dibantu skill `tinjau-pr`) → merge oleh pemilik.

Aturan emas 6 di `AGENTS.md` mengikat: **PR selalu lahir dari issue yang
terbuka dan berlabel `ready`.** PR tanpa issue ditolak, bukan ditawar. Gerbang
`PR description` (`pr-template-guard.sh`) menegakkannya dan merah sampai PR
memenuhi semuanya.

Ikuti langkah berikut berurutan. Bila satu langkah gagal, **berhenti dan
laporkan** — jangan cari jalan pintas.

## 1. Cari issue yang diselesaikan

Cari issue terbuka yang benar-benar diselesaikan perubahan ini, bukan yang
sekadar mirip, termasuk issue yang ikut terselesaikan tanpa disengaja (aturan
emas 6: issue yang diperbaiki tanpa ditautkan tetap terbuka dan melahirkan
duplikat):

```bash
gh api -X GET search/issues -f q='repo:cipansor/cipansor is:issue is:open <istilah atau berkas>' \
  --jq '.items[] | "\(.number) \([.labels[].name] | join(",")) \(.title)"'
```

- Setiap issue yang akan ditutup harus **terbuka** dan berlabel **`ready`**
  (atau `in-progress`, bila sudah diklaim PR ini). Bila belum, kerjakan
  langkah 2 dulu.
- **Satu PR boleh menutup beberapa issue bila tipenya sama.** Tipe PR hanya
  satu (`docs/LABELS.md` aturan 1). Issue berbeda tipe → periksa dulu apakah
  salah satunya salah tipe (minta `cipansor-bot` menyelaraskannya); bila
  keduanya benar, pisahkan PR per tipe.
- **Pastikan belum ada PR terbuka yang menutup issue yang sama.**
  `pr-duplicate.sh` melabeli PR kedua `duplicate-pr`.

## 2. Belum ada issue? Buat dulu lewat skill `buat-issue`

Ikuti skill `buat-issue` (`.claude/skills/buat-issue/SKILL.md`). Intinya:

- Buka issue lewat formulir yang cocok di `.github/ISSUE_TEMPLATE/`. Formulir
  itu yang memasang label tipe: `bug`, `enhancement`, `documentation`, `refactor`, `chore`, `security`. Lewat API, sebut label tipe itu di field
  `labels`; itulah satu-satunya label yang boleh dipasang akun penulis.
  Prioritas, `ready`, `question`, dan `blocked` tetap milik `cipansor-bot`
  dan dicabut `label-guard` bila dipasang akun lain.
- **Jangan memasang `ready` sendiri.** `Triase issue` yang memutuskan, sesudah
  isinya cukup. Bila ia memasang `question`, jawab di komentar issue; jangan
  buka PR.
- **Tunggu sampai `ready` terpasang**, lalu lanjut ke langkah 3.

## 3. Tolak keras bila belum layak

**Jangan buka PR** bila salah satu benar:

- tidak ada issue tertaut, atau issue tertautnya **belum `ready`**;
- issue tertautnya `question` atau `blocked`;
- issue tertautnya **sudah tertutup** (tautkan yang masih terbuka, atau buka
  kembali bila belum selesai);
- nomor yang ditautkan adalah **pull request**, bukan issue;
- PR hanya memakai `Refs #<n>`. **PR yang hanya `Refs` selalu merah**, karena
  guard mewajibkan minimal satu `Fixes`. Pekerjaan bertahap dipecah menjadi
  issue anak, satu per PR (skill `buat-issue` §6);
- issue-issue yang ditutup berbeda tipe;
- PR tidak menuju `main`. `Fixes` hanya menutup issue pada branch default.

Penolakan adalah jawaban yang benar. Laporkan apa yang kurang dan apa yang harus
terjadi lebih dulu — jangan mengakalinya dengan `Refs`, dengan PR tanpa tautan,
atau dengan memasang `ready` sendiri.

## 4. Kerjakan dan buktikan sebelum membuka

- **Cabang dari `main` terbaru:** `<tipe>/<nomor>-<slug>`, mis. `fix/1081-edit-menu`.
- **Uji dalam commit yang sama** (aturan emas 7): vitest di `tests/` modul untuk
  service atau controller yang berubah, Playwright di `apps/web/e2e/` untuk rute
  atau alur web yang berubah. Bug fix membawa uji yang **gagal sebelum** perbaikan.
- **Gerbang mutu lokal** (aturan emas 5): jalankan skill `gate`, termasuk
  `pnpm format`. CI hanya jaring cadangan.
- **Perubahan UI** (aturan emas 10): tangkapan sebelum (dirender dari `main`)
  dan sesudah untuk setiap tampilan yang berubah (skill `screenshot-roles`,
  `before-after.md`).
- **PR lain yang menyentuh berkas yang sama** (aturan emas 9): cari PR terbuka
  yang menyentuh berkas yang sama. Bila ada, gabungkan kedua head di worktree
  dan jalankan gerbang mutu sebelum PR kedua digabung. Migrasi baru diberi
  stempel waktu sesudah migrasi terakhir di `main`.
- Commit message berbahasa Inggris; prosa GitHub berbahasa Indonesia.

## 5. Isi body persis templat PR

Judul PR: `<tipe>(<area>): <ringkasan> (#<n>)`, sesuai konvensi repo (mis.
`fix(finance): tagihan menunggak hanya setelah hari WIB berakhir (#1050)`).

Body wajib mengikuti `.github/pull_request_template.md`. Setiap judul bagian
harus ada (guard menerima nama Indonesia atau nama Inggris lama):

| Bagian | Isi |
| --- | --- |
| `## Mengapa` | masalah dan dampaknya bagi pengguna/sistem; untuk bug: gejala dan penyebabnya, diambil dari issue tertaut |
| `## Yang diubah` | 1–5 butir: apa yang berubah dan di mana |
| `## Issue tertaut` | satu baris `Fixes #<n>` per issue yang diselesaikan; `Refs #<n>` untuk yang baru maju sebagian (mis. issue induk), dengan komentar di issue itu tentang sisanya |
| `## Kriteria penerimaan` | kotak centang yang **disalin dari issue tertaut**, yang dipenuhi dicentang, beserta buktinya (nama tes/berkas/log) |
| `## Cara menguji` | perintah atau langkah persis untuk peninjau, dan hasil yang teramati |
| `## Bukti` | untuk perubahan `apps/web`: tangkapan **Sebelum** dan **Sesudah** beserta jalur menunya; selain itu keluaran tes/log |
| `## Risiko` | **wajib** bila PR berlabel `security` atau menyentuh skema/migrasi/skrip data, skrip data produksi, atau auth/RBAC (`RISKY_PATHS`): apa yang bisa rusak dan cara mengembalikannya |
| `## Catatan` | opsional: migrasi, konfigurasi, tindak lanjut, non-goal |

Aturan lain yang ditegakkan guard:

- **Buka dengan basmalah** «بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ» lalu baris kosong
  (`basmalah.yml` menambahkannya bila lupa, tetapi tulis sendiri).
- **Prosa Bahasa Indonesia.** Deskripsi yang terbaca sebagai Inggris gagal
  (`docs/LABELS.md`); judul bagian dan `Fixes #<n>` tetap seperti adanya.
- **Kriteria hidup di issue.** Jangan mengarang kriteria baru di PR; kriteria
  yang memang berubah dibahas di issue lebih dulu.
- **Isi dengan yang sudah terjadi**, bukan rencana: yang diubah, dijalankan, dan
  teramati.

## 6. Buka sebagai draf ke `main`, naikkan saat hijau

- **Akun penulis**, bukan `cipansor-bot`: manusia memakai akunnya sendiri,
  armada memakai `GITHUB_TOKEN` (`adminypc`). Tanpa field `labels`.
- **Draf sampai siap.** Buka PR sebagai **draf**, lalu tandai siap ditinjau
  (`ready_for_review`) begitu CI hijau dan semua kriteria terpenuhi. PR draf
  yang hijau hanya mendapat komentar informasi dan tidak pernah dinaikkan
  otomatis, jadi PR yang dibiarkan draf tidak akan pernah ditinjau.
- **Tinjauan:** `PR lifecycle` mengirim `Gerbang tinjau PR` sekali, saat PR siap
  dan semua check wajib hijau. Untuk tinjauan berikutnya sesudah head baru,
  minta review dari `cipansor-bot` secara manual (`docs/LABELS.md` aturan 5).

## 7. Sesudah PR dibuka

- **Klaim label issue bukan tugasmu.** `issue-claim.yml` memindahkan issue
  tertaut dari `ready` ke `in-progress` dalam satu edit segera setelah PR
  dibuka. Jangan memanggil `POST/DELETE /issues/<n>/labels` untuk itu.
- **Label PR bukan tugasmu.** `issue-label-sync` menyalin tipe issue dan
  menetapkan prioritas PR sebagai **langit-langit**, yaitu prioritas tertinggi
  di antara issue yang ditutup. PR di bawah langit-langit dibiarkan; PR di
  atasnya merah dan dikoreksi `Gerbang tinjau PR`.
- Tulis satu komentar di issue yang menyebut nomor PR dan statusnya; jangan
  menutup issue — PR yang di-merge-lah yang menutupnya.
- Tanggapi tinjauan: terapkan blok `suggestion` yang benar, jelaskan yang
  ditolak, lalu minta tinjauan ulang dari `cipansor-bot`.
- **Sesudah merge, bangunkan issue yang menunggu.** Tidak ada otomasi yang
  mencabut `blocked` saat penghalangnya tertutup, jadi tulis satu komentar
  "penghalang #n sudah digabung" di setiap issue yang menyebut PR/issue ini di
  `Bergantung pada:`. Komentar itu membangunkan `Triase issue`.
- Laporkan perubahan UI dengan jalur menu dan keadaannya: di branch, di `main`,
  di staging, atau di produksi (aturan emas 11).

## Ringkas

Cari issue `ready` → belum ada, buat lewat skill `buat-issue` dan tunggu
`ready` → **tolak bila belum layak** (termasuk `Refs` saja dan tipe campur) →
uji dalam commit yang sama + skill `gate` + tangkapan UI → isi templat lengkap
dalam Bahasa Indonesia → buka sebagai draf ke `main` → naikkan ke siap-ditinjau
saat hijau → sesudah merge, bangunkan issue yang menunggu. Gerbang yang
menegakkan: `PR description`, `Basmalah`, `Issue label sync`, `issue-claim`.
