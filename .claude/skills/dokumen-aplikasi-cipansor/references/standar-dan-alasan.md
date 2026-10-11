# Standar yang dipakai, dan alasannya

Riset dilakukan 2026-09-28, diperiksa dan diperbarui 2026-09-29, diperiksa ulang
2026-09-30 terhadap sumber resminya, atas pertanyaan: dokumentasi aplikasi seperti
apa yang dianggap praktik terbaik untuk (a) dokumen teknis dan (b) panduan
pengguna, pada sistem seukuran Cipansor — monorepo dengan puluhan modul,
dikembangkan tim kecil, dipakai belasan keluarga peran, repo publik sampai rilis.

Baca berkas ini bila pengguna bertanya "kenapa formatnya begini", atau bila harus
memilih antara dua cara menyusun. Untuk *cara mengerjakan*, buka
`dokumen-teknis.md` dan `panduan-pengguna.md`.

> **Catatan edisi standar.** Sebutan standar di sini memakai edisi yang berlaku
> pada 2026: **ISO/IEC/IEEE 26514:2022** (diterbitkan 2022-01, menggantikan
> `26514:2008` yang ditarik; ISO menandainya *Edition 1*, tetapi ia edisi
> pertama dari judul *Design and development of information for users* — edisi
> 2008 memakai judul *Requirements for designers and developers of user
> documentation*). Edisi 2022 menambah subpasal tentang **API dan chatbot**
> sebagai sasaran informasi bagi pengguna, hal yang relevan di sini karena repo
> punya modul chatbot dan `docs/MOBILE_API.md`. Keluarga 2651x lengkapnya: 26511
> (manajer), 26512 (pengadaan), 26513 (penguji/peninjau), 26514
> (perancang/pengembang), 26515 (lingkungan tangkas), 26516 (video
> instruksional), 26531 (manajemen konten). Yang dipakai skill ini hanya 26514,
> sebagai daftar periksa mutu. Sumber diperiksa ulang 2026-09-30 pada
> iso.org/standard/77451.html.

## Ringkasan pilihan

| Kebutuhan | Dipakai | Bukan format, melainkan | Kenapa cocok untuk Cipansor |
|---|---|---|---|
| Kerangka dokumen teknis | **arc42** (12 bab) | kerangka bab | Gratis, ringan, dipakai luas, tiap bab menjawab satu pertanyaan pembaca. Tim kecil bisa mengisi bab yang perlu dan menulis "tidak berlaku" pada yang tidak. Sudah ada tempat untuk *keputusan* (bab 9) dan *risiko & utang teknis* (bab 11), dua hal yang paling sering hilang. arc42 sendiri menyarankan bab 1 memuat **tujuan mutu**, bukan daftar kebutuhan. |
| Menggambar arsitektur | **Model C4** (Context → Container → Component) | cara menggambar | Tiga tingkat zoom yang bisa dibaca pengurus (tingkat 1) sampai pengembang baru (tingkat 3). Tingkat 4 (kode) tidak digambar: kodenya sendiri sumbernya. C4 dan arc42 saling melengkapi — diagram C4 masuk ke bab 3 (konteks), 5 (kontainer/komponen), 6 (dinamis), 7 (penempatan). |
| Menyimpan alasan keputusan | **ADR** (catatan keputusan arsitektur) | isi bab 9 | Repo sudah melakukannya di `.claude/memory/decisions/`. Dokumen *merangkum dan menautkan*, tidak menulis ulang alasannya. Satu ADR = satu keputusan; yang tergantikan tidak disunting, melainkan diberi catatan pengganti (arc42 tip 9-5/9-6). |
| Pemeriksa kelengkapan dokumen teknis | **IEEE 1016 / ISO/IEC/IEEE 42010** (deskripsi rancangan, sudut pandang) | daftar periksa | Bab 5–8 arc42 sudah mencakup sudut pandang yang diminta: struktur, perilaku saat berjalan, penempatan, konsep lintas-bidang. Dipakai untuk memastikan tak ada sudut pandang yang terlewat, bukan sebagai format. |
| Menata panduan pengguna | **Diátaxis** (tutorial · panduan tugas · rujukan · penjelasan) | pemisah jenis isi | Orang membuka panduan dengan empat niat berbeda: belajar dari nol, menyelesaikan satu tugas, mencari fakta, memahami alasan. Mencampurnya membuat panduan tebal dan sulit dipakai. Diátaxis adalah *peta dan kompas*, bukan format wajib: yang penting satu halaman satu jenis. |
| Cara menulis tiap topik | **Penulisan berbasis topik + minimalisme (Carroll)** | disiplin menulis | Topik kecil yang berorientasi tugas mengalahkan narasi panjang yang "menjelaskan semuanya". Pembaca sibuk tidak membaca pendahuluan; mulai dari prosedur, potong basa-basi, dan jadikan kesalahan sebagai hal yang bisa dipulihkan (kartu tugas punya bagian "Bila tidak berhasil"). Ini yang membuat satu kartu tugas utuh dan pendek. |
| Isi & mutu panduan pengguna | **ISO/IEC/IEEE 26514:2022** (rancangan & pengembangan informasi untuk pengguna) | daftar periksa | Meminta dokumentasi berangkat dari analisis pengguna dan tugasnya (bukan dari daftar menu), memuat unsur lazim (pendahuluan, prosedur, penanganan masalah, glosarium), memakai istilah yang konsisten, dan **diuji pada pembaca sungguhan** (26513 mengatur pengujiannya). |
| Struktur informasi untuk dipakai (produk/sistem) | **IEC/IEEE 82079-1:2019** (penyusunan *information for use*) | daftar periksa pelengkap | Standar payung yang dipakai 26514:2022 sebagai acuan normatif. Ia menuntut informasi yang **lengkap tetapi tidak berlebih**, berorientasi tugas, dan menempatkan **keselamatan/pemulihan dari kesalahan** sebagai bagian prosedur — sejalan dengan "Bila tidak berhasil" di kartu tugas. Dipakai untuk menimbang *kelengkapan* isi, bukan format. |
| Menjaga dokumen tetap ramping | **Dokumentasi ramping (agile/lean)** | sikap kerja | "Cukup, tidak berlebih": dokumentasikan konsep yang stabil, bukan gagasan spekulatif; jangan salin apa yang sudah punya satu sumber; perbarui hanya bila perlu. Selaras dengan aturan repo "angka dari kode" dan "rangkum, jangan salin". |
| Cara mengelola berkas | **Docs-as-code** | praktik kerja | Dokumen dekat dengan kode, ditulis dalam Markdown, angka dihitung dari kode. Sesuai dengan cara repo ini bekerja dan menekan dokumen basi. |

## Cara tiap standar diterapkan

### arc42 → dokumen teknis
Dua belas bab: (1) Pendahuluan & tujuan, (2) Batasan, (3) Konteks & lingkup,
(4) Strategi solusi, (5) Tampak blok bangunan, (6) Tampak runtime, (7) Tampak
penempatan, (8) Konsep lintas-bidang, (9) Keputusan arsitektur, (10) Persyaratan
kualitas, (11) Risiko & utang teknis, (12) Glosarium. Pemetaan ke sumber di repo
ada di `dokumen-teknis.md`. Sumber resmi: arc42.org.

### C4 → diagram
- **Tingkat 1, Konteks:** Cipansor sebagai satu kotak; di sekelilingnya orang
  (peran) dan sistem luar (surel, WhatsApp, Turnstile, penyedia model bahasa).
  Untuk pengurus yayasan dan donor.
- **Tingkat 2, Kontainer:** hal yang berjalan sendiri — web, API, basis data,
  Redis, penjadwal. Untuk pengelola sistem.
- **Tingkat 3, Komponen:** isi satu kontainer — lapisan modul API
  (routes → controller → service → schema) dan pengelompokan modul menurut
  ranah. Untuk pengembang.
- Tulis diagram sebagai **Mermaid** dalam Markdown: bisa disunting, dibanding
  per baris di git, dan dirender GitHub. `build_docs.py` mengubahnya menjadi
  gambar untuk `.docx`. Sumber resmi: c4model.com.

### Diátaxis → panduan pengguna
| Jenis | Pertanyaan pembaca | Wujud di panduan Cipansor |
|---|---|---|
| Tutorial | "Saya baru, ajari saya" | Bagian *Mulai*: masuk, mengenal dasbor & menu, ganti kata sandi, keluar |
| Panduan tugas | "Bagaimana saya melakukan X?" | *Kartu tugas* per peran (Tujuan → Jalur menu → Langkah → Hasil) |
| Rujukan | "Apa arti/isi X?" | Glosarium, arti status, daftar peran, pesan galat |
| Penjelasan | "Mengapa begitu?" | Konsep singkat: persetujuan berjenjang, hak akses per peran, privasi data santri |

Aturannya: **satu halaman, satu jenis.** Kartu tugas tidak berisi ceramah konsep;
konsep ditautkan. Sumber resmi: diataxis.fr.

### ISO/IEC/IEEE 26514:2022 → mutu panduan
Dipakai sebagai daftar periksa mutu, bukan format:
- disusun dari **tugas pengguna**, bukan dari menu (cf. `panduan-peran` di repo);
- ada pendahuluan (siapa pembaca, cara memakai panduan), prosedur, penanganan
  masalah, glosarium;
- **istilah konsisten** dengan layar (nama tombol persis; *santri*, bukan *murid*,
  di panduan portal);
- prosedur **dicoba** pada aplikasi/pembaca sungguhan sebelum dinyatakan selesai
  (pengujiannya diatur standar saudaranya, 26513);
- ada riwayat revisi dan basis versi aplikasi.

Edisi 2022 secara eksplisit memasukkan **API dan chatbot** sebagai informasi yang
ditujukan kepada pengguna. Terapannya di sini: kontrak API yang dibaca klien
(dokumentasi mobile di `docs/MOBILE_API.md`) dan jawaban chatbot dianggap
"informasi untuk pengguna" yang tunduk aturan kejelasan dan konsistensi istilah
yang sama — bukan sekadar artefak teknis.

### IEC/IEEE 82079-1:2019 → kelengkapan isi
82079-1 adalah standar **horizontal** (semua jenis produk); 26514:2022 adalah
standar **vertikal** untuk perangkat lunak dan secara eksplisit "based on the
requirements applicable to all types of products in IEC/IEEE 82079-1:2019" —
82079-1 satu-satunya acuan normatifnya. Yang diambil dari 82079-1 sebagai daftar
periksa:
- **Lengkap, tetapi tidak berlebih** — pengguna menemukan apa yang ia butuh untuk
  tugasnya tanpa harus membaca yang tidak relevan. Di sini: buklet per peran,
  bukan satu buku raksasa; satu kartu satu tugas.
- **Pemulihan dari kesalahan masuk prosedur**, bukan lampiran terpisah. Di sini:
  bagian "Bila tidak berhasil" pada tiap kartu.
- **Prosedur langkah demi langkah** sebagai bentuk baku untuk tugas yang berurutan
  (82079-1 menyebutnya *step-by-step instructions*). Di sini: "Langkah." bernomor
  pada tiap kartu.
Yang **tidak** diambil: persyaratan keselamatan produk, pelabelan, dan
pernyataan kesesuaian — dokumen ini dokumentasi perangkat lunak internal, bukan
lembar instruksi produk. Sumber: IEC/IEEE 82079-1:2019 (cancels IEC 82079-1:2012).

### Minimalisme (Carroll) + penulisan berbasis topik → cara menulis
Bukan kerangka bab, melainkan cara menulis **di dalam** tiap bab dan kartu:
- **Mulai dari prosedur.** Pembaca yang sibuk tidak membaca pendahuluan; bagian
  "Mulai" boleh panjang, tetapi kartu tugas langsung ke langkah.
- **Satu topik, satu tujuan.** Satu kartu = satu tugas dalam istilah kerja
  pembaca; jangan mencampur penjelasan konsep ke dalam kartu (konsep ditautkan).
- **Kesalahan adalah bagian dari topik.** Bagian "Bila tidak berhasil" bukan
  tambahan; ia yang membuat pengguna pulih tanpa bertanya.
- **Jangan menjelaskan yang bisa ditemukan sendiri.** Potong pengantar basa-basi
  dan pengulangan; pembaca belajar dengan mencoba.

### Dokumentasi ramping (agile/lean) → menjaga dokumen tetap hidup
- Dokumentasikan **konsep yang stabil**, bukan gagasan spekulatif; yang bergerak
  cepat cukup ditautkan ke sumbernya (kode, Swagger, `decisions/`).
- **Jangan salin** apa yang sudah punya satu rumah; salinan adalah dokumen yang
  berikutnya basi.
- **Perbarui hanya bila perlu** — tetapi bila angka bergeser, ukur ulang dan
  bangun ulang; jangan menyunting angka di dalam `.docx`.

## Yang sengaja tidak dipakai

- **SRS penuh (IEEE 830 / ISO/IEC/IEEE 29148).** Sistem dibangun bertahap;
  kebutuhan hidup di `roadmap.md` dan `decisions/`. Dokumen teknis cukup
  memuat *tujuan dan kebutuhan kualitas utama* (arc42 bab 1 dan 10). SRS penuh
  akan basi sebelum selesai dicetak.
- **Diagram UML lengkap tiap kelas.** Ratusan model dan puluhan modul: hasilnya tak
  terbaca dan berubah tiap PR (angka pastinya diukur `collect_facts.py`, bukan ditulis di sini). Cukup ERD tingkat ranah (kelompok model), dengan
  skema Prisma sebagai rujukan tunggal.
- **Salinan daftar endpoint.** Sumbernya Swagger dan kode; salinan pasti basi.
  Dokumen menautkan ke sana dan menyebut *cakupannya* (berapa modul
  beranotasi), apa adanya.
- **Salinan pohon menu.** Menu berubah tiap PR menu. Panduan menulis jalur menu
  per tugas, dicetak dari kode pada saat penulisan.
- **Panduan satu buku raksasa untuk semua peran.** Ada belasan keluarga peran
  dengan tugas berbeda. Diterbitkan sebagai **bagian umum + buklet per keluarga
  peran**, supaya guru tidak membaca bab bendahara.

## Pemeriksaan ulang 2026-09-30

Riset diulang atas tiga pertanyaan: apakah pilihan kerangka masih sesuai standar
berlaku, apakah C4 tingkat 3 masih layak dirawat, dan apakah ada konvensi baru
yang pantas diikuti. Hasilnya:

- **arc42 tetap 12 bab** (arc42.org/overview; contoh arc42-by-Example). Tidak ada
  perubahan struktur; bab 1 tetap memuat *tujuan mutu* lebih dulu, bukan daftar
  kebutuhan. Versi terbit saat ini **v9 (Juli 2025)** — penomoran bab tidak
  berubah sejak v8; yang bertambah hanya terjemahan. Dokumen menyebut versinya di
  Lampiran B supaya pembaca tahu acuan mana yang dipakai.
- **C4 — peringatan volatilitas, dari pembuatnya sendiri.** Simon Brown (GOTO
  2026; YOW! 2025) menyarankan memulai dari **dua tingkat teratas** (konteks dan
  kontainer) karena keduanya jarang berubah, sedangkan tingkat 3 (komponen) dan
  tingkat 4 (kode) berubah tiap commit. Terapan kita: dokumen **tetap** memuat
  tingkat 3 karena pembaca utamanya (pengembang baru) membutuhkannya, tetapi
  tingkat itu ditulis sebagai **satu diagram lapisan modul**, bukan tiap kelas,
  dan tingkat 4 sengaja **tidak** digambar. Bila nanti terbukti cepat basi, yang
  diturunkan adalah tingkat 3, bukan tingkat 1–2.
- **Konvensi baru 2026: `llms.txt` / `llms-full.txt` / `agents.md`.** Masing-masing
  kini lazim: `llms.txt` (berkas ringkas di akar domain, 10–50 tautan terpilih
  beranotasi) untuk situs; `llms-full.txt` untuk isi lengkap; `agents.md` (standar
  Linux Foundation) untuk perilaku agen. **Terapan kita:** `AGENTS.md` sudah ada
  dan sesuai maksudnya; dokumen teknis dan panduan sudah berbentuk Markdown yang
  bisa dibaca agen. `llms.txt` publik **tidak** dibuat: ia fitur **situs web**,
  bukan dokumen aplikasi, dan repositori ini publik sampai rilis — menambah berkas
  akar baru adalah perubahan kode web dengan tesnya sendiri (aturan emas #7/#8),
  di luar lingkup dokumen. Dicatat di sini supaya keputusan itu terlihat, bukan
  terlupa.
- **Docs-as-code — CI memeriksa, bukan manusia mengingat.** Praktik 2026 menuntut
  validasi otomatis (lint, tautan, contoh terhadap API) pada tiap perubahan
  dokumentasi. Terapan kita sudah ada: `check_docs.py`, `scan_sensitive.py`,
  `build_docs.py` memverifikasi hasil. Yang belum: menjalankannya di CI. Selama
  biner tidak dilacak git, dokumen Markdown ditinjau seperti kode lain, dan
  pemeriksa dijalankan sebelum menyerahkan dokumen (lihat `docs/README.md`).
- **IEC/IEEE 82079-1:2019 ditambahkan sebagai acuan pelengkap.** 26514:2022
  menyebutnya normatif; ia menyumbang tiga tuntutan yang sudah dipegang skill ini
  (lengkap-tidak-berlebih, pemulihan dari kesalahan di dalam prosedur, prosedur
  langkah demi langkah) dan menjelaskan **mengapa** buklet per peran lebih benar
  daripada satu buku untuk semua orang. Yang tidak diambil: persyaratan
  keselamatan produk dan pelabelan — ini dokumentasi perangkat lunak internal.

Sumber tambahan yang dikutip di bagian ini: Simon Brown, *The C4 Model* (GOTO
2026, YOW! 2025); llmstxt.org dan laporan adopsi 2026; panduan docs-as-code 2026.

## Pemeriksaan ulang 2026-09-30 (kedua) — perkakas pemeriksa dan edisi standar

Riset diulang atas pertanyaan "sesuai standar praktik terbaik seperti apa", dengan
menyebut perkakas dan edisi terbaru. Hasilnya **tidak mengubah kerangka** (arc42 +
C4 + Diátaxis + ADR + docs-as-code tetap pilihan yang benar); yang diperkuat adalah
*edisi acuan* dan *kesadaran perkakas*:

- **arc42 — v9 (Juli 2025)** tetap 12 bab; v9 menyempurnakan bab 10 (persyaratan
  mutu) dan gambar konsep bab 8, bukan menomori ulang bab. Dokumen menyebut
  versinya di Lampiran B. Sumber: arc42.org/download, github.com/arc42/arc42-template.
- **C4 — Structurizr sebagai acuan model-as-code**, dan **D2 kini mengenal konsep
  C4 bawaan** (`c4-person`, `legend`). Terapan kita tetap **Mermaid di dalam
  Markdown** (bisa disunting, dibanding per baris di git, dirender GitHub, dan
  `build_docs.py` mengubahnya jadi gambar) — Structurizr/D2 tidak ditambahkan karena
  menuntut berkas model terpisah yang menjadi sumber kedua yang bisa menyimpang.
- **ISO/IEC/IEEE 42010:2022** (menggantikan 42010:2011) tetap dipakai sebagai daftar
  periksa sudut pandang (bab 5–8 arc42), bukan format. Sumber: iso.org.
- **ISO/IEC/IEEE 26514:2022** (edisi ketiga) tetap acuan mutu panduan; edisi ini
  secara eksplisit menyebut **API dan chatbot** sebagai saluran informasi pengguna
  — relevan karena repo punya modul `chatbot` dan `docs/MOBILE_API.md`.
- **MADR 4.0.0 (17 September 2024)** adalah versi template ADR terkini (sebelumnya
  bernama "Markdown *Any* Decision Records"; 4.0 menegaskan kembali fokus
  *arsitektural*). Terapan kita: `.claude/memory/decisions/` sudah mengikuti
  semangat satu-keputusan-satu-catatan; dokumen **merangkum dan menautkan**, tidak
  menyalin. Sumber: adr.github.io/madr, changelog MADR.
- **Diátaxis** tetap kerangka hidup yang dirawat Daniele Procida (diataxis.fr,
  github.com/evildmp/diataxis-documentation-framework); tidak ada perubahan empat
  mode. Terapan kita tetap "satu halaman, satu jenis".
- **Perkakas lint/verifikasi docs-as-code 2026** yang lazim: **Vale** (gaya bahasa,
  gaya prosa), **markdownlint** (struktur Markdown), **lychee** (tautan mati, ada
  GitHub Action), **cspell** (ejaan), **textlint** (aturan teks). Repo ini **tidak**
  memasangnya; ia memakai pemeriksa sendiri (`check_docs.py`, `scan_sensitive.py`,
  `build_docs.py`, `scripts/check-doc-refs.py`) karena yang perlu diperiksa bukan
  gaya prosa melainkan **kecocokan klaim dengan kode** (rute, angka, label layar,
  nama model) — hal yang tidak diperiksa Vale/lychee. Perkakas itu tetap dicatat
  sebagai opsi bila nanti dokumen tumbuh dan butuh pemeriksa ejaan/tautan otomatis.

Sumber yang dikutip di bagian ini: arc42.org/download; c4model.com; structurizr.com;
d2lang.com/blog/c4; iso.org (42010:2022, 26514:2022); adr.github.io/madr +
changelog; diataxis.fr; errata-ai/vale, lycheeverse/lychee, markdownlint,
streetsidesoftware/cspell, textlint.org.

## Pemeriksaan ulang 2026-09-30 (ketiga) — edisi masih berlaku, pemeriksa baris Lampiran A

Riset diulang lewat web untuk memastikan tidak ada edisi standar yang berganti
sejak pemeriksaan pagi hari, dan untuk menimbang satu kelas cacat yang baru
terjadi. Hasilnya **tidak mengubah kerangka**; yang bertambah adalah satu
pemeriksa dan satu catatan.

- **arc42 — v9 (Juli 2025) masih versi terbit**; arc42.org/download menyebut v9
  menambah terjemahan (ZH, HU Mei 2026) tanpa menomori ulang 12 bab. Situs arc42
  kini menonjolkan **docs-as-code** sebagai cara pakai yang disarankan ("treat
  your architecture documentation like source code", template AsciiDoc/Markdown,
  direview lewat pull request, dibangun dengan docToolchain) — persis cara skill
  ini bekerja. Tidak ada bab baru yang perlu ditambah.
- **C4 — tak ada edisi bernomor**, tetapi pesan pembuatnya tetap: mulailah dari
  dua tingkat teratas karena tingkat 3–4 paling cepat basi (Simon Brown, *The C4
  model: misconceptions, misuses and mistakes*, DDD Europe 2025). Terapan kita
  tidak berubah: tingkat 3 dipertahankan sebagai satu diagram lapisan modul,
  tingkat 4 tidak digambar.
- **Diátaxis — tetap empat mode** (tutorial · how-to · reference · explanation)
  dan tetap dirawat Daniele Procida; tidak ada mode baru. Yang baru adalah
  relevansinya untuk agen/RAG: dokumen yang terpisah per jenis lebih mudah
  dipotong dan diambil ulang — memperkuat pilihan "satu halaman, satu jenis".
- **ISO/IEC/IEEE 26514:2022 tetap edisi berlaku** (diterbitkan Maret/Agustus
  2022; tidak ada edisi lebih baru). Tiga pilar yang ditekankannya — analisis
  audiens & tugasnya, penurunan konsep informasi, lalu validasi lewat uji
  kegunaan — tetap menjadi daftar periksa mutu panduan. Acuan normatifnya
  IEC/IEEE 82079-1:2019 tetap dipakai sebagai pemeriksa kelengkapan.
- **MADR 4.0.0 (September 2024) masih versi terkini** template ADR; ekosistem
  2026 bergerak ke lapisan di atasnya (ADR sebagai lapisan keputusan yang
  di-query, varian ITD "Important Technical Decisions"), bukan ke format baru.
  Terapan kita tetap: `.claude/memory/decisions/` sebagai sumber, dokumen
  merangkum dan menautkan.
- **Docs-as-code 2026 — gerbang mutu di CI adalah kelaziman, bukan kemewahan.**
  Praktik yang dilaporkan konsisten: periksa tautan (lychee), struktur
  Markdown (markdownlint), gaya prosa (Vale) dan ejaan (cspell) di pipeline,
  dengan ambang yang **dimulai dari WARN lalu naik ke ERROR** agar tidak
  memblokir tim karena ribuan peringatan lama. Terapan kita: `check_docs.py`
  (kecocokan klaim↔kode), `scan_sensitive.py`, `build_docs.py`,
  `scripts/check-doc-refs.py` sudah memverifikasi; yang belum, dan tetap
  belum, adalah menjalankannya di CI — dicatat sebagai utang, bukan dikerjakan
  di sini karena perubahan CI adalah perubahan kode dengan tesnya sendiri
  (aturan emas #7/#8).

**Kelas cacat baru yang memicu satu pemeriksa.** Lampiran A (katalog modul)
punya **jumlah baris yang benar** — 94 baris = 94 modul — tetapi **lima barisnya
basi**: `certificates`, `rewards`, `violations`, `hr`, dan `organisasi` masih
mencetak jumlah handler lama setelah modulnya bertambah rute. Pemeriksa lama
hanya membandingkan **jumlah baris**, sehingga baris yang isinya salah lolos.
Ditambahkan pemeriksa per baris (`lampiran-a-handler`, `lampiran-a-mount`,
`lampiran-a-layering`) yang membandingkan tiap sel dengan `facts.json`. Ini
contoh umum yang layak diingat: **jumlah yang cocok bukan bukti isi yang
cocok** — sama kelasnya dengan C5 (`akreditasi-unit.md` dua kali, 23 = 23
kebetulan).

## Prinsip yang menyatukan semuanya

1. **Angka dari kode, bukan ingatan** — `collect_facts.py`; sebut commit dan
   tanggalnya. Repo ini sendiri melarang angka yang ditulis dari ingatan.
2. **Katakan seberapa jauh:** tiap kemampuan ditandai *di cabang / di `main` /
   di staging / di produksi* (aturan emas 11 di `AGENTS.md`). "Halamannya ada"
   bukan "fiturnya jalan" (pelajaran `breadth-over-depth`).
3. **Jujur soal utang teknis**, tetapi jangan membuka apa yang bisa dipakai
   penyerang. Repo publik sampai rilis; dokumen sering dikirim ke donor,
   auditor, vendor.
4. **Satu sumber, banyak keluaran:** tulis Markdown, turunkan `.docx`/`.md`.
5. **Cukup, tidak berlebih (lean).** Yang berubah cepat ditautkan, bukan
   disalin; yang stabil dan mahal dicari (alasan keputusan, konsep lintas-bidang)
   ditulis sekali. Dokumen yang mencatat segalanya tidak dibaca dan segera basi.
6. **Kepatuhan diperiksa mesin, bukan dinilai sendiri.** Setiap aturan yang bisa
   diperiksa terhadap kode diberi skrip (`check_docs.py`); yang tersisa hanya
   penilaian mutu tulisan — dan itu diperiksa manusia (uji pada pembaca, 26513).

## Sumber yang dikutip

| Hal | Sumber |
|---|---|
| arc42 (12 bab, tip bab 9) | arc42.org, docs.arc42.org/section-9 |
| Model C4 | c4model.com; pemetaan C4→arc42: workingsoftware.dev |
| ADR / MADR | Nygard, "Documenting Architecture Decisions" (2011); adr.github.io/madr (MADR 4.0) |
| ISO/IEC/IEEE 42010 (deskripsi arsitektur) | ISO/IEC/IEEE 42010:2022 |
| Diátaxis | diataxis.fr |
| ISO/IEC/IEEE 26514:2022 (+ keluarga 2651x) | standards.ieee.org, iso.org |
| Minimalisme | Carroll, *The Nurnberg Funnel* (1990); ringkasan teknis-komunikasi |
| IEC/IEEE 82079-1:2019 (informasi untuk dipakai) | standards.ieee.org, iso.org (cancels IEC 82079-1:2012) |
| Dokumentasi ramping | agilemodeling.com/essays/agiledocumentation.htm |
| Perkakas pemeriksa docs-as-code | Vale (errata-ai/vale), markdownlint, lychee (+ lychee-action), cspell, textlint |

