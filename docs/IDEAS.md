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
perbaikan berjalan lewat jalur normal (`Triase issue` memberi `ready`, lalu
`Tiket jadi PR` mengerjakannya bila maintainer memasang `bot-implement`).

## 2. Pemindai standar

Membaca standar resmi terkini untuk stack ini dan regulasi perlindungan data
yang berlaku untuk sistem manajemen sekolah, lalu membuka issue
`pending-maintainer` dengan sitasi untuk tiap penyimpangan konkret. Maintainer
menambahkan `ready` untuk memulai implementasi.

## 3. Penjaga issue — **diimplementasikan 2026-11-09**

> Kini GitHub Action, bukan automation LLM: `.github/workflows/stale-sweep.yml` +
> `.github/scripts/stale-sweep.sh`. Tugasnya label + stempel waktu, jadi tidak
> perlu sandbox; automation `SDLC 21` dipensiunkan. Timer di bawah dipertahankan;
> hari peringatan (13/8/90) ditambahkan agar penutupan tidak datang tanpa kabar.

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
  kredensial, hasil run, atau timer `stale-sweep` (dulu timer `Penjaga issue`,
  kini deterministik di Actions).
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
satunya. `Triase issue` adalah gerbang itu.

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
- `Triase issue` tidak lagi mengirim _cacat_ yang tipis ke `needs-info` — jalur
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
  - `.github/scripts/issue-triage-bridge.sh` mendispatch pemilik triase saat bot
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
  kecuali `bot-implement`. (`rilis-disetujui`/`rilis-ditolak` dihapus
  2026-11-09: keduanya tidak pernah ada di repo; persetujuan rilis kini tag
  `vX.Y.Z`.)

## Keputusan armada 2026-11-09 — yang mekanis turun ke Actions, yang menilai tetap LLM

Klasifikasi ulang seluruh armada (24 automation, 330 run/7 hari). Aturannya:
kalau keluarannya sebuah **daftar, label, atau stempel waktu**, itu kerja
deterministik dan tidak boleh memakai sandbox; kalau keluarannya **penilaian**,
ia tetap LLM.

- **`Pembuat catatan rilis` (SDLC 13) — DIPENSIUNKAN 2026-11-09.** Telusuran
  lanjutan membantah dua alasan pertama saya, dan koreksinya dicatat terbuka
  supaya tidak diulang:
  1. ~~"release-please menulis `CHANGELOG.md`, bertentangan dengan keputusan 4"~~
     — **salah.** release-please punya `skip-changelog` dan `skip-github-release`
     (docs/manifest-releaser.md), jadi ia bisa tidak menyentuh berkas apa pun.
  2. ~~"label `rilis-disetujui` dipasang pada issue, bukan keluaran
     release-please"~~ — **salah, dan bukan karena release-please.** Label
     `rilis-disetujui`/`rilis-ditolak` **tidak pernah ada di repositori ini**
     (`gh label list` tidak memuatnya), tidak ada workflow yang membacanya, dan
     tidak ada satu pun issue `rilis-*` yang pernah dibuat. Jadi "alur rilis
     berlabel" itu **dokumen, bukan kode**.

  Alasan yang bertahan: (a) tidak ada yang **mengonsumsi** tag `-rc` — tidak ada
  workflow `on: tags`, tidak ada `git describe` di skrip mana pun; (b) k6 smoke
  tetap manual; (c) tag `-rc` **membingungkan**: N hanya naik bila ada commit
  relevan, sedangkan repo ini didominasi `chore(deps)` yang tidak menaikkan
  versi — rc4 bertanggal 2026-10-30, dan run berikutnya (2026-11-06) `SKIPPED`.
  Tag berhenti menandai "kode terverifikasi" dan hanya menandai "commit
  fix/feat terakhir yang jatuh pada Jumat". Membangun apa pun di atas urutan itu
  keliru.

  **Keputusan:** automation dipensiunkan (masuk `RETIRED` di
  `scripts/deploy-sdlc-agents.py`), dan rilis produksi diganti **tag `vX.Y.Z`
  manual** yang sekaligus memicu `deploy-production.yml` — bukan release-please,
  yang hanya akan menggantikan mesin semver dengan mesin semver lain di atas tag
  yang tetap tak dikonsumsi. Prasyarat rilis dijaga gerbang deterministik
  `.github/scripts/release-gate.sh` (tag `vX.Y.Z` tanpa sufiks, commit di `main`,
  staging menyajikan SHA itu, ada run k6 hijau untuk SHA itu);
  `workflow_dispatch` dipertahankan **hanya** untuk rollback.

- **`Peta basis kode` (SDLC 03) — dipensiunkan; `Pengelola dokumentasi` (SDLC 14)
  — DIPERTAHANKAN.** Koreksi 2026-11-09, beberapa jam setelah keputusan pertama.
  SDLC 03 memang separuh besar terukur (jumlah modul, model, rute, entri cron,
  Lampiran A baris demi baris) dan itu sudah dihitung `collect_facts.py` +
  `check_docs.py`; ia juga menunjuk `docs/MODULE_MAP.md` yang **tidak pernah
  ada**. Sisa penilaiannya — apakah peta modul `docs/ARCHITECTURE.md` masih
  benar — dilebur ke SDLC 14.
  SDLC 14 **bukan** diff path: memutuskan bahwa sebuah merge mengubah kontrak
  API atau alur UI sehingga prosa mana pun tak lagi benar, lalu menyebut apa yang
  harus prosa itu jadi, adalah **penilaian** — persis pekerjaan yang armada ada
  untuk itu. Buktinya #943, satu-satunya issue-nya: ia menyebut rantai sebab
  (`59b96dc` dari #935 mengubah `pnpm-workspace.yaml` dan menambah guard test,
  tanpa satu berkas `.md`) dan akibat konkretnya (aturan floor kini menggagalkan
  job Tests, tetapi tak tertulis di dokumen mana pun). Dan 17 issue
  `documentation` yang dibuka manusia pada 2026-10-09/10 menunjukkan kelas cacat
  ini nyata. Jadi: **03 turun, 14 tetap LLM.**
  Lapisan terukur dijalankan `docs-drift.yml` — dan ia menyegarkan **badan issue
  induk #782**, bukan membuka issue baru (keputusan pemilik 2026-10-11: enam belas
  issue dokumen yang tumpang tindih menjadi satu induk yang badannya ditulis
  ulang). Ini juga menutup temuan sesi ini: `check_docs.py` atas #782 melaporkan
  **13 ERROR** pada `docs/DOKUMEN-TEKNIS.md` (294 vs 307 model, 434 vs 437
  halaman, 1.411 vs 1456 rute, 17 vs 19 cron, 15 vs 17 job) — #782 sudah memuat
  semuanya, jadi tidak ada temuan baru yang perlu dibuka.
- **`Pelabel PR` (SDLC 17) — dipensiunkan.** Separuh mekanisnya (menyalin tipe +
  prioritas issue tertaut ke PR) sudah dikerjakan `issue-label-sync.yml` sejak
  awal, dan itu check wajib. Separuh semantiknya (menilai PR duplikat) kini
  heuristik deterministik `pr-duplicate.sh`: dua PR terbuka yang menutup issue
  yang sama → yang terbaru dilabeli `duplicate-pr` sebagai kandidat. Label ini
  **tidak** menutup PR: mana dari dua PR yang lebih benar adalah penilaian
  maintainer (docs/LABELS.md butir 4), jadi `duplicate-sweep.sh` hanya menutup
  issue `duplicate`, bukan PR. Hemat 22 run/7 hari.
- **`Triase bug` (SDLC 01) dilebur ke `Triase issue` (SDLC 15).** Keduanya
  menyala pada `issues.opened` dan keduanya menulis komentar triase — itulah
  "Triase ganda" (#848). SDLC 01 punya penelusuran kritis lebih dalam; SDLC 15
  punya taksonomi label, rubrik prioritas berbukti, dan estimasi. Yang kedua
  menyerap yang pertama, dan jembatan triase kini mengarah ke SDLC 15. Hemat
  ~50 run/7 hari dan satu komentar per issue baru.
