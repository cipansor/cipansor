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
    Prompt dan tarball runner 24 automation diperbarui lewat
    `scripts/deploy-sdlc-agents.py` (idempoten; `main.py`/`setup.sh` tidak
    disentuh).

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
