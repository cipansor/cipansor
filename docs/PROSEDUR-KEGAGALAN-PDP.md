# Prosedur Notifikasi Kegagalan Pelindungan Data Pribadi

Prosedur kerja **Yayasan Pesantren Cipansor** (selanjutnya "yayasan") untuk
menemukan, mencatat, menilai, dan memberitahukan kegagalan pelindungan data
pribadi sesuai **UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP),
Pasal 46**.

Dokumen ini untuk **pengurus, pengelola sistem, dan petugas pelindungan data
pribadi** yayasan. Ia bukan kebijakan privasi (isi pemberitahuan privasi ada di
halaman publik **`/kebijakan-privasi`** yang diterbitkan Super Admin),
melainkan **prosedur tanggap** ketika data pribadi yang yayasan kendalikan gagal
dilindungi.

> **Kenapa ini ada.** Pasal 46 mewajibkan Pengendali Data Pribadi menyampaikan
> pemberitahuan **tertulis paling lambat 3×24 jam** kepada subjek data dan
> kepada lembaga. Lewat tenggat adalah pelanggaran Pasal 46 ayat (1) yang
> dikenai sanksi administratif (Pasal 57 ayat (1) dan (2): peringatan tertulis
> sampai denda administratif paling tinggi 2% dari pendapatan tahunan). Karena
> tenggatnya 3×24 jam, prosedurnya harus sudah ada **sebelum** insiden pertama,
> bukan disusun sambil menanggapi.

## Dasar hukum

| Sumber | Isi yang dipakai |
|---|---|
| UU 27/2022 Pasal 46 ayat (1) | Wajib memberitahukan secara tertulis ≤ **3×24 jam** kepada **subjek data** dan **lembaga**. UU menyebut tenggatnya tanpa menamai titik awalnya secara tegas; prosedur ini memakai tafsir teraman — dihitung dari **pengetahuan pertama** (waktu temuan), bukan dari waktu pencatatan (lihat "Diketahui"). |
| UU 27/2022 Pasal 46 ayat (2) | Pemberitahuan tertulis minimal memuat: (a) Data Pribadi yang terungkap; (b) kapan dan bagaimana Data Pribadi terungkap; (c) upaya penanganan dan pemulihan oleh Pengendali. |
| UU 27/2022 Pasal 46 ayat (3) | Dalam hal tertentu, wajib memberitahukan pula kepada **masyarakat**. |
| UU 27/2022 Pasal 47 | Pengendali bertanggung jawab atas pemrosesan dan wajib menunjukkan pertanggungjawaban. |
| UU 27/2022 Pasal 57–58 | Sanksi administratif; "lembaga" pengawas ditetapkan Presiden melalui Peraturan Presiden. |
| UU 27/2022 Pasal 74 | Masa penyesuaian 2 tahun sejak UU diundangkan (17 Oktober 2022) — sudah lewat, kewajiban berlaku penuh. |

## Ruang lingkup dan istilah

- **Data pribadi** — data tentang orang perseorangan yang teridentifikasi atau
  dapat diidentifikasi, baik sendiri maupun digabung dengan informasi lain.
  Cakupannya luas dan mencakup data anak: nama, NIK, No. KK, akta, foto, nomor
  telepon orang tua, nilai, dan catatan kesehatan.
- **Kegagalan pelindungan data pribadi** — setiap peristiwa yang membuat data
  pribadi yang yayasan kendalikan **terakses, terungkap, berubah, hilang, atau
  disalahgunakan** tanpa hak. Contoh: kebocoran basis data; akun pegawai
  diambil alih; berkas berisi data pribadi terkirim ke penerima yang salah;
  cadangan data hilang tanpa enkripsi; layar menampilkan data pribadi santri
  kepada peran yang tidak berhak.
- **"Diketahui"** — saat **orang pertama di yayasan** menyadari bahwa suatu
  kegagalan pelindungan mungkin terjadi, **bukan** saat penyebabnya sudah
  dipastikan. Pasal 46 sendiri **tidak menamai** titik awal tenggatnya secara
  tegas (lihat "Dasar hukum"); prosedur ini memakai tafsir teraman — tenggat
  3×24 jam berjalan dari **waktu temuan** itu, saat pengetahuan pertama ada,
  **bukan** dari waktu pencatatannya. Mencatat (langkah 2) adalah perbuatan
  administratif: ia mendokumentasikan pengetahuan yang sudah ada dan **tidak
  menggeser** tenggat. Karena itu catatlah secepatnya — dan bila pencatatan
  tertunda, tenggatnya tetap dihitung mundur dari **waktu temuan**.
- **Petugas pelindungan data pribadi** — orang yang ditunjuk yayasan sebagai
  penanggung jawab prosedur ini. **Namanya tidak ditulis di repositori ini**
  (repositori publik sampai rilis); ia tercatat di **register insiden** yang
  disimpan di luar repositori.

## Peran dan penanggung jawab

Setiap langkah punya **satu** penanggung jawab. Bila penanggung jawab tidak
tersedia, tugasnya jatuh ke penggantinya yang ditunjuk yayasan (dicatat di
register, di luar repo).

| Peran | Tanggung jawab |
|---|---|
| **Petugas pelindungan data pribadi** (ditunjuk yayasan) | Memegang prosedur ini; mencatat tiap dugaan ke register; memimpin penilaian; menyusun dan mengirim pemberitahuan; menutup tinjauan. |
| **Pengelola sistem / Super Admin** | Menjaga teknis: memutus akses, memutar kredensial, memulihkan layanan, mengumpulkan bukti teknis (log). |
| **Pengurus yayasan** | Menyetujui pemberitahuan ke lembaga dan ke masyarakat; menandatangani surat; memutuskan tindak lanjut. |
| **Kepala unit** | Menjadi titik hubung bagi subjek data di unitnya; membantu menghubungi wali/santri bila kanal otomatis gagal. |

## Alur tanggap (temukan → catat → nilai → beri tahu → pulihkan → tinjau)

Tenggat 3×24 jam dihitung dari **waktu temuan** (langkah 1), bukan dari waktu
pencatatan — mencatat tidak menggeser tenggat (lihat "Diketahui"). Semua langkah
dan waktunya dicatat di register insiden (di luar repo) supaya
pertanggungjawaban Pasal 47 bisa ditunjukkan.

| # | Langkah | Penanggung jawab | Tenggat | Bukti yang dicatat |
|---|---|---|---|---|
| 1 | **Temukan** — saat pengetahuan pertama ada; hentikan penyebaran lebih jauh bila aman dilakukan (mis. cabut tautan, nonaktifkan akun, putar kredensial). Jangan hapus bukti. **Waktu temuan ini yang memulai hitungan 3×24 jam.** | Orang yang menemukan → beri tahu petugas PDP segera | Segera | Deskripsi singkat + **waktu temuan** |
| 2 | **Catat** — buka entri register insiden dan catat waktu temuan tadi. Pencatatan mendokumentasikan pengetahuan yang sudah ada; ia **tidak** menggeser tenggat. | Petugas PDP | ≤ 1 jam sejak temuan | ID insiden, waktu temuan, pelapor, dugaan awal |
| 3 | **Nilai** — tentukan: data pribadi apa, milik siapa (subjek data), berapa banyak, apakah berisiko bagi subjek data, siapa yang harus diberi tahu (subjek data, lembaga, masyarakat). | Petugas PDP + Pengelola sistem | ≤ 12 jam sejak temuan | Catatan penilaian, kategori data, perkiraan jumlah subjek data |
| 4 | **Beri tahu** — kirim pemberitahuan tertulis ke **subjek data** dan ke **lembaga** (lihat kanal di bawah dan templat). Bila Pasal 46 ayat (3) berlaku, terbitkan pemberitahuan **masyarakat**. | Petugas PDP menyusun; Pengurus menandatangani | **≤ 3×24 jam sejak temuan** | Salinan tiap pemberitahuan + waktu kirim + daftar penerima |
| 5 | **Pulihkan** — tutup celah, pulihkan data/layanan, perkuat kontrol, pantau penyalahgunaan lanjutan. | Pengelola sistem | Segera, sampai pulih | Tindakan perbaikan + waktu |
| 6 | **Tinjau** — telusuri akar masalah, perbarui kontrol dan prosedur ini bila perlu, catat pelajaran. | Petugas PDP + Pengurus | ≤ 30 hari sejak temuan | Laporan tinjauan + tindak lanjut |

> **Bila ragu apakah suatu peristiwa "kegagalan pelindungan data pribadi":**
> catat dan nilai. Prosedur ini lebih memilih satu entri register yang akhirnya
> ditutup "bukan insiden" daripada satu tenggat 3×24 jam yang terlewat.

## Kanal notifikasi per penerima

| Penerima | Kanal utama | Kanal cadangan | Catatan |
|---|---|---|---|
| **Subjek data** (wali/santri/pegawai) | Email ke alamat yang terdaftar pada sistem | WhatsApp/SMS ke nomor terdaftar; bila gagal, telepon oleh Kepala Unit **lalu kirim pemberitahuan tertulis menyusul** (lihat catatan di bawah) | Pakai kanal yang **sudah** dipakai sistem, jangan minta subjek data memasang aplikasi baru saat insiden. |
| **Lembaga** (pengawas PDP) | Surat resmi yayasan ke **Kementerian Komunikasi dan Digital (Komdigi)**, ditembuskan ke kanal pengaduan resminya | Surel resmi yayasan bila kanal surat tidak dapat dipakai | "Lembaga" menurut Pasal 58 ditetapkan Presiden lewat Peraturan Presiden; **selama lembaganya belum ditetapkan**, pemberitahuan disampaikan melalui Komdigi. Bila Perpres sudah menetapkan lembaga, ganti penerimanya. |
| **Masyarakat** (bila Pasal 46 ayat (3) berlaku) | Pengumuman di situs publik `cipansor.or.id` + kanal resmi yayasan | Media sosial resmi yayasan | Dipakai bila jumlah subjek data besar atau kontak satu per satu tidak mungkin — tetap **di samping** pemberitahuan ke subjek data yang bisa dihubungi. |

Alamat surel resmi yayasan dan nomor kontak ada di
[`packages/shared/src/public-site.ts`](../packages/shared/src/public-site.ts)
(`siteConfig.contact`); jangan menulis ulang di sini supaya tidak basi.

> **Pemberitahuan harus tertulis — telepon tidak menggantikannya.** Pasal 46
> mewajibkan pemberitahuan **tertulis** dan langkah 4 menyimpan salinannya.
> Telepon (atau WA/SMS) hanya cara **memberi tahu lebih cepat**; ia **tidak
> melepas** kewajiban tertulis. Bila kanal utama dan WhatsApp/SMS gagal, Kepala
> Unit menelepon **lalu tetap mengirim** pemberitahuan tertulis susulan (email
> bila alamatnya ada; bila tidak, surat ke alamat yang terdaftar) — salinan
> susulan itu yang masuk register sebagai bukti pemberitahuan tertulis, dan
> tenggat 3×24 jam tetap dihitung dari **waktu temuan**, bukan dari saat
> telepon.

## Register insiden (disimpan di luar repositori)

Register insiden **tidak** disimpan di repositori ini — ia memuat data pribadi
subjek data, nama petugas, dan rincian kelemahan yang mungkin masih terbuka.
Repositori ini publik sampai rilis dan riwayat git menyimpan segalanya.

Register disimpan di ruang terbatas milik yayasan (mis. berkas terenkripsi atau
ruang kerja internal) dan memuat sekurang-kurangnya:

- **ID insiden**, waktu temuan, dan waktu **Catat** (awal hitungan 3×24 jam
  adalah **waktu temuan**; waktu Catat hanya mencatat kapan register dibuka);
- pelapor dan penanggung jawab tiap langkah;
- kategori data pribadi dan perkiraan jumlah subjek data;
- salinan tiap pemberitahuan yang dikirim, penerimanya, dan waktunya;
- tindakan pemulihan dan hasil tinjauan.

Nama petugas pelindungan data pribadi dan penggantinya juga tercatat di register
(header), bukan di sini.

## Templat pemberitahuan

Kedua templat memuat **ketiga** butir Pasal 46 ayat (2). Isi bagian bertanda
`[…]` saat insiden; jangan mengirim templat apa adanya.

### Templat A — pemberitahuan kepada subjek data

> **Perihal: Pemberitahuan kegagalan pelindungan data pribadi**
>
> Kepada Bapak/Ibu [nama subjek data],
>
> Yayasan Pesantren Cipansor menyampaikan bahwa telah terjadi kegagalan
> pelindungan data pribadi yang **dapat** berdampak pada data pribadi Anda.
> Kami menyampaikan ini sesuai UU No. 27 Tahun 2022 Pasal 46.
>
> **1. Data pribadi yang terungkap.** [Sebutkan jenis data: mis. nama, NIK, No.
> KK, nomor telepon, dan/atau data lain yang benar-benar terungkap — sebutkan
> yang spesifik, bukan "data pribadi" secara umum.]
>
> **2. Kapan dan bagaimana data pribadi terungkap.** [Tanggal/jam kejadian dan
> cara terjadinya, mis. "pada [tanggal] sebuah akun pegawai diambil alih
> sehingga berkas [x] terakses pihak yang tidak berhak".]
>
> **3. Upaya penanganan dan pemulihan oleh yayasan.** [Tindakan yang sudah dan
> akan dilakukan: akses dicabut, kredensial diputar, layanan dipulihkan, dan
> langkah pencegahan. Sebutkan apa yang perlu Anda lakukan bila ada, mis.
> mewaspadai kontak mencurigakan.]
>
> Bila ada pertanyaan, hubungi [kanal resmi yayasan, mis. alamat surel pada
> `siteConfig.contact`].
>
> Hormat kami,
> Yayasan Pesantren Cipansor

### Templat B — pemberitahuan kepada lembaga (Komdigi)

> **Perihal: Pemberitahuan kegagalan pelindungan data pribadi — Yayasan
> Pesantren Cipansor**
>
> Kepada [Lembaga Pelindungan Data Pribadi / Kementerian Komunikasi dan
> Digital],
>
> Sesuai UU No. 27 Tahun 2022 Pasal 46, kami, **Yayasan Pesantren Cipansor**
> sebagai Pengendali Data Pribadi, memberitahukan terjadinya kegagalan
> pelindungan data pribadi.
>
> **1. Data pribadi yang terungkap.** [Jenis/kategori data pribadi dan
> perkiraan jumlah subjek data yang terdampak.]
>
> **2. Kapan dan bagaimana data pribadi terungkap.** [Waktu kejadian dan cara
> terjadinya; sebutkan waktu kami mengetahuinya.]
>
> **3. Upaya penanganan dan pemulihan oleh Pengendali.** [Tindakan penanganan
> dan pemulihan yang telah dan akan kami lakukan, termasuk pemberitahuan kepada
> subjek data dan langkah pencegahan.]
>
> Kontak penanggung jawab: [nama/jabatan petugas pelindung data pribadi dan
> kanal resmi yayasan].
>
> Hormat kami,
> [Nama dan jabatan penandatangan],
> Yayasan Pesantren Cipansor

## Menjaga prosedur ini tetap hidup

- **Latihan meja (table-top)** sekali setahun: jalankan satu skenario dari
  langkah 1 sampai 4 dan ukur apakah tenggat 3×24 jam realistis dengan peran
  dan kanal yang ada.
- **Tinjau setelah setiap insiden**: bila langkah, kanal, atau penanggung jawab
  terbukti tidak memadai, perbarui dokumen ini lewat pull request.
- **Jaga register tetap di luar repo.** Bila suatu pelajaran dari insiden perlu
  dibagikan ke pengembang, tulis **tanpa** data pribadi, nama petugas, atau
  rincian kelemahan yang masih terbuka.

## Rujukan

- UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi — Pasal 46, 47, 57, 58,
  74. Teks resmi: <https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022>.
- [`docs/README.md`](./README.md) — peta dokumentasi.
- Halaman Kebijakan Privasi publik (diterbitkan Super Admin) — rute
  `/kebijakan-privasi`.
