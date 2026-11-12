# otomasi-armada

> KEPUTUSAN 2026-10-09 → 10 (pengguna) tentang armada otomasi, alur PR, dan
> rilis. Alurnya sendiri ada di `docs/SDLC-FLOW.md` → "Desain target — armada
> otomatis penuh" dan "Instruksi pelaksanaan". Berkas ini mencatat **apa yang
> dipilih dan mengapa**, supaya pilihan yang sudah ditolak tidak diusulkan lagi.

## Yang diputuskan

1. **Pemantauan dipicu event, bukan cron.** Deploy diawasi `deploy-watch.yml`
   pada `workflow_run` dari kedua workflow deploy (#664).
   _(Digantikan 2026-11-11: `deploy-watch.yml` dihapus; pemilik mengawasi tab
   Actions dan email GitHub langsung. Prinsipnya tetap — tidak ada pemeriksa
   berjadwal.)_ Kegagalan CI/E2E di
   `main` dilaporkan `main-failure-bridge.yml` (#711). Satu masalah, satu
   peringatan: kedua jalur tidak saling mengulang. Usulan pemeriksa berjadwal
   yang menumpuk ditutup.
2. **Uji beban k6 dijalankan manual sebelum setiap rilis** (#677), relatif
   terhadap baseline yang direkam, bukan terjadwal. Cron cloud "Uji beban" dan
   "Penjaga issue" dimatikan oleh pengguna. **Keduanya kini juga tercatat
   pensiun di `RETIRED` (`scripts/deploy-sdlc-agents.py`)** — `Uji beban`
   (SDLC 11) ditambahkan 2026-11-09 setelah sempat hanya _dimatikan_ tanpa
   entri: automation yang nonaktif tanpa entri `RETIRED` tak terlihat oleh
   deploy berikutnya, dan menghidupkannya lagi akan mengembalikan uji beban
   bulanan terhadap baseline yang tak ada job menyegarkannya.
3. **Persetujuan rilis lewat TAG** (diubah 2026-11-09; sebelumnya label
   `rilis-disetujui` pada issue rilis mingguan). Rilis adalah tag `vX.Y.Z` yang
   dipush maintainer; tag itu memicu `deploy-production.yml`. Alasan perubahan:
   label `rilis-disetujui`/`rilis-ditolak` **tidak pernah ada di repo** dan tidak
   ada workflow yang membacanya — alur "satu issue rilis mingguan" hanya ada di
   dokumen, bukan kode. Satu artefak (tag) kini menyatakan persetujuan **dan**
   memicunya. Prasyaratnya dijaga gerbang deterministik
   `.github/scripts/release-gate.sh` (tag `vX.Y.Z` tanpa sufiks, commit ada di
   `main`, staging menyajikan SHA itu, ada run k6 hijau untuk SHA itu).
   `workflow_dispatch` dipertahankan **hanya** untuk rollback (mode `rollback`
   melewatkan cek staging/k6 dengan sengaja).
4. **Tidak ada berkas `CHANGELOG`.** Catatan rilis ditulis maintainer di body
   Release saat memotong tag. Automation `Pembuat catatan rilis` (SDLC 13)
   dipensiunkan 2026-11-09: pre-release `-rc` mingguannya tidak dikonsumsi apa
   pun (tidak ada workflow `on: tags`, tidak ada `git describe` di skrip mana
   pun).
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
9. **Templat PR tanpa `HUMAN`/`AGENT`; `Risk and rollback` hanya untuk PR
   berisiko** (2026-11-09, #965, menggantikan catatan `## HUMAN` dari #760):
   PR berlabel `security`, atau yang menyentuh skema/migrasi/skrip data, skrip
   data produksi, atau auth/RBAC, menulis apa yang bisa rusak dan cara
   mengembalikannya. Persetujuan manusia sudah diwajibkan ruleset `main`; PR
   lain cukup bagian wajib biasa.
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
    _(Digantikan 2026-11-11: `gate-watch.yml` dan label `automation-health`
    dihapus. Gerbang tetap idempoten dan `pr-lifecycle.sh` tetap mendispatch
    ulang head yang belum ditinjau; yang hilang hanya pengawas otomatisnya.)_
14. **Panduan tidak menyalin angka jumlah** (#782/#783). Jumlah modul, model,
    job, dan berkas uji ditunjuk lewat perintah ukurnya. Pengukuran bertanggal
    beserta definisinya hanya di `known-issues.md` dan di dokumen teknis
    berrevisi yang diperiksa `check_docs.py`. `Peta basis kode` memperbarui satu
    issue induk (#782), tidak membuka issue per temuan.
15. **Penulis dan penyetuju tetap dua identitas** (#781). GitHub menolak
    approval dari penulis PR itu sendiri, jadi usulan "semua otomasi lewat satu
    akun" ditolak, karena gerbang tidak lagi bisa meng-approve. Penulis issue
    dan PR tetap akun pengguna maintainer yang dipakai otomasi penulis, dan
    `cipansor-bot` tetap akun penyetuju, karena approval dari akun ber-izin
    write terbukti dihitung ruleset. Rencana memindahkan penulis ke GitHub App
    `cipansor-contributor-bot` **dibatalkan pemilik pada 2026-10-15** (#781
    ditutup _not planned_): tidak ada App yang perlu ditunggu atau dibangun.
    Hak token otomasi penulis ditinjau ulang bersama daftar pra-rilis, saat
    repositori dijadikan privat.
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
      kriteria, dan pertanyaan terbuka ditulis sebagai **komentar**
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
      pertanyaan terbuka; tidak pernah bersama `question`/`blocked` (#814;
      `needs-info`/`pending-maintainer` dihapus 2026-11-11 — dulu ikut daftar
      ini). Kritik habis-habisan dulu, baru `ready`.
      `label-guard.sh` mencabut `ready` yang bertentangan, dari akun mana pun.
      Konflik dihitung dari himpunan label **efektif**: label pada event
      diabaikan hanya bila jalur standar memang akan mencabutnya, sehingga
      exclusion **lain** yang tersisa tetap membuat `ready` dicabut (temuan
      tinjauan PR #817, 2026-10-13).
    - **Hanya `cipansor-bot` melabeli.** Label yang dipasang akun lain dicabut
      `label-guard.yml` dan pelakunya diberi tahu sekali. Automasi membaca
      label, jadi label manual membuat keduanya berbeda pendapat.
      _(Diperketat 2026-11-11: pengecualian `bot-implement` dihapus bersama
      labelnya, jadi tidak ada lagi pengecualian keputusan manusia.)_
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
    memasang `bug` dan form tipe lain memasang label tipe masing-masing
    (`feature_request.yml` dulu memasang `enhancement`; 2026-11-11 form dipecah
    per tipe) saat issue dibuka; `label-guard` mencabutnya karena bukan `cipansor-bot`, sehingga issue
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
24. **Jalur pemulihan `--recover-ready` untuk issue `ready` (tinjauan #837
    R348/R474/R475/R481/R496/R512/R402).** Sweep mencari `is:open -label:ready`,
    jadi penanda pada issue `ready` tak pernah diperiksa lagi. Perbaikan:
    subperintah `--recover-ready` **memindai komentar penanda langsung** untuk
    memperoleh daftar kandidat nomor issue (`sweep_markers`,
    `gh api .../issues/comments` — bukan `search/issues` berbatas waktu-update
    yang akan melupakan penanda lama begitu issue `ready` baru memenuhi jendela,
    R475), lalu **membaca ulang penanda pada issue itu sendiri** untuk
    memastikan penanda benar miliknya: komentar yang sekadar **mengutip** sintaks
    meninggalkan `MARK_FORM=none` (dilewati), dan penanda basi (ada penanda final
    yang lebih baru) meninggalkan `MARK_FORM=final` (dilewati) — R512. Baru tiap
    kandidat non-final diserahkan ke `process_one … 1`. **Penemuan tak dibatasi**;
    hanya jumlah dispatch per eksekusi (`SWEEP_MAX`) dan plafon kolam
    (`MAX_INFLIGHT`) yang membatasi kerja. Penanda **final** dilewati, jadi
    komentar baru pada issue `ready` yang sudah difinalkan **tidak** men-triase
    ulang (R496); penanda `legacy` (tanpa field run) tetap diproses (dimigrasi).
    - Hasil run pasca-dispatch pemulihan tetap diperiksa: **COMPLETED** difinalkan
      (meski sinyal berubah — pengecekan status tak bergantung sinyal), **FAILED**
      dicoba ulang, `pending` didispatch bila ada ruang, `inflight` dibiarkan
      (R474).
    - **`run_status` membaca daftar run, menyaring `.id`, dan menelusuri
      halaman** — bukan `?run_id=`: endpoint `/runs` **mengabaikan `run_id=`**
      dan selalu mengembalikan halaman terbaru, jadi bentuk query akan membaca
      status run terbaru untuk id apa pun, memfinalkan run gagal sebagai
      `COMPLETED` dan tak pernah mencobanya ulang (cacat inti #836; dibuktikan
      terhadap API produksi: run `1ab90892…` `FAILED` dibaca `COMPLETED` lewat
      `?run_id=`, benar lewat saringan `.id`). Halaman ditelusuri dengan
      `limit`/`offset` sampai id ditemukan (halaman-pertama-saja akan melewatkan
      run yang tergeser >100 run lebih baru, lalu mendispatch ulang tiap sweep,
      R220). Bila seluruh halaman habis tanpa id → status kosong → **retry**
      (run hilang, triase idempoten); bila sebuah halaman **tak terbaca** →
      `UNKNOWN` → **biarkan** penanda (jangan dispatch ulang karena hiccup).
      "Tak terbaca" mencakup `runs` yang **bukan array** (`null`, hilang, objek)
      — `has("runs")` saja meloloskan `{"runs":null}`, lalu `.runs[]` gagal dan
      `length` membaca 0 sehingga run yang mungkin masih berjalan terlihat hilang
      dan didispatch ulang (R226).
      Stub curl uji **wajib mencerminkan API** (abaikan `run_id=`, hormati
      `limit`/`offset`), atau uji hijau terhadap perilaku yang tak ada.
    - Kegagalan dispatch (status 2) dikumpulkan dan menggagalkan langkah
      (non-nol), bukan hijau palsu (R481).
    - `process_one` **tidak** mengosongkan `prev_sig`/`prev_run` untuk penanda
      `pending`: dedup kapasitas membandingkannya, jadi mengosongkan membuat
      sweep kolam-penuh menulis ulang penanda identik tiap kali (menaikkan
      waktu update issue). Cabang hasil-run dilewati untuk `pending` lewat
      kondisi `prev_run != pending` (R402).
    - Workflow menjalankan langkah ini `if: always()` agar kegagalan sweep tidak
      menelantarkannya. Skrip `#!/bin/sh` (dash) — tanpa proses-substitusi;
      hasilnya lewat berkas sementara.

25. **Run yang mati infrastruktur mendapat kesempatan kedua yang terukur**
    (2026-10-15, pengguna; #837). `POST /{id}/dispatch` fire-and-forget: run
    yang mati setelah HTTP 201 hilang tanpa apa pun yang mengulangnya. Riwayat
    run armada memang begitu — mayoritas run `FAILED` terakhir gagal karena
    infrastruktur, bukan isi tugas (`execution/timeout` dominan, disusul
    `environment_unavailable`, `execution_error`, `unknown`). Menambah timeout
    tidak menolong — 1800 s sudah plafon platform (field `timeout` automation),
    jadi kegagalan timeout adalah run yang **hilang**, bukan run yang lambat.
    Dua retrier, keduanya tiap jam:
    - **`automation-retry.sh`** (+ `automation-retry.yml`, menit 47): run
      terakhir sebuah automation **cron** yang gagal infrastruktur di-dispatch
      ulang, maksimum `RETRY_MAX` (2) kali dengan jeda `BACKOFF_MINUTES` (20).
      Percobaan disimpan di **KV store automation** dengan **satu kunci per
      automation** (`retry-<aid>`), tulis optimistis `nx`/`if_version`. Kunci
      per-run id **salah**: `POST /{id}/dispatch` selalu menerbitkan run id
      baru, jadi kunci per-run memberi setiap retry anggaran baru dan rantainya
      tak pernah berhenti — kunci per-automation membatasi seluruh episode.
      Kunci itu **dihapus** saat run terbaru `COMPLETED` (automation pulih,
      kegagalan berikutnya mulai episode baru), dan **klaim ditulis sebelum
      dispatch** — kalah balapan berarti tidak ada dispatch. Dispatch yang
      ditolak **me-rollback** klaimnya agar percobaan tidak terbakar sia-sia.
      Yang kehabisan kesempatan, atau yang **dijeda otomatis** platform
      (penghentian manual dibiarkan), dilaporkan di satu issue
      `automation-health` (ditutup lagi saat kedua daftarnya kosong); satu
      automation yang gagal dibaca membuat seluruh pemindaian **tidak
      mengubah** issue itu — pemindaian tak lengkap bukan bukti gangguan
      selesai. Automation **event** sengaja **tidak** di-retry di sini:
      payload-nya (issue/PR mana) tidak diekspos API runs (`run_metadata`
      `null`, `trigger` event tak menyimpan payload), jadi run ulang buta bisa
      salah sasaran — mereka punya retrier deterministik sendiri
      (`gate-watch.yml`, `issue-triage-bridge.sh`).
    - **`gate-watch.sh`**: re-dispatch gerbang jadi terukur, bukan sekali.
      API runs tidak punya endpoint per-run id dan tidak menyebut PR mana pun
      pada sebuah run, jadi sebuah run **tidak bisa** diatribusikan ke head yang
      memintanya dari API saja — dan run terbaru milik PR lain bisa salah
      menahan atau salah memicu retry. Karena itu skrip **mencatat run id** yang
      ia dispatch di penanda komentar head itu (`<!-- gate-watch-run:<sha>:<id>
-->`) dan membaca status **id itu** kembali; hanya bila head belum punya
      id tercatat ia membaca run terbaru global, dan itu pun hanya untuk tahu
      ada run yang sedang berjalan. Klasifikasi: `RUNNING`/`PENDING` →
      **tunggu**; `FAILED` infrastruktur, run id yang jatuh keluar jendela
      riwayat, belum ada run sama sekali, atau `COMPLETED` yang tidak menulis
      review (gerbang diam — justru kegagalan yang dipantau ini) → dispatch
      ulang sampai `GATE_MAX_ATTEMPTS` (3) per head; `FAILED` non-infrastruktur
      (auth/quota/config) → tidak di-retry. Dispatch ulang aman karena gerbang
      **idempoten** (melewati head yang sudah ditinjau), jadi run ekstra paling
      buruk memakai satu slot sandbox, bukan menulis review yang salah. Riwayat
      run yang **tak terbaca** **tidak** dianggap "tak ada run": dispatch
      dilewati agar tidak menumpuk run pada head yang sudah ditinjau. Listing
      run **ditelusuri** `limit`/`offset` sampai id ditemukan — satu halaman
      saja akan menyebut run yang tergeser ke halaman berikutnya `gone`, dan
      `gone` di-dispatch ulang, sehingga run yang masih berjalan bisa
      diduplikasi. Hitungan percobaan dan
      run id ikut di penanda komentar (`<!-- gate-watch-attempt:<sha>:<n> -->`)
      sehingga bertahan antar-run, dan komentar diperbarui di tempat (PATCH)
      hanya saat teksnya berubah — bukan ditumpuk.
      `gh api --paginate` mencetak **satu array JSON per halaman**, jadi halaman
      harus di-`jq -rs` (slurp) dulu: tanpa itu `attempts` menjadi `"3\n0"`,
      perbandingan angka gagal, dan gerbang bisa di-dispatch ulang tanpa batas.
    - **`set -eu` + pipa ke `while` = subshell**: variabel yang di-set di dalam
      `| while` tidak bertahan setelah loop. Karena itu hitungan percobaan
      disimpan di **penanda komentar**, bukan variabel shell.
    - Pelajaran shell yang sudah menggigit dua kali: `${v:-{...}}` dengan `}`
      literal **menutup ekspansi lebih awal** dan menyisipkan `}` liar ke JSON
      (default harus lewat variabel); dan `jq` `expr as $x | if …` mengikat `as`
      hanya ke operand terakhir — bungkus `(expr) as $x`.
    - Automation yang auto-paused karena kegagalan beruntun (SDLC 14,
      `disabled_reason: "Paused automatically: the last 5 runs all failed and
nothing has succeeded in 24 hours."`) **diaktifkan kembali** dengan
      `PATCH /api/automation/v1/<id>` body `{"enabled":true}`; kelima
      kegagalannya murni infrastruktur. Tidak ada endpoint enable/disable
      terpisah.

26. **Gerbang tinjau berjalan otomatis sekali; sesudahnya tinjauan ulang
    manual** (2026-10-15, pengguna; #837) — **DIGANTIKAN oleh #27 (2026-10-16)**;
    disimpan sebagai riwayat. Dispatch otomatis #727 membuat setiap
    siklus hijau+ready memicu tinjauan lagi, sehingga PR yang sedang diperbaiki
    terus ditinjau tanpa diminta. Aturan baru:
    - `pr-lifecycle.sh` men-dispatch gerbang **hanya** bila gerbang belum pernah
      meninjau PR itu (`.user.login == cipansor-bot` pada **salah satu** review,
      head apa pun). Bila sudah pernah: tidak ada dispatch. Head yang belum
      ditinjau tetapi PR-nya sudah pernah → satu komentar penunjuk
      (`<!-- pr-lifecycle:rereview -->`), "minta tinjauan ulang manual ke
      `cipansor-bot`". Head yang **sudah** ditinjau pada head itu → diam.
    - Jalur `CHANGES_REQUESTED` pada commit lama kini hanya "lanjut", bukan
      "dispatch ulang": keputusan dispatch ada di jalur hijau di atas.
    - Tinjauan ulang diminta lewat `pull_request.review_requested` (pemicu
      gerbang), yaitu mengajukan permintaan tinjauan ke `cipansor-bot`. Itu juga
      memperbaiki keluhan lama "gerbang meninjau sebelum diminta".
    - `gate-watch.sh` hanya menandai head yang gerbang **berutang** pass:
      (a) gerbang belum pernah meninjau PR itu (pass pertama), atau (b) tinjauan
      ulang sudah diminta manual (`requested_reviewers` memuat `cipansor-bot`)
      tetapi belum dijawab. Head yang sudah ditinjau tanpa permintaan baru
      **diabaikan** — dulu ini baris health-issue palsu tiap kali head baru hijau.
      Karena itu daftar PR kini membaca `requested_reviewers`, dan kata pembuka
      komentar membedakan "tinjauan pertama" dari "belum meninjau **ulang**".
    - Jebakan: `gh api --paginate` mencetak **satu array JSON per halaman**;
      `jq -s` (slurp) wajib sebelum `any(.[][]?; …)`/hitungan, kalau tidak
      deteksi "sudah pernah ditinjau" selalu salah (array tunggal pun gagal
      tanpa `-s`).

27. **Gerbang tinjau setiap head siap yang hijau, bukan hanya yang pertama**
    (2026-10-16, pengguna; #837). Aturan #26 (2026-10-15) membuat penulis harus
    meminta ulang secara manual setiap kali ia mendorong head baru, padahal PR
    yang siap memang tugas gerbang. Aturan baru menggantikan #26:
    - `pr-lifecycle.sh` men-dispatch gerbang untuk **setiap head hijau yang
      belum ditinjau pada head itu** (`.user.login == cipansor-bot` pada
      `commit_id == head`). Yang membatasinya adalah idempotensi gerbang sendiri
      (satu review per head): re-run workflow pada head yang sama tidak
      menumpuk run, dan hanya head baru yang memicu dispatch. Penanda
      `<!-- pr-lifecycle:rereview -->` dan pesan "minta tinjauan ulang manual"
      dihapus.
    - `gate-watch.sh` menandai **setiap** head hijau tanpa review gerbang pada
      head itu (bukan lagi hanya pass pertama atau re-review manual). Parameter
      `requested` hanya memilih kata pembuka komentar.
    - `pull_request.review_requested` tetap pemicu gerbang dan permintaan
      tinjauan ke `cipansor-bot` tetap sah, tetapi **tidak lagi wajib** untuk
      head baru.
    - Aturan #840 tetap utuh: tidak ada dispatch pada transisi
      `ready_for_review`; hanya setelah semua check wajib hijau.
    - **Sasaran saat payload kosong: pilih head paling BARU hijau, bukan paling
      lama** (2026-10-16, #837). `POST /{id}/dispatch` tidak punya request body
      (skema OpenAPI menyatakan `requestBody: NONE`; body proporsional apa pun
      dibuang diam-diam — dibuktikan: body `{event:{pull_request:{number:837}}}`
      tak sampai ke agen). Jadi run API-dispatch harus menemukan sasarannya
      sendiri. Aturan awalnya "bila lebih dari satu, pilih head yang paling lama
      hijau"; itu keliru: dispatch `pr-lifecycle` menyala tepat saat satu head
      menjadi hijau, sehingga head yang **baru** hijau itulah yang memicu run
      ini. Dengan "paling lama", setiap dispatch memilih PR basi (diff besar,
      mis. #804 yang hijau sejak 2026-10-14) dan membiarkan head pemicunya
      (#837, hijau 2026-10-16) tak pernah ditinjau; run menelusuri diff basi itu
      berulang sampai plafon 1800 detik dan tak pernah mengirim review. Aturan
      baru: satu PR saja, tiebreak **paling baru hijau**, dan lapor sasaran di
      kalimat pertama sebelum menyelidiki. Ditambah `BATAS PENELUSURAN` (jangan
      ulang baca; ≤ 40 perintah terminal lalu WAJIB kirim review) supaya diff
      besar tak bisa menelan anggaran sebelum review terkirim.

28. **Langkah estimasi DIHAPUS (2026-11-11, pengguna).** `Estimasi usaha`
    (SDLC 02) sudah dilebur ke `Triase issue` (SDLC 15) pada 2026-11-09, tetapi
    langkahnya sendiri kini dibuang sama sekali: pekerjaannya dikerjakan AI, jadi
    ukuran XS–XL dan kalibrasi hanya menambah baris yang dibaca tanpa mengubah
    keputusan. Yang dihapus: butir `- Estimasi usaha (lihat bagian di bawah)` dari
    template komentar triase, seluruh bagian `ESTIMASI USAHA`, dan penanda body
    `<!-- sdlc:estimasi -->`. Butir dan bagiannya hidup di `TAILS["SDLC 15"]`,
    yang **diganti utuh** setiap deploy, jadi mengubah `TAILS` sudah cukup untuk
    keduanya. Yang tidak ikut berubah adalah kalimat di blok BODY
    ("… triase, estimasi, kriteria, dan pertanyaan terbuka …"): blok BODY hanya
    disisipkan saat penandanya belum ada, sehingga prompt live menyimpan salinan
    lamanya. Itu yang dihapus lewat `DROPPED_STEP_TEXTS`. Aturannya: perubahan di
    managed tail mendarat sendiri; perubahan di blok insert-once dan di
    `orig_tail` (prompt tanpa managed tail) butuh substitusi teks.

    **`Estimasi usaha` (SDLC 02) dilebur ke `Triase issue` (SDLC 15)**
    (2026-11-09, pengguna). Estimasi bukan langkah tersendiri: ia bagian dari
    satu komentar triase yang sudah ditulis `Triase issue`. Invarian 3
    (`docs/SDLC-FLOW.md`) dan butir "Triase ganda" pada "Selisih dari keadaan
    sekarang" memang sudah meminta ini sejak awal — SDLC 02 adalah sisa yang
    belum dilebur. Bukti duplikasinya nyata dan terhitung (API, 2026-11-09):
    **21** issue menerima komentar `Estimasi usaha` yang terpisah dari komentar
    triasenya, mis. #955 (estimasi `6730734956` + 5 komentar triase), #951,
    #933, #923, #912. Satu komentar triase bahkan sudah memuat bagian "Estimasi
    usaha" sendiri.
    Alasan tambahan: setiap automation adalah satu slot sandbox dan satu run
    yang bisa mati di plafon 1800 detik — kelas kegagalan dominan armada — jadi
    satu automation lebih sedikit berarti satu sumber kematian lebih sedikit.
    Pelaksanaan: isi prompt SDLC 02 dipindahkan ke tail SDLC 15 sebagai bagian
    `## Estimasi usaha` (tetap menulis `<!-- sdlc:estimasi -->` di body saat
    issue `ready`), entri `TAILS["SDLC 02"]` dihapus, dan SDLC 02 dimasukkan ke
    `RETIRED` di `scripts/deploy-sdlc-agents.py` sehingga deploy berikutnya
    menonaktifkannya lewat `PATCH {enabled:false}` alih-alih men-deploy ulang
    promptnya, apa pun status `enabled`-nya (versi pertama men-deploy ulang
    prompt automation yang sudah nonaktif; diperbaiki dalam tinjauan #968).
    Satu automation lebih sedikit yang aktif; jumlahnya tidak ditulis keras di
    prompt atau dokumen, karena berubah setiap kali armada berubah. Pada saat
    keputusan ini diambil, "Triase ganda" belum selesai seluruhnya: `Triase bug`
    masih berkomentar saat issue dibuka (#848). **Selesai kemudian di hari yang
    sama (2026-11-09):** `Triase bug` (SDLC 01) ikut dilebur ke `Triase issue`
    (SDLC 15) dan masuk `RETIRED`; jembatan triase kini mengarah ke id SDLC 15,
    jadi satu automation menulis satu komentar triase. Dijaga tes
    `automation-fleet.guard.test.ts`.

29. **Pemisahan identitas: `adminypc` menulis, `cipansor-bot` berkomunikasi**
    (2026-11-09, pengguna). Satu akun untuk dua peran adalah cacat: issue dan PR
    baru teratribusi ke `cipansor-bot`, sehingga riwayat repo memperlihatkan bot
    membuka pekerjaannya sendiri, dan label/review yang seharusnya milik bot bisa
    jatuh ke `adminypc` (kelas yang sama dengan #806). Aturan yang berlaku:
    - `GITHUB_TOKEN` (akun `adminypc`) — PENULIS: `POST /issues`, `POST /pulls`,
      push commit. Hanya automation pembuat artefak yang memakainya.
    - `GITHUB_BOT_TOKEN` (akun `cipansor-bot`) — KOMUNIKATOR: semua komentar,
      label, review, reaction.
      Akarnya bukan niat agen, melainkan **prompt**: kalimat "Catatan lingkungan"
      menyuruh memakai token yang tertanam di remote `origin` untuk "operasi baca
      dan tulis apa pun", dan blok IDENTITAS lama hanya menyebut `cipansor-bot`
      tanpa pernah mengatakan token mana yang membuat issue/PR. Keduanya diperbaiki
      di `scripts/deploy-sdlc-agents.py` (`AMBIENT_TOKEN_NOTE` ->
      `IDENTITY_TOKEN_NOTE`, `OLD_IDENTITY_LINE` -> `NEW_IDENTITY_LINE`) supaya
      deploy berikutnya memperbarui seluruh armada. Dua mitigasi ditambahkan
      dalam tinjauan #968: issue/PR dibuat lewat `GITHUB_TOKEN` **tanpa** field
      `labels`, lalu label dipasang lewat `GITHUB_BOT_TOKEN` (label akun lain
      dicabut `label-guard`, #838); dan setiap `PATCH` body issue/PR memakai
      `GITHUB_BOT_TOKEN`, karena suntingan lewat `adminypc` terbaca sebagai
      aktivitas manusia oleh jembatan triase dan `Diskusi`. Masih menunggu
      keputusan maintainer: satu akun manusia (`adminypc`) sekaligus penulis
      armada melemahkan guard anti-loop berbasis penulis dan pemisahan tugas
      (penulis tidak bisa meng-approve PR-nya sendiri); alternatifnya machine
      Catatan: automation yang **tidak** membuat artefak juga memegang
      `GITHUB_TOKEN` (grant otomatis platform), jadi larangan itu harus eksplisit
      di prompt, bukan diasumsikan dari ketiadaan token.

30. **Penomoran ulang armada dibatalkan — dokumen menyebut peran, bukan nomor**
    (2026-11-09, pengguna). #710/#711 (Okt 2026) sudah menomori ulang armada
    01–23, tetapi keputusan yang bertahan dari PR itu adalah bagian lainnya:
    `docs/SDLC-FLOW.md` menyebut automation lewat **peran** (namanya), bukan
    nomor `SDLC NN`. Usulan menomor-ulang lagi — nomor = urutan tahap, sehingga
    `Triase issue` menjadi `06` — **dibatalkan** atas keputusan pengguna.
    Alasan: nomor adalah penanda tampilan yang bergeser setiap kali automation
    ditambah, dilebur, atau dihapus (SDLC 02 baru saja dilebur 2026-11-09),
    sedangkan peran stabil dan sudah menjadi rujukan dokumen serta tes. Dampak:
    jangan mengusulkan penomoran ulang lagi; referensi `SDLC NN` di dokumen
    hanya boleh muncul sebagai **riwayat** (mis. "SDLC 02 dilebur ke SDLC 15"),
    bukan sebagai rujukan normatif. Nama automation di API tetap boleh membawa
    nomor (itu identitasnya di layanan), tetapi dokumen dan tes merujuk peran.

31. **Rollback deploy prompt armada** (2026-11-09, tinjauan PR #968). Deploy
    prompt menyentuh armada **hidup** sebelum PR-nya ditinjau, padahal premis
    #927/#933 justru "perubahan prompt harus lewat tinjauan PR". Bila PR
    ditolak atau berubah, armada dan `main` berselisih, jadi prosedurnya
    ditulis, bukan diingat:
    1. Simpan prompt hidup sebelum deploy (`GET /api/automation/v1` -> JSON
       `name` -> `prompt`). Tanpa ini rollback tidak mungkin.
    2. Bangun ulang dari `main`: `ORIGINALS=<backup.json> DEPLOY=true
OPENHANDS_API_KEY=... python3 scripts/deploy-sdlc-agents.py` — `ORIGINALS`
       mengganti basis, sehingga head dibangun dari prompt asli, bukan yang
       sudah berubah.
    3. Nyalakan kembali automation pensiun: `PATCH /api/automation/v1/{id}`
       `{"enabled": true}` (mis. SDLC 02).
       Pelajaran proses: deploy sesudah PR disetujui, atau tulis rencana rollback
       di body PR bila deploy mendahului tinjauan.

32. **Peran `Pelabel issue` (SDLC 15) berganti nama menjadi `Triase issue`**
    (2026-11-09, pengguna). Nama lama menyebut separuh pekerjaan saja
    ("pelabel"), padahal automation itu **satu-satunya pemilik triase** sejak
    `Triase bug` (SDLC 01) dan `Estimasi usaha` (SDLC 02) dilebur ke dalamnya
    (langkah estimasinya dihapus 2026-11-11):
    keluaran satu komentarnya mencakup tipe, prioritas berbukti, keparahan dan
    sebab, area, kesiapan, dan duplikat (estimasi menyusul dihapus 2026-11-11).
    "Triase" adalah nama yang jujur untuk keseluruhan itu.
    Pelaksanaan: dokumen (`docs/SDLC-FLOW.md`, `docs/LABELS.md`,
    `docs/IDEAS.md`, `docs/COVERAGE.md`), templat issue, dan jembatan triase
    menyebut `Triase issue`; entri `RENAMES` baru di `scripts/deploy-sdlc-agents.py`
    (`apply_rename`) me-`PATCH {name}` automation hidup **di tempat** — id,
    prompt, dan tarball tidak tersentuh — pada deploy berikutnya. Nama API tetap
    membawa nomor (`SDLC 15 · Triase issue`), sesuai butir 30: dokumen merujuk
    peran, layanan menyimpan identitas bernomor.
    Alternatif yang ditolak: "Triase" saja (terlalu pendek, berbenturan dengan
    tahap "Triase" di tabel alur) dan "Pelabel & triase issue" (mengulang dua
    kata untuk satu pekerjaan). Dijaga tes `automation-fleet.guard.test.ts`
    (nama di skrip, ketiadaan nama lama di dokumen, dan idempotensi rename).

33. **Cek maintainer berlaku juga untuk mode `rollback`** (2026-11-10, temuan
    gerbang tinjauan pada PR #972, putaran ke-3; pilihan maintainer #1).
    `.github/scripts/release-gate.sh` menjalankan cek permission aktor hanya
    bila `[ -n "$TAG" ]`, sehingga pada `workflow_dispatch` (rollback) `TAG`
    kosong dan cek itu dilewati. Justifikasinya ("`workflow_dispatch` sudah
    menuntut akses tulis") adalah alasan yang **persis sama** yang gerbang tolak
    untuk jalur tag — di sana ia menuntut `admin`. Karena repo tak punya ruleset
    tag dan environment `production` tak menuntut reviewer, kolaborator
    ber-akses tulis dapat memicu rollback ke SHA `main` lama mana pun dan
    memundurkan produksi tanpa persetujuan maintainer; dengan migrasi maju-saja,
    itu juga bisa meninggalkan skema tak cocok.
    Perbaikan: syarat `[ -n "$TAG" ]` dibuang (cek jalan bila `ACTOR` terisi),
    pesan `fail` bercabang antara "may release" dan "may roll back production",
    komentar blok `0.` dan komentar `deploy-production.yml` diperbarui; tes
    "does not require an admin actor for a rollback dispatch" dibalik menjadi
    penolakan (`refuses a rollback dispatch by an actor without admin
permission`) plus tes positif untuk maintainer. `ACTOR` sudah diisi
    `${{ github.actor }}` untuk kedua peristiwa, jadi tak ada perubahan
    workflow. Alternatif yang tidak dipilih: memasang required reviewers pada
    environment `production` (butuh admin, di luar PR). `docs/SDLC-FLOW.md` dan
    `docs/deploy-azure.md` diperbarui agar syarat ini eksplisit.

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
  (token kedaluwarsa dalam satu jam, izin dan repo bisa dipersempit; riset untuk
  rencana App butir 15 yang dibatalkan 2026-10-15) —
  <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app>

## 2026-11-10 — `ready` and `blocked` are mutually exclusive; `bug-hunter` retired

The owner ruled that `ready` and `blocked` must never sit on the same issue, and
that the `bug-hunter` label is not wanted. Both were true before this date: 29
open issues carried `ready`+`blocked` and 7 carried `bug-hunter`, every one of
them applied by `cipansor-bot`. The triage owner created the conflict itself —
`label-guard.sh` enforced `ready` against `question`/`needs-info`/
`pending-maintainer` but not `blocked`, and the `SDLC 15` prompt never named it.
**Adding a new exclusive label means updating the triage prompt in the same
change; otherwise the automation keeps violating its own rule.**

Which label is withdrawn: always `ready`, never `blocked`. `blocked` carries the
stronger information, withdrawing it would claim the issue can start again, and
`stale-sweep.sh` keeps `blocked` exempt from automatic closing so a blocked
issue does not disappear on its own.

`bug-hunter` was the `Pemburu bug` provenance label. Removing the label from the
repository is not enough: `POST /repos/:o/:r/issues/:n/labels` **creates** a
label that does not exist, so a live prompt that still applies it resurrects it
on the next run. Delete the label _and_ strip the mention from the prompt
(`scripts/deploy-sdlc-agents.py`). `SDLC 15` keeps one mention — the sentence
forbidding it.

Deployed and verified on 2026-11-10: `SDLC 15 · Triase issue` (renamed from
`Pelabel issue`) and `SDLC 19 · Pemburu bug`.

## 2026-11-11 — taksonomi label dirampingkan; pengawas otomatis dipensiunkan

Pemilik memutuskan (dilaksanakan 2026-11-11):

- **`needs-info` dan `pending-maintainer` dihapus.** `question` menampung
  keduanya: "sedang dibahas" dan "ini pertanyaan, bukan perubahan". Timer
  `needs-info` (20 hari) ikut pindah; peringatan kini 8 hari, penutupan 15.
- **`bot-implement` dihapus; `ready` sendiri adalah serah-terima.**
  `Tiket jadi PR` (SDLC 06) kini cron harian **08:00 WIB** (`0 8 * * *`,
  `Asia/Jakarta`): memindai antrean `ready` terlama dulu, membuka paling banyak
  `DAILY_PR_MAX` = 3 PR per run. Jam itu dipilih karena kuota sandbox pulih
  07:00 WIB dan slot 09:00 sudah milik `Pemburu bug` — dua automation tidak boleh
  berbagi slot cron. Konsekuensinya `label-guard` tidak punya pengecualian
  keputusan manusia lagi.
  - **Trigger harus lengkap, bukan fragmen.** `PATCH {trigger}` memvalidasi dan
    mengganti trigger sebagai satu objek: `{"filter": …}` saja dijawab `422
    union_tag_invalid`, dan cron yang digabung ke event menyisakan `source`/
    `filter` lama. Rewrite 2026-11-11 meninggalkan `{"on": ["schedule"]}` —
    bukan trigger sama sekali (`schedule` bukan tipe event GitHub) — sehingga
    SDLC 06 akan diam begitu di-deploy. `target_trigger()` kini melengkapi
    fragmen dari trigger live, dan mengirim cron sendirian saat jenisnya
    berganti (ditemukan 2026-11-11 saat audit armada).
- **`automation` dan `github_actions` dihapus** (tak ada lagi yang memakainya).
- **`deploy-watch`, `gate-watch`, `automation-retry` dan SDLC 23
  `Pengawas armada` dipensiunkan.** Skrip, workflow, dan guard test-nya dihapus;
  label `automation-health` ikut. Pemilik mengawasi OpenHands Cloud dan tab
  Actions langsung, dengan email GitHub sebagai saluran peringatan.
  Label `deploy-watch` dan `watchdog-repair` dihapus dari repo 2026-11-11.
  **Urutan penting:** workflow `deploy-watch.yml` masih hidup di `main` (hanya
  terhapus di branch ini) dan memanggil `ensure_label` setiap run, jadi label
  `deploy-watch` akan **dibuat kembali** sampai penghapusan itu mendarat di
  `main`. `watchdog-repair` yatim total (nol rujukan di kode dan dokumen, nol
  issue) sehingga aman dihapus kapan saja.
- **Form issue dipecah per tipe** (`bug_report`, `enhancement`,
  `documentation`, `refactor`, `chore`, `security`), masing-masing memasang
  label tipe yang cocok — menggantikan `feature_request.yml` tunggal.

### Pelajaran: serah-terima stateful butuh langkah acknowledgement

`bot-implement` adalah **sinyal sekali pakai** (pemilik memasang, automation
memakai, run berikutnya tak punya sisa). `ready` adalah **keadaan**. Automation
yang membaca antrean keadaan wajib mengeluarkan item itu dari antrean di run
yang sama, atau run berikutnya mengambil ulang pekerjaan yang sudah ada PR-nya.

Bug #857/PR #878 memperlihatkan bentuk lain dari lubang yang sama: prompt
membuka PR **draf** lalu berhenti — tidak ada yang menandainya siap ditinjau,
dan gerbang tinjau hanya menunggu PR non-draf, jadi PR itu menganggur 19 hari
sampai manusia menandainya. Issue-nya pun tetap `ready`. Perbaikannya: SDLC 06
memindahkan issue `ready` → `in-progress` **dan** memanggil
`POST /pulls/<n>/ready_for_review`, menyisakan draf hanya bila pekerjaan
benar-benar belum selesai. Rinciannya di
`lessons/handoff-stops-one-step-short.md`.

### Yang masih menggantung

Tidak ada prompt yang menggantung per 2026-11-11: deploy susulan sudah
dijalankan dan diverifikasi terhadap state live (lihat di bawah).

**Deploy 2026-11-11 dijalankan.** Armada live kini 15 ON / 9 OFF dan cocok
dengan `RETIRED`: SDLC 01/02/03/11/13/17/21/23 + `Audit Kematangan` mati. Tiga
trigger yang menyaring label terhapus diperbaiki (SDLC 06 → cron 08:00 WIB,
SDLC 16/22 → `question`). Semua prompt aktif kini nol penyebutan label yang
sudah dihapus.

**Deploy ulang 2026-11-11 (susulan, setelah tinjauan PR #1045).** Tiga perubahan
mendarat dan diverifikasi dengan membaca balik state live:
`SDLC 22 · Diskusi` → filter maintainer (`author_association` OWNER/MEMBER/
COLLABORATOR), `SDLC 16 · Penjernih issue` → filter pelapor (kebalikannya),
`SDLC 06 · Tiket jadi PR` → prompt baru (paginasi `&page=2`, `in-progress`,
`ready_for_review`). Sebelumnya kedua filter 16/22 identik, jadi satu balasan
maintainer menjalankan dua agen. `deploy-watch` dan `watchdog-repair` tetap
hilang dari repo, dan workflow `deploy-watch` di
`main` belum berjalan lagi sejak penghapusan label — label akan dibuat ulang
begitu run berikutnya jalan, sebelum PR #1045 mendarat.

Prompt automation yang **pensiun/OFF** masih menyebut label terhapus dan
langkah estimasi (9 automation: `Audit Kematangan`, SDLC 01/02/03/11/13/17/21/
23). Itu memang disengaja: `apply_retire` hanya mematikan, tidak menulis ulang
prompt, karena tail-nya sudah dilipat ke automation lain dan redeploy akan
menghidupkan lagi komentar duplikatnya. Jangan "membersihkan" prompt mati itu.


**Cacat yang baru ketahuan saat deploy: pola substitusi label tidak cocok.**
`LEGACY_LABEL_TEXTS` mencocokkan kalimat kepemilikan label yang berakhir di
"`bot-implement` adalah keputusan maintainer — jangan pernah memasangnya.",
padahal teks live menyebut tiga label: "`bot-implement`, `rilis-disetujui`,
`rilis-ditolak` adalah keputusan maintainer — jangan pernah memasangnya."
Akibatnya pola tidak pernah cocok dan ketiga label itu **selamat di 19 prompt
aktif**. Lebih parah, tail beberapa automation masih *menyuruh memasang* label
terhapus (SDLC 05 `needs-info`, SDLC 09/20 `pending-maintainer`, SDLC 12
`bot-implement`) — dan `POST /issues/<n>/labels` **membuat** label yang tidak
ada, jadi run berikutnya akan menghidupkan kembali label yang sengaja dihapus.
Perbaikannya: `LEGACY_LABEL_TEXTS` diperluas ke kalimat penuh, dan
`DELETED_LABEL_TEXTS` baru menambal rujukan label di tail (juga mengganti
`Pelabel issue` → `Triase issue`). Pelajaran umum: **setiap substitusi teks
harus diuji terhadap prompt live yang sebenarnya, bukan terhadap teks yang
kita harap ada** — dan itu berlaku untuk head maupun tail.

**Drift live vs repo (audit 2026-11-11) — SUDAH DITUTUP oleh deploy di atas.**
Empat automation yang sudah `RETIRED` ternyata masih `enabled` di cloud (SDLC
01, 03, 13, 17) dan tiga trigger masih menyaring label yang sudah dihapus (SDLC
06 `bot-implement`, SDLC 16 `needs-info`, SDLC 22
`pending-maintainer`/`needs-info`). `Audit Kematangan` dimatikan manual
2026-11-10 tanpa entri `RETIRED`; kini tercatat. Karena `enabled` dan `trigger`
hanya berubah lewat `PATCH`, **audit armada harus membandingkan state live
dengan repo setiap kali**, bukan mempercayai repo.

**Kuota sandbox membatasi armada.** Banyak run `SKIPPED` dengan alasan `daily_sandbox_limit`, jadi automation yang konfigurasinya benar pun bisa jarang benar-benar bekerja. Kegagalan sunyi ini lebih sering menjelaskan "armada tidak jalan" daripada cacat konfigurasi: **jangan menilai kesehatan armada dari `enabled` saja — hitung dulu run yang `SKIPPED`.** Angka, automation terdampak, dan cara menaikkan kuota ada di memory mesin, bukan repo publik, karena memuat rincian operasional insiden — lihat aturan "sensitive" di `AGENTS.md`.

**Pesan yang menyatakan sebuah aturan bisa hidup lebih lama daripada aturannya.**
`bot-implement` dihapus 2026-11-11 dan `label-guard.sh` berhenti memperlakukannya
khusus, tetapi kalimat di komentar pencabutannya masih berbunyi "Label keputusan
manusia (`bot-implement`) tetap boleh dipasang manual" — pemilik menemukannya di
#1046. Logika dan pesan diperbarui di dua tempat berbeda, jadi perubahan aturan
harus diikuti `grep` atas **bunyi pesannya**, bukan hanya atas logikanya. Pesan
barunya menyebut jalur yang nyata (`@cipansor-bot`), karena "sebutkan apa yang
Anda inginkan" tidak menyebut kanal apa pun dan seolah label dipasang atas
permintaan langsung — padahal SDLC 07 yang mengubah sebutan menjadi label atau
issue.

Tiga temuan lain dari ronde yang sama, semuanya cacat nyata:

- `visual-evidence.sh` tidak mengenali header tabel bercetak tebal
  (`| **Sebelum** | **Sesudah** |`), sehingga kolomnya jatuh ke label prosa di
  atasnya dan pengingat muncul padahal buktinya lengkap; `side_of` kini
  memangkas `*`, `_`, dan backtick.
- Pencocokan media peka huruf besar-kecil setelah pindah dari `grep -iE` ke
  `awk`, jadi `.PNG`/`.JPG` terhitung nol; setiap baris/k sel kini di-`tolower`
  sebelum dicocokkan.
- `pr-template-guard.sh` menerima issue `in-progress` yang juga `blocked` atau
  `question`. `label-guard` hanya mencabut `ready`, jadi pasangan itu bisa
  berdampingan; `question`/`blocked` kini diperiksa lebih dulu dan menang.

**Pesan harus sadar izin penerimanya, dan izin bukan asosiasi.** Pesan
pencabutan dikirim ke siapa pun yang memasang label terlindungi, tetapi
`MENTION_FILTER` (SDLC 07) menyaring lewat `comment.author_association` — bukan
lewat izin repo. Dua kesalahan berturut-turut di sini:

1. Versi pertama menyuruh **semua** penerima menyebut `@cipansor-bot`, padahal
   pelapor luar tidak akan diproses: sebutannya gagal `COLLABORATOR`.
2. Versi kedua memperbaiki itu tetapi memakai `admin|maintain|write` sebagai
   daftar orang dalam. `triage` **adalah** izin yang cukup untuk memasang label,
   dan kolaborator `triage` tetap ber-asosiasi `COLLABORATOR`, jadi ia justru
   dialihkan dari jalur bot yang terbuka untuknya. Daftarnya kini
   `admin|maintain|write|triage`.

**Fakta API yang mahal dipelajari (terverifikasi 2026-11-11):**
`GET /repos/{o}/{r}/collaborators/{user}/permission` menjawab **`read`/`read`**
untuk akun publik yang sama sekali tidak terkait — bukan `none`. `none` hanya
muncul saat `gh api` gagal (mis. 404 saat menjalankan dengan token akun lain).
Jadi penanda "orang luar" adalah `read`, dan mencocokkan `!= none` akan salah
mengklasifikasikan seluruh publik. Karena `triage` bisa muncul di salah satu
field saja, keduanya dibaca dan salah satu cocok sudah cukup.

**Sebelum menulis "lakukan X" di sebuah pesan, periksa filter siapa yang
menerima pesan itu** — dan periksa **jenis** nilainya (izin repo vs asosiasi
komentar), bukan hanya apakah kalimatnya enak dibaca. Tes yang saya tulis untuk
temuan ini ikut salah karena memakai `triage` sebagai contoh "pelapor luar";
tes yang mengunci asumsi salah lebih buruk daripada tidak ada tes.

**Stub yang mengabaikan `--jq` membuat cabangnya tidak teruji.** Stub `gh` di
guard test menjawab satu kata dan mengabaikan `--jq`, jadi tes `triage` versi
pertama hanya membuktikan kasus satu-field dan tidak pernah menyentuh alasan
kedua field dibaca. Stub sekarang mengembalikan objek `{permission, role_name}`
dan menjalankan ekspresi `--jq` yang diminta, sehingga `permission: read` +
`role_name: triage` bisa diuji. Dibuktikan dengan uji mutasi: mengembalikan
skrip sesaat ke `--jq '.permission'` membuat tes itu **gagal** (dialihkan ke
maintainer), lalu dipulihkan. **Stub yang menyederhanakan bentuk respons akan
menyembunyikan cabang yang justru ingin diuji — tiru bentuk respons API-nya.**

Catatan kecil: komentar di dalam template literal stub tidak boleh memakai
backtick; backtick menutup template dan `vite` gagal dengan "Cannot assign to
this expression".

**Detail insiden bocor ke memory repo, lagi.** Catatan tentang label 404 dan
waktu run terakhir workflow (jam, nomor run, nomor issue) ditulis ke
`.claude/memory/` padahal `AGENTS.md` menyebut "incident details" eksplisit
sensitif; peninjau menandainya. Angka-angka itu dihapus dari repo (pelajarannya
tetap, angkanya tidak) dan hanya hidup di memory mesin. Pola yang sama sudah
pernah terjadi sebelumnya dengan kuota sandbox: **menulis hasil observasi live
terasa seperti pengetahuan, tetapi jam dan nomor run adalah detail insiden.**
