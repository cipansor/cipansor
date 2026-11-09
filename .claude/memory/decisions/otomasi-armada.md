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
    dan PR tetap akun pengguna maintainer yang dipakai otomasi penulis, dan
    `cipansor-bot` tetap akun penyetuju, karena approval dari akun ber-izin
    write terbukti dihitung ruleset. Rencana memindahkan penulis ke GitHub App
    `cipansor-contributor-bot` **dibatalkan pemilik pada 2026-10-15** (#781
    ditutup *not planned*): tidak ada App yang perlu ditunggu atau dibangun.
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
