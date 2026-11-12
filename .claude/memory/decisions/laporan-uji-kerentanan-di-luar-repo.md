# laporan-uji-kerentanan-di-luar-repo

> Keputusan maintainer **K37** (2026-11-09, dari daftar K1–K38): selama repositori publik, laporan uji kerentanan **penuh** disimpan di luar repo; `docs/` hanya memuat prosedur + ringkasan netral **tanpa temuan yang masih terbuka**. Satu label tipe: `security`.

Diputuskan saat menutup pertanyaan jalur pengiriman issue **#818** (skill dan
laporan uji kerentanan internal). Ini penunjuknya supaya sesi berikutnya tidak
mengulang perdebatannya.

## Yang diputuskan

- **Jalur pengiriman = opsi B.** Selama repositori publik (lihat
  `decisions/lisensi.md` — kembali proprietary begitu repo privat), laporan
  penuh — temuan `F-nn` beserta peringkat CVSS, langkah, dan bukti — **tinggal
  di luar repo**. `docs/` hanya memuat **prosedur uji** dan **ringkasan netral**.
- Selaras dengan `decisions/otomasi-armada.md` butir 5 (temuan keamanan →
  **advisory privat** GitHub, bukan issue publik; perbaikan lewat PR publik
  netral) dan `docs/SDLC-FLOW.md` invarian 9 (rahasia tidak masuk teks publik).
- **Satu label tipe: `security`.** Label `documentation` dicabut — dua label
  tipe berdampingan menggagalkan `issue-label-sync.sh` saat PR dibuat.

## Yang masuk repo (dan yang tidak)

Masuk: `docs/UJI-KERENTANAN.md` (prosedur: otorisasi Ketua Yayasan, lingkup
gray-box, batas tanpa uji merusak, kerangka Ringkasan Eksekutif + Bagian 1–10,
dan **ringkasan netral** kontrol terverifikasi baik) + skill
`.claude/skills/uji-kerentanan-cipansor/` (SKILL.md, `scripts/check_report.py`,
`scripts/test_check_report.py`, `references/`, `assets/template-laporan.md`).

Tidak masuk: laporan penuh, register temuan terbuka, langkah eksploitasi,
kredensial, IP, nama/ID sumber daya cloud, data pribadi. Ringkasan netral hanya
boleh menyebut temuan yang **sudah ditutup**.

## Penjaga (guard)

- `apps/api/src/utils/vulnerability-procedure.guard.test.ts` memaku invarian
  K37: prosedur + skill ada, skill terdaftar di tabel Skills `AGENTS.md`, dan
  **tidak ada temuan `F-nn` berstatus terbuka** di `docs/UJI-KERENTANAN.md`.
  Uji itu juga menjalankan `check_report.py --summary` dan suite regresinya.
- `docs/UJI-KERENTANAN.md` terdaftar sebagai **kode** di
  `.github/scripts/change-scope.sh` (aturan emas 5: berkas yang dibaca uji =
  kode), supaya perubahan prosedur tidak melewati CI.
- Pemeriksa Python: `check_report.py` mode penuh (struktur temuan, skor CVSS vs
  vektor, paritas lintas bahasa) dan mode `--summary` (menolak temuan terbuka).
  `.github/scripts/check-sensitive.py` menyapu teks publik.

## Yang DITOLAK (jangan diusulkan ulang tanpa alasan baru)

- **Menyimpan laporan penuh (tak teredaksi) di repo** — ditolak: repo publik.
  Bukti mentah tetap di Lampiran Rahasia terpisah yang tidak di-commit.
- **Satu berkas tiga bahasa** — label sampul/footer/`core_properties.language`
  hanya bisa satu nilai per bangun; jadi satu sumber per bahasa bila kelak
  diperlukan. Untuk ringkasan netral di repo, cukup satu bahasa (Indonesia).
- **Menambah `--lang id|en|ar` ke `build_docs.py` di PR #818** — lebih baik
  sebagai PR tersendiri; alat itu dipakai dokumen lain.

## Kesiapan dan lingkup

#818 kini `ready` (label `security`, `priority:medium`). Kesiapan = tujuan
jelas, jalur pengiriman diputuskan, kriteria penerimaan konkret dan dapat
diamati. Nasib klon lokal pelapor tidak lagi menentukan lingkup: yang masuk
repo adalah prosedur + ringkasan netral, dibangun dari `main`.
