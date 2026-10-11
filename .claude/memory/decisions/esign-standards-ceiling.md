# esign-standards-ceiling

> Batas atas TTE Cipansor menurut AATL/eIDAS/PP 71 — dan satu temuan: Ed25519 tidak ada di daftar algoritma AATL

Dibaca 2026-09-02 dari **Adobe AATL Technical Requirements v2.0** yang dikirim
yayasan, dipadukan dengan eIDAS dan PP 71/2019. Ringkasannya lengkap di
`docs/EOFFICE_ESIGN_PLAN.md` (§ "PR-2b" dan "What AATL asks…").

**AATL adalah program untuk certificate authority, bukan untuk aplikasi
penandatangan.** Keanggotaan menuntut audit WebTrust/ETSI EN 319 411 tiap dua
tahun (G2), HSM FIPS 140-2 Level 3 (ICA4), verifikasi identitas tatap muka
(ICA5a), dan kontrak dengan Adobe. Yayasan tidak akan menjadi anggotanya —
jangan menjadikannya sasaran.

**Temuan yang paling berguna: EE4(b) menyebut RSA ≥ 2048 atau EC ≥ 256.
Ed25519 tidak ada dalam daftarnya.** Itu pembenaran mandiri atas §4.3 rencana:
pilihan algoritma inilah yang menghalangi PAdES, dan dukungan EdDSA-in-CMS
(RFC 8419) di Acrobat memang tipis. Migrasi, bukan tambalan.

> **Koreksi 2026-09-29 — AATL bukan PAdES.** Kalimat di atas (dan §4.3 rencana)
> mencampur dua daftar algoritma yang berbeda. **ETSI TS 119 312 V2.1.1
> (2026-06), Tabel A.1** — spesifikasi yang justru dirujuk oleh ETSI EN 319 142
> (PAdES) — menempatkan **EdDSA (Ed25519, Ed448) sebagai *shall support* bagi
> pengguna AdES**, bukan sebagai algoritma yang dihindari; catatannya juga
> menyebut hash bawaan Ed25519 adalah SHA-512. Jadi **Ed25519 tidak menghalangi
> PAdES**; yang tidak menerimanya adalah **AATL** (Adobe Approved Trust List),
> program keanggotaan CA yang, seperti sudah ditulis di bawah, memang bukan
> sasaran yayasan. Alasan "Acrobat tipis" tetap berlaku untuk *validasi di
> Acrobat*, tetapi itu masalah dukungan *validator*, bukan larangan standar.
> Konsekuensinya untuk §4.3: pindah ke RSA-3072/ECDSA P-256 masih masuk akal
> demi interoperabilitas Acrobat dan AATL, tetapi argumennya harus jujur —
> **bukan** "Ed25519 tidak ada di PAdES". Ini memengaruhi keputusan masa depan
> (mis. kalau PAdES B-B dikerjakan, Ed25519 secara standar boleh dipakai;
> penggantian algoritma adalah pilihan interoperabilitas, bukan keharusan).

Yang paling bernilai berikutnya: **stempel waktu RFC 3161** (EE3) — tanpanya
tidak ada jawaban atas "apakah kuncinya masih berlaku *saat* ditandatangani",
yang justru inti semantik pencabutan. Masih PR-5, belum dikerjakan.

**Keputusan 2026-09-29 — PR-5 (PAdES B-B + RFC 3161) ditunda, opsi (b).**
Setelah menimbang tiga jalan — (a) kerjakan sekarang, (b) tunda, (c) PAdES B-T
dengan stempel lokal — yayasan memilih **(b) tunda**. Alasannya: tanpa
**endpoint TSA RFC 3161** yang harus diadakan yayasan, PAdES hanya menambah
ketergantungan (pembangun CMS/PKCS#7, sertifikat X.509, plumbing byte-range)
tanpa menambah nilai bukti — justru TSA itu yang menjawab "apakah kunci masih
berlaku *saat* ditandatangani", inti semantik pencabutan. Bentuk yang berjalan
sekarang (Ed25519 *detached* atas hash byte PDF, byte tertandatangan diarsipkan,
verifikasi lewat unggah) sudah sah menurut UU 11/2008 jo. UU 19/2016 (UU ITE)
Pasal 11 dan sudah terverifikasi.
Pemicu untuk membuka kembali: yayasan menetapkan penyedia TSA (BSrE/Privy/VIDA/
Peruri/Digisign) atau memutuskan sertifikasi PSrE; kapan pun itu terjadi,
Ed25519 boleh tetap dipakai untuk PAdES — penggantian algoritma adalah pilihan
interoperabilitas Acrobat, bukan syarat PAdES. Jangan mengusulkannya ulang
tanpa pemicu itu.

~~Yang murah: mencatat cara identitas diverifikasi (ICA5a)~~ — **sudah dibangun
dan terbukti jalan di produksi, 2026-09-03 (#445, #447, #448, #449).** `UserIdentity` menyimpan nama sesuai KTP, NIK,
tempat/tanggal lahir; pengajuan kunci ditolak otomatis bila belum lengkap atau
belum diverifikasi, sambil menyebut ruas yang kurang; dan menyetujui menuntut
Super Admin membuka foto KTP yang diunggah lalu menyatakan kecocokannya. Itu
menutup ICA5(a), dan ia tidak menuntut PSrE.

**Kesimpulan tetap:** TTE ini *tidak tersertifikasi* menurut PP 71/2019, dan
semua perbaikan di atas tidak mengubahnya. Menjadi tersertifikasi berarti
memakai PSrE (BSrE, Privy, VIDA, Peruri, Digisign) — keputusan pengadaan, bukan
keputusan teknik. Jangan menjanjikan sebaliknya kepada yayasan.

**Keputusan yayasan, 2026-09-03: PSrE belum, tetap memakai kunci sendiri.**
Jangan mengusulkannya ulang tanpa alasan baru. Satu jawaban itu sekaligus
menutup Tier 2, segel elektronik, dan boleh-tidaknya naskah memakai kalimat kaki
baku BSrE — yang **tidak boleh disalin**, sebab menyebut sertifikat PSrE yang
tidak kita punya.

**Yang sudah diriset dan jangan diulang** (semuanya di
`docs/EOFFICE_ESIGN_PLAN.md` §5b dan §PR-5b, lengkap dengan sumbernya):

- **Visualisasi TTE menurut aturan Indonesia minimal QR + nama + jabatan** —
  bukan logo. Mengganti QR dengan logo menjauh dari standar. Lihat
  [eoffice-verify-by-upload-not-qr](./eoffice-verify-by-upload-not-qr.md).
- **Segel elektronik**: satu dokumen satu segel, banyak tanda tangan; dan
  **segel dibubuhkan lebih dulu, baru tanda tangan**, kalau ingin lolos
  validasi Adobe. BSrE menerbitkannya lewat Verifikator Instansi — yayasan bukan
  instansi, jadi pintunya tertutup.
- **Bentuk identitas di sertifikat** (ETSI EN 319 412-1/-2): orang →
  `serialNumber = IDCID-<NIK>`; organisasi → `organizationIdentifier =
  NTRID-<nomor pengesahan Kemenkumham>`, `O` nama persis SK, `L/ST/C` kota saja
  — **sertifikat memuat kota, bukan alamat pos**.
- **Retensi bukti registrasi**: CA/Browser Forum menetapkan **tujuh tahun
  setelah sertifikat berhenti berlaku** — dihitung dari berakhirnya masa
  berlaku, bukan penerbitan. Diterapkan sebagai `IDENTITY_DOCUMENT_RETENTION_YEARS`.
- **Pencocokan wajah ditolak**: citra wajah adalah data biometrik = data pribadi
  bersifat spesifik (UU PDP Ps. 20 ayat 2, persetujuan eksplisit terpisah), dan
  BSrE sendiri sudah mencocokkannya ke Dukcapil — membangun sendiri berarti
  membangun versi yang lebih buruk.

**Ditelusuri ujung ke ujung di produksi, 2026-09-03.** Yang dibuktikan berjalan,
bukan sekadar terpasang: gerbang identitas menolak dengan menyebut ruas yang
kurang; unggahan KTP menyimpan byte yang sama persis; pembacaannya tercatat;
masa simpan dihitung dari kedaluwarsa kunci (2034, bukan 2033); passphrase
diminta setelah persetujuan; byte naskah = arsip = `pdfHash`; **PDF yang diubah
satu byte tidak ditemukan**; pencabutan terverifikasi secara kriptografis.

Dua sifat yang baru terbukti di sana dan layak diingat: pindaian KTP **selamat
melewati `--force-recreate`** (itulah gunanya #448), dan verifikasi tetap
berjalan setelah baris kunci dihapus — kunci publiknya tersimpan pada baris
tanda tangan, sehingga naskah lama terverifikasi selamanya. Kunci boleh dicabut
atau dihapus tanpa membatalkan apa pun yang sudah ditandatangani.

Rinciannya di `docs/EOFFICE_ESIGN_PLAN.md` §7.
