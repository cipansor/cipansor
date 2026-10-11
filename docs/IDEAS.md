# Automation ideas and their guardrails

Automation yang bukan bagian dari kerangka 18 item tetap. Masing-masing adalah
usulan yang disetujui dan di-deploy, dengan batas yang harus dijaganya. Semua
hidup di luar repositori ini (di-deploy lewat API automation OpenHands); guardrail
tiap automation ditulis ke dalam promptnya, dan `docs/SDLC-FLOW.md` merekam
bentuk armadanya.

## 1. Pemburu bug

Secara proaktif menemukan bug nyata yang bisa direproduksi di `main`,
membuktikannya, dan membuka **satu issue berbukti**. Sebuah issue spekulatif
lebih buruk daripada tidak ada, jadi ia tidak membuka apa pun yang tidak bisa
direproduksi, dan mencari duplikat lebih dulu. Ia tidak menulis perbaikan —
perbaikan berjalan lewat jalur normal (`Pelabel issue` memberi `ready`, lalu
`Tiket jadi PR` mengerjakannya bila maintainer memasang `bot-implement`).

## 2. Pemindai standar

Membaca standar resmi terkini untuk stack ini dan regulasi perlindungan data
yang berlaku untuk sistem manajemen sekolah, lalu membuka issue
`pending-maintainer` dengan sitasi untuk tiap penyimpangan konkret. Maintainer
menambahkan `ready` untuk memulai implementasi.

## 3. Penjaga issue

Mengusangkan issue yang macet. Timer, dari yang dipakai proyek sebanding:

| Label         | Warn after        | Close after | Precedent                  |
| ------------- | ----------------- | ----------- | -------------------------- |
| `needs-info`  | —                 | 20 days     | Kubernetes triage guide    |
| `question`    | 8 days (`stale`)  | 7 more      | Traefik contributors guide |
| anything else | 90 days (`stale`) | 14 more     | `actions/stale` default    |

Exempt: `pending-maintainer`, `ready`, `blocked`, `in-progress`, dan apa pun yang
dikomentari maintainer. `duplicate` dimiliki oleh sweep workflow.

## 4. Diskusi

Menjawab maintainer pada issue `pending-maintainer` atau `needs-info`.
Menyuplai detail yang kurang atau lampu hijau memberi `ready`, yang menyerahkan
ke `Tiket jadi PR`; penolakan memberi `wontfix` dan menutup. Ia tidak pernah
bertindak atas komentarnya sendiri.

## 5. Pengawas armada

Mengawasi setiap automation dan melaporkan ke maintainer.

- **Membuka satu issue berlabel `automation-health` per penyebab, paling banyak
  satu per penyebab per minggu.** Ini mencakup cacat konfigurasi (guard
  self-comment yang hilang, automation yang mati padahal seharusnya hidup, dua
  automation pada satu slot cron, pin kedaluwarsa yang dilaporkan check
  `Security`).
- **Tidak pernah menulis perbaikan.** Pengawas hanya melaporkan; perbaikan
  berjalan lewat jalur PR normal (`Tiket jadi PR`), bukan lewat perbaikan
  otomatis. Ini menghapus kebutuhan akan automation verifikasi terpisah.
- **Tidak boleh menyentuh:** guard loop atau tesnya, rahasia, login atau
  kredensial, hasil run, atau timer Penjaga issue.
- **Konflik:** ketidaksepakatan konten antara dua automation adalah milik
  pengawas untuk diselesaikan, dengan bukti; bila tidak bisa memutuskan, ia
  menandai manusia.
- **Jujur saat buta:** bila API automation tak terjangkau ia mengatakannya dan
  jatuh ke bukti repositori dan GitHub Actions.

## 6. Template issue dan PR (dibangun)

Repo ini dulu **tidak punya templat sama sekali**. Ditambahkan form issue dan
templat PR yang terikat ke sistem label, bukan prosa bebas:

- `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.yml` — form issue, wajib
  berisi reproduksi + kriteria penerimaan, otomatis memasang label tipe
  `bug`/`enhancement`; `config.yml` mengarahkan pembaca ke `docs/LABELS.md` dan
  berkas ini.
- `.github/pull_request_template.md` — pemisahan `HUMAN`/`AGENT`, wajib
  `Fixes #<n>` ke issue `ready`, dan kriteria penerimaan yang disalin sebagai
  kotak centang.

Tautan yang menjaganya jujur: OpenHands sendiri menggerbangi PR-nya pada label
`ready-for-dev` yang dikelola workflow, jadi **sebuah issue hanya mendapat
`ready` saat kriteria penerimaannya nyata**, dan PR harus menunjuk ke salah
satunya. `Pelabel issue` adalah gerbang itu.

### Penegakan keras (di-deploy)

Dipilih **gate keras pada job `template`**:

- `.github/workflows/pr-description-checks.yml` berjalan pada
  `pull_request_target` (PR fork tetap bisa dikomentari; tidak ada kode PR yang
  di-checkout):
  - job **template** **gagal** selama deskripsi belum lengkap (catatan `HUMAN` pada PR berisiko,
    `Why`/`What changed`/`How to test`/`Acceptance criteria`, `Fixes #<n>` ke
    issue `ready`/`bot-implement`, dan prosa Bahasa Indonesia);
  - job **visual** memasang pengingat **sebelum/sesudah** bila PR mengubah
    `apps/web` dan body-nya tidak punya gambar atau video — ini tetap advisory.
- Hanya job `template` yang memblokir; ia tidak memberi label atau mengubah
  status draft. Check-nya bernama `PR template reminder`. Agar merge benar-benar
  tertahan, check itu harus ditambahkan ke required status checks ruleset `main`
  — langkah maintainer dengan akses admin; sampai itu dilakukan, job hanya merah
  tanpa memblokir. Aturannya adalah skrip shell di `.github/scripts/` dan dicakup
  oleh `apps/api/src/utils/pr-description.guard.test.ts` (stub `gh`, `jq` asli),
  pola yang sama dengan guard lain.

Gate ini menyamakan repo dengan standar OpenHands: PR wajib punya bagian
Why/Summary/How to test dan menunjuk issue `ready-for-dev`.

### Issue bug yang datang tidak lengkap (`Reproduksi bug`)

Pelapor yang tidak bisa menyebut _mengapa_ sesuatu terjadi tetap telah menemukan
kegagalan nyata. Karena itu `Reproduksi bug` memperlakukan laporan bug yang
tipis sebagai pekerjaan, bukan alasan memantulkannya:

- Ia menyelidiki — membaca kode dan riwayat terkini, membentuk hipotesis — dan
  menambahkan apa yang tidak bisa diberikan pelapor: reproduksi, penyebabnya.
- Pada cacat UI ia mereproduksi kegagalan di aplikasi yang berjalan dan
  **menyunting body issue** untuk melampirkan tangkapan layarnya, sehingga issue
  itu sendiri menunjukkan masalahnya, bukan hanya utas komentar.
- Bila tidak ada yang salah (perilaku memang disengaja, salah baca) ia
  mengatakannya dengan bukti dan memasang `invalid`/`duplicate`/`question`,
  mencabut `bug`.
- `Pelabel issue` tidak lagi mengirim _cacat_ yang tipis ke `needs-info` — jalur
  itu untuk permintaan yang kabur, bukan bug yang penyebabnya belum diketahui.
  `ready` tetap keputusan manusia: `Reproduksi bug` melaporkan bahwa reproduksi
  kini ada dan menyerahkan gerbangnya ke maintainer.
- Ia membuka **issue saja** — tidak ada draft PR. Perbaikan berjalan lewat
  `Tiket jadi PR`.

Pemicunya menyala pada `issues.opened` atau saat label `bug` dipasang, tetapi
hanya bila issue _masih_ membawa `bug` dan hanya bila label itulah yang berubah —
jadi memasang `ready` atau `needs-info` saat meninjau tidak memicunya ulang.

## Aturan yang dibagi semua

Setiap automation yang mengomentari issue harus mengakhiri komentarnya dengan
footer AI-disclosure dan menjaga pemicu `issue_comment.created` dengan
`!icontains(comment.body, 'This comment was created by an AI agent')`. Tanpa itu
automation memicu ulang dirinya sendiri — issue #680. Lihat `docs/LABELS.md`.
