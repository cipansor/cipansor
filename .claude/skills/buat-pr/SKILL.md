---
name: buat-pr
description: The one procedure for opening a pull request in this repository — find the open `ready` issue it resolves (or open one through the matching issue form and wait for `Triase issue` to mark it `ready`), then fill the repository PR template exactly. Refuse to open a PR that has no open `ready` issue, a linked number that is a pull request, or a missing template section. Use when asked to "buat PR", "open a pull request", "submit a PR", "ajukan PR", or before running `gh pr create` / `POST /repos/…/pulls` for any change.
---

# Membuat pull request

Aturan emas 6 di `AGENTS.md` mengikat: **PR selalu lahir dari issue yang
terbuka dan berlabel `ready`.** PR tanpa issue ditolak, bukan ditawar. Gerbang
`PR description` (`pr-template-guard.sh`) menegakkannya dan merah sampai PR
memenuhi semuanya.

Ikuti langkah berikut berurutan. Bila satu langkah gagal, **berhenti dan
laporkan** — jangan cari jalan pintas.

## 1. Cari issue yang diselesaikan

Cari issue terbuka yang benar-benar diselesaikan perubahan ini, bukan yang
sekadar mirip:

```bash
gh issue list --repo cipansor/cipansor --state open --search "<istilah atau berkas yang disentuh>"
```

Bila sudah ada, baca body-nya dan pastikan **label `ready`** terpasang. Bila
belum, jangan lanjut ke langkah 3 — kerjakan langkah 2 dulu.

## 2. Belum ada issue? Buat dulu, lewat formulir

Buat issue memakai formulir yang cocok (`.github/ISSUE_TEMPLATE/`):
`bug_report.yml` (bug), `enhancement.yml` (fitur), `documentation.yml`,
`refactor.yml`, `chore.yml`, `security.yml`. Formulir itu yang memasang label
**tipe**; automation `Triase issue` yang memasang prioritas dan `ready`.

- Buka issue lewat `POST /repos/cipansor/cipansor/issues` dengan `GITHUB_TOKEN`
  (akun `adminypc`, supaya teratribusi ke penulis) dan **tanpa field `labels`** —
  label yang dipasang akun selain `cipansor-bot` dicabut `label-guard` (#838).
- Tulis body selengkap formulir: masalah/motivasi, apa yang diharapkan, dan
  **kriteria penerimaan yang konkret dan bisa diamati**. Buka dengan basmalah
  (aturan label 13).
- **Jangan memasang `ready` sendiri.** `Triase issue` yang memutuskan, dan ia
  memutuskan setelah isinya cukup. Kalau ada pertanyaan terbuka, ia memasang
  `question` — jawab dulu di komentar issue, jangan buka PR.
- **Tunggu sampai `ready` terpasang**, lalu lanjut. Bila tidak yakin triase akan
  memutuskan, tulis komentar issue yang menjelaskan konteksnya; jangan memaksa.

## 3. Tolak keras bila belum layak

**Jangan buka PR** bila salah satu benar:

- tidak ada issue tertaut, atau issue tertautnya **belum `ready`**;
- issue tertautnya `question` atau `blocked` (kontradiksi dengan `ready`);
- issue tertautnya **sudah tertutup** (tautkan yang masih terbuka, atau buka
  kembali bila belum selesai);
- nomor yang ditautkan adalah **pull request**, bukan issue.

Penolakan adalah jawaban yang benar. Laporkan apa yang kurang dan apa yang harus
terjadi lebih dulu — jangan mengakalinya dengan `Refs`, dengan PR tanpa tautan,
atau dengan memasang `ready` sendiri.

## 4. Isi body persis templat PR

Body wajib mengikuti `.github/pull_request_template.md`. Setiap judul bagian
harus ada (guard menerima nama Indonesia atau nama Inggris lama):

| Bagian | Isi |
| --- | --- |
| `## Mengapa` | masalah dan dampaknya bagi pengguna/sistem; untuk bug: gejala dan penyebabnya, diambil dari issue tertaut |
| `## Yang diubah` | 1–5 butir: apa yang berubah dan di mana |
| `Fixes #<n>` | satu baris per issue yang diselesaikan; `Refs #<n>` untuk yang baru maju sebagian, dengan komentar di issue itu |
| `## Kriteria penerimaan` | kotak centang yang **disalin dari issue tertaut**, yang dipenuhi dicentang, beserta buktinya (nama tes/berkas/log) |
| `## Cara menguji` | perintah atau langkah persis untuk peninjau, dan hasil yang teramati |
| `## Bukti` | untuk perubahan `apps/web`: tangkapan **Sebelum** dan **Sesudah**; selain itu keluaran tes/log |
| `## Risiko` | **wajib** bila PR berlabel `security` atau menyentuh skema/migrasi/skrip data, skrip data produksi, atau auth/RBAC (`RISKY_PATHS`): apa yang bisa rusak dan cara mengembalikannya |
| `## Catatan` | opsional: migrasi, konfigurasi, tindak lanjut, non-goal |

Aturan lain yang ditegakkan guard:

- **Buka dengan basmalah** «بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ» lalu baris kosong
  (`basmalah.yml` menambahkannya bila lupa, tetapi tulis sendiri).
- **Prosa Bahasa Indonesia.** Deskripsi yang terbaca sebagai Inggris gagal
  (`docs/LABELS.md`); judul bagian dan `Fixes #<n>` tetap seperti adanya.
- **`Fixes #<n>` hanya menutup issue pada PR ke branch default (`main`).** PR ke
  branch lain diberi tahu bahwa tautannya tidak menutup apa pun.
- **Draf sampai siap.** Buka PR sebagai **draf**, jalankan gate lokal
  (skill `gate`), lalu tandai siap ditinjau (`ready_for_review`) begitu hijau
  dan kriteria terpenuhi. PR yang dibiarkan draf tidak akan pernah ditinjau.

## 5. Sesudah PR dibuka

- **Klaim label issue bukan tugasmu.** `issue-claim.yml` memindahkan issue
  tertaut dari `ready` ke `in-progress` dalam satu edit segera setelah PR
  dibuka. Jangan memanggil `POST/DELETE /issues/<n>/labels` untuk itu.
- `issue-label-sync` menyalin tipe dan prioritas issue ke PR. Jangan memasang
  label PR sendiri.
- Tulis satu komentar di issue yang menyebut nomor PR dan statusnya; jangan
  menutup issue — PR yang di-merge-lah yang menutupnya.

## Ringkas

Cari issue → belum ada, buat lewat formulir dan tunggu `ready` → **tolak bila
belum layak** → isi templat lengkap dalam Bahasa Indonesia → buka sebagai draf →
naikkan ke siap-ditinjau saat hijau. Gerbang yang menegakkan: `PR description`,
`Basmalah`, `Issue label sync`, `issue-claim`.
