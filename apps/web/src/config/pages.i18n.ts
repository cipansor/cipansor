import type { Locale } from "@/locales";
import { ORGANISATION, type OfficeGroupSlug } from "@cipansor/shared";

/** The groups whose members show a position (see `structure.positions`). */
export const STRUCTURE_POSITIONED: OfficeGroupSlug[] = [
  "pengurus",
  "pesantren",
];

/**
 * Page chrome for the public pages beyond the homepage — headings, standfirsts,
 * breadcrumb labels, and the closing call to action.
 *
 * The *data* those pages render (unit descriptions, programme copy, article
 * headlines) is translated in site.i18n.ts and news.i18n.ts, so a page usually
 * needs only its own frame here.
 */
export interface PagesContent {
  programs: {
    title: string;
    /** <title> is built as `${title} — ${legalName}`; only this differs. */
    metaDescription: string;
    lead: (visi: string) => string;
    ctaHeading: string;
    ctaBody: (year: string) => string;
    ctaRegister: string;
    ctaUnits: string;
  };
  units: {
    title: string;
    metaDescription: string;
    lead: string;
    moreLink: (shortName: string) => string;
  };
  campus: {
    title: string;
    metaDescription: string;
    lead: string;
    galleryLink: string;
    contactPrompt: string;
    contactLink: string;
  };
  activities: {
    title: string;
    metaDescription: string;
    lead: string;
    extracurricularHeading: string;
    extracurricularLead: string;
    /** Shown while the list loads and when it cannot be loaded. */
    extracurricularUnavailable: string;
    /** Keyed by the extracurricular category the portal stores. */
    categories: Record<string, string>;
    agendaHeading: string;
    agendaLead: string;
    ctaHeading: string;
    ctaBody: string;
    ctaRegister: string;
    ctaFacilities: string;
  };
  unitDetail: {
    highlightsHeading: (shortName: string) => string;
    ctaHeading: (unitName: string) => string;
    ctaBody: string;
    ctaRegister: string;
    ctaContact: string;
    otherUnitsHeading: string;
  };
  news: {
    title: string;
    metaDescription: string;
    lead: string;
    readMore: string;
    emptyState: string;
  };
  gallery: {
    title: string;
    metaDescription: string;
    lead: string;
    photoCount: (n: number) => string;
  };
  leadership: {
    title: string;
    metaDescription: string;
    lead: string;
    photoAlt: (name: string) => string;
    /** Keyed by leader slug — positions are prose and must not key anything. */
    positions: Record<string, string>;
    /**
     * Each motto is an Indonesian rendering of a hadith the leader chose.
     * Producing Arabic or English from that Indonesian would publish a
     * reconstruction as a quotation attributed to the Prophet ﷺ under a named
     * person's photograph, so the mottos stay as they are and this line says
     * why. See config/content.i18n.ts.
     */
    mottoNotTranslated: string | null;
    /** The full structure below the leaders, from office-holders.ts. */
    structure: {
      heading: string;
      lead: string;
      groups: Record<OfficeGroupSlug, string>;
      /**
       * Keyed by office slug, for the Pengurus and the pesantren only — under
       * "Pembina" or "Pengawas" a position would repeat the heading.
       */
      positions: Record<string, string>;
    };
  };
  contact: {
    title: string;
    metaDescription: string;
    lead: string;
    addressHeading: string;
    openInMaps: string;
    phoneHeading: string;
    emailHeading: string;
    whatsappHeading: string;
    whatsappCta: string;
    /** Prefilled WhatsApp message — the greeting is kept in every locale. */
    whatsappMessage: string;
  };
  privacy: {
    title: string;
    /** <title> is built as `${title} — ${legalName}`; only this differs. */
    metaDescription: string;
    lead: string;
    /**
     * Shown when the foundation has not published a policy version yet. The
     * page must still resolve — a missing page on the one link the consent
     * checkbox points at is worse than an honest "not yet".
     */
    notPublishedTitle: string;
    notPublishedBody: string;
    /** e.g. "Berlaku sejak 1 Januari 2027" — `{date}` is formatted per locale. */
    effectiveSince: (date: string) => string;
    versionLabel: (version: number) => string;
    contactHeading: string;
    contactBody: string;
    backToForm: string;
  };
  article: {
    otherNewsHeading: string;
    /**
     * Shown above an article body that has no translation yet. Saying so is
     * better than letting a reader who chose English scroll into Indonesian
     * with no explanation and conclude the page is broken.
     */
    bodyNotTranslated: string | null;
  };
}

const ID: PagesContent = {
  programs: {
    title: "Program Unggulan",
    metaDescription:
      "Sepuluh program unggulan Pesantren Cipansor: tahfidz bersanad, kajian kitab kuning, kepemimpinan, bahasa Arab dan Inggris, hafalan hadits, praktik ibadah, public speaking, kewirausahaan, dan bimbingan masuk perguruan tinggi.",
    lead: (visi) =>
      `Program pembinaan yang menopang visi “${visi}” — dijalankan berdampingan dengan kurikulum nasional di seluruh unit pendidikan.`,
    ctaHeading: "Tertarik menyekolahkan putra-putri Anda?",
    ctaBody: (year) =>
      `Pendaftaran Sistem Penerimaan Murid Baru (SPMB) ${year} telah dibuka untuk seluruh unit pendidikan.`,
    ctaRegister: "Daftar SPMB",
    ctaUnits: "Lihat Unit Pendidikan",
  },
  units: {
    title: "Unit Pendidikan",
    metaDescription:
      "Lima unit pendidikan Pesantren Cipansor: TK Qur'an, SD IT, SMP IT, SMA Qur'an, dan program Takhosus tahfidz intensif.",
    lead: "Lima jenjang yang saling menyambung, sehingga santri dapat menempuh seluruh masa belajarnya dalam satu lingkungan pembinaan.",
    moreLink: (shortName) => `Selengkapnya tentang ${shortName}`,
  },
  campus: {
    title: "Fasilitas",
    metaDescription:
      "Sarana dan prasarana Pesantren Cipansor: masjid, asrama putra dan putri, ruang kelas, laboratorium komputer dan IPA, aula, gelanggang dan lapangan olahraga, sarana outbound, dan sumber mata air.",
    lead: "Tempat santri beribadah, belajar, tinggal, dan berolahraga — dalam satu lingkungan pesantren.",
    galleryLink: "Lihat galeri foto",
    contactPrompt: "Ingin melihat langsung?",
    contactLink: "Hubungi kami untuk berkunjung",
  },
  activities: {
    title: "Kegiatan",
    metaDescription:
      "Ekstrakurikuler di setiap unit Pesantren Cipansor dan agenda tahunannya: Rihlah Tarbawi, study tour, wisuda tahfidz, dan mukhoyam.",
    lead: "Di luar jam pelajaran, santri mengasah bakat, kepemimpinan, dan kebersamaan.",
    extracurricularHeading: "Ekstrakurikuler",
    extracurricularLead:
      "Kegiatan pilihan setiap unit, dibina asatidz. Daftar ini diperbarui oleh unit masing-masing.",
    extracurricularUnavailable:
      "Daftar ekstrakurikuler belum dapat dimuat. Silakan muat ulang halaman ini.",
    categories: {
      SPORTS: "Olahraga",
      ARTS: "Seni & Budaya",
      ACADEMIC: "Akademik",
      RELIGIOUS: "Keagamaan",
      SCOUTING: "Kepramukaan",
      LEADERSHIP: "Kepemimpinan",
      LANGUAGE: "Bahasa",
      TECHNOLOGY: "Teknologi",
      OTHER: "Lainnya",
    },
    agendaHeading: "Agenda Tahunan",
    agendaLead:
      "Kegiatan besar yang berulang setiap tahun ajaran. Tanggalnya ditetapkan setiap tahun.",
    ctaHeading: "Ingin putra-putri Anda ikut serta?",
    ctaBody: "Pendaftaran SPMB dibuka untuk seluruh unit pendidikan.",
    ctaRegister: "Daftar SPMB",
    ctaFacilities: "Lihat Fasilitas",
  },
  unitDetail: {
    highlightsHeading: (shortName) => `Yang Dipelajari di ${shortName}`,
    ctaHeading: (unitName) => `Pendaftaran ${unitName}`,
    ctaBody:
      "Pendaftaran SPMB dibuka untuk seluruh unit pendidikan. Silakan mendaftar secara online atau hubungi kami untuk bertanya lebih dulu.",
    ctaRegister: "Daftar SPMB",
    ctaContact: "Hubungi Kami",
    otherUnitsHeading: "Unit lainnya",
  },
  news: {
    title: "Berita",
    metaDescription:
      "Kabar terbaru dari Pesantren Cipansor: prestasi santri, kegiatan pembinaan, dan agenda unit pendidikan.",
    lead: "Catatan kegiatan, prestasi, dan pembinaan santri di seluruh unit pendidikan.",
    readMore: "Baca selengkapnya",
    emptyState: "Belum ada berita yang dipublikasikan.",
  },
  gallery: {
    title: "Galeri",
    metaDescription:
      "Dokumentasi Pesantren Cipansor: bangunan pondok, upacara dan pembiasaan disiplin santri, serta halaqah Al-Qur'an dan kegiatan keseharian.",
    lead: "Foto-foto berikut diambil di lingkungan Pesantren Cipansor — bangunan, santri, dan kegiatan kesehariannya.",
    photoCount: (n) => `${n} foto`,
  },
  leadership: {
    title: "Pimpinan Pesantren",
    metaDescription:
      "Jajaran pimpinan Yayasan Pesantren Cipansor dan struktur organisasinya: Pembina, Pengawas, Pengurus, pimpinan pesantren, serta kepala TK Qur'an, SD IT, SMP IT, dan SMA Qur'an.",
    lead: "Para pengasuh dan kepala unit yang memimpin penyelenggaraan pendidikan di Pesantren Cipansor.",
    photoAlt: (name) => `Foto ${name}`,
    positions: {
      "ketua-yayasan": "Ketua Yayasan",
      "pimpinan-pesantren": "Pimpinan Pesantren",
      "bendahara-yayasan": "Bendahara Yayasan",
      "kepala-sdit": "Kepala SD IT Cipansor",
      "kepala-smpit": "Kepala SMP IT Cipansor",
      "kepala-smaquran": "Kepala SMA Qur'an",
    },
    mottoNotTranslated: null,
    structure: {
      heading: "Struktur Organisasi",
      lead: "Organ yayasan menurut Undang-Undang Yayasan dan struktur pesantren, sebagaimana diumumkan Yayasan Pesantren Cipansor.",
      groups: {
        pembina: "Pembina",
        pengawas: "Pengawas",
        pengurus: "Pengurus",
        pesantren: "Pesantren Cipansor",
      },
      // Indonesian is the yayasan's own wording, so it is read from the list.
      positions: Object.fromEntries(
        ORGANISATION.filter((g) =>
          STRUCTURE_POSITIONED.includes(g.slug),
        ).flatMap((g) => g.holders.map((h) => [h.slug, h.position])),
      ),
    },
  },
  contact: {
    title: "Hubungi Kami",
    metaDescription:
      "Alamat, telepon, email, dan WhatsApp Yayasan Pesantren Cipansor di Kecamatan Kadipaten, Kabupaten Tasikmalaya, Jawa Barat.",
    lead: "Silakan menghubungi kami untuk pertanyaan seputar pendaftaran, program pendidikan, maupun kunjungan ke pesantren.",
    addressHeading: "Alamat",
    openInMaps: "Buka di Google Maps",
    phoneHeading: "Telepon",
    emailHeading: "Email",
    whatsappHeading: "WhatsApp",
    whatsappCta: "Chat via WhatsApp",
    whatsappMessage:
      "Assalamualaikum, saya ingin bertanya tentang Pesantren Cipansor.",
  },
  privacy: {
    title: "Kebijakan Privasi",
    metaDescription:
      "Kebijakan Privasi Yayasan Pesantren Cipansor: data pribadi apa yang kami proses, dasar hukumnya, berapa lama kami simpannya, dan hak Anda sebagai orang tua atau wali.",
    lead: "Bagaimana Yayasan Pesantren Cipansor memproses data pribadi, terutama data pribadi anak yang mendaftar melalui SPMB.",
    notPublishedTitle: "Kebijakan Privasi belum diterbitkan",
    notPublishedBody:
      "Yayasan belum menerbitkan teks Kebijakan Privasi, sehingga pendaftaran daring belum dapat menerima persetujuan. Silakan hubungi panitia SPMB untuk mendaftar atau menanyakan kebijakan privasi kami.",
    effectiveSince: (date) => `Berlaku sejak ${date}`,
    versionLabel: (version) => `Versi ${version}`,
    contactHeading: "Pertanyaan dan hak Anda",
    contactBody:
      "Anda berhak meminta akses, koreksi, atau penghapusan data pribadi anak Anda, dan berhak menarik persetujuan ini kapan saja. Sampaikan permintaan itu kepada panitia SPMB melalui kontak di halaman Kontak.",
    backToForm: "Kembali ke formulir pendaftaran",
  },
  article: {
    otherNewsHeading: "Berita lainnya",
    // Indonesian is the language the article was written in.
    bodyNotTranslated: null,
  },
};

const EN: PagesContent = {
  programs: {
    title: "Flagship Programmes",
    metaDescription:
      "The ten flagship programmes at Pesantren Cipansor: Qur'an memorisation with sanad, classical Islamic texts, leadership, Arabic and English, hadith memorisation, practice of worship, public speaking, entrepreneurship, and university preparation.",
    lead: (visi) =>
      `The programmes that carry the vision “${visi}” — run alongside the national curriculum across every educational unit.`,
    ctaHeading: "Considering Cipansor for your child?",
    ctaBody: (year) =>
      `Admissions for ${year} (SPMB, the new-student admission system) are open across all educational units.`,
    ctaRegister: "Register (SPMB)",
    ctaUnits: "See the educational units",
  },
  units: {
    title: "Educational Units",
    metaDescription:
      "The five educational units at Pesantren Cipansor: TK Qur'an, SD IT, SMP IT, SMA Qur'an, and the intensive Takhosus tahfidz programme.",
    lead: "Five stages that connect to one another, so a santri can spend their whole schooling in one consistent environment.",
    moreLink: (shortName) => `More about ${shortName}`,
  },
  campus: {
    title: "Facilities",
    metaDescription:
      "The facilities at Pesantren Cipansor: a mosque, boys' and girls' dormitories, classrooms, computer and science laboratories, a main hall, a sports hall and field, an outdoor activity course, and a natural spring.",
    lead: "Where santri pray, study, live and play sport — all within one pesantren.",
    galleryLink: "See the photo gallery",
    contactPrompt: "Would you like to see it for yourself?",
    contactLink: "Contact us to arrange a visit",
  },
  activities: {
    title: "Student Activities",
    metaDescription:
      "Extracurricular activities in every unit of Pesantren Cipansor, and its annual events: Rihlah Tarbawi, study tours, the tahfidz graduation, and the annual camp.",
    lead: "Outside lessons, santri develop their talents, leadership and friendships.",
    extracurricularHeading: "Extracurricular activities",
    extracurricularLead:
      "Optional activities in each unit, led by our teachers. Each unit keeps this list up to date.",
    extracurricularUnavailable:
      "The list of activities could not be loaded. Please reload this page.",
    categories: {
      SPORTS: "Sport",
      ARTS: "Arts & culture",
      ACADEMIC: "Academic",
      RELIGIOUS: "Religious",
      SCOUTING: "Scouting",
      LEADERSHIP: "Leadership",
      LANGUAGE: "Languages",
      TECHNOLOGY: "Technology",
      OTHER: "Other",
    },
    agendaHeading: "Annual events",
    agendaLead:
      "Major events that come round every school year. Their dates are set each year.",
    ctaHeading: "Would you like your child to take part?",
    ctaBody: "SPMB admissions are open for every educational unit.",
    ctaRegister: "Register (SPMB)",
    ctaFacilities: "See the facilities",
  },
  unitDetail: {
    highlightsHeading: (shortName) => `What is studied at ${shortName}`,
    ctaHeading: (unitName) => `Applying to ${unitName}`,
    ctaBody:
      "SPMB admissions are open for every educational unit. Apply online, or contact us first if you have questions.",
    ctaRegister: "Register (SPMB)",
    ctaContact: "Contact us",
    otherUnitsHeading: "Other units",
  },
  news: {
    title: "News",
    metaDescription:
      "The latest from Pesantren Cipansor: what santri are achieving, how they are being formed, and what is coming up across the educational units.",
    lead: "A record of activities, achievements, and the formation of santri across every educational unit.",
    readMore: "Read the article",
    emptyState: "No news has been published yet.",
  },
  gallery: {
    title: "Gallery",
    metaDescription:
      "A photographic record of Pesantren Cipansor: its buildings, the assemblies that build discipline, and the Qur'an study circles of an ordinary day.",
    lead: "Every photograph below was taken at Pesantren Cipansor — its buildings, its santri, and the ordinary business of its days.",
    photoCount: (n) => (n === 1 ? "1 photograph" : `${n} photographs`),
  },
  leadership: {
    title: "Pesantren Leadership",
    metaDescription:
      "The leadership and organisational structure of Yayasan Pesantren Cipansor: its trustees, supervisors and executive board, the head of the pesantren, and the heads of TK Qur'an, SD IT, SMP IT, and SMA Qur'an.",
    lead: "The teachers and unit heads who lead the running of education at Pesantren Cipansor.",
    photoAlt: (name) => `Portrait of ${name}`,
    positions: {
      "ketua-yayasan": "Chair of the Foundation",
      "pimpinan-pesantren": "Head of the Pesantren",
      "bendahara-yayasan": "Treasurer of the Foundation",
      "kepala-sdit": "Head of SD IT Cipansor",
      "kepala-smpit": "Head of SMP IT Cipansor",
      "kepala-smaquran": "Head of SMA Qur'an",
    },
    mottoNotTranslated:
      "Each motto below is a hadith as the leader themselves rendered it in Indonesian, and is shown in the original wording rather than translated.",
    structure: {
      heading: "Organisational Structure",
      lead: "The foundation's organs as Indonesian foundation law defines them, and the pesantren's own structure, as Yayasan Pesantren Cipansor has published them.",
      groups: {
        pembina: "Board of Trustees (Pembina)",
        pengawas: "Board of Supervisors (Pengawas)",
        pengurus: "Executive Board (Pengurus)",
        pesantren: "The Pesantren's Own Structure",
      },
      positions: {
        "ketua-yayasan": "Chair",
        "sekretaris-yayasan": "Secretary",
        "bendahara-yayasan": "Treasurer",
        "pimpinan-pesantren": "Head of the Pesantren",
        "sekretaris-pesantren": "Secretary",
        "bendahara-pesantren": "Treasurer",
        "direktur-tahfidz-ikhwan": "Director of Tahfidz, Boys",
        "direktur-tahfidz-akhwat": "Director of Tahfidz, Girls",
        "kepala-tkq": "Head of TK Qur'an",
        "kepala-sdit": "Head of SD IT",
        "kepala-smpit": "Head of SMP IT",
        "kepala-smaquran": "Head of SMA Qur'an",
        "kepengasuhan-ikhwan": "Boarding Care, Boys",
        "kepengasuhan-akhwat": "Boarding Care, Girls",
      },
    },
  },
  contact: {
    title: "Contact Us",
    metaDescription:
      "Address, telephone, email, and WhatsApp for Yayasan Pesantren Cipansor in Kecamatan Kadipaten, Kabupaten Tasikmalaya, West Java.",
    lead: "Please get in touch with any question about admissions, our educational programmes, or visiting the pesantren.",
    addressHeading: "Address",
    openInMaps: "Open in Google Maps",
    phoneHeading: "Telephone",
    emailHeading: "Email",
    whatsappHeading: "WhatsApp",
    whatsappCta: "Chat on WhatsApp",
    whatsappMessage:
      "Assalamualaikum, I would like to ask about Pesantren Cipansor.",
  },
  privacy: {
    title: "Privacy Policy",
    metaDescription:
      "Yayasan Pesantren Cipansor's Privacy Policy: what personal data we process, our lawful basis, how long we keep it, and your rights as a parent or guardian.",
    lead: "How Yayasan Pesantren Cipansor processes personal data, in particular the personal data of a child registering through SPMB.",
    notPublishedTitle: "The Privacy Policy has not been published",
    notPublishedBody:
      "The foundation has not published the Privacy Policy text yet, so online registration cannot take consent. Please contact the SPMB committee to register or to ask about our privacy policy.",
    effectiveSince: (date) => `In effect since ${date}`,
    versionLabel: (version) => `Version ${version}`,
    contactHeading: "Questions and your rights",
    contactBody:
      "You have the right to request access to, correction of, or deletion of your child's personal data, and to withdraw this consent at any time. Send that request to the SPMB committee through the contact details on the Contact page.",
    backToForm: "Back to the registration form",
  },
  article: {
    otherNewsHeading: "Other news",
    bodyNotTranslated:
      "This article was written in Indonesian. The headline and summary are translated; the full text below is the original.",
  },
};

const AR: PagesContent = {
  programs: {
    title: "البرامج المتميّزة",
    metaDescription:
      "البرامج العشرة المتميّزة في معهد سيبانسور: تحفيظ القرآن بسندٍ متّصل، ودراسة الكتب التراثية، والقيادة، والعربية والإنجليزية، وحفظ الحديث، والتطبيق العملي للعبادات، والخطابة، وريادة الأعمال، والإعداد الجامعي.",
    lead: (visi) =>
      `البرامج التي تحمل رؤية «${visi}» — تسير جنباً إلى جنب مع المنهج الوطني في جميع الوحدات التعليمية.`,
    ctaHeading: "هل تفكّر في إلحاق أبنائك بسيبانسور؟",
    ctaBody: (year) =>
      `فُتح باب التسجيل لعام ${year} عبر نظام قبول الطلاب الجدد (SPMB) في جميع الوحدات التعليمية.`,
    ctaRegister: "التسجيل (SPMB)",
    ctaUnits: "عرض الوحدات التعليمية",
  },
  units: {
    title: "الوحدات التعليمية",
    metaDescription:
      "الوحدات التعليمية الخمس في معهد سيبانسور: روضة القرآن، والابتدائية، والإعدادية، وثانوية القرآن، وبرنامج التخصّص المكثّف في التحفيظ.",
    lead: "خمس مراحل متّصل بعضها ببعض، فيقضي الطالب مسيرته الدراسية كلها في بيئة تربوية واحدة متّسقة.",
    moreLink: (shortName) => `المزيد عن ${shortName}`,
  },
  campus: {
    title: "المرافق",
    metaDescription:
      "مرافق معهد سيبانسور: المسجد، والسكن الداخلي للبنين والبنات، والفصول الدراسية، ومختبرا الحاسوب والعلوم، والقاعة الرئيسية، والصالة والملعب الرياضيان، وساحة الأنشطة الخارجية، وعين الماء.",
    lead: "حيث يصلّي الطلاب ويتعلّمون ويسكنون ويمارسون الرياضة — في رحاب معهد واحد.",
    galleryLink: "معرض الصور",
    contactPrompt: "هل تودّ أن تراه بنفسك؟",
    contactLink: "تواصل معنا لترتيب زيارة",
  },
  activities: {
    title: "الأنشطة",
    metaDescription:
      "الأنشطة اللاصفية في كل وحدات معهد سيبانسور وفعالياته السنوية: الرحلة التربوية، والزيارات العلمية، وحفل تخريج الحفاظ، والمخيم.",
    lead: "خارج أوقات الدراسة، ينمّي الطلاب مواهبهم وقيادتهم وأخوّتهم.",
    extracurricularHeading: "الأنشطة اللاصفية",
    extracurricularLead:
      "أنشطة اختيارية في كل وحدة بإشراف الأساتذة، وتتولّى كل وحدة تحديث هذه القائمة.",
    extracurricularUnavailable:
      "تعذّر تحميل قائمة الأنشطة. يُرجى إعادة تحميل الصفحة.",
    categories: {
      SPORTS: "الرياضة",
      ARTS: "الفنون والثقافة",
      ACADEMIC: "الأنشطة العلمية",
      RELIGIOUS: "الأنشطة الدينية",
      SCOUTING: "الكشافة",
      LEADERSHIP: "القيادة",
      LANGUAGE: "اللغات",
      TECHNOLOGY: "التقنية",
      OTHER: "أنشطة أخرى",
    },
    agendaHeading: "الفعاليات السنوية",
    agendaLead: "فعاليات كبرى تتكرّر في كل عام دراسي، وتُحدَّد مواعيدها كل عام.",
    ctaHeading: "هل تودّ أن يشارك أبناؤك؟",
    ctaBody:
      "باب التسجيل عبر نظام قبول الطلاب الجدد (SPMB) مفتوح لجميع الوحدات التعليمية.",
    ctaRegister: "التسجيل (SPMB)",
    ctaFacilities: "عرض المرافق",
  },
  unitDetail: {
    highlightsHeading: (shortName) => `ما يُدرَس في ${shortName}`,
    ctaHeading: (unitName) => `التسجيل في ${unitName}`,
    ctaBody:
      "باب التسجيل عبر نظام قبول الطلاب الجدد (SPMB) مفتوح لجميع الوحدات التعليمية. سجّل عبر الإنترنت، أو تواصل معنا أولاً إن كان لديك سؤال.",
    ctaRegister: "التسجيل (SPMB)",
    ctaContact: "تواصل معنا",
    otherUnitsHeading: "وحدات أخرى",
  },
  news: {
    title: "الأخبار",
    metaDescription:
      "آخر أخبار معهد سيبانسور: إنجازات الطلاب وأنشطة التكوين وأجندة الوحدات التعليمية.",
    lead: "تسجيلٌ للأنشطة والإنجازات وتكوين الطلاب في جميع الوحدات التعليمية.",
    readMore: "قراءة الخبر",
    emptyState: "لم يُنشر أي خبر بعد.",
  },
  gallery: {
    title: "معرض الصور",
    metaDescription:
      "توثيق مصوَّر لمعهد سيبانسور: مبانيه، وطوابير الانضباط اليومية، وحلقات القرآن في يومٍ عادي.",
    lead: "كل صورة أدناه التُقطت في معهد سيبانسور — مبانيه وطلابه وتفاصيل يومه.",
    // Arabic marks 1, 2, 3–10 and 11+ differently; the dual and the plural of
    // paucity are not optional politeness. Anything past ten takes the
    // accusative singular, which is why 11+ reads صورة and not صور.
    photoCount: (n) =>
      n === 1
        ? "صورة واحدة"
        : n === 2
          ? "صورتان"
          : n <= 10
            ? `${n} صور`
            : `${n} صورة`,
  },
  leadership: {
    title: "الهيئة القيادية للمعهد",
    metaDescription:
      "الهيئة القيادية لمؤسسة معهد سيبانسور وهيكلها التنظيمي: مجلس الأمناء ومجلس الرقابة والمجلس التنفيذي، ومدير المعهد، ورؤساء روضة القرآن والمرحلة الابتدائية والإعدادية وثانوية القرآن.",
    lead: "المشايخ ورؤساء الوحدات الذين يقودون العملية التعليمية في معهد سيبانسور.",
    photoAlt: (name) => `صورة ${name}`,
    positions: {
      "ketua-yayasan": "رئيس المؤسسة",
      "pimpinan-pesantren": "مدير المعهد",
      "bendahara-yayasan": "أمين صندوق المؤسسة",
      "kepala-sdit": "رئيس المرحلة الابتدائية بسيبانسور",
      "kepala-smpit": "رئيس المرحلة الإعدادية بسيبانسور",
      "kepala-smaquran": "رئيس ثانوية القرآن",
    },
    mottoNotTranslated:
      "كل حكمة أدناه حديثٌ صاغه صاحبها بالإندونيسية، وتُعرَض بلفظها الأصلي دون ترجمة.",
    structure: {
      heading: "الهيكل التنظيمي",
      lead: "أجهزة المؤسسة كما يحددها قانون المؤسسات الإندونيسي، وهيكل المعهد الخاص به، كما أعلنتها مؤسسة معهد سيبانسور.",
      groups: {
        pembina: "مجلس الأمناء (Pembina)",
        pengawas: "مجلس الرقابة (Pengawas)",
        pengurus: "المجلس التنفيذي (Pengurus)",
        pesantren: "هيكل المعهد",
      },
      positions: {
        "ketua-yayasan": "الرئيس",
        "sekretaris-yayasan": "أمين السر",
        "bendahara-yayasan": "أمين الصندوق",
        "pimpinan-pesantren": "مدير المعهد",
        "sekretaris-pesantren": "أمين السر",
        "bendahara-pesantren": "أمينة الصندوق",
        "direktur-tahfidz-ikhwan": "مدير التحفيظ للبنين",
        "direktur-tahfidz-akhwat": "مديرة التحفيظ للبنات",
        "kepala-tkq": "رئيسة روضة القرآن",
        "kepala-sdit": "رئيس المرحلة الابتدائية",
        "kepala-smpit": "رئيس المرحلة الإعدادية",
        "kepala-smaquran": "رئيس ثانوية القرآن",
        "kepengasuhan-ikhwan": "رعاية الطلاب المقيمين (البنين)",
        "kepengasuhan-akhwat": "رعاية الطالبات المقيمات (البنات)",
      },
    },
  },
  contact: {
    title: "تواصل معنا",
    metaDescription:
      "عنوان مؤسسة معهد سيبانسور وهاتفها وبريدها الإلكتروني وواتساب، في منطقة كاديفاتين بتاسيكمالايا، جاوة الغربية.",
    lead: "تفضّل بالتواصل معنا لأي سؤال عن التسجيل أو البرامج التعليمية أو زيارة المعهد.",
    addressHeading: "العنوان",
    openInMaps: "الفتح في خرائط جوجل",
    phoneHeading: "الهاتف",
    emailHeading: "البريد الإلكتروني",
    whatsappHeading: "واتساب",
    whatsappCta: "المحادثة عبر واتساب",
    whatsappMessage: "السلام عليكم، أودّ الاستفسار عن معهد سيبانسور.",
  },
  privacy: {
    title: "سياسة الخصوصية",
    metaDescription:
      "سياسة الخصوصية لمؤسسة معهد سيبانسور: البيانات الشخصية التي نعالجها، والأساس القانوني لها، ومدة حفظها، وحقوقكم بصفتكم أولياء أمور.",
    lead: "كيفية تعامل مؤسسة معهد سيبانسور مع البيانات الشخصية، لا سيّما بيانات الأطفال المتقدّمين عبر التسجيل الإلكتروني (SPMB).",
    notPublishedTitle: "لم تُنشر سياسة الخصوصية بعد",
    notPublishedBody:
      "لم تنشر المؤسسة نصّ سياسة الخصوصية بعد، لذا لا يمكن للتسجيل الإلكتروني تسجيل الموافقة. يُرجى التواصل مع لجنة القبول للتسجيل أو للسؤال عن سياسة الخصوصية.",
    effectiveSince: (date) => `نافذة منذ ${date}`,
    versionLabel: (version) => `الإصدار ${version}`,
    contactHeading: "الأسئلة وحقوقكم",
    contactBody:
      "لكم الحق في طلب الوصول إلى بيانات طفلكم الشخصية أو تصحيحها أو حذفها، وفي سحب هذه الموافقة في أي وقت. أرسلوا هذا الطلب إلى لجنة القبول عبر بيانات التواصل في صفحة التواصل.",
    backToForm: "العودة إلى استمارة التسجيل",
  },
  article: {
    otherNewsHeading: "أخبار أخرى",
    bodyNotTranslated:
      "كُتب هذا الخبر بالإندونيسية. العنوان والملخّص مترجمان، والنصّ الكامل أدناه هو الأصل.",
  },
};

const BY_LOCALE: Record<Locale, PagesContent> = { id: ID, en: EN, ar: AR };

export function pagesContentFor(locale: Locale): PagesContent {
  return BY_LOCALE[locale] ?? ID;
}
