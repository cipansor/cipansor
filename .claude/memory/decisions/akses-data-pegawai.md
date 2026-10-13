# akses-data-pegawai

> KEPUTUSAN 2026-10-10 (pengguna): data pribadi lengkap seorang pegawai —
> NIK, No. KK, alamat, tempat dan tanggal lahir, rekening bank — hanya terbaca
> oleh **pegawai itu sendiri**, **admin unit**, **Tata Usaha unit itu**, **organ
> yayasan**, dan **Super Admin**. Rekan kerja, termasuk kepala sekolah, hanya
> melihat kolom direktori: nama, NIP/NUPTK, jabatan, unit, dan status.

## Asal keputusan

#512 menghidupkan rute daftar dan detail pegawai (`/hr/employees`) untuk semua
guru dan staf. Rute itu memilih seluruh baris `Teacher`/`Staff`
(`teacher: true`), sehingga setiap guru dapat membaca NIK dan rekening rekan
seunitnya. Pengguna diberi tiga pilihan: admin + TU + diri sendiri; hanya admin
+ diri sendiri; atau ditambah kepala sekolah. Pilihannya yang pertama.

## Aturannya

- **Daftar pegawai** selalu memakai kolom direktori, untuk siapa pun.
- **Detail** lengkap hanya bagi yang memegang catatan kepegawaian: pegawai itu
  sendiri, admin unit, TU unit itu (pengelola kepegawaian dan data PTK
  Dapodik/EMIS), organ yayasan, dan Super Admin. Batas unit tetap berlaku, jadi
  TU unit lain mendapat 404.
- Kepala sekolah menilai kinerja tanpa NIK atau rekening. Gaji tetap lewat
  modul payroll, dengan aturannya sendiri.
- Jawaban API tidak pernah membawa kolom kredensial (`SAFE_USER_SELECT`).

Kode: `TEACHER_DIRECTORY_SELECT`, `STAFF_DIRECTORY_SELECT`, dan
`keepsHrRecords` di `apps/api/src/modules/hr/hr.service.ts`.

## Sumber

- UU 27/2022 Pasal 16 ayat (2): pemrosesan data pribadi dilakukan secara
  terbatas dan spesifik, sah secara hukum, dan transparan —
  <https://peraturan.bpk.go.id/Download/224884/UU%20Nomor%2027%20Tahun%202022.pdf>
- `.claude/memory/lessons/prisma-include-leaks-pii.md` — `include` pada relasi
  mengirim setiap kolom; selalu `select`.
