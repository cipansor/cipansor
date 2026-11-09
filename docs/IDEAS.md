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
- `.github/pull_request_template.md` — bagian `Why`, `What changed`, `Linked
  issue`, `Acceptance criteria`, `How to test`, `Risk and rollback`, `Evidence`,
  `Notes`; wajib `Fixes #<n>` ke issue `ready`/`bot-implement` dan kriteria
  penerimaan yang disalin sebagai kotak centang. Bagian `HUMAN`/`AGENT` dan
  `Type` dihapus pada 2026-11-09 (#965): tipe sudah datang dari label issue.

Tautan yang menjaganya jujur (polanya dari OpenHands upstream, yang memakai
label `ready-for-dev`; di repo ini `ready`/`bot-implement`): **sebuah issue
hanya mendapat `ready` saat kriteria penerimaannya nyata**, dan PR harus menunjuk ke salah
satunya. `Pelabel issue` adalah gerbang itu.

### Penegakan keras (di-deploy)

Dipilih **gate keras pada job `template`**:

- `.github/workflows/pr-description-checks.yml` berjalan pada
  `pull_request_target` (PR fork tetap bisa dikomentari; tidak ada kode PR yang
  di-checkout):
  - job **template** **gagal** selama deskripsi belum lengkap:
    `Why`/`What changed`/`How to test`/`Acceptance criteria`, `Risk and
    rollback` pada PR berisiko, minimal satu `Fixes #<n>` dengan **setiap**
    nomor berupa issue terbuka berlabel `ready`/`bot-implement` (PR tanpa issue
    gagal, #772), PR menuju cabang default, dan prosa Bahasa Indonesia.
    Dependabot saja yang dilewati, berdasarkan penulis PR;
  - job **visual** memasang pengingat **sebelum/sesudah** bila PR mengubah
    `apps/web` dan body-nya tidak punya gambar atau video — ini tetap advisory.
- Hanya job `template` yang memblokir; ia tidak memberi label atau mengubah
  status draft. Check-nya bernama `PR template reminder` dan termasuk required
  status checks ruleset `main` sejak 2026-10-11 (#772), jadi PR merah tidak
  bisa di-merge. Aturannya adalah skrip shell di `.github/scripts/` dan dicakup
  oleh `apps/api/src/utils/pr-description.guard.test.ts` (stub `gh`, `jq` asli),
  pola yang sama dengan guard lain.

Gate ini mengikuti pola OpenHands upstream (bagian Why/Summary/How to test dan
issue `ready-for-dev`); di repo ini issue-nya berlabel `ready`/`bot-implement`.

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

Setiap automation yang mengomentari issue memakai akun `cipansor-bot`, dan
menjaga pemicu `issue_comment.created` dengan
`comment.user.login != 'cipansor-bot' && comment.user.type != 'Bot'`. Guard-nya
penulis komentar, bukan teks footer — nama akunnya sudah menandai komentar itu
otomatis, jadi tidak ada footer AI-disclosure yang ditulis (dihapus 2026-10-14).
Tanpa guard itu automation memicu ulang dirinya sendiri — issue #680. Lihat
`docs/LABELS.md`.

Sejak 2026-10-13 armada juga berbagi lima aturan (diminta pengguna, terpasang di
setiap prompt dan dijaga workflow deterministik):

- **Mengakui dulu.** Sebelum menangani apa pun, react 👀 pada objeknya
  (`POST …/issues/<n>/reactions`, `{"content":"eyes"}`; untuk komentar
  `…/issues/comments/<id>/reactions`), supaya orang tahu automation bekerja.
  Pemicu komentar dijaga `acknowledge.yml`.
- **Komentar dulu, body saat `ready` (issue).** Selama issue belum `ready`,
  triase/estimasi/kriteria/pertanyaan ditulis sebagai **komentar**; **body** issue
  diperbarui hanya saat bot memasang `ready` (ringkasan final di bawah penanda
  `<!-- sdlc:triase -->`). PR berbeda: putusan tinjauan/QA tetap ke body PR di
  bawah penanda (`<!-- sdlc:gerbang -->`).
- **Prioritas berbukti.** Dampak, urgensi, dan risiko; apa pun di atas `medium`
  wajib menyebut bukti konkret, tanpa bukti maksimum `medium`, bila ragu pilih
  yang lebih rendah. `critical` hanya untuk layanan mati total, kehilangan data,
  atau keamanan/privacy yang aktif bisa dieksploitasi. Jangan menginflasi.
- **Triase ulang lewat jembatan, bukan `issues.edited`.** `issue-triage-bridge.yml`
  + `.github/scripts/issue-triage-bridge.sh` mendispatch pemilik triase saat bot
  memasang label tipe/prioritas dan saat issue belum `ready` punya aktivitas baru
  (komentar atau suntingan deskripsi). Idempoten (penanda per keadaan dan per
  stempel aktivitas). **Deskripsi PR tidak ditanggapi otomatis** — tidak ada
  pemicu `pull_request.edited`; gerbang tinjau sudah membaca deskripsi, issue,
  diff, dan semua komentar.
- **Basmalah.** Setiap body dibuka dengan «بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ»;
  templat PR membawanya, form issue menampilkannya sebagai petunjuk (blok
  `markdown` form tidak ikut ke body), dan `basmalah.yml` menambahkannya bila lupa.
- **`ready` eksklusif dan kuat.** `ready` hanya bila sangat yakin, tanpa
  pertanyaan terbuka, dan tidak pernah bersama `question`/`needs-info`/
  `pending-maintainer` (#814). Kritik habis-habisan dulu, baru `ready`.
- **Hanya `cipansor-bot` melabeli.** Label akun lain dicabut `label-guard.yml`,
  kecuali `rilis-disetujui`, `rilis-ditolak`, `bot-implement`.
