# showcase-portofolio

> KEPUTUSAN 2026-10-10: portofolio "showcase" tetap terbatas cakupan
> (`studentScope`). `isShowcase`/`isPublic` memilih karya yang **ditampilkan**,
> bukan siapa yang **boleh melihat**. Keterangan "PUBLIC" pada header dihapus.

**Keputusan pemilik 2026-10-10**, sesudah tinjauan bot pada PR #747 menandai
`getStudentShowcase` berubah dari "publik" menjadi terbatas cakupan dan meminta
arahnya diputuskan.

## Keadaan yang diukur

- `getStudentShowcase(studentId, actor)` berada di belakang `authenticate`,
  jadi "publik" berarti akun mana pun yang sudah masuk, lintas unit — bukan
  pengunjung anonim.
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
tanpa kebutuhan itu.
