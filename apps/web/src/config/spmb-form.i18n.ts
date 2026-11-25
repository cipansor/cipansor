import type { Locale } from "@/locales";
import { QURAN_ABILITY_LABELS, type QuranAbilityCode } from "@cipansor/shared";

/**
 * The public SPMB form, its status lookup and its document upload, in the
 * three languages of the public site (decisions/istilah-dan-penamaan.md).
 * The intakes above the form have their own words in `spmb.i18n.ts`.
 *
 * What a visitor types, what the unit's admin entered (period, wave and unit
 * names) and what the API answers are shown as they are, in Indonesian.
 * Indonesian terms the registration is about — NIK, Kartu Keluarga, KTP,
 * kecamatan — are kept and glossed, since they are what the parent holds.
 */
export interface SpmbFormContent {
  hero: {
    /** "Pendaftaran SPMB Pesantren Cipansor". */
    title: (site: string) => string;
    intro: string;
    /** Before the first tab's name. */
    fillIn: string;
    /**
     * Straight after the first tab's name, up to the second. Carries its own
     * leading space or comma, since English puts "tab" after the name.
     */
    thenSave: string;
    /** Straight after the second tab's name, up to the phone number. */
    askUs: string;
    /** Between the phone number and WhatsApp. */
    or: string;
  };
  tabs: { info: string; check: string };
  shut: {
    upcomingTitle: string;
    closedTitle: string;
    /** "Pendaftaran SD IT akan dibuka pada 1 Januari 2027. …" */
    upcomingBody: (unit: string, date: string) => string;
    closedBody: string;
    noneBody: string;
  };
  banner: {
    title: string;
    /** The chosen unit: "SPMB 2027/2028 SD IT: Gelombang 1 dibuka hingga 20 Desember 2026". */
    chosen: (period: string, wave: string, date: string) => string;
    chosenNoWave: (period: string, date: string) => string;
    /** No unit chosen yet: which units are open, and the first close. */
    open: (units: string, wave: string, date: string) => string;
    openNoWave: (units: string, date: string) => string;
    unit: string;
    registrationFee: string;
    free: string;
    timeLeft: string;
    days: (count: string) => string;
  };
  steps: {
    student: string;
    parent: string;
    address: string;
    quran: string;
    documents: string;
    confirm: string;
  };
  stepHint: string;
  student: {
    unit: string;
    unitPlaceholder: string;
    notOpenYet: string;
    closed: string;
    fullName: string;
    fullNamePlaceholder: string;
    nickname: string;
    birthPlace: string;
    birthDate: string;
    gender: string;
    genderPlaceholder: string;
    male: string;
    female: string;
    nationalId: string;
    familyCard: string;
    /**
     * Shown under the NIK field when the 16 digits disagree with the birth date
     * or the sex chosen above (Dukcapil: digits 7–12 are DD MM YY, +40 for
     * girls). Empty string means "no complaint".
     */
    nikError: (problem: "format" | "date" | "birthDate" | "gender") => string;
  };
  parent: {
    fatherHeading: string;
    fatherName: string;
    motherHeading: string;
    motherName: string;
    occupation: string;
    whatsapp: string;
  };
  address: {
    street: string;
    village: string;
    district: string;
    city: string;
    province: string;
    postalCode: string;
  };
  quran: {
    ability: string;
    abilityPlaceholder: string;
    abilities: Record<QuranAbilityCode, string>;
    juz: string;
    juzPlaceholder: string;
    juzHint: string;
    noteTitle: string;
    note: string;
  };
  documents: {
    savedTitle: (registrationNo: string) => string;
    savedBody: string;
    instructionsTitle: string;
    instructions: string;
    photo: string;
    idCard: string;
    familyCard: string;
    birthCertificate: string;
    chooseFile: string;
    camera: string;
    checking: string;
    valid: string;
    recheck: string;
    mismatch: string;
    toastValid: string;
    toastRecheck: string;
    toastMismatch: string;
    toastUnchecked: string;
    uncheckedNote: string;
    /** Shown when the document was not scanned at all (OCR flag off). */
    manualNote: string;
    /** Shown when the local OCR engine read the document. */
    ocrEngineNote: string;
    /** Shown when every compared field matched. */
    ocrMatchedNote: string;
    /** Shown when the document was read but nothing could be compared. */
    ocrPartialNote: string;
    /** Shown when at least one field differs; `fields` is a comma-joined list. */
    ocrMismatchNote: (fields: string) => string;
    ocrField: {
      nationalId: string;
      familyCardNumber: string;
      fullName: string;
      birthPlace: string;
      birthDate: string;
    };
  };
  confirm: {
    studentHeading: string;
    name: string;
    gender: string;
    born: string;
    unit: string;
    parentHeading: string;
    father: string;
    mother: string;
    addressHeading: string;
    documentsHeading: string;
    uploaded: string;
    notUploaded: string;
    statementTitle: string;
    statement: string;
    /**
     * UU PDP 27/2022 Pasal 20 dan 25: the parent/guardian must consent before
     * the child's data is sent. The checkbox is not decoration — the API
     * refuses a submission without it. `consentLink` is the words inside
     * `consent`, the anchor to the public policy page; the sentence is split so
     * each language places the link where its grammar puts it.
     */
    consentBefore: string;
    consentLink: string;
    consentAfter: string;
    consentRequired: string;
    /** Shown when the policy page has no published version yet. */
    consentUnavailable: string;
  };
  actions: {
    previous: string;
    next: string;
    submit: string;
    submitting: string;
  };
  toasts: {
    studentIncomplete: string;
    parentIncomplete: string;
    addressIncomplete: string;
    unitNotOpen: string;
    uploadsDone: string;
    /** "Beberapa berkas masih gagal diunggah: KK, Akta". */
    uploadsStillFailing: (files: string) => string;
    retryFailed: string;
    savedButUploadsFailed: (registrationNo: string, files: string) => string;
    submitFailed: string;
  };
  checkTab: { heading: string; body: string };
  help: { heading: string; body: string };
  success: {
    heading: string;
    thanks: (name: string) => string;
    numberLabel: string;
    keepNumber: string;
    close: string;
  };
  tracker: {
    registrationNo: string;
    /** "Contoh: REG-2027-0001". */
    example: (registrationNo: string) => string;
    birthDate: string;
    search: string;
    notFound: string;
    steps: {
      REGISTERED: string;
      DOCUMENT_CHECK: string;
      TEST_COMPLETED: string;
      ACCEPTED: string;
    };
    status: {
      REGISTERED: string;
      DOCUMENT_CHECK: string;
      TEST_SCHEDULED: string;
      TEST_COMPLETED: string;
      ACCEPTED: string;
      REJECTED: string;
      ENROLLED: string;
      CANCELLED: string;
    };
    history: string;
    received: string;
    accepted: string;
    scores: string;
    academic: string;
    interview: string;
    quran: string;
    documents: string;
    verified: string;
    waiting: string;
    noDocuments: string;
    enrolledTitle: string;
    enrolledBody: (unit: string) => string;
  };
  trackPage: { heading: string; intro: string; formHeading: string };
}

const ID: SpmbFormContent = {
  hero: {
    title: (site) => `Pendaftaran SPMB ${site}`,
    intro:
      "Sistem Penerimaan Murid Baru (SPMB) Yayasan Pesantren Cipansor melayani seluruh unit pendidikan: TK Qur'an, SD IT, SMP IT, dan SMA Qur'an. Pendaftaran dilakukan secara online. Jadwal, biaya, dan persyaratan tiap unit tercantum di bawah.",
    fillIn: "Isi formulir pada tab",
    thenSave:
      ", lalu simpan nomor pendaftaran Anda untuk memantau perkembangan seleksi melalui tab",
    askUs: ". Bila ada pertanyaan, hubungi kami di",
    or: "atau melalui",
  },
  tabs: { info: "Informasi & Pendaftaran", check: "Cek Status" },
  shut: {
    upcomingTitle: "Pendaftaran Belum Dibuka",
    closedTitle: "Pendaftaran Telah Ditutup",
    upcomingBody: (unit, date) =>
      `Pendaftaran ${unit} akan dibuka pada ${date}. Silakan kembali pada tanggal tersebut.`,
    closedBody:
      "Pendaftaran semua unit telah ditutup. Informasi gelombang berikutnya akan diumumkan melalui halaman ini. Untuk menanyakan ketersediaan kuota, silakan hubungi panitia SPMB.",
    noneBody:
      "Mohon maaf, saat ini belum ada periode penerimaan murid baru yang dibuka. Silakan hubungi panitia untuk informasi lebih lanjut.",
  },
  banner: {
    title: "Formulir Pendaftaran",
    chosen: (period, wave, date) => `${period}: ${wave} dibuka hingga ${date}`,
    chosenNoWave: (period, date) => `${period}: dibuka hingga ${date}`,
    open: (units, wave, date) =>
      `Dibuka untuk ${units}. ${wave} ditutup ${date}`,
    openNoWave: (units, date) =>
      `Dibuka untuk ${units}. Yang pertama ditutup ${date}`,
    unit: "Unit",
    registrationFee: "Biaya pendaftaran",
    free: "Gratis",
    timeLeft: "Sisa Waktu",
    days: (count) => `${count} Hari`,
  },
  steps: {
    student: "Data Calon Santri",
    parent: "Data Orang Tua",
    address: "Alamat",
    quran: "Kemampuan Al-Qur'an",
    documents: "Dokumen",
    confirm: "Konfirmasi",
  },
  stepHint: "Lengkapi data berikut dengan benar",
  student: {
    unit: "Pilih Unit Pendidikan",
    unitPlaceholder: "Pilih unit tujuan",
    notOpenYet: "belum dibuka",
    closed: "ditutup",
    fullName: "Nama Lengkap",
    fullNamePlaceholder: "Sesuai akta kelahiran",
    nickname: "Nama Panggilan",
    birthPlace: "Tempat Lahir",
    birthDate: "Tanggal Lahir",
    gender: "Jenis Kelamin",
    genderPlaceholder: "Pilih jenis kelamin",
    male: "Laki-laki",
    female: "Perempuan",
    nationalId: "NIK",
    familyCard: "Nomor Kartu Keluarga",
    nikError: (problem) => {
      if (problem === "format") {
        return "NIK harus 16 digit angka — periksa kembali angka pada KTP/KK";
      }
      // The public form has no appeal path, and a real NIK can disagree with the
      // birth date the family uses (a Dukcapil mis-entry, a different date
      // recognised at home). Leaving the field blank stays a way through.
      const boleh = " Bila NIK memang tidak sesuai, kosongkan saja isian NIK.";
      return problem === "date"
        ? "NIK tidak memuat tanggal lahir yang sah — periksa kembali 16 digitnya." +
            boleh
        : problem === "birthDate"
          ? "Tanggal lahir pada NIK tidak sama dengan tanggal lahir di atas." +
            boleh
          : "Jenis kelamin pada NIK tidak sama dengan jenis kelamin yang dipilih." +
            boleh;
    },
  },
  parent: {
    fatherHeading: "Data Ayah",
    fatherName: "Nama Ayah",
    motherHeading: "Data Ibu",
    motherName: "Nama Ibu",
    occupation: "Pekerjaan",
    whatsapp: "No. WhatsApp",
  },
  address: {
    street: "Alamat Lengkap (Jalan, RT/RW)",
    village: "Desa/Kelurahan",
    district: "Kecamatan",
    city: "Kota/Kabupaten",
    province: "Provinsi",
    postalCode: "Kode Pos",
  },
  quran: {
    ability: "Kemampuan Membaca Al-Qur'an",
    abilityPlaceholder: "Pilih kemampuan",
    // The portal's own labels, so the two cannot drift apart.
    abilities: QURAN_ABILITY_LABELS,
    juz: "Jumlah Hafalan (Juz)",
    juzPlaceholder: "Jika sudah hafal, tulis jumlah juz",
    juzHint: "Kosongkan jika belum memiliki hafalan",
    noteTitle: "Catatan:",
    note: "Kemampuan Al-Qur'an akan diuji saat tes masuk. Isilah dengan jujur sesuai kondisi sebenarnya.",
  },
  documents: {
    savedTitle: (no) => `Pendaftaran Tersimpan (${no})`,
    savedBody:
      "Data formulir pendaftaran Anda sudah tersimpan, tetapi beberapa berkas gagal diunggah. Pilih kembali berkas yang gagal, lalu tekan tombol di bawah untuk mengunggah ulang.",
    instructionsTitle: "Petunjuk Unggah Dokumen:",
    instructions:
      "Anda dapat memilih berkas dari perangkat atau memotret langsung dengan kamera HP/laptop. Petugas SPMB memeriksa setiap dokumen untuk mencocokkan NIK dan nomor KK dengan isian formulir.",
    photo: "Pas Foto Calon Santri (3×4, latar biru)",
    idCard: "KTP Orang Tua / Wali",
    familyCard: "Kartu Keluarga (KK)",
    birthCertificate: "Akta Kelahiran",
    chooseFile: "Pilih Berkas",
    camera: "Kamera / Foto Langsung",
    checking:
      "Memeriksa dokumen… (bila tidak terbaca, petugas akan memeriksanya sendiri)",
    valid: "Data Cocok",
    recheck: "Perlu Dicek Ulang",
    mismatch: "Data Tidak Cocok",
    toastValid:
      "Data dokumen cocok. Petugas tetap memeriksa gambarnya secara langsung.",
    toastRecheck:
      "Dokumen tersimpan. Pembacaan otomatis tidak tersedia; petugas akan memeriksanya.",
    toastMismatch: "Dokumen terbaca, tetapi datanya tidak cocok dengan isian.",
    toastUnchecked:
      "Pemeriksaan otomatis gagal; petugas akan memeriksa dokumen ini.",
    uncheckedNote:
      "Pemeriksaan otomatis gagal. Petugas akan memeriksa dokumen ini secara langsung.",
    manualNote: "Dokumen akan diverifikasi manual oleh petugas.",
    ocrEngineNote:
      "Isi dokumen dibaca mesin di sistem yayasan sendiri, tanpa pihak ketiga. Hasil ini menandai kecocokan isian, bukan bukti keaslian.",
    ocrMatchedNote:
      "Semua isian yang dibandingkan cocok. Petugas tetap memeriksa dokumennya.",
    ocrPartialNote:
      "Dokumen terbaca, tetapi belum ada isian yang bisa dibandingkan. Petugas akan memeriksanya.",
    ocrMismatchNote: (fields) =>
      `Tidak sama dengan isian: ${fields}. Periksa kembali sebelum verifikasi.`,
    ocrField: {
      nationalId: "NIK",
      familyCardNumber: "Nomor KK",
      fullName: "Nama",
      birthPlace: "Tempat lahir",
      birthDate: "Tanggal lahir",
    },
  },
  confirm: {
    studentHeading: "Data Calon Santri",
    name: "Nama",
    gender: "Jenis Kelamin",
    born: "Tempat, Tanggal Lahir",
    unit: "Unit",
    parentHeading: "Data Orang Tua",
    father: "Ayah",
    mother: "Ibu",
    addressHeading: "Alamat",
    documentsHeading: "Dokumen",
    uploaded: "Sudah dipilih",
    notUploaded: "Belum dipilih",
    statementTitle: "Pernyataan:",
    statement:
      "Dengan mengirim formulir ini, saya menyatakan bahwa data yang saya isikan adalah benar dan dapat dipertanggungjawabkan.",
    consentBefore:
      "Saya, sebagai orang tua atau wali, menyetujui pemrosesan data pribadi anak saya sebagaimana dijelaskan dalam",
    consentLink: "Kebijakan Privasi",
    consentAfter:
      ", dan saya berhak menarik persetujuan ini kapan saja dengan menghubungi panitia SPMB.",
    consentRequired:
      "Persetujuan orang tua atau wali diperlukan sebelum formulir dapat dikirim.",
    consentUnavailable:
      "Kebijakan Privasi belum diterbitkan, sehingga pendaftaran belum dapat menerima persetujuan. Silakan hubungi panitia SPMB.",
  },
  actions: {
    previous: "Sebelumnya",
    next: "Selanjutnya",
    submit: "Kirim Pendaftaran",
    submitting: "Mengirim…",
  },
  toasts: {
    studentIncomplete: "Lengkapi semua data yang wajib diisi",
    parentIncomplete: "Lengkapi data orang tua yang wajib diisi",
    addressIncomplete: "Lengkapi alamat yang wajib diisi",
    unitNotOpen: "Pendaftaran untuk unit ini sedang tidak dibuka",
    uploadsDone: "Seluruh berkas dokumen berhasil diunggah.",
    uploadsStillFailing: (files) =>
      `Beberapa berkas masih gagal diunggah: ${files}`,
    retryFailed: "Gagal mengunggah ulang berkas. Silakan coba lagi.",
    savedButUploadsFailed: (no, files) =>
      `Pendaftaran tersimpan (${no}), tetapi berkas gagal diunggah: ${files}`,
    submitFailed: "Gagal mengirim pendaftaran. Silakan coba lagi.",
  },
  checkTab: {
    heading: "Cek Status Pendaftaran",
    body: "Masukkan nomor pendaftaran dan tanggal lahir calon santri. Nomor pendaftaran ditampilkan setelah formulir berhasil dikirim — simpan nomor tersebut untuk memantau proses seleksi.",
  },
  help: {
    heading: "Butuh Bantuan?",
    body: "Hubungi panitia SPMB untuk informasi lebih lanjut",
  },
  success: {
    heading: "Pendaftaran Berhasil!",
    thanks: (name) => `Terima kasih, ${name}`,
    numberLabel: "Nomor Pendaftaran:",
    keepNumber:
      "Simpan nomor ini. Dengan nomor ini dan tanggal lahir calon santri, perkembangan seleksi dapat dipantau di tab Cek Status.",
    close: "Tutup",
  },
  tracker: {
    registrationNo: "No. Pendaftaran",
    example: (no) => `Contoh: ${no}`,
    birthDate: "Tanggal Lahir",
    search: "Cek Status",
    notFound:
      "Data tidak ditemukan. Pastikan nomor pendaftaran dan tanggal lahir sudah benar.",
    steps: {
      REGISTERED: "Pendaftaran",
      DOCUMENT_CHECK: "Verifikasi Dokumen",
      TEST_COMPLETED: "Tes & Seleksi",
      ACCEPTED: "Hasil Seleksi",
    },
    // Worded for the parent reading it; the portal's own status labels are in
    // hooks/use-admissions.ts.
    status: {
      REGISTERED: "Terdaftar",
      DOCUMENT_CHECK: "Verifikasi Dokumen",
      TEST_SCHEDULED: "Tes Dijadwalkan",
      TEST_COMPLETED: "Tes Selesai",
      ACCEPTED: "Diterima",
      REJECTED: "Tidak Diterima",
      ENROLLED: "Daftar Ulang Selesai",
      CANCELLED: "Dibatalkan",
    },
    history: "Riwayat",
    received: "Pendaftaran Diterima",
    accepted: "Dinyatakan Diterima",
    scores: "Nilai Seleksi:",
    academic: "Akademik",
    interview: "Wawancara",
    quran: "Al-Qur'an",
    documents: "Verifikasi Dokumen",
    verified: "Terverifikasi",
    waiting: "Menunggu",
    noDocuments: "Belum ada dokumen yang diunggah.",
    enrolledTitle: "Selamat! Daftar Ulang Selesai",
    enrolledBody: (unit) =>
      `Ananda telah resmi menjadi santri di ${unit}. Silakan tunggu informasi jadwal masuk.`,
  },
  trackPage: {
    heading: "Lacak Pendaftaran",
    intro: "Masukkan nomor pendaftaran dan tanggal lahir calon santri",
    formHeading: "Formulir pencarian pendaftaran",
  },
};

const EN: SpmbFormContent = {
  hero: {
    title: (site) => `SPMB Registration — ${site}`,
    intro:
      "SPMB (Sistem Penerimaan Murid Baru, the national new-student admission system) at Yayasan Pesantren Cipansor covers every school: TK Qur'an, SD IT, SMP IT and SMA Qur'an. Registration is online. Each school's schedule, fees and requirements are listed below.",
    fillIn: "Fill in the form on the",
    thenSave:
      " tab, then keep your registration number to follow the selection on the",
    askUs: " tab. If you have questions, call us on",
    or: "or reach us on",
  },
  tabs: { info: "Information & Registration", check: "Check Status" },
  shut: {
    upcomingTitle: "Registration Not Yet Open",
    closedTitle: "Registration Closed",
    upcomingBody: (unit, date) =>
      `Registration for ${unit} opens on ${date}. Please come back on that day.`,
    closedBody:
      "Registration has closed for every school. The next intake will be announced on this page. To ask whether places remain, please contact the SPMB committee.",
    noneBody:
      "There is no admission period open at the moment. Please contact the committee for more information.",
  },
  banner: {
    title: "Registration Form",
    chosen: (period, wave, date) => `${period}: ${wave} open until ${date}`,
    chosenNoWave: (period, date) => `${period}: open until ${date}`,
    open: (units, wave, date) => `Open for ${units}. ${wave} closes on ${date}`,
    openNoWave: (units, date) =>
      `Open for ${units}. The first to close closes on ${date}`,
    unit: "School",
    registrationFee: "Registration fee",
    free: "Free",
    timeLeft: "Time Left",
    days: (count) => `${count} days`,
  },
  steps: {
    student: "Applicant",
    parent: "Parents",
    address: "Address",
    quran: "Qur'an Reading",
    documents: "Documents",
    confirm: "Review",
  },
  stepHint: "Please fill in the details below accurately",
  student: {
    unit: "Choose a School",
    unitPlaceholder: "Choose the school applied to",
    notOpenYet: "not yet open",
    closed: "closed",
    fullName: "Full Name",
    fullNamePlaceholder: "As on the birth certificate",
    nickname: "Nickname",
    birthPlace: "Place of Birth",
    birthDate: "Date of Birth",
    gender: "Sex",
    genderPlaceholder: "Choose",
    male: "Male",
    female: "Female",
    nationalId: "NIK (national ID number)",
    familyCard: "Kartu Keluarga (family card) number",
    nikError: (problem) => {
      if (problem === "format") {
        return "The NIK must be 16 digits — check the numbers on the ID card";
      }
      const boleh =
        " If the NIK really does not match, leave the NIK field empty.";
      return problem === "date"
        ? "These 16 digits do not contain a real birth date — check them again." +
            boleh
        : problem === "birthDate"
          ? "The birth date in the NIK does not match the birth date above." +
            boleh
          : "The sex in the NIK does not match the sex selected." + boleh;
    },
  },
  parent: {
    fatherHeading: "Father",
    fatherName: "Father's Name",
    motherHeading: "Mother",
    motherName: "Mother's Name",
    occupation: "Occupation",
    whatsapp: "WhatsApp Number",
  },
  address: {
    street: "Street Address (street, RT/RW)",
    village: "Village (desa/kelurahan)",
    district: "District (kecamatan)",
    city: "City or Regency",
    province: "Province",
    postalCode: "Postal Code",
  },
  quran: {
    ability: "How the Applicant Reads the Qur'an",
    abilityPlaceholder: "Choose",
    abilities: {
      BELUM_BISA: "Cannot read yet",
      IQRA: "Still learning with Iqra",
      LANCAR: "Reads the Qur'an fluently",
      TARTIL: "Reads with tartil and good tajwid",
      TAHFIDZ: "Has memorised some juz",
    },
    juz: "Juz Memorised",
    juzPlaceholder: "If any, how many juz",
    juzHint: "Leave empty if none yet",
    noteTitle: "Note:",
    note: "Qur'an reading is tested at the entrance test. Please answer honestly.",
  },
  documents: {
    savedTitle: (no) => `Registration Saved (${no})`,
    savedBody:
      "Your registration is saved, but some files did not upload. Choose those files again and press the button below to upload them.",
    instructionsTitle: "Uploading documents:",
    instructions:
      "Choose a file from your device or take a photo with your phone or laptop camera. The SPMB staff check every document against the NIK and family card number in the form.",
    photo: "Applicant's Photo (3×4, blue background)",
    idCard: "Parent's or Guardian's KTP (identity card)",
    familyCard: "Kartu Keluarga (family card)",
    birthCertificate: "Birth Certificate",
    chooseFile: "Choose File",
    camera: "Camera / Take Photo",
    checking:
      "Checking the document… (if it cannot be read, staff will check it)",
    valid: "Details Match",
    recheck: "Needs a Second Look",
    mismatch: "Details Do Not Match",
    toastValid:
      "The document's details match. Staff will still look at the image.",
    toastRecheck:
      "Document saved. Automatic reading is not available; staff will check it.",
    toastMismatch:
      "The document was read, but its details do not match the form.",
    toastUnchecked:
      "The automatic check failed; staff will check this document.",
    uncheckedNote:
      "The automatic check failed. Staff will look at this document themselves.",
    manualNote: "The document will be verified manually by staff.",
    ocrEngineNote:
      "The document was read by a machine inside the yayasan's own system, with no third party. This only flags whether the fields match; it is not proof of authenticity.",
    ocrMatchedNote:
      "Every compared field matches. Staff will still review the document.",
    ocrPartialNote:
      "The document was read, but nothing could be compared yet. Staff will review it.",
    ocrMismatchNote: (fields) =>
      `Does not match the form: ${fields}. Please check before verification.`,
    ocrField: {
      nationalId: "NIK",
      familyCardNumber: "Family card number",
      fullName: "Name",
      birthPlace: "Place of birth",
      birthDate: "Date of birth",
    },
  },
  confirm: {
    studentHeading: "Applicant",
    name: "Name",
    gender: "Sex",
    born: "Place and Date of Birth",
    unit: "School",
    parentHeading: "Parents",
    father: "Father",
    mother: "Mother",
    addressHeading: "Address",
    documentsHeading: "Documents",
    uploaded: "Chosen",
    notUploaded: "Not chosen",
    statementTitle: "Declaration:",
    statement:
      "By sending this form I declare that the information I have given is true and that I am responsible for it.",
    consentBefore:
      "I, as the parent or guardian, consent to the processing of my child's personal data as described in the",
    consentLink: "Privacy Policy",
    consentAfter:
      ", and I may withdraw this consent at any time by contacting the SPMB committee.",
    consentRequired:
      "A parent's or guardian's consent is required before the form can be sent.",
    consentUnavailable:
      "The Privacy Policy has not been published yet, so the form cannot take consent. Please contact the SPMB committee.",
  },
  actions: {
    previous: "Back",
    next: "Next",
    submit: "Send Registration",
    submitting: "Sending…",
  },
  toasts: {
    studentIncomplete: "Please fill in every required field",
    parentIncomplete: "Please fill in the required parent details",
    addressIncomplete: "Please fill in the required address fields",
    unitNotOpen: "Registration for this school is not open",
    uploadsDone: "Every document has been uploaded.",
    uploadsStillFailing: (files) => `Some files still did not upload: ${files}`,
    retryFailed: "Uploading again failed. Please try once more.",
    savedButUploadsFailed: (no, files) =>
      `Registration saved (${no}), but these files did not upload: ${files}`,
    submitFailed: "The registration could not be sent. Please try again.",
  },
  checkTab: {
    heading: "Check Registration Status",
    body: "Enter the registration number and the applicant's date of birth. The registration number is shown once the form has been sent — keep it to follow the selection.",
  },
  help: {
    heading: "Need Help?",
    body: "Contact the SPMB committee for more information",
  },
  success: {
    heading: "Registration Received!",
    thanks: (name) => `Thank you, ${name}`,
    numberLabel: "Registration Number:",
    keepNumber:
      "Keep this number. With it and the applicant's date of birth you can follow the selection on the Check Status tab.",
    close: "Close",
  },
  tracker: {
    registrationNo: "Registration No.",
    example: (no) => `For example: ${no}`,
    birthDate: "Date of Birth",
    search: "Check Status",
    notFound:
      "Nothing found. Please check the registration number and the date of birth.",
    steps: {
      REGISTERED: "Registration",
      DOCUMENT_CHECK: "Document Check",
      TEST_COMPLETED: "Test & Selection",
      ACCEPTED: "Result",
    },
    status: {
      REGISTERED: "Registered",
      DOCUMENT_CHECK: "Documents Being Checked",
      TEST_SCHEDULED: "Test Scheduled",
      TEST_COMPLETED: "Test Done",
      ACCEPTED: "Accepted",
      REJECTED: "Not Accepted",
      ENROLLED: "Enrolment Complete",
      CANCELLED: "Cancelled",
    },
    history: "History",
    received: "Registration Received",
    accepted: "Accepted",
    scores: "Selection Scores:",
    academic: "Academic",
    interview: "Interview",
    quran: "Qur'an",
    documents: "Document Check",
    verified: "Checked",
    waiting: "Waiting",
    noDocuments: "No documents uploaded yet.",
    enrolledTitle: "Congratulations! Enrolment Complete",
    enrolledBody: (unit) =>
      `Your child is now a santri (student) of ${unit}. Please wait for the start date.`,
  },
  trackPage: {
    heading: "Track a Registration",
    intro: "Enter the registration number and the applicant's date of birth",
    formHeading: "Registration lookup form",
  },
};

const AR: SpmbFormContent = {
  hero: {
    title: (site) => `التسجيل للقبول في ${site}`,
    intro:
      "يخدم نظام قبول الطلاب الجدد (SPMB) في مؤسسة معهد سيبانسور جميعَ وحداتها التعليمية: روضة القرآن، والابتدائية، والإعدادية، وثانوية القرآن. يتمّ التسجيل عبر الإنترنت، وتجدون أدناه مواعيد كل وحدة ورسومها وشروطها.",
    fillIn: "املؤوا الاستمارة في تبويب",
    thenSave: "، ثم احتفظوا برقم التسجيل لمتابعة مراحل الاختيار في تبويب",
    askUs: ". وللاستفسار اتصلوا بنا على الرقم",
    or: "أو عبر",
  },
  tabs: { info: "المعلومات والتسجيل", check: "متابعة الطلب" },
  shut: {
    upcomingTitle: "لم يُفتح التسجيل بعد",
    closedTitle: "أُغلق التسجيل",
    upcomingBody: (unit, date) =>
      `يُفتح التسجيل في ${unit} يوم ${date}. نرجو العودة في ذلك اليوم.`,
    closedBody:
      "أُغلق التسجيل في جميع الوحدات، وسيُعلَن عن الدفعة القادمة في هذه الصفحة. للسؤال عن المقاعد المتبقية يُرجى التواصل مع لجنة القبول.",
    noneBody:
      "لا توجد حاليًا فترة قبول مفتوحة. يُرجى التواصل مع لجنة القبول لمزيد من المعلومات.",
  },
  banner: {
    title: "استمارة التسجيل",
    chosen: (period, wave, date) => `${period}: ${wave} مفتوحة حتى ${date}`,
    chosenNoWave: (period, date) => `${period}: التسجيل مفتوح حتى ${date}`,
    open: (units, wave, date) =>
      `التسجيل مفتوح في: ${units}. تُغلق ${wave} يوم ${date}`,
    openNoWave: (units, date) =>
      `التسجيل مفتوح في: ${units}. أقرب إغلاق يوم ${date}`,
    unit: "الوحدة",
    registrationFee: "رسوم التسجيل",
    free: "مجانًا",
    timeLeft: "الوقت المتبقي",
    days: (count) => `${count} يومًا`,
  },
  steps: {
    student: "بيانات المتقدّم",
    parent: "بيانات الوالدين",
    address: "العنوان",
    quran: "قراءة القرآن",
    documents: "الوثائق",
    confirm: "المراجعة",
  },
  stepHint: "يُرجى ملء البيانات التالية بدقّة",
  student: {
    unit: "اختيار الوحدة التعليمية",
    unitPlaceholder: "اختاروا الوحدة",
    notOpenYet: "لم يُفتح بعد",
    closed: "مغلق",
    fullName: "الاسم الكامل",
    fullNamePlaceholder: "كما في شهادة الميلاد",
    nickname: "الاسم المتداول",
    birthPlace: "مكان الميلاد",
    birthDate: "تاريخ الميلاد",
    gender: "الجنس",
    genderPlaceholder: "اختاروا",
    male: "ذكر",
    female: "أنثى",
    nationalId: "رقم الهوية الوطنية (NIK)",
    familyCard: "رقم بطاقة العائلة (Kartu Keluarga)",
    nikError: (problem) => {
      if (problem === "format") {
        return "رقم الهوية الوطنية يجب أن يكون 16 رقمًا — راجعوا الأرقام في البطاقة";
      }
      const boleh =
        " وإن كان الرقم فعلًا غير مطابق فاتركوا خانة رقم الهوية فارغة.";
      return problem === "date"
        ? "هذه الأرقام الستة عشر لا تحمل تاريخ ميلاد صحيحًا — راجعوها." + boleh
        : problem === "birthDate"
          ? "تاريخ الميلاد في رقم الهوية لا يطابق تاريخ الميلاد أعلاه." + boleh
          : "الجنس في رقم الهوية لا يطابق الجنس المختار." + boleh;
    },
  },
  parent: {
    fatherHeading: "بيانات الأب",
    fatherName: "اسم الأب",
    motherHeading: "بيانات الأم",
    motherName: "اسم الأم",
    occupation: "المهنة",
    whatsapp: "رقم واتساب",
  },
  address: {
    street: "العنوان الكامل (الشارع، RT/RW)",
    village: "القرية (desa/kelurahan)",
    district: "الناحية (kecamatan)",
    city: "المدينة أو المحافظة",
    province: "الإقليم",
    postalCode: "الرمز البريدي",
  },
  quran: {
    ability: "مستوى قراءة القرآن",
    abilityPlaceholder: "اختاروا المستوى",
    abilities: {
      BELUM_BISA: "لا يقرأ بعد",
      IQRA: "ما زال يتعلّم بكتاب إقرأ",
      LANCAR: "يقرأ القرآن بطلاقة",
      TARTIL: "يقرأ بالترتيل ويُحسن التجويد",
      TAHFIDZ: "يحفظ بعض الأجزاء",
    },
    juz: "عدد الأجزاء المحفوظة",
    juzPlaceholder: "إن وُجد، اكتبوا عدد الأجزاء",
    juzHint: "اتركوه فارغًا إن لم يحفظ شيئًا بعد",
    noteTitle: "ملاحظة:",
    note: "تُختبر قراءة القرآن في اختبار القبول، فنرجو الإجابة بصدق.",
  },
  documents: {
    savedTitle: (no) => `حُفظ الطلب (${no})`,
    savedBody:
      "حُفظت بيانات طلبكم، لكن تعذّر رفع بعض الملفات. اختاروا تلك الملفات مرة أخرى ثم اضغطوا الزر أدناه لرفعها.",
    instructionsTitle: "رفع الوثائق:",
    instructions:
      "يمكنكم اختيار ملف من الجهاز أو التصوير مباشرة بكاميرا الهاتف أو الحاسوب. يطابق موظفو القبول كل وثيقة مع رقم الهوية ورقم بطاقة العائلة في الاستمارة.",
    photo: "صورة شخصية للمتقدّم (٣×٤، خلفية زرقاء)",
    idCard: "بطاقة هوية ولي الأمر (KTP)",
    familyCard: "بطاقة العائلة (Kartu Keluarga)",
    birthCertificate: "شهادة الميلاد",
    chooseFile: "اختيار ملف",
    camera: "الكاميرا / التصوير المباشر",
    checking: "جارٍ فحص الوثيقة… (إن تعذّرت قراءتها فسيفحصها الموظف)",
    valid: "البيانات مطابقة",
    recheck: "تحتاج إلى مراجعة",
    mismatch: "البيانات غير مطابقة",
    toastValid: "بيانات الوثيقة مطابقة، وسيطّلع الموظف على الصورة مع ذلك.",
    toastRecheck: "حُفظت الوثيقة. القراءة الآلية غير متاحة، وسيفحصها الموظف.",
    toastMismatch: "قُرئت الوثيقة، لكن بياناتها لا تطابق الاستمارة.",
    toastUnchecked: "تعذّر الفحص الآلي، وسيفحص الموظف هذه الوثيقة.",
    uncheckedNote: "تعذّر الفحص الآلي. سيطّلع الموظف على هذه الوثيقة بنفسه.",
    manualNote: "ستُتحقَّق الوثيقة يدويًا من قبل الموظف.",
    ocrEngineNote:
      "قُرئت الوثيقة آليًا داخل نظام المعهد نفسه، دون أي طرف ثالث. هذا يبيّن مطابقة الحقول فقط، وليس دليلًا على صحتها.",
    ocrMatchedNote: "جميع الحقول المقارنة مطابقة. سيظّل الموظف يراجع الوثيقة.",
    ocrPartialNote:
      "قُرئت الوثيقة، لكن لم يمكن مقارنة أي حقل بعد. سيراجعها الموظف.",
    ocrMismatchNote: (fields) =>
      `لا تطابق الاستمارة: ${fields}. يرجى المراجعة قبل التحقق.`,
    ocrField: {
      nationalId: "رقم الهوية",
      familyCardNumber: "رقم بطاقة العائلة",
      fullName: "الاسم",
      birthPlace: "مكان الميلاد",
      birthDate: "تاريخ الميلاد",
    },
  },
  confirm: {
    studentHeading: "بيانات المتقدّم",
    name: "الاسم",
    gender: "الجنس",
    born: "مكان الميلاد وتاريخه",
    unit: "الوحدة",
    parentHeading: "بيانات الوالدين",
    father: "الأب",
    mother: "الأم",
    addressHeading: "العنوان",
    documentsHeading: "الوثائق",
    uploaded: "تم الاختيار",
    notUploaded: "لم يُختر",
    statementTitle: "إقرار:",
    statement:
      "بإرسال هذه الاستمارة أُقرّ بأن البيانات التي أدخلتها صحيحة وأنني مسؤول عنها.",
    consentBefore:
      "أنا، بصفتي وليّ الأمر، أوافق على معالجة البيانات الشخصية لطفلي على النحو الموضّح في",
    consentLink: "سياسة الخصوصية",
    consentAfter:
      "، ويحق لي سحب هذه الموافقة في أي وقت بالتواصل مع لجنة القبول.",
    consentRequired: "موافقة وليّ الأمر مطلوبة قبل إرسال الاستمارة.",
    consentUnavailable:
      "لم تُنشر سياسة الخصوصية بعد، لذا لا يمكن للاستمارة تسجيل الموافقة. يُرجى التواصل مع لجنة القبول.",
  },
  actions: {
    previous: "السابق",
    next: "التالي",
    submit: "إرسال الطلب",
    submitting: "جارٍ الإرسال…",
  },
  toasts: {
    studentIncomplete: "يُرجى ملء جميع الحقول المطلوبة",
    parentIncomplete: "يُرجى ملء بيانات الوالدين المطلوبة",
    addressIncomplete: "يُرجى ملء حقول العنوان المطلوبة",
    unitNotOpen: "التسجيل في هذه الوحدة غير مفتوح الآن",
    uploadsDone: "رُفعت جميع الوثائق.",
    uploadsStillFailing: (files) => `ما زال تعذّر رفع بعض الملفات: ${files}`,
    retryFailed: "تعذّرت إعادة الرفع. يُرجى المحاولة مرة أخرى.",
    savedButUploadsFailed: (no, files) =>
      `حُفظ الطلب (${no})، لكن تعذّر رفع هذه الملفات: ${files}`,
    submitFailed: "تعذّر إرسال الطلب. يُرجى المحاولة مرة أخرى.",
  },
  checkTab: {
    heading: "متابعة حالة الطلب",
    body: "أدخلوا رقم التسجيل وتاريخ ميلاد المتقدّم. يظهر رقم التسجيل بعد إرسال الاستمارة بنجاح، فاحتفظوا به لمتابعة مراحل الاختيار.",
  },
  help: {
    heading: "هل تحتاجون إلى مساعدة؟",
    body: "تواصلوا مع لجنة القبول لمزيد من المعلومات",
  },
  success: {
    heading: "تمّ التسجيل!",
    thanks: (name) => `شكرًا لكم، ${name}`,
    numberLabel: "رقم التسجيل:",
    keepNumber:
      "احتفظوا بهذا الرقم. به وبتاريخ ميلاد المتقدّم يمكنكم متابعة مراحل الاختيار في تبويب «متابعة الطلب».",
    close: "إغلاق",
  },
  tracker: {
    registrationNo: "رقم التسجيل",
    example: (no) => `مثال: ${no}`,
    birthDate: "تاريخ الميلاد",
    search: "عرض الحالة",
    notFound: "لم يُعثر على الطلب. تأكّدوا من رقم التسجيل وتاريخ الميلاد.",
    steps: {
      REGISTERED: "التسجيل",
      DOCUMENT_CHECK: "تدقيق الوثائق",
      TEST_COMPLETED: "الاختبار والاختيار",
      ACCEPTED: "النتيجة",
    },
    status: {
      REGISTERED: "مسجَّل",
      DOCUMENT_CHECK: "قيد تدقيق الوثائق",
      TEST_SCHEDULED: "حُدّد موعد الاختبار",
      TEST_COMPLETED: "أُجري الاختبار",
      ACCEPTED: "مقبول",
      REJECTED: "غير مقبول",
      ENROLLED: "اكتمل التسجيل النهائي",
      CANCELLED: "أُلغي",
    },
    history: "السجلّ",
    received: "استُلم الطلب",
    accepted: "أُعلن القبول",
    scores: "درجات الاختيار:",
    academic: "الأكاديمي",
    interview: "المقابلة",
    quran: "القرآن",
    documents: "تدقيق الوثائق",
    verified: "مدقَّقة",
    waiting: "قيد الانتظار",
    noDocuments: "لم تُرفع أي وثيقة بعد.",
    enrolledTitle: "مبارك! اكتمل التسجيل النهائي",
    enrolledBody: (unit) =>
      `أصبح ابنكم طالبًا في ${unit}. يُرجى انتظار موعد بدء الدراسة.`,
  },
  trackPage: {
    heading: "متابعة الطلب",
    intro: "أدخلوا رقم التسجيل وتاريخ ميلاد المتقدّم",
    formHeading: "استمارة البحث عن الطلب",
  },
};

const CONTENT: Record<Locale, SpmbFormContent> = { id: ID, en: EN, ar: AR };

export function spmbFormContentFor(locale: Locale): SpmbFormContent {
  return CONTENT[locale] ?? ID;
}
