# otomasi-armada

> KEPUTUSAN 2026-10-09 → 10 (pengguna) tentang armada otomasi, alur PR, dan
> rilis. Alurnya sendiri ada di `docs/SDLC-FLOW.md` → "Desain target — armada
> otomatis penuh" dan "Instruksi pelaksanaan". Berkas ini mencatat **apa yang
> dipilih dan mengapa**, supaya pilihan yang sudah ditolak tidak diusulkan lagi.

## Yang diputuskan

1. **Pemantauan dipicu event, bukan cron.** Deploy diawasi `deploy-watch.yml`
   pada `workflow_run` dari kedua workflow deploy (#664). Kegagalan CI/E2E di
   `main` dilaporkan `main-failure-bridge.yml` (#711). Satu masalah, satu
   peringatan: kedua jalur tidak saling mengulang. Usulan pemeriksa berjadwal
   yang menumpuk ditutup.
2. **Uji beban k6 dijalankan manual sebelum setiap rilis** (#677), relatif
   terhadap baseline yang direkam, bukan terjadwal. Cron cloud "Uji beban" dan
   "Penjaga issue" dimatikan oleh pengguna.
3. **Persetujuan rilis lewat label.** Setiap minggu ada satu issue rilis. Label
   `rilis-disetujui` berarti setuju. `rilis-ditolak`, disertai alasannya,
   berarti tolak. Kalau tidak ada tindakan, rc minggu depan menggantikannya.
   Teks persisnya ada di SDLC-FLOW → "Instruksi pelaksanaan".
4. **Tidak ada berkas `CHANGELOG`.** Catatan rilis ditulis otomatis saat
   pra-rilis.
5. **Temuan keamanan masuk ke advisory privat GitHub**, bukan issue publik.
   Perbaikannya lewat PR publik yang ditulis netral (aturannya, bukan
   celahnya), dan advisory diterbitkan sesudah rilis produksi yang membawanya.
   Isi advisory tidak pernah disalin ke tempat publik.
6. **Ruleset `strict` menyusul**, sesudah job yang memperbarui branch PR secara
   otomatis tersedia (aturan emas 9 menjadi mekanis).
7. **Duplikat:** yang dipertahankan adalah yang **paling benar**. Kalau setara,
   yang paling awal (`docs/LABELS.md` aturan 4).
8. **Loop komentar bot (#680):** aturannya cukup di `docs/LABELS.md` dan
   SDLC-FLOW. Tidak ada job mingguan pendeteksi pergeseran, karena loop
   menghabiskan anggaran dalam hitungan menit, sedangkan pemeriksaan mingguan
   datang terlambat. Pencegahannya saat otomasi dibuat atau diubah: uji
   filternya dengan contoh komentar bot. #681, #682, dan #683 ditutup.
9. **Catatan `## HUMAN` hanya untuk PR berisiko** (#760): PR berlabel
   `security`, atau yang menyentuh skema/migrasi/skrip data, skrip data
   produksi, atau auth/RBAC. PR lain ditinjau gerbang bot, dan manusia hadir di
   empat gerbang SDLC-FLOW. Upstream OpenHands mewajibkannya di setiap PR,
   tetapi di sini aturan itu menjadi gerbang manusia kelima yang menahan PR
   dokumen satu baris.
10. **Penjaga perintah (#660)** membaca perintah seperti shell (wrapper,
    subshell, `sh -c`), dan dokumennya jujur: dinding sesungguhnya adalah
    ruleset `main`, bukan hook.
11. **Peta modul** tinggal di `DOKUMEN-TEKNIS.md` Lampiran A milik #512, bukan
    berkas tersendiri.

12. **Setiap PR berangkat dari issue dan menautkan semua yang diselesaikannya**
    (2026-10-11, #772/#773). Satu `Fixes #n` per issue, dan `Refs #n` untuk
    yang baru sebagian. Tidak ada jalan keluar "tanpa issue". Setiap nomor harus
    issue terbuka berlabel `ready`. Check-nya dijadikan wajib di ruleset; hanya
    Dependabot yang dikecualikan, berdasarkan penulis PR. Audit hari itu
    menemukan delapan issue yang sudah selesai tetapi masih terbuka karena PR
    penyelesainya tidak menyebutnya.
13. **Gerbang yang diam ditandai mesin** (#776/#777). PR siap yang semua
    check-nya hijau lebih dari 60 menit tanpa review gerbang di head-nya
    didispatch ulang sekali, diberi satu komentar per head, dan dicatat dalam
    satu issue `automation-health`.
14. **Panduan tidak menyalin angka jumlah** (#782/#783). Jumlah modul, model,
    job, dan berkas uji ditunjuk lewat perintah ukurnya. Pengukuran bertanggal
    beserta definisinya hanya di `known-issues.md` dan di dokumen teknis
    berrevisi yang diperiksa `check_docs.py`. `Peta basis kode` memperbarui satu
    issue induk (#782), tidak membuka issue per temuan.
15. **Penulis dan penyetuju tetap dua identitas** (#781). GitHub menolak
    approval dari penulis PR itu sendiri, jadi usulan "semua otomasi lewat satu
    akun" ditolak, karena gerbang tidak lagi bisa meng-approve. Penulis issue
    dan PR pindah ke GitHub App `cipansor-contributor-bot` (izin minimal, token
    per run). `cipansor-bot` tetap akun penyetuju, karena approval dari akun
    ber-izin write terbukti dihitung ruleset.
16. **Armada mengakui, memusatkan kesimpulan, dan tidak melabeli sendiri**
    (2026-10-13, pengguna). Lima aturan yang dipasang di setiap prompt dan
    dijaga workflow deterministik (`docs/LABELS.md` aturan 8–12, `docs/SDLC-FLOW.md`
    invarian 14–17, `docs/IDEAS.md`):
    - **Mengakui dulu.** Reaction 👀 pada objek yang ditangani, supaya orang
      melihat automation bekerja sebelum jawabannya tiba. Pemicu komentar
      dijaga `acknowledge.yml` (hanya saat automation akan benar-benar jalan);
      automation lain melakukannya dari promptnya.
    - **Komentar dulu, body saat `ready`.** (2026-10-14, pengguna; menggantikan
      "Satu deskripsi" versi 2026-10-13.) Selama issue belum `ready`, triase,
      estimasi, kriteria, dan pertanyaan terbuka ditulis sebagai **komentar**
      (percakapan kerja); **body** issue diperbarui hanya saat bot memasang
      `ready`, dengan ringkasan final di bawah penanda tetap
      (`<!-- sdlc:triase -->`). PR tetap: putusan tinjauan/QA ke **body** PR di
      bawah penanda (`<!-- sdlc:gerbang -->`). Pemicunya: issue #818 — body
      terisi kesimpulan bot sejak putaran pertama, dan tidak ada yang memicu
      `issues.edited`, jadi suntingan deskripsi oleh manusia tak ditanggapi.
    - **Prioritas berbukti.** Prioritas dinilai dari dampak, urgensi, dan risiko;
      apa pun di atas `medium` wajib menyebut bukti konkret, tanpa bukti
      maksimum `medium`, bila ragu pilih yang lebih rendah. `critical` hanya
      untuk layanan mati total, kehilangan/korupsi data, atau masalah
      keamanan/privacy (UU PDP) yang aktif bisa dieksploitasi. Jangan
      menginflasi `critical`. (2026-10-14, pengguna.)
    - **Triase ulang lewat jembatan, bukan `issues.edited`.** Tak satu pun
      automation memicu `issues.edited`. `issue-triage-bridge.yml` +
      `.github/scripts/issue-triage-bridge.sh` mendispatch pemilik triase saat
      bot memasang label tipe/prioritas dan saat **sinyal aktivitas** sebuah
      issue belum `ready` berubah sejak checkpoint terakhir. Sinyalnya adalah
      hash isi — body issue plus tiap komentar bukan-armada (penulis +
      `updated_at` + body) — sehingga suntingan deskripsi, komentar baru, atau
      komentar yang disunting semuanya terdeteksi, termasuk suntingan pada detik
      yang sama dengan penulisan penanda (perbandingan timestamp beresolusi detik
      dulu menelannya). Komentar armada sendiri (`*[bot]`, `cipansor-bot`)
      dikecualikan agar bot tidak memicu triase ulang dirinya. Idempoten (penanda
      per keadaan tipe+prioritas, dan penanda sweep per sinyal). **Deskripsi PR
      tidak ditanggapi otomatis** — tidak ada pemicu `pull_request.edited`;
      gerbang tinjau sudah membaca deskripsi, issue, diff, dan semua komentar.
      (2026-10-14, pengguna; menutup #818.)
    - **Basmalah.** Setiap body dibuka dengan «بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ»;
      templat PR membawanya di body, form issue hanya menampilkannya sebagai
      petunjuk (blok `markdown` form tidak ikut ke body), dan `basmalah.yml`
      menambahkannya bila lupa (idempoten; body dibaca ulang tepat sebelum PATCH
      agar ringkasan `<!-- sdlc:… -->` yang mendarat bersamaan tidak tertimpa).
    - **`ready` kuat dan eksklusif.** `ready` hanya bila sangat yakin, tanpa
      pertanyaan terbuka; tidak pernah bersama `question`/`needs-info`/
      `pending-maintainer` (#814). Kritik habis-habisan dulu, baru `ready`.
      `label-guard.sh` mencabut `ready` yang bertentangan, dari akun mana pun.
      Konflik dihitung dari himpunan label **efektif**: label pada event
      diabaikan hanya bila jalur standar memang akan mencabutnya, sehingga
      exclusion **lain** yang tersisa (mis. `ready`+`needs-info` saat manusia
      menambah `question`) tetap membuat `ready` dicabut (temuan tinjauan
      PR #817, 2026-10-13).
    - **Hanya `cipansor-bot` melabeli.** Label yang dipasang akun lain dicabut
      `label-guard.yml` dan pelakunya diberi tahu sekali; label keputusan
      manusia (`rilis-disetujui`, `rilis-ditolak`, `bot-implement`) tetap boleh
      manual. Automasi membaca label, jadi label manual membuat keduanya
      berbeda pendapat.
    - **Dua sebutan, dua penanggap; guard penulis, tanpa footer** (2026-10-14,
      pengguna; keputusan "A dan lanjut E"). `@openhands` membangunkan OpenHands
      GitHub App (`openhands-ai[bot]`) — yang membuka conversation OpenHands
      Cloud sendiri dan membuka PR; `@cipansor-bot` membangunkan armada
      repositori ini (`Bot sebutan` dan kerabatnya). Keduanya dulu menanggapi
      `@openhands`, jadi satu sebutan memicu **dua** penanggap (terbukti di
      timeline PR #828). Guard anti-loop (#680) pindah dari teks footer ke
      **penulis komentar**: filter `comment.user.login != 'cipansor-bot' &&
      comment.user.type != 'Bot'`. Karena itu footer AI-disclosure dihapus dari
      setiap komentar `cipansor-bot` — nama akunnya sudah menandai komentar itu
      otomatis. Penghapusan footer dan pemindahan guard harus bersama: tanpa
      footer, guard teks tidak lagi menemukan apa pun; tanpa guard penulis,
      automation akan meloop. Berlaku di skrip `.github/scripts/*`
      (`acknowledge.sh`, `label-guard.sh`, `duplicate-sweep.sh`, `gate-watch.sh`,
      `pr-lifecycle.sh`, `pr-template-guard.sh`, `visual-evidence.sh`,
      `issue-triage-bridge.sh`) dan di prompt 24 automation (paragraf mandat
      footer dihapus oleh `deploy-sdlc-agents.py`).
    Prompt dan tarball runner 24 automation diperbarui lewat
    `scripts/deploy-sdlc-agents.py` (idempoten; `main.py`/`setup.sh` tidak
    disentuh).
17. **Gerbang tinjau hanya berjalan setelah siap + hijau** (2026-10-14,
    pengguna; #840). `pr-lifecycle.sh` sudah men-dispatch gerbang pada
    `workflow_run` begitu semua check wajib hijau — untuk PR biasa maupun PR
    dokumen (yang tidak menghasilkan `workflow_run` sesudah ditandai siap,
    tetapi tertangkap jalur `pull_request: ready_for_review` di `pr-lifecycle`
    itu sendiri). Karena itu pemicu **event** gerbang `pull_request.ready_for_review`
    dihapus: ia menyala saat PR ditandai siap tanpa tahu check-nya sudah hijau,
    sehingga run bisa dimulai, menemukan check masih berjalan, lalu berhenti
    tanpa meninjau — run terbuang. Pemicu event gerbang kini hanya
    `pull_request.review_requested` (permintaan tinjauan manual, disaring ke
    `requested_reviewer.login == 'cipansor-bot'`); dispatch biasa tetap milik
    `pr-lifecycle.sh`. Diterapkan lewat `PATCH` trigger automation `SDLC 18`
    (id tetap `96eebf19…`). Kegagalan sandbox saat dispatch (`Timed out: Sandbox
    not available`, `Failed to get execution context`) adalah masalah kapasitas
    terpisah — #839/#841.

18. **Sweep triase mengantre sendiri; checkpoint = hasil run, bukan 201**
    (2026-10-14, pengguna; #836/#841). Sweep jembatan triase mendispatch hingga
    `SWEEP_MAX=15` sekaligus; kolam sandbox tidak menyediakan 15 slot, sehingga
    14 run mati `Sandbox not available`. Dua cacat: ledakan dispatch, dan
    kegagalan senyap — penanda checkpoint ditulis saat API membalas 201,
    sehingga run yang mati dianggap "sudah ditangani" dan tidak pernah diulang.
    Perbaikan **C + A**: (C) penanda menyimpan id run
    (`<!-- triage-bridge-sweep:<n>:<signal>:<run> -->`); sweep berikutnya membaca
    **hasil run** itu — `COMPLETED` memfinalkan checkpoint, `FAILED`/`CANCELLED`/
    `SKIPPED` mendispatch ulang, `RUNNING`/`PENDING` dibiarkan. (A) `MAX_INFLIGHT`
    (default 3) membatasi run triase yang berjalan sekaligus; kandidat berlebih
    ditunda ke sweep berikutnya, jadi armada tidak pernah membentuk burst yang
    kolam tak bisa tampung. Hasil run dibaca lewat `$CURL` (bearer OpenHands),
    bukan `gh api` (bearer GitHub).
19. **`label-guard` tidak mencabut label tipe bawaan template — hanya pada
    issue** (2026-10-14, pengguna; #842/#838, disempitkan #837). `bug_report.yml`
    memasang `bug` dan `feature_request.yml` memasang `enhancement` saat issue
    dibuka; `label-guard` mencabutnya karena bukan `cipansor-bot`, sehingga issue
    baru kehilangan label dan mendapat komentar pencabutan yang tidak perlu.
    `ALLOWED_LABELS` (default `bug enhancement`) dibiarkan **pada issue**: label
    tipe adalah maksud pelapor, dan pelabel (SDLC 15) mencabut tipe yang
    bertentangan saat memasang tipe yang benar. **Pada PR pengecualian ini tidak
    berlaku**: PR tidak punya form template, dan `issue-label-sync` membaca tipe
    PR sebagai klaim yang harus cocok dengan issue tertaut — `bug` manual pada PR
    yang menutup issue `enhancement` akan menggagalkan check. Jadi tipe tetap
    dilindungi di PR dan dicabut seperti label lain. Label status (`ready`,
    `priority:*`, label workflow) tetap milik bot di keduanya.
20. **Tinjauan PR menyertakan checklist kriteria penerimaan** (2026-10-14,
    pengguna; #787). `Peninjau kode` (SDLC 08) dan `Gerbang tinjau PR` (SDLC 18)
    wajib memeriksa setiap kriteria penerimaan issue tertaut **terhadap diff**
    (bukan terhadap deskripsi PR) dan menyajikannya sebagai checklist markdown
    sederhana — `- [x] <kriteria>` bila terpenuhi, `- [ ] <kriteria>` bila belum
    — **dua keadaan saja**, sama bentuknya dengan `## Acceptance criteria` di
    deskripsi PR (bukan emoji `✅/⚠️/❌`, bukan keadaan "sebagian"). Kriteria
    diambil persis dari issue; bila diturunkan dari maksud issue, barisnya
    ditandai `(turunan)` agar asalnya jelas. Kriteria `- [ ]` tanpa alasan yang
    meyakinkan menghalangi `APPROVE`.
21. **Checkpoint sweep membedakan tiga bentuk penanda; run tanpa id = gagal**
    (2026-10-14, pengguna; tinjauan #837 R378/R121, memperbaiki #836/#841 yang
    belum menutupnya). Tiga bentuk berbagi prefiks: `…:<n>:<signal>` (lama,
    ditulis saat 201, hasil run tak pernah dicatat), `…:<n>:<signal>:<run>`
    (run sedang berjalan), `…:<n>:<signal>: -->` (final, run tuntas). Penanda
    lama **bukan** checkpoint final — sweep mendispatch ulang sekali dan
    menulisnya ke bentuk baru, karena hasil run-nya tak diketahui. Field run
    `pending` menandai kandidat yang ditunda karena `MAX_INFLIGHT`, sehingga
    sweep berikutnya mendispatch saat kapasitas longgar (bukan dibaca final).
    Dispatch 2xx **tanpa `.id`** diperlakukan **gagal** (tidak menulis penanda,
    `exit 1`), karena checkpoint dengan run kosong akan dibaca final dan
    kegagalannya senyap — kekeliruan yang justru ingin dicegah mekanisme retry.
22. **Batas `MAX_INFLIGHT` berlaku di jalur label juga** (2026-10-14, pengguna;
    tinjauan #837 R319). Jalur `issues.labeled` menjalankan job `labeled`
    terpisah per issue, sehingga sepuluh label sekaligus mendispatch sepuluh run
    tanpa melewati batas yang hanya dipasang di sweep. `on_label` kini membaca
    jumlah run in-flight dan menunda (menulis penanda `pending`) bila cap
    tercapai; sweep berikutnya mengambilnya. Pemeriksaan per-job tanpa reservasi
    atomik tidak cukup untuk event yang serentak, karena itu penanda `pending`
    yang menyelamatkan kandidat, bukan sekadar hitungan.
23. **Guard anti-loop `acknowledge.sh` sejalan dengan filter cloud** (2026-10-14;
    tinjauan #837). `acknowledge.sh` melewatkan komentar yang ditulis akun
    bertipe `Bot` (`comment.user.type == 'Bot'`), bukan hanya `cipansor-bot`:
    filter cloud yang membangunkan automation pemicu komentar menolak penulis
    tipe `Bot`, jadi memberi reaction 👀 pada komentar itu akan menampilkan
    "sedang dikerjakan" untuk komentar yang tak akan pernah ditanggapi armada.
24. **Jalur pemulihan `--recover-ready` untuk dispatch label tertunda pada issue
    `ready`** (2026-10-14, tinjauan #837 R348). Menunda dispatch label pada issue
    yang `ready` (atau menjadi `ready`) tanpa jalur pemulihan berarti triase ulang
    untuk perubahan prioritas **hilang permanen**: sweep mencari
    `is:open -label:ready`, jadi penanda `pending` di sana tak pernah diambil.
    Perbaikan: subperintah `--recover-ready` membaca semua penanda `pending` dan
    memprosesnya lewat `process_one … 1` (izinkan `ready`); hanya menyentuh issue
    berpenanda `pending`, jadi issue `ready` tanpa penanda tak tersentuh.
    `process_one` memperlakukan `pending` bukan-sebagai-run-id (dispatch saat ada
    ruang), dan workflow menjalankan langkah ini dengan `if: always()` agar
    kegagalan sweep tidak menelantarkannya. Skrip berjalan `#!/bin/sh` di bawah
    `dash`, jadi tanpa proses-substitusi — hasilnya lewat berkas sementara.


## Sumber

- Google SRE, "Monitoring Distributed Systems" —
  <https://sre.google/sre-book/monitoring-distributed-systems/>
- PagerDuty Event Management, kunci dedupe —
  <https://developer.pagerduty.com/docs/events-api-v2/overview/>
- DORA, empat metrik kunci — <https://dora.dev/guides/dora-metrics-four-keys/>
- DORA, "Streamlining change approval": persetujuan yang berat memperlambat
  pengiriman dan memperbesar dampak tiap rilis, sedangkan tinjauan sejawat yang
  didukung otomasi dan pengujian menurunkan risiko —
  <https://dora.dev/capabilities/streamlining-change-approval/>
- GitHub, repository security advisories —
  <https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/about-repository-security-advisories>
- OpenHands upstream, `check_pr_description.py` (catatan HUMAN di setiap PR;
  minimal satu issue `ready-for-dev`, bot dikecualikan) —
  <https://github.com/OpenHands/OpenHands/blob/main/.github/scripts/check_pr_description.py>
- GitHub Docs, "Linking a pull request to an issue" (kata kunci hanya dibaca
  pada PR ke branch default; satu kata kunci per issue) —
  <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue>
- GitHub Docs, "Generating an installation access token for a GitHub App"
  (token kedaluwarsa dalam satu jam, izin dan repo bisa dipersempit) —
  <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app>
