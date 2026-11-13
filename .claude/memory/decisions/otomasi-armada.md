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
    - **Penundaan yang tak bisa ditulis ke checkpoint sweep** (tinjauan #872):
      bila `read_sweep_marker` gagal (`MARK_FORM=unknown`) saat kolam penuh dan
      tidak ada checkpoint `pending`, jalur label dulu tidak menulis apa pun —
      pada issue `ready` itu menghilangkan satu-satunya kesempatan triase (sweep
      mengecualikan `ready`; `recover_ready` hanya membaca checkpoint yang ada).
      Kini penundaan disimpan di `triage-retry-<n>` (`{signal, at}`), dan
      `drain_retry_markers` — dijalankan di awal `sweep` **dan** `recover_ready`
      — melipatnya kembali ke checkpoint `pending` sebelum kandidat dibaca. `at`
      yang lebih tua menang, jadi slot FIFO tak tergeser; kunci retry dihapus
      setelah lipatan berhasil. **Koreksi tinjauan (2026-11-12, putaran kedua):**
      drain tidak boleh membuang retry selama checkpoint masih menyebut sebuah
      run (in-flight atau belum difinalkan). Sinyal checkpoint hanya menghitung
      body dan komentar, **tidak** label, sehingga run yang didispatch sebelum
      label masuk — mis. run lama pada issue `ready` — memfinalkan issue tanpa
      meninjau label itu; retry dibiarkan sampai run keluar (`run` dikosongkan
      oleh pass yang memfinalkannya), lalu dilipat menjadi `pending` dan
      didispatch. Dijaga tes round-trip tiga pass (in-flight → selesai → kuras).

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

34. **Sweep triase mengantre FIFO menurut penundaan pertama** (2026-11-11,
    pengguna; `K25`, #872). Sweep memilih kandidat dari pencarian `sort=updated
    order=desc` dan hanya meloloskan `MAX_INFLIGHT` (default 3) per run. Setelah
    penanda pindah ke KV store (#1031), penulisan `pending` **tidak lagi**
    menyentuh issue, jadi `updated_at`-nya membeku: issue yang ditunda tenggelam
    ke dasar `updated desc` dan **tidak pernah** naik ke jendela sweep selama
    aktivitas baru terus mengambil slot — kelaparan head-of-line (bukti: #850,
    #851, #852, penandanya berbunyi "menunggu" tapi nol triase ~4 hari).
    Perbaikan (pilihan maintainer): checkpoint `pending` menyimpan **waktu
    penundaan pertama** (`at`, epoch detik; checkpoint lama tanpa `at` dihitung
    paling tua, `0`), dan sweep mengambil kandidat dari **dua sumber** — store
    (semua checkpoint `pending`, urut `at` menaik) **lebih dulu**, lalu
    pencarian aktivitas. Satu issue = satu baris (kemunculan pertama menang),
    jadi slot FIFO-nya tak digeser aktivitas yang tak bergerak. Menulis ulang
    `pending` mempertahankan `at` (penundaan berulang tak mereset antrean).
    Alternatif yang ditolak: hanya memperbarui `updated_at` saat menunda
    (menyentuh issue lagi, justru yang dihindari migrasi KV) dan batas umur
    penundaan yang mendispatch paksa (menabrak `MAX_INFLIGHT`/kolam sandbox).
    Dijaga `automation-fleet.guard.test.ts` (tiga sweep berturut-turut dengan
    ekor yang sama lalu ekor itu maju; urutan tertua-dulu; penundaan berulang
    mempertahankan `at`).
    **Koreksi tinjauan (2026-11-12).** Dua cacat yang ditemukan reviewer gerbang
    pada FIFO ini: (i) `pending_keys` menyerahkan checkpoint `pending` milik
    issue `ready` ke sweep biasa, yang lalu **menghapusnya** (jalur `ready` di
    luar lingkupnya) — padahal `--recover-ready` berjalan *sesudah* sweep dan
    membaca store, jadi dispatch tertunda itu hilang. Perbaikan: jalur `ready`
    hanya menghapus checkpoint yang **selesai** (`run` kosong, `MARK_FORM=some`);
    yang `pending`/in-flight dibiarkan untuk `recover_ready`. (ii) kegagalan baca
    KV di jalur label (`read_sweep_marker` → `unknown`) membuat `at` diisi ulang
    `now`, menggeser issue yang lama menunggu ke belakang antrean. Perbaikan:
    saat `MARK_FORM=unknown`, checkpoint dibiarkan apa adanya. Dijaga dua tes
    round-trip baru (sweep → `--recover-ready`; hiccup baca KV).

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

**PR draf tidak terlihat oleh gerbang — dan tidak ada yang menua-kannya.**
Insiden yang memicu konsolidasi 2026-11-12: sebuah PR dibuka sebagai **draf**,
CI-nya hijau, tetapi tidak ada satu pun yang memindahkannya ke siap-ditinjau.
`pr-lifecycle.sh` sengaja **tidak** mengubah draf/siap (itu keputusan maintainer),
dan `Tiket jadi PR` yang membukanya berhenti setelah draf. Akibatnya PR itu
diam sampai manusia menandainya siap, dan issue-nya tetap `ready` (antrean
menganggapnya belum dikerjakan). Dua pelajaran tetap:

1. **"Siap ditinjau" adalah langkah yang harus dimiliki seseorang.** Membuka draf
   lalu berhenti berarti pekerjaan yang mati diam bila uji sudah hijau. `Tiket
   jadi PR` kini menaikkan PR-nya sendiri ke siap-ditinjau saat uji lokal hijau
   dan kriteria terpenuhi; draf tetap menjadi jalan keluar bila belum.
2. **Klaim issue tidak boleh bergantung pada prompt LLM.** Memindahkan `ready`
   → `in-progress` kini deterministik (`.github/workflows/issue-claim.yml`), bukan
   instruksi di prompt: satu langkah, satu pemilik, sehingga keadaan label tidak
   bisa berselisih antara dua penulis.

**Balasan maintainer sudah ditangani jembatan triase.** `Diskusi` (SDLC 22)
mengawasi balasan maintainer pada issue `question` lewat `issue_comment.created`,
padahal `issue-triage-bridge.sh` **sudah** mendispatch `Triase issue` pada setiap
aktivitas non-armada — termasuk balasan maintainer. Dua pemilik untuk satu
komentar berarti dua run sandbox dan dua balasan untuk satu pertanyaan; `Diskusi`
dipensiunkan dan perannya masuk ke tail `Triase issue`.

**QA bukan pemilik terpisah.** `Peninjau kode` (SDLC 08) dan `Otomasi QA`
(SDLC 10) sama-sama menulis putusan per head, sehingga satu head bisa menerima
dua review yang berselisih. Keduanya dilebur ke `Gerbang tinjau PR` (SDLC 18):
satu gerbang meninjau kode **dan** menilai alur yang berubah (membaca berkas tes
dan check-run E2E, bukan `pnpm install`, karena anggaran waktu melarangnya).
Hasil QA hidup di bagian `<!-- sdlc:gerbang -->` yang sama, bukan `sdlc:qa`.

**Diagnosis kegagalan `main` tidak butuh LLM.** `Pemantau deployment` (SDLC 12)
dipensiunkan: `main-failure-bridge.yml` kini membuka **satu issue per workflow**
lewat `.github/scripts/main-failure-report.sh` (deterministik, tanpa
`OPENHANDS_API_KEY`), dan maintainer membaca penyebabnya dari tab Actions. Pola
"peringatan deterministik, penilaian manual" yang sama dengan `stale-sweep` dan
`docs-drift`.

**Gerbang tidak menulis "putusan akhir".** Pemilik menandai satu judul bagian di
deskripsi PR ("Gerbang tinjau — putusan akhir", PR #1033, 2026-11-12): putusan
gerbang adalah **rekomendasi**, bukan kata terakhir — merge tetap milik
maintainer, dan bahasa yang menyebut dirinya final membuat bot tampak memutuskan
sendiri. Aturan itu tidak hanya untuk gerbang: ia hidup di `BODY_BLOCK`
bersama (deploy script), sehingga SETIAP automation terikat — satu automation
lain pun pernah memberi judul komentarnya "putusan akhir". Prompt SDLC 18
menambahkan penegasannya (pakai "putusan tinjauan"/"putusan gerbang", judul
`## Gerbang tinjau — putusan (head <sha>)`), dan satu guard test menolak frasa
itu kembali ke prompt mana pun. Aturan tetap: **kata-kata yang memberi bot
wewenang yang bukan miliknya adalah cacat, bukan gaya bahasa.**

**Pintu masuk PR: issue `ready` dulu, dan itu ditolak bila tidak ada.** Pemilik
meminta (2026-11-12) agar AI yang diminta membuat PR memeriksa lebih dulu: bila
belum ada issue, arahkan membuat issue dulu, dan **tolak keras** membuka PR tanpa
issue berlabel `ready`; issue maupun PR wajib mengikuti templat dan ketentuan
SDLC. Sebelumnya aturan ini hanya hidup sebagai **penegakan** — `PR description`
merah, dan gerbang repo menolak merge — tanpa satu pun tempat yang memberi tahu
agen apa yang harus dilakukan **sebelum** mencoba. Penegakan yang benar tetapi
tak terbaca sebelum percobaan hanya menghasilkan PR merah, bukan penolakan.

Rumahnya dipilih sesuai `AGENTS.md` → "Where things live":

- **Aturan** — aturan emas 6 `AGENTS.md` ditulis ulang: "PR selalu lahir dari
  issue terbuka dan `ready`", dengan penolakan eksplisit sebagai jawaban yang
  benar, bukan celah yang dilewati.
- **Prosedur** — skill baru `.claude/skills/buat-pr/SKILL.md` (langkah: cari
  issue → belum ada, buat lewat formulir dan tunggu `Triase issue` memasang
  `ready` → tolak bila belum layak → isi templat → buka draf → naikkan saat
  hijau). Ia juga memuat isian templat PR dan aturan `Fixes #<n>`.
- **Penegakan** — tetap `pr-template-guard.sh` (tidak berubah); guard test
  `pr-description.guard.test.ts` memaku skill-nya (ada, ada frontmatter, memuat
  penolakan, memuat setiap bagian templat).
- **Klasifikasi CI** — `.claude/skills/*/SKILL.md` kini "code" di
  `change-scope.sh`, karena satu guard test membacanya; tanpa itu perubahan pada
  skill dilewati CI dan `change-scope.guard.test.ts` merah.

Dua hal yang **sengaja tidak** dilakukan: memasang `ready` sendiri (itu wewenang
`Triase issue` — memasangnya sendiri persis cacat yang aturan ini cegah), dan
memakai `Refs`/PR tanpa tautan sebagai jalan keluar.

### Deploy 2026-11-12 dijalankan — repo sudah memutuskan, cloud belum tahu

Pemilik menemukan SDLC 08/10/12/22 **masih ada** di OpenHands Cloud padahal
keputusan 2026-11-12 sudah menetapkan pensiun. Sebabnya bukan keputusan yang
belum dibuat: entri `RETIRED`-nya sudah ada di repo (PR #1057), tetapi **skrip
deploy belum pernah dijalankan** — `RETIRED` hanya berlaku sesudah
`DEPLOY=true`. Selama itu, repo dan cloud berbeda dan cloud-lah yang menjalankan
perilaku lama.

Setelah `DEPLOY=true` dijalankan 2026-11-12: armada live **11 ON / 13 OFF**, dan
tidak ada satu pun kunci `RETIRED` yang masih ON. Empat automation yang diminta
pemilik (SDLC 08/10/12/22) kini `off`. Empat prompt juga naik ke versi PR
(SDLC 06/15/16/18), masing-masing diverifikasi masih memuat `BODY_BLOCK` dan
tail-nya (dibaca balik dari API, bukan dari tarball lokal).

**Pelajaran.** Keputusan di repo tidak mengubah cloud. `enabled` dan `prompt`
hanya berubah lewat `PATCH`, jadi pertanyaan "apakah automation X masih ada?"
hanya dijawab `GET /api/automation/v1` — bukan dengan membaca repo. Sama seperti
catatan audit 2026-11-11, **audit armada harus membandingkan state live dengan
repo setiap kali.**

### SDLC 16 · Penjernih issue dipensiunkan 2026-11-12 (opsi (a))

Keputusan 2026-11-12 semula mencakup SDLC 08/10/12/22 saja; **SDLC 16 sempat
dipertahankan** karena desainnya memang membagi klarifikasi kepada dua pemilik
(docs/SDLC-FLOW.md, tabel alur baris 3): `Penjernih issue` untuk balasan
**pelapor**, `Triase issue` untuk balasan **maintainer**. Filter trigger-nya
sengaja berlawanan sejak 2026-11-11 — SDLC 16 menyaring
`comment.author_association != OWNER/MEMBER/COLLABORATOR` (hanya pelapor),
sedangkan filter SDLC 22 yang pensiun justru sebaliknya (hanya maintainer).

**Namun pembagian itu ternyata tidak berlaku di lapangan.** Sweep jembatan
triase memilih `repo:$REPO is:issue is:open -label:ready`
(`.github/scripts/issue-triage-bridge.sh`). Issue `question` tidak `ready`, jadi
**ikut tersapu**, dan sinyal aktivitasnya memuat setiap komentar non-armada —
termasuk balasan pelapor. Akibatnya satu balasan pelapor pada issue `question`
membangunkan **dua** agen: SDLC 16 (pemicu `issue_comment.created`) dan SDLC 15
(dispatch jembatan). Itu cacat "satu komentar, dua pemilik" yang sama persis
dengan yang memensiunkan SDLC 22, hanya di sisi pelapor.

**Keputusan pemilik 2026-11-12: opsi (a)** — pensiunkan SDLC 16 dan serahkan
balasan pelapor ke SDLC 15 lewat jembatan (konsisten dengan SDLC 22). Opsi (b)
(kecualikan issue `question` dari sweep) ditolak: jembatan sudah menangani kedua
sisi, dan "satu pemilik per langkah" adalah invarian armada.

Yang berubah: entri `RETIRED["SDLC 16"]`, tail `SDLC 16` dihapus dari `TAILS`,
entri `TRIGGERS["SDLC 16"]` dihapus, dan tail SDLC 15 mendapat bagian `BALASAN
PELAPOR`. Karena `RETIRED` hanya berlaku saat deploy, **SDLC 16 tetap hidup di
cloud sampai `DEPLOY=true` dijalankan** — pola yang sama dengan temuan deploy
sebelumnya.

### SDLC 04 · Peninjau arsitektur dipensiunkan 2026-11-12 (keputusan pemilik)

Diminta pemilik 2026-11-12: "cek automate `Bot sebutan` (SDLC 07) dan `Peninjau
arsitektur` (SDLC 04), apa masih diperlukan, karena sudah lama tidak digunakan."
Temuan atas SDLC 04 jauh lebih keras daripada "jarang dipakai": **pemicunya tidak
pernah bisa menyala**.

- Pemicunya `pull_request.opened` + filter `pull_request.draft == `false`` +
  judul memuat design/rfc/arsitektur/adr. Tapi `Tiket jadi PR` (SDLC 06) **selalu**
  membuka PR sebagai **DRAF**, dan promosi draf memancarkan `ready_for_review` —
  bukan `pull_request.opened`. Jadi filter `draft == false` tak pernah cocok
  untuk satu pun PR armada.
- Bukti run: seumur hidupnya **satu** run (2026-10-07), dan run itu sendiri
  menyebut PR #669 sebagai "placeholder architecture note … safe to delete" —
  smoke test. Judul PR seumur repo: 2 untuk `design` (keduanya sekitar smoke
  test), 0 untuk `rfc`/`arsitektur`/`adr`.
- Pemicunya **tidak pernah dikelola `TRIGGERS`** di deploy script (hanya 07/06/18
  yang ada) — hidup hanya di cloud, melanggar prinsip "satu sumber kebenaran".

**Keputusan pemilik 2026-11-12: opsi (a) — pensiunkan.** Peran tinjauan desain
**tidak** dipindahkan: `Gerbang tinjau PR` (SDLC 18) sudah meninjau setiap PR
non-draf termasuk dokumen desain, dan maintainer membaca dokumen desain langsung.
Opsi (b) — perbaiki pemicu jadi `pull_request.ready_for_review` + tambah peran
tinjau desain ke SDLC 18 — ditolak karena menambah cakupan ke gerbang yang sudah
punya anggaran waktu ketat tanpa kebutuhan nyata.

Yang berubah: hanya entri `RETIRED["SDLC 04"]`. Tidak ada tail untuk dihapus
(SDLC 04 tak pernah punya entri `TAILS`) dan tidak ada trigger untuk dihapus (tak
pernah ada di `TRIGGERS`). Karena `RETIRED` hanya berlaku saat deploy,
**SDLC 04 tetap hidup di cloud sampai `DEPLOY=true`** — pola yang sama dengan
SDLC 16. Deploy 2026-11-12 menjalankannya: `disabled (retired)`, live 9 ON/24.

**Pelajaran verifikasi:** `search/issues?q=@cipansor-bot` (1053 hasil) dan
`q=cipansor-bot` (378) mencocokkan **body** & dokumen, bukan komentar — angka
besar itu menyesatkan. Pemakaian sebutan harus dihitung dari
`GET /issues/<n>/comments` dan disaring `user.login`. Dengan cara itu: 5 komentar
sebutan manusia seumur repo (semua `adminypc`), terakhir 2026-11-03.

### SDLC 07 · Bot sebutan — DIPERTAHANKAN 2026-11-12

Diperiksa bersama SDLC 04; keputusan pemilik: pertahankan (belum diputuskan
eksplisit soal tumpang tindih jembatan triase). Ia kanal **on-demand**, bukan
yang diharapkan jalan tiap hari, jadi "jarang dipakai" bukan alasan pensiun.
Angka "40 run, 15 gagal" menyesatkan: ~25 run terjadi 10-07..10-14, **sebelum
guard penulis** (ditetapkan 2026-10-14) — masa bot saling membalas. Pasca-guard
ia menyala ~1× per sebutan nyata (5 sebutan manusia seumur repo). Kegagalannya
mayoritas infrastruktur (`Sandbox not available`, timeout).

Tumpang tindih yang dicatat, belum diputuskan: sinyal aktivitas jembatan triase
memuat setiap komentar non-armada, jadi sebutan `@cipansor-bot` pada issue
terbuka non-`ready` membangunkan SDLC 07 **dan** SDLC 15 — kelas "satu komentar,
dua pemilik" yang sama dengan SDLC 16/22.

### 2026-11-12 · PR menua + klaim yang tak bergantung event + identitas `cipansor-bot`

Tiga celah yang ditutup bersama (issue #927, lanjutan #857).

**1. Klaim issue bergantung 100% pada event.** `issue-claim.yml` memindahkan
`ready` → `in-progress` hanya saat event `pull_request`/`issues` datang. Bukti
empiris: `Issue claim` punya **49 run** dan nol run `pull_request` setelah
15:16Z, padahal `Issue label sync`/`E2E Tests`/`PR lifecycle` menyala di
commit & branch yang sama (PR #1075, head `eb5cb2f0`) — jadi bukan YAML rusak
(byte-identik dengan `main`, GitHub menyajikan YAML yang sama, workflow
`active`). Dua PR yang tidak pernah dapat run tetap bocor (`ready` bertahan):
#1075→#877, #1062→#845, #1060→#818. Perbaikan: **sapuan rekonsiliasi harian**
`issue-claim.sh --sweep` (`gh pr list --json isCrossRepository,closingIssuesReferences`)
yang menurunkan klaim dari **keadaan**, bukan dari event. Pelajaran: pemicu
event saja bukan jaminan; setiap gerbang wajib punya jalur sapuan idempoten.

**2. `stale-sweep` hanya menyasar issue.** Kini PR ikut menua, **tanpa label
apa pun** (taksonomi tak punya `stale` untuk PR; `duplicate-pr` milik otomasi
lain): PR tanpa issue → peringatan lalu tutup 5 hari; PR ber-issue → timer diam
(peringatan 90 hari, tutup 104). Draf & PR bot (Dependabot) dilewati. Aktivitas
yang mengakhiri siklus: komentar manusia, dan — khusus PR ber-issue — commit
head baru; push **tidak** mengulur siklus "tanpa issue" karena cacatnya tetap.
Butuh `pull-requests: write` (ditambahkan).

**3. Identitas `github-actions[bot]`.** Semua workflow komunikator (12 berkas)
kini `GH_TOKEN: ${{ secrets.CIPANSOR_BOT_TOKEN || github.token }}`. **Nama
secret tidak boleh berawalan `GITHUB_`** (422) → dipakai `CIPANSOR_BOT_TOKEN`.
Yang **tetap** `github.token`: `issue-label-sync` (menerbitkan check-run),
`ci`/`e2e`/`deploy` (hanya membaca; jalur `pull_request` dari fork tak bisa
melihat secret). Guard baru di `automation-fleet.guard.test.ts` mengunci
pembagian ini.

**Konsekuensi aman yang diperiksa:** `label-guard` mengecualikan `*[bot]`, jadi
tak ada pencabutan; `issue-triage-bridge` mencocokkan `*bot`/`*[bot]` (bukan
login spesifik); `stale-sweep`/`duplicate-sweep` menganggap `cipansor-bot`
bukan manusia (perilaku benar). **Koreksi 2026-11-12 (review PR #1077):** klaim awal saya salah. Secret yang
**tidak ada** dan secret yang **kosong** sama-sama menghasilkan string kosong di
ekspresi Actions, jadi `|| github.token` tetap memilih token bawaan — workflow
**tidak** gagal, identitasnya saja yang mundur ke `github-actions[bot]`. Jadi
fallback ini memang membuat identitas bot "best effort", bukan jaminan: bila
secret hilang, armada tetap jalan tapi menulis sebagai bot platform. Yang benar
untuk diwaspadai: kegagalan senyap, bukan crash.

## 2026-11-11 — #838: `label-guard` yang mencabut memicu pelabelan ulang (mode `--relabel`)

**Masalah.** `label-guard.sh` hanya *mencabut* label yang dipasang akun non-bot
dan tidak memasang penggantinya. Bila yang dicabut adalah label tipe/prioritas,
issue berakhir tanpa keduanya — keadaan yang lebih buruk daripada label yang
salah, karena triase, prioritas, dan pelabelan PR semuanya membaca label.
`Pelabel issue` dan `Triase issue` hanya dipicu `issues.opened`; jembatan triase
hanya `labeled`; dan komentar pencabutan ditulis bot sehingga dikecualikan dari
sinyal aktivitas. Tidak ada yang menutup celahnya.

**Opsi B tidak bisa dipakai apa adanya — `unlabeled` dari `label-guard` tidak
akan pernah memicu workflow apa pun.** `label-guard.yml` mencabut dengan
`GITHUB_TOKEN` otomatis (`${{ github.token }}`), dan GitHub **tidak memulai run
workflow untuk event yang dibuat token itu** (aturan anti-rekursi). Terverifikasi
di repositori ini: dari ~100 run terakhir, **nol** ber-aktor
`github-actions[bot]`, padahal `label-guard`, `basmalah`, dan `issue-label-sync`
semuanya menulis lewat token itu. Jadi trigger `on: issues: [unlabeled]` adalah
kode mati — persis jebakan "presence is not function" di
`lessons/guard-tests-that-measure-the-wrong-thing.md`.

**Yang dipilih.** `label-guard.yml` memanggil mode baru `--relabel <n>` di
**run yang sama**, tepat setelah guard, hanya bila guard benar-benar mencabut
sesuatu (`steps.guard.outputs.revoked == '1'`, ditulis `label-guard.sh` ke
`$GITHUB_OUTPUT`), dan hanya untuk issue (PR tidak punya celah ini — labelnya
disinkronkan dari issue yang ditutup). `label-guard.sh` tetap murni
deterministik; jembatan tetap satu-satunya dispatcher. Mode `--relabel`:
membaca label sisa (`remaining_labels`, gagal-baca = lewati, bukan "kosong"),
men-dispatch hanya bila tipe **atau** prioritas hilang, dan menciutkan burst
pencabutan dengan kunci per-issue + jendela `BURST_WINDOW` (kunci terpisah dari
jalur `labeled`: keduanya tidak boleh saling menciutkan). Kunci per-jendela,
bukan per-himpunan-sisa, karena grup concurrency `label-guard.yml` per-label —
run-nya berlomba dan masing-masing bisa melihat himpunan sisa yang berbeda.

**Alternatif yang ditolak.** Opsi A (guard men-dispatch langsung lewat API
OpenHands) menaruh logika dispatch di dalam guard dan menggandakan jalan dispatch
yang sudah dimiliki jembatan; opsi C (maintainer boleh melabeli) adalah
keputusan kebijakan terpisah yang tetap menunggu pemilik — perbaikan celah ini
tidak menunggunya.

**Pelajaran operasional.** Sebelum merancang pemicu antar-workflow, periksa
**token apa** yang dipakai penulis event: event dari `GITHUB_TOKEN` otomatis
tidak memicu run. Bila butuh rantai, panggil di run yang sama, atau pakai token
non-otomatis (PAT/GitHub App) yang memang memicu.

## 2026-11-12 — #838 (lanjutan): pemulihan label yang dicabut manusia, dan dua cacat jembatan

**Fitur pemulihan.** Setengah kebijakan yang hilang: pencabutan bukan cara
membantah bot. Label yang **terakhir dipasang `cipansor-bot`** lalu dicabut
seorang manusia **dipasang kembali** secara deterministik, tanpa LLM.

- **Pemicu.** `label-guard.yml` kini `types: [labeled, unlabeled]` pada `issues`
  **dan** `pull_request_target`. Berbeda dari pencabutan (yang ditulis
  `GITHUB_TOKEN` dan tak bisa memicu apa pun — lihat bagian #838 di atas), di
  sini yang mencabut adalah **manusia**, jadi event `unlabeled`-nya asli dan
  memicu run. Langkah `--relabel` yang ada tetap **hanya** untuk `labeled`
  dengan gate `steps.guard.outputs.revoked == '1'`; jalur pemulihan tidak
  menulis `revoked=1` (tak ada dispatch jembatan di jalurnya).
- **Keputusan.** Di `label-guard.sh`, cabang `ACTION=unlabeled` →
  `restore_after_revocation`. Lewati bila pencabut `$BOT_LOGIN`/`*[bot]`
  (pencabutan itu sengaja: armada mencabut `ready` yang bertentangan,
  `stale-sweep`, `issue-label-sync`). Baca aktor event `labeled` **terakhir**
  untuk label itu dari `gh api --paginate repos/$REPO/issues/$NUMBER/events`;
  pulihkan hanya bila aktornya bot. **Gagal baca = lewati dengan `::warning::`,
  tidak pernah dianggap "boleh dipulihkan".** Baca label **saat ini** (bukan
  payload) karena grup concurrency per-label membuat run berlomba; bila label
  `ready` dan kini ada `question`/`blocked`, jangan pulihkan (aturan eksklusif
  16). Pulihkan lewat `gh api -X POST .../labels -f "labels[]=$LABEL"`; event
  `labeled` yang dihasilkannya tak memicu workflow (loop tertutup). Satu
  komentar penanda `<!-- label-guard:restored -->` per issue.
- **Kenapa bukan jalur jembatan.** Pencabutan yang meninggalkan issue tanpa
  tipe/prioritas sudah ditangani `--relabel` (dispatch pemilik triase). Pemulihan
  ini kebijakan label yang berbeda dan murni deterministik — tak perlu LLM, jadi
  ia hidup di guard, bukan di jembatan.
- **Penyempurnaan (2026-11-12).** Jalur pemulihan **tidak** memakai
  `protected_labels()` (yang membuang `ALLOWED_LABELS` pada issue), melainkan
  cek "label ada di repo" lewat `gh label list` (`repo_labels()`), tetap melewati
  `EXEMPT_LABELS`. Dengan `protected_labels()`, tipe label yang dipasang bot lalu
  dicabut manusia tak akan pernah dipulihkan — padahal itu justru kasus #838.
  Guard standar tetap memakai `protected_labels()` (tipe label pada issue form
  dibiarkan), jadi kedua paruh kini memakai daftar yang berbeda dan beralasan.
- **Koreksi (2026-11-12, review #1058).** Memakai `repo_labels()` saja
  menciptakan **dua tipe**: bila manusia memasang `enhancement` lalu mencabut
  `bug` milik bot, pemulihan menaruh kembali `bug` → issue punya `bug` +
  `enhancement`, dan `issue-label-sync.sh` menolaknya ("more than one type"),
  sehingga PR yang menutup issue itu gagal sinkron. Karena itu jalur pemulihan
  kini: (a) bila label adalah **tipe** (`TYPE_LABELS`, default = `ALLOWED_LABELS`)
  dan issue memuat tipe **lain**, **jangan** pulihkan — tulis
  `type_conflict=1` ke `$GITHUB_OUTPUT`; (b) `label-guard.yml` memanggil mode baru
  `issue-triage-bridge.sh --type-conflict <n> <tipe-ditolak>`, yang men-dispatch
  pemilik triase (pemilik taksonomi) untuk mencabut tipe yang salah. Ini menjaga
  singleton tipe (docs/LABELS.md aturan 1). Bila label bukan tipe (mis.
  `priority:*`) atau tipe yang sama sudah kembali, jalur pemulihan biasa tetap
  berjalan.
- **Koreksi kedua (2026-11-12, review #1058 putaran 2).** Awalnya mode konflik
  memakai kunci collapse `UNLABELED_KEY` yang sama dengan `--relabel`. Akibatnya
  bila pencabutan memicu `--relabel` (mis. prioritas kosong) lalu pergantian tipe
  menyusul dalam `BURST_WINDOW` (300 dtk), `--type-conflict` membaca waktu
  `--relabel` dan **menganggap konflik sudah ditangani** — padahal `--relabel`
  hanya mengisi celah, bukan merekonsiliasi tipe. `activity_signal` tak mencatat
  label, jadi sweep pun melihat checkpoint lama "selesai". Tipe salah bertahan →
  sinkronisasi PR gagal. Perbaikan: kunci collapse **terpisah**
  (`CONFLICT_KEY="triage-conflict-"`), dan konflik yang ditunda menulis checkpoint
  `pending` yang sama sehingga sweep (atau `--recover-ready` pada issue `ready`)
  memulihkannya.
- **Koreksi ketiga (2026-11-12, review #1058 putaran 3).** Karena kunci burst
  kini terpisah, `--relabel` dan `--type-conflict` dapat men-dispatch untuk issue
  yang sama; keduanya menulis satu checkpoint `triage-sweep-<n>`, sehingga run
  yang ditulis belakangan menimpa ID run yang lebih dulu. `process_one` hanya
  membaca satu ID yang tersisa, jadi bila run konflik gagal lalu run relabel
  selesai, sweep menandai issue selesai dan konflik tak pernah diulang.
  Perbaikan: tiap respons sisi disimpan di slotnya sendiri
  (`extra.relabel`, `extra.conflict`), dan `process_one` memeriksa **semua** slot
  sebelum menandai issue selesai (ada yang RUNNING → tunggu; ada yang gagal →
  dispatch ulang; semua COMPLETED → bersihkan). `--recover-ready` memakai
  `MARK_ACTIVE`/`MARK_PENDING` yang dihitung dari semua slot.

**Bug 1 (severe) — dispatch gagal membuat issue tetap tanpa label.**
`relabel_after_revocation` tidak menulis checkpoint sweep saat dispatch gagal.
Sweep berikutnya lalu membandingkan sinyal aktivitas issue dengan checkpoint
yang **basi atau tidak ada**: bila sinyalnya kebetulan sama dengan yang akan
dihitung, issue terbaca "sudah dijawab" dan **tak pernah dicoba ulang**. Perbaikan:
tulis checkpoint `pending` (bentuk yang sama dengan deferral `MAX_INFLIGHT`)
sebelum gagal; `pending` tidak menamai run, jadi sweep berikutnya men-dispatch.
`process_one` sudah memperlakukan `PENDING_RUN` sebagai "perlu dicoba ulang", jadi
tak perlu diubah.

**Bug 2 — `refactor`/`security` terbaca sebagai tipe yang hilang.**
Penentuan `has_type` memakai uji awalan `case "$left" in none|priority:*)`. Karena
himpunan digabung `+` dan **terurut**, `priority:high+refactor` dan
`priority:high+security` cocok `priority:*` → dibaca tanpa tipe → dispatch palsu.
Ganti dengan pemeriksaan keanggotaan per elemen
(`case "+$left+" in *"+refactor+"*|… )`).

**Bukti.** `automation-fleet.guard.test.ts`: **203 passed**. Golden rule 7
dibuktikan dengan memulihkan `.github/scripts/label-guard.sh`,
`.github/scripts/issue-triage-bridge.sh`, dan `.github/workflows/label-guard.yml`
ke `HEAD` sementara tes baru tetap ada: **10 tes gagal** (pemulihan label,
gate `unlabeled`, `refactor`/`security`, checkpoint `pending`), lalu hijau setelah
perubahan dipulihkan. Tes pemulihan tipe label (`bug`) juga dibuktikan gagal
dengan `protected_labels()` dan hijau dengan `repo_labels()`; tes konflik tipe
(manusia mencabut `bug`, issue memuat `enhancement`) dibuktikan gagal tanpa
penjaga konflik dan hijau dengannya; tes kunci konflik terpisah dibuktikan gagal
saat memakai `UNLABELED_KEY` dan hijau dengan `CONFLICT_KEY`; tes slot run sisi
(`extra`) dibuktikan gagal (7 tes) saat `issue-triage-bridge.sh` dipulihkan ke
`HEAD` dan hijau dengannya. Seluruh 68 berkas guard `src/utils/`: **1155
passed**.

## 2026-11-13 — jembatan triase: penjaga siklus hidup + pemicu peristiwa (#1083, #1084)

Keputusan pemilik (dari #1083/#1084, dicatat di issue):
`blocked` **tetap** ditriase; hanya `in-progress`/`ready` yang dikecualikan dari
triase otomatis. Balasan pelapor pada issue `ready`/`in-progress` tidak memicu
triase otomatis. Satu-satunya pengecualian: sebutan `@cipansor-bot` oleh
maintainer, yang memicu triase spesifik sesuai isi komentar dan boleh mengubah
tipe/prioritas/kesiapan. Balasan maintainer **tidak** menembus `MAX_INFLIGHT` —
mengantre seperti kandidat lain, karena menembusnya membuat kolam sandbox tak
stabil. `stale` yang masih terbuka tetap ditriase; komentar pelapor pada
`question` tetap memicu.

Akar yang diperbaiki:
1. **Kueri kandidat sweep** hanya `-label:ready`, jadi issue `in-progress`
   (#851) tetap ditriase penuh. Kini `-label:ready -label:in-progress`, dan
   `process_one` menolak `in-progress` juga (kueri hanya prefilter; label yang
   tak terlihat kueri — issue yang baru dilabeli ulang — tetap ditolak di sana).
2. **Tidak ada pemicu peristiwa** untuk komentar/suntingan. Kini workflow
   berlangganan `issue_comment: [created]` dan `issues: [labeled, edited]`,
   dengan job `activity` memanggil `--comment`/`--edited`. Sweep tetap jaring
   pengaman. Bukti masalah: 7 balasan maintainer 01:45–01:47Z ditunda sweep
   #1466 ("deferred, 3 triage run(s) already in flight") karena `MAX_INFLIGHT=3`
   vs antrean ~40 (dispatch 3,3,2,6,6 vs defer 36,35,40,41,41).

Penjaga baru di `issue-triage-bridge.sh`: `in_lifecycle_state` (label status
`ready`/`in-progress`; baca gagal = lewati, bukan dispatch),
`maintainer_mention` (komentar non-armada **terakhir** dari
OWNER/MEMBER/COLLABORATOR yang memuat `@cipansor-bot`; sebutan lama tak membuka
gerbang selamanya), `on_activity` (anti-loop `*bot`/`*[bot]`, lewati PR,
`changes.body` saja untuk `edited`, burst collapse via `ACTIVITY_KEY`
`triage-activity-<n>` dengan `BURST_WINDOW`, deferral `pending` saat cap penuh).
Jalur `--relabel`/`--type-conflict` **tidak** dijaga siklus hidup: keduanya
memperbaiki label, bukan memulai triase.

Uji: `automation-fleet.guard.test.ts` **242 passed** (110 untuk
`issue-triage-bridge.sh`), termasuk penjaga baru. Stub `gh` ditambah dua cabang
(status-label dan `author_association`) yang harus mendahului pola `select((`
(activity signal), kalau tidak keduanya tertelan.

## 2026-11-13 — gerbang tinjau dikunci, label siklus hidup dilepas saat tutup (#1083)

Dua sisa kriteria penerimaan #1083 (gejala 4 dan 5); gejala 1–3 sudah ditutup
oleh perubahan sebelumnya di berkas ini.

**Gerbang tinjau ganda pada satu SHA.** Pemeriksaan "sudah ditinjau?" di
`pr-lifecycle.sh` adalah baca-lalu-tulis: dua run pada detik yang sama
sama-sama membacanya sebagai "belum ditinjau" lalu keduanya men-dispatch
(PR #1052: 3× `APPROVED` pada `eeda681f`). Grup concurrency workflow tidak
menutupnya — kuncinya per PR dengan `cancel-in-progress: false`, jadi run kedua
mengantre dan tetap berjalan. Kini dispatch diklaim di KV store automation
(`review-gate-<PR>-<HEAD>`): `nx=true` saat belum ada, `if_version` saat
memperpanjang; yang kalah menerima 409 dan tidak men-dispatch. Klaim menyimpan
`{at, attempt}`: dispatch yang mati di infrastruktur dicoba ulang
(`REVIEW_GATE_ATTEMPT_MAX=3`), klaim yang gerbangnya masih berjalan dibiarkan
(`REVIEW_GATE_STALE_MIN=45` menit), dan dispatch yang gagal melepas klaimnya
supaya re-request langsung mencoba lagi. Store tak terjangkau tidak mengganjal:
klaim best-effort, gagal-baca/gagal-tulis jatuh ke perilaku lama dengan warning.
Endpoint store bisa ditimpa lewat `GATE_API` — itu yang dipakai harness uji,
karena `pr-lifecycle.sh` sebelumnya **tidak punya** harness sama sekali.

**Label siklus hidup tertinggal saat tutup.** Tidak ada workflow yang memicu
`issues: closed`, jadi `ready`/`in-progress` menempel di 136 issue tertutup.
`lifecycle-cleanup.sh` (+ `lifecycle-cleanup.yml`) melepas keduanya: satu
`gh issue edit` dengan `--remove-label` per label (bentuk yang sama dengan
`issue-claim.sh`; dua panggilan bisa mati di antaranya dan menyisakan satu
label). Hanya kedua label itu yang dilepas — `stale`/`question`/`duplicate` dan
tipe/prioritas tetap sebagai catatan alasan tutup. Karena pencabutannya oleh
`cipansor-bot`, `label-guard.sh` tidak pernah mengembalikannya. Selain pemicu
`issues: closed` ada sapuan harian (`--sweep`) untuk backlog 136 issue itu dan
untuk tutup yang event-nya tak sampai; sapuan gagal bila daftarnya tak terbaca,
supaya "tak ada yang tersisa" tidak pernah salah lapor.

Uji: `automation-fleet.guard.test.ts` **255 passed** (9 uji baru; keempat uji
klaim gerbang dan kelima uji cleanup **gagal** pada kode sebelum perbaikan).
Harness `pr-lifecycle.sh` baru: stub `gh` per-field (`GH_STUB_PR_*`,
`GH_STUB_CHECKS`, `GH_STUB_REVIEWS`) plus stub `curl` yang menyimulasikan KV
store (`nx`/`if_version` → 409). Jebakan yang tertangkap: komentar di dalam
template literal stub `gh` tak boleh memakai backtick mentah — parser oxc
memutuskannya di tengah string.
