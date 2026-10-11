/**
 * Garis kewenangan pada penandatanganan naskah dinas.
 *
 * Seorang pejabat jarang menandatangani hanya atas namanya sendiri. Naskah
 * keluar sehari-hari sering ditandatangani "a.n. Kepala …" oleh pejabat di
 * bawahnya, atau oleh pejabat yang menjalankan tugas karena pejabat definitif
 * belum dilantik (Plt.) maupun sedang berhalangan (Plh.). Bentuk-bentuk itu
 * bukan hiasan: masing-masing menyatakan **dari mana wewenang penanda tangan
 * berasal**, dan karena itu wajib tercetak pada naskahnya dan terbaca pada
 * halaman verifikasi publik.
 *
 * **Dasarnya.** Empat bentuk ini bukan karangan, melainkan tata naskah dinas
 * yang berlaku di instansi pemerintah, dan tiga sumber berikut sepakat:
 *
 * - **Peraturan BKN Nomor 16 Tahun 2020 tentang Tata Naskah Dinas**, Pasal 241
 *   dan 242: penandatanganan dengan garis kewenangan dilaksanakan dengan empat
 *   cara — atas nama (a.n.), untuk beliau (u.b.), pelaksana tugas (Plt.), dan
 *   pelaksana harian (Plh.). Pasal 243 menetapkan syarat masing-masing.
 * - **Peraturan Menteri Kehutanan Nomor P.69/Menhut-II/2013** (Pedoman Tata
 *   Naskah Dinas Instansi Pemerintah), Lampiran V — susunan penulisan tiap
 *   bentuk, yang dikutip di bawah pada komentar setiap nilai.
 * - **Peraturan Menteri PANRB Nomor 16 Tahun 2020** dan pedoman tata naskah
 *   dinas daerah yang mengikutinya (mis. Pergub/Pergub) memakai rumusan yang
 *   sama.
 *
 * **Yang dapat ditegakkan sistem, dan yang tidak.** Bentuknya dapat dicatat,
 * diterbitkan bersama naskahnya, dan diperiksa konsistensinya (mis. Plt. tidak
 * boleh dirangkap dengan a.n.). Yang **tidak** dapat diperiksa sistem adalah
 * keberadaan surat kuasa/pelimpahan atau SK penunjukan yang mendasarinya — itu
 * perbuatan tata usaha kepegawaian, bukan data yang dimiliki aplikasi ini.
 * Karena itu bentuknya adalah **pernyataan penanda tangan** yang dipublikasikan
 * (sama seperti `signerRoleCode` yang mencatat jabatan saat menandatangani),
 * dan teks di layar mengatakannya terus terang alih-alih berpura-pura
 * memverifikasi surat kuasa yang tidak pernah dibacanya.
 */

/**
 * Cara sebuah naskah ditandatangani menurut garis kewenangan.
 *
 * `NONE` bukan berarti "tanpa wewenang", melainkan "ditandatangani atas nama
 * jabatan penanda tangan sendiri" — keadaan yang paling lazim dan bawaannya.
 */
export enum SigningAuthorityForm {
  /** Atas nama jabatannya sendiri. Bawaan. */
  NONE = "NONE",
  /** a.n. — atas nama pejabat yang berwenang. */
  ATAS_NAMA = "ATAS_NAMA",
  /** u.b. — untuk beliau; hanya dipakai setelah a.n. */
  UNTUK_BELIAU = "UNTUK_BELIAU",
  /** Plt. — pelaksana tugas, karena pejabat definitif belum dilantik. */
  PELAKSANA_TUGAS = "PELAKSANA_TUGAS",
  /** Plh. — pelaksana harian, karena pejabat definitif berhalangan sementara. */
  PELAKSANA_HARIAN = "PELAKSANA_HARIAN",
}

/**
 * Singkatan baku yang tercetak di naskah.
 *
 * a.n. dan u.b. ditulis huruf kecil pada naskahnya (praktik baku yang dikutip
 * pedoman); Plt. dan Plh. berawal huruf kapital. Nilai di sini adalah yang
 * benar-benar tercetak, bukan label antarmuka.
 */
export const SIGNING_AUTHORITY_ABBREVIATION: Record<
  SigningAuthorityForm,
  string
> = {
  [SigningAuthorityForm.NONE]: "",
  [SigningAuthorityForm.ATAS_NAMA]: "a.n.",
  [SigningAuthorityForm.UNTUK_BELIAU]: "u.b.",
  [SigningAuthorityForm.PELAKSANA_TUGAS]: "Plt.",
  [SigningAuthorityForm.PELAKSANA_HARIAN]: "Plh.",
};

/**
 * Keterangan untuk antarmuka dan halaman verifikasi.
 *
 * `summary` menyebut kapan bentuk itu dipakai; `authority` menyebut di mana
 * tanggung jawabnya berada — pertanyaan yang justru dicari pembaca naskah.
 */
export const SIGNING_AUTHORITY_LABELS: Record<
  SigningAuthorityForm,
  { label: string; summary: string; authority: string }
> = {
  [SigningAuthorityForm.NONE]: {
    label: "Atas nama sendiri",
    summary: "Ditandatangani atas nama jabatan penanda tangan sendiri.",
    authority: "Tanggung jawab naskah berada pada penanda tangan.",
  },
  [SigningAuthorityForm.ATAS_NAMA]: {
    label: "Atas nama (a.n.)",
    summary:
      "Pejabat yang berwenang memberi kuasa kepada pejabat di bawahnya berdasarkan bidang tugas dan tanggung jawabnya.",
    authority:
      "Tanggung jawab tetap pada pejabat yang memberi kuasa; penerima kuasa mempertanggungjawabkannya kepada pemberi kuasa.",
  },
  [SigningAuthorityForm.UNTUK_BELIAU]: {
    label: "Untuk beliau (u.b.)",
    summary:
      "Penerima kuasa memberi kuasa lagi kepada pejabat satu tingkat di bawahnya; dipakai setelah a.n., paling banyak dua tingkat struktural.",
    authority:
      "Tanggung jawab tetap pada pejabat yang memberi kuasa; penerima kuasa mempertanggungjawabkannya kepada pemberi kuasa.",
  },
  [SigningAuthorityForm.PELAKSANA_TUGAS]: {
    label: "Pelaksana tugas (Plt.)",
    summary:
      "Pejabat definitif belum ditetapkan/dilantik, sehingga jabatan itu dijalankan sementara oleh pelaksana tugas.",
    authority:
      "Pelaksana tugas bertanggung jawab atas naskah yang ditandatanganinya, tetapi tidak berwenang menetapkan keputusan yang mengikat.",
  },
  [SigningAuthorityForm.PELAKSANA_HARIAN]: {
    label: "Pelaksana harian (Plh.)",
    summary:
      "Pejabat definitif berhalangan sementara, sehingga pelaksanaan pekerjaan sehari-hari dijalankan pelaksana harian.",
    authority:
      "Pelaksana harian bertanggung jawab atas naskah yang ditandatanganinya selama masa pelaksanaan.",
  },
};

/**
 * Susunan baris yang tercetak pada blok tanda tangan.
 *
 * Mengikuti pedoman: singkatan garis kewenangan di depan nama jabatan yang
 * diwakili, ditulis dengan huruf kapital pada setiap awal kata. Contoh yang
 * dihasilkan untuk a.n.:
 *
 *     a.n. Kepala SMA Qur'an Cipansor
 *     Sekretaris Yayasan,
 *     Tanda Tangan
 *     Nama Lengkap
 *
 * Fungsi ini hanya menyusun barisnya; yang menggambar ke PDF memakainya apa
 * adanya. Dikembalikan sebagai larik supaya dapat diuji tanpa perender PDF.
 */
export function signingAuthorityLines(input: {
  form: SigningAuthorityForm;
  /** Jabatan pejabat yang diwakili, mis. "Kepala SMA Qur'an Cipansor". */
  representedOffice?: string | null;
  /** Jabatan penanda tangan, mis. "Sekretaris Yayasan". */
  signerOffice?: string | null;
}): string[] {
  const { form, representedOffice, signerOffice } = input;
  const lines: string[] = [];

  if (form === SigningAuthorityForm.ATAS_NAMA && representedOffice) {
    lines.push(`a.n. ${representedOffice}`);
    if (signerOffice) lines.push(`${signerOffice},`);
  } else if (form === SigningAuthorityForm.UNTUK_BELIAU && representedOffice) {
    // u.b. hanya bermakna setelah a.n.; bila jabatan diwakili tidak diberikan,
    // tidak ada yang dapat dicetak dan bloknya jatuh kembali ke bentuk biasa.
    lines.push(`a.n. ${representedOffice}`);
    if (signerOffice) lines.push(`u.b. ${signerOffice},`);
  } else if (
    form === SigningAuthorityForm.PELAKSANA_TUGAS &&
    representedOffice
  ) {
    lines.push(`Plt. ${representedOffice},`);
  } else if (
    form === SigningAuthorityForm.PELAKSANA_HARIAN &&
    representedOffice
  ) {
    lines.push(`Plh. ${representedOffice},`);
  } else if (signerOffice) {
    lines.push(`${signerOffice},`);
  }

  return lines;
}

/**
 * Bentuk garis kewenangan yang **boleh dipilih** seorang penanda tangan.
 *
 * Semuanya boleh dipilih oleh penanda tangan yang sudah ditunjuk — sistem tidak
 * memiliki data surat kuasa atau SK penunjukan untuk mempersempitnya, dan
 * mempersempit berdasarkan jabatan akan mengarang aturan yang tidak ada di
 * pedoman. Yang disaring di sini hanyalah bentuk yang tidak masuk akal untuk
 * naskah keluar dengan pengirim sendiri: tidak ada. Dikembalikan sebagai daftar
 * terurut supaya antarmuka menampilkannya dengan urutan pedoman.
 */
export const SELECTABLE_SIGNING_AUTHORITY_FORMS: readonly SigningAuthorityForm[] =
  [
    SigningAuthorityForm.NONE,
    SigningAuthorityForm.ATAS_NAMA,
    SigningAuthorityForm.UNTUK_BELIAU,
    SigningAuthorityForm.PELAKSANA_TUGAS,
    SigningAuthorityForm.PELAKSANA_HARIAN,
  ];

/** Bentuk yang menuntut jabatan yang diwakili agar dapat dicetak. */
export function requiresRepresentedOffice(form: SigningAuthorityForm): boolean {
  return form !== SigningAuthorityForm.NONE;
}
