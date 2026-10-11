<!-- Biarkan PR ini draft sampai siap ditinjau. `Gerbang tinjau PR` hanya
     meninjau PR yang siap; check merah atau permintaan perubahan tampil di PR
     dan branch protection menahan merge sampai diselesaikan. -->

## HUMAN

<!-- Penulis manusia: ganti komentar ini dengan catatan singkat tentang apa yang
     Anda uji dan bagaimana. Agen AI tidak boleh menyunting bagian ini.
     Wajib (minimal 20 karakter) hanya pada PR berisiko: berlabel `security`,
     atau mengubah skema/migrasi/skrip data, skrip data produksi, atau auth/RBAC
     (`RISKY_PATHS` di .github/scripts/pr-template-guard.sh). -->

---

## AGENT

<!-- Agen AI/LLM: jangan menyunting bagian HUMAN. Jangan menuliskan apa yang
     hendak Anda lakukan — tulis apa yang Anda jalankan dan apa yang
     dikembalikannya. Menguji dengan unit test saja tidak cukup untuk perubahan
     yang bisa dicoba pengguna; jalankan jalur nyatanya dan tunjukkan. Akhiri
     setiap komentar dengan footer AI-disclosure supaya PR ini tidak memicu
     automation atas teksnya sendiri:
     "_This comment was created by an AI agent (OpenHands) on behalf of <user>._" -->

## Why

<!-- Masalah dan motivasinya. Untuk bug: kegagalan dan biaya yang terlihat. -->

## What changed

<!-- 1-3 butir. Untuk bug: sebutkan kegagalannya, lalu perbaikannya. -->

-

## Linked issue

<!-- Wajib. Tulis `Fixes #<n>`. Issue-nya harus berlabel `ready`: label itu
     berarti tujuannya jelas dan kriteria penerimaannya konkret, dan hanya
     dipasang oleh `Pelabel issue` saat itu terpenuhi. Tanpa issue `ready`, PR
     ini seharusnya belum ada — buka issue-nya dulu. Lihat docs/LABELS.md. -->

Fixes #

## Acceptance criteria

<!-- Salin kotak centang dari issue tertaut dan centang yang dipenuhi PR ini,
     beserta buktinya. `Pelabel PR` menyalin tipe dan prioritas issue ke PR ini;
     workflow Issue label sync gagal bila tipenya benar-benar berbeda. -->

- [ ]

## How to test

<!-- Wajib. Perintah persis yang dijalankan peninjau untuk melihat hasilnya,
     beserta keluaran yang diamati. Untuk bug: langkah reproduksi dan hasil
     sebelum/sesudah. Jika tidak bisa mengujinya, sebutkan alasannya — itu lebih
     baik daripada klaim diam-diam. -->

## Evidence

<!-- Untuk bug: kegagalan sebelum dan keberhasilan sesudah, setup yang sama.
     Untuk perubahan apa pun di apps/web: visual sebelum dan sesudah dari
     tampilan atau alur yang berubah, keduanya, ditempel lewat unggahan GitHub.
     Untuk perubahan fungsional lain: tangkapan layar atau video perilaku yang
     berjalan. Workflow `visual-evidence` memasang pengingat (bukan blokir) bila
     apps/web berubah tanpa visual sebelum/sesudah. Log dan tes melengkapinya;
     untuk perubahan non-fungsional keduanya bisa menjadi buktinya. Nyatakan apa
     yang Anda validasi dan batasnya. -->

## Type

<!-- Centang satu. Harus cocok dengan label tipe pada issue tertaut. -->

- [ ] `bug` — memperbaiki cacat
- [ ] `enhancement` — kemampuan baru
- [ ] `documentation` — hanya dokumen
- [ ] `refactor` — perilaku sama, kode lebih bersih
- [ ] `chore` — perkakas, dependensi, pemeliharaan
- [ ] `security` — pengerasan

## Notes

<!-- Opsional: migrasi, perubahan konfigurasi, kekhawatiran rilis, tindak
     lanjut, atau apa pun yang perlu diketahui peninjau. Dokumen desain
     diletakkan di docs/ dan ditautkan. -->
