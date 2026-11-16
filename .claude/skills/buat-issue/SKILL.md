---
name: buat-issue
description: The one procedure for opening an issue in this repository — check that it belongs in a public issue at all (a vulnerability goes to a private advisory), search open and closed issues for a duplicate, pick the issue form that sets the right type (`bug`, `enhancement`, `documentation`, `refactor`, `chore`, `security`), write the body the way the form would (basmalah, Indonesian, evidence, observable acceptance criteria, `Bergantung pada:`), apply only the form's type label, and leave priority, `ready`, `question` and `blocked` to `Triase issue`. Refuse to publish a vulnerability as an issue, to self-apply any other label, or to open a second issue for the same cause. Use when asked to "buat issue", "open/create an issue", "laporkan bug", "catat sebagai issue", "ajukan fitur", or when the `buat-pr` skill finds no `ready` issue.
---

# Membuat issue

**Alur kerja issue dan PR di repo ini:** `buat-issue` → triase (`Triase issue`; dibantu skill `triase-issue`) → `ready` → `buat-pr` → tinjauan (`Gerbang tinjau PR`; dibantu skill `tinjau-pr`) → merge oleh pemilik.

Issue adalah satu-satunya pintu masuk pekerjaan: PR hanya lahir dari issue
terbuka berlabel `ready` (aturan emas 6 `AGENTS.md`). Issue yang baik membuat
`Triase issue` bisa memasang `ready` tanpa bertanya balik. Aturan label, prioritas,
dan siklus hidupnya ada di `docs/LABELS.md`; skill ini hanya prosedurnya.

Ikuti langkahnya berurutan. Bila satu langkah gagal, berhenti dan laporkan.

## 1. Pastikan memang perlu issue publik

- **Kerentanan yang bisa dieksploitasi tidak boleh menjadi issue publik.**
  Laporkan lewat advisory privat (`SECURITY.md`; tautan "Laporkan kerentanan
  keamanan" di halaman issue baru). Formulir `security.yml` hanya untuk
  **pengerasan**, dan formulirnya sendiri berbunyi "Jangan laporkan kerentanan
  di sini". Pengecualian hanya bila pemilik memutuskannya untuk issue tertentu,
  dan keputusan itu tertulis di issue tersebut.
- Pertanyaan cara memakai aplikasi → panduan pengguna
  (`docs/PANDUAN-PENGGUNA-UMUM.md`), bukan issue.
- Keputusan yang menjadi milik pemilik (pilihan desain, kebijakan) boleh dibuka
  sebagai issue, tetapi sertakan riset, pilihan, dan rekomendasinya (aturan
  emas 12). Triase akan memasang `question` sampai pemilik memutuskan.
- Satu masalah atau satu hasil per issue. Pekerjaan besar dipecah (§6).

## 2. Cari duplikat lebih dulu

Cari issue **terbuka dan tertutup** dengan istilah, berkas, rute, atau gejala
yang sama:

```bash
gh api -X GET search/issues -f q='repo:cipansor/cipansor is:issue <istilah>' \
  --jq '.items[] | "\(.number) \(.state) \(.title)"'
```

- Sudah ada yang **terbuka**: jangan buka issue kedua. Tambahkan bukti baru
  sebagai komentar di sana.
- Hanya ada yang **tertutup** dan masalahnya muncul lagi: issue baru boleh,
  sebut "regresi dari #n".
- `duplicate-detect.sh` melabeli `duplicate` dua issue terbuka yang judulnya
  sama setelah dinormalkan, jadi buat judul yang spesifik.

## 3. Pilih formulir = pilih tipe

Satu formulir per tipe di `.github/ISSUE_TEMPLATE/`; formulir itu yang memasang
label tipe. Bila isi formulir berubah, ikuti berkas formulirnya, bukan tabel ini.

| Formulir | Berkas | Label tipe | Kolom wajib |
| --- | --- | --- | --- |
| Laporan bug | `bug_report.yml` | `bug` | Apa yang terjadi; Apa yang Anda harapkan |
| Permintaan fitur | `enhancement.yml` | `enhancement` | Masalah atau motivasi; Perilaku yang diinginkan |
| Perubahan dokumen | `documentation.yml` | `documentation` | sama dengan fitur |
| Perapian kode | `refactor.yml` | `refactor` | sama dengan fitur |
| Pemeliharaan | `chore.yml` | `chore` | sama dengan fitur |
| Pengerasan keamanan | `security.yml` | `security` | sama dengan fitur |

Hal yang tidak cocok dengan formulir mana pun boleh dibuka sebagai issue kosong;
`Triase issue` yang menetapkan tipenya.

## 4. Tulis body seperti hasil formulir

Lewat antarmuka web, formulir menyusun body-nya sendiri. Lewat API atau agen,
formulir **tidak berjalan**, jadi susun body dengan judul `### <label kolom>`
persis seperti formulir dan dalam urutan yang sama. Kolom opsional yang tidak
diketahui ditulis `_No response_`, seperti keluaran formulir.

- **Baris pertama basmalah** «بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ», lalu baris
  kosong (`basmalah.yml` menambahkannya bila lupa, tetapi tulis sendiri).
- **Prosa Bahasa Indonesia.** Istilah pesantren tidak diterjemahkan, dan peserta
  didik disebut "santri" (`AGENTS.md` → "Naming and API conventions").
- **Apa yang terjadi / Masalah:** perilaku yang diamati, bukan dugaan penyebab.
- **Bukti yang bisa diperiksa orang lain:** `berkas:baris` beserta commit `main`
  yang dibaca, rute dan kode jawabannya, id run CI, langkah reproduksi yang bisa
  diikuti, dan jalur menu persis seperti di layar (skill `panduan-peran`).
- **Siapa yang terdampak:** unit, peran, atau jumlah orang; apakah pekerjaannya
  terhenti atau masih ada cara lain. Inilah bahan prioritas yang berbukti
  (`docs/LABELS.md` → "Priority").
- **Kriteria penerimaan:** kotak centang yang bisa diamati, bukan "berfungsi
  dengan baik". Sertakan uji yang membuktikannya (aturan emas 7: uji regresi
  yang gagal sebelum perbaikan; Playwright untuk alur web).
- **Alternatif:** termasuk opsi "tidak perlu sama sekali" bila memang nyata.
- **Konteks tambahan:** satu baris `Bergantung pada: #n, #m` bila ada
  ketergantungan (tulis persis begitu agar mudah ditemukan), non-goal, issue
  terkait, dan keputusan yang dirujuk (`.claude/memory/decisions/…`).
- **Tanpa data sensitif.** Repo ini publik: tanpa kredensial, alamat IP, nama
  sumber daya cloud, jalur host, atau data pribadi santri (`AGENTS.md` →
  "Where things live"; `check-sensitive.py`). Pakai akun seed sebagai contoh.

**Judul:** `<tipe>(<area>): <gejala atau hasil yang diinginkan>`, sesuai
konvensi yang dipakai repo (mis. `bug(otomasi): …`, `fix(meals): …`,
`feat(ekskul): …`). Untuk bug, tulis gejalanya, bukan rencana perbaikannya.

## 5. Buka issue

- **Akun:** akun penulis, yaitu akun manusia itu sendiri, atau `adminypc` lewat
  `GITHUB_TOKEN` bagi armada. **Bukan `cipansor-bot`**, yang merupakan akun
  komunikator (`docs/SDLC-FLOW.md` → "Identitas").
- **Lewat web:** pilih formulirnya.
- **Lewat API atau agen:** `POST /repos/cipansor/cipansor/issues` (atau alat
  GitHub yang setara) dengan `title`, `body`, dan `labels` yang berisi **hanya
  label tipe formulir**: salah satu dari `bug`, `enhancement`, `documentation`, `refactor`, `chore`, `security`. Label tipe termasuk `ALLOWED_LABELS`
  `label-guard`, jadi tidak dicabut.
- **Jangan memasang label lain.** Prioritas, `ready`, `question`, `blocked`,
  `duplicate`, dan seterusnya tetap milik `cipansor-bot`; `label-guard`
  mencabutnya bila dipasang akun lain (`docs/LABELS.md` aturan 12).
- Tanpa assignee dan tanpa milestone.
- Bila agen menulis atas nama akun manusia, nyatakan itu dalam satu baris
  penutup, seperti praktik repo selama ini. Bila alatnya membuang baris itu dari
  body, nyatakan di komentar pertama.

## 6. Pekerjaan besar: issue induk + issue anak

`pr-template-guard.sh` mewajibkan setiap PR **menutup** (`Fixes`) minimal satu
issue terbuka berlabel `ready` atau `in-progress`. **PR yang hanya `Refs` selalu
merah.** Karena itu pekerjaan yang butuh beberapa PR dipecah:

- **Issue anak, satu per PR,** masing-masing berdiri sendiri: kriteria, berkas,
  uji, dan `Bergantung pada:` yang jelas.
- **Issue induk** memuat urutan dan ketergantungan anak-anaknya. Setiap PR anak
  memakai `Fixes #anak` dan `Refs #induk`; induk ditutup sesudah anak terakhir.
- Dua pekerjaan berbeda tipe tidak bisa ditutup satu PR, karena tipe PR hanya
  satu (`docs/LABELS.md` aturan 1). Pisahkan menjadi dua issue dan dua PR.

## 7. Sesudah issue dibuka

- `Triase issue` berjalan pada `issues.opened`: memasang prioritas, lalu
  `ready`, `question`, `blocked`, atau `duplicate`. Jawab pertanyaannya di
  **komentar** issue; balasan manusia membangunkan triase lagi lewat jembatan
  triase (`docs/LABELS.md` aturan 11).
- Body boleh disunting bila permintaannya sendiri berubah, dan suntingan itu
  juga memicu triase ulang. Ringkasan final yang ditulis bot di bawah penanda
  `<!-- sdlc:triase -->` jangan disunting.
- Mau label diubah? Sebut `@cipansor-bot` di komentar beserta permintaannya.
  Jangan memasangnya sendiri.
- Issue `question` tanpa aktivitas manusia diberi `stale` sesudah 8 hari dan
  ditutup sesudah 15 hari (`stale-sweep.sh`); issue `ready`, `blocked`, dan
  `in-progress` dikecualikan.
- Begitu issue `ready` dan Anda sendiri yang mengerjakannya, lanjut ke skill
  `buat-pr`. Buka PR draf secepatnya: PR yang terbuka memindahkan issue ke
  `in-progress`, sehingga `Tiket jadi PR` tidak mengambilnya dari antrean.

## Tolak keras

- Membuka issue publik untuk kerentanan yang bisa dieksploitasi.
- Memasang label selain label tipe formulir, termasuk `ready` dan `priority:*`.
- Membuka issue kedua untuk penyebab yang sudah punya issue terbuka.

Penolakan adalah jawaban yang benar: laporkan apa yang harus terjadi lebih dulu.

## Ringkas

Perlu issue publik? → cari duplikat (terbuka + tertutup) → pilih formulir =
tipe → tulis body seperti formulir (basmalah, Indonesia, bukti, kriteria yang
bisa diamati, `Bergantung pada:`) → buka dengan akun penulis dan hanya label
tipe → jawab triase di komentar → `ready` → skill `buat-pr`.
