# showcase-portofolio

> KEPUTUSAN 2026-10-10: portofolio "showcase" tetap terbatas cakupan
> (`studentScope`). `isShowcase`/`isPublic` memilih karya yang **ditampilkan**,
> bukan siapa yang **boleh melihat**. Keterangan "PUBLIC" pada header dihapus.

**Keputusan pemilik 2026-10-10**, sesudah tinjauan bot pada PR #747 menandai
`getStudentShowcase` berubah dari "publik" menjadi terbatas cakupan dan meminta
arahnya diputuskan. Pembatasan itu kini terpasang: #747 merged 2026-10-13 dan
membawa `getStudentShowcase` ke `studentScope`.

## Keadaan yang diukur

- `getStudentShowcase(studentId, actor)` berada di belakang `authenticate`,
  jadi "publik" berarti akun mana pun yang sudah masuk, lintas unit — bukan
  pengunjung anonim.
- Sebelum #747, penyaringnya hanya `OR: [{ isShowcase }, { isPublic }]` tanpa
  cakupan unit: akun dari unit mana pun menjangkau data santri unit lain.
  #747 menambahkan `assertStudentInScope(studentId, actor)` di depannya.
- Portofolio membawa foto santri, penghargaan, dan total tahfidz: data anak.
- Hook web `useStudentShowcase` belum dipakai halaman mana pun, jadi tidak ada
  UI yang bergantung pada tampilan lintas unit.

## Dasar

- **UU 27/2022 (Pelindungan Data Pribadi) Pasal 25** — data anak termasuk data
  pribadi bersifat spesifik; pemrosesannya diselenggarakan secara khusus dan
  menuntut persetujuan orang tua/wali.
- **PP 17/2025 Pasal 10 ayat (1)** — fitur yang dirancang untuk, atau mungkin,
  diakses anak dikonfigurasi secara baku pada tingkat privasi tinggi.

Keduanya menuntut baku tertutup, bukan terbuka. Membukanya lintas unit menuntut
dasar (izin wali tercatat) yang belum ada.

## Sumber

- UU 27/2022 Pasal 25: pemrosesan data pribadi anak wajib dengan persetujuan
  orang tua dan/atau wali —
  <https://peraturan.bpk.go.id/Download/224884/UU%20Nomor%2027%20Tahun%202022.pdf>
- PP 17/2025 (PP TUNAS) Pasal 10 ayat (1): fitur yang diakses anak berada pada
  "tingkat privasi tinggi secara baku" —
  <https://pasal.id/peraturan/pp/pp-no-17-tahun-2025>
- ICO Children's Code standar 7 ("high privacy by default") —
  <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/7-default-settings/>
- Seesaw: karya hanya terlihat di kelas, dan masuk blog kelas sesudah guru
  menyetujuinya — <https://seesaw.com/privacy-policy/privacy-security/>
- Google Classroom: teman sekelas tidak melihat karya kecuali guru sengaja
  membagikannya — <https://support.google.com/edu/classroom/answer/6386395>
- KPAI tentang publikasi identitas anak (dikutip lewat Diskominfo Kota
  Cirebon) — <https://dkis.cirebonkota.go.id/artikel/etika-mengunggah-foto-anak-di-media-sosial>

## Alternatif yang ditolak (kini)

- **Tetap publik lintas unit.** Ditolak: baku terbuka atas data anak, tanpa izin
  wali yang tercatat.
- **Bergantung pada `isPublic` saja.** Ditolak: `isPublic` penanda penyajian,
  bukan gerbang akses; tanpa cakupan ia jadi gerbang yang tidak diperiksa.

## Pembuka (kapan ditinjau ulang)

Bentuk berjenjang — pribadi → kelas/unit dengan kurasi guru → yayasan/situs
dengan izin wali yang tercatat — dicadangkan, bukan sekarang. Bangun saat ada
kebutuhan nyata (mis. karya dipamerkan ke yayasan atau situs publik). Syaratnya:
izin wali tercatat, kurasi staf, dan default tetap tertutup. Jangan membangunnya
tanpa kebutuhan itu. Rancangan bertingkat ada di `roadmap.md` § 7.
