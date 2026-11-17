import type { Locale } from "@/locales";

/**
 * The homepage's own prose — the seven landing sections and the footer.
 *
 * Kept apart from content.i18n.ts (which holds /profil and the legal-identity
 * copy) purely so neither file becomes unreadable; both are resolved the same
 * way. The sections are server components, so the page reads the locale once
 * with `getServerLocale()` and passes the resolved copy down as props rather
 * than each section reading the cookie for itself.
 *
 * The footer is the exception: it renders inside the client-side SPMB form as
 * well as inside server-rendered pages, so it takes its locale from
 * `useI18n()`. That is why this module is a plain function of the locale with
 * no server-only imports.
 *
 * Interpolated values arrive already formatted (`year` is a string, not a
 * number) so that Arabic gets Arabic-Indic digits — see lib/locale-format.ts.
 */
export interface HomeContent {
  hero: {
    registerCta: string;
    profileCta: string;
    imageAlt: string;
  };
  stats: {
    /** Visually hidden; names the section for screen readers. */
    srHeading: string;
    established: { label: string; description: (years: string) => string };
    units: { label: string; description: string };
    programs: { label: string; description: string };
    languages: { label: string; description: string };
  };
  about: {
    eyebrow: string;
    heading: string;
    body: (
      markaz: string,
      legalName: string,
      year: string,
      visi: string,
    ) => string;
    commitments: string[];
    moreLink: string;
    /** Under the documentation photographs, to the full album. */
    galleryLink: string;
  };
  units: {
    eyebrow: string;
    heading: string;
    lead: string;
    moreLink: string;
    logoAlt: (unitName: string) => string;
  };
  programs: {
    eyebrow: string;
    heading: string;
    lead: (count: string) => string;
    allLink: string;
  };
  news: {
    eyebrow: string;
    heading: string;
    lead: string;
    readMore: string;
    allLink: string;
  };
  cta: {
    spmb: { title: string; body: string; button: string };
    donate: { title: string; body: string; button: string };
  };
  footer: {
    blurb: (
      markaz: string,
      legalName: string,
      year: string,
      visi: string,
    ) => string;
    linksHeading: string;
    unitsHeading: string;
    contactHeading: string;
    viewOnMaps: string;
    rights: string;
    /**
     * The line that says, in plain words, who runs this website.
     *
     * Google for Nonprofits declined the domain a second time because they
     * "couldn't confirm its relationship with your registered nonprofit
     * organization". The structured data in config/organization-jsonld.ts
     * answers that for a machine; this is the half a person reads, and it sits
     * in the footer so it is on every public page rather than one.
     */
    operatedBy: (legalName: string) => string;
    links: {
      profile: string;
      leadership: string;
      legal: string;
      programs: string;
      units: string;
      facilities: string;
      activities: string;
      news: string;
      gallery: string;
      spmb: string;
      donate: string;
      contact: string;
      privacy: string;
    };
  };
}

const ID: HomeContent = {
  hero: {
    registerCta: "Daftar SPMB",
    profileCta: "Profil Pesantren",
    imageAlt: "Lingkungan dan kegiatan santri di Pesantren Cipansor",
  },
  stats: {
    srHeading: "Sekilas Pesantren Cipansor",
    established: {
      label: "Berdiri Sejak",
      description: (years) => `Lebih dari ${years} tahun mengabdi`,
    },
    units: {
      label: "Unit Pendidikan",
      description: "Jenjang TKQ hingga Takhosus",
    },
    programs: {
      label: "Program Unggulan",
      description: "Tahfidz, kitab, hingga kepemimpinan",
    },
    languages: {
      label: "Bahasa Pembiasaan",
      description: "Bahasa Arab & Bahasa Inggris",
    },
  },
  about: {
    eyebrow: "Profil Pesantren",
    heading: "Menyeimbangkan Ilmu Agama, Akademik, dan Teknologi",
    body: (markaz, legalName, year, visi) =>
      `${markaz} ${legalName} adalah lembaga pendidikan Islami yang berdiri sejak ${year} dengan visi “${visi}”. Santri dibina dalam lingkungan asrama yang menumbuhkan kemandirian, kedisiplinan, dan adab, sekaligus disiapkan untuk bersaing di era global.`,
    commitments: [
      "Kurikulum terpadu: nasional, kepesantrenan, dan teknologi",
      "Tahfidz & tahsin Al-Qur'an bersanad setiap hari",
      "Kajian kitab kuning dan hafalan hadits pilihan",
      "Pembiasaan bahasa Arab dan bahasa Inggris",
    ],
    moreLink: "Selengkapnya tentang profil pesantren",
    galleryLink: "Lihat semua foto dokumentasi",
  },
  units: {
    eyebrow: "Unit Pendidikan",
    heading: "Satu Jalur Pendidikan, dari Taman Kanak-Kanak hingga Takhosus",
    lead: "Lima unit pendidikan yang saling menyambung, sehingga santri dapat menempuh seluruh jenjang tanpa terputus pembinaan hafalan dan karakternya.",
    moreLink: "Selengkapnya",
    logoAlt: (unitName) => `Logo ${unitName}`,
  },
  programs: {
    eyebrow: "Program Unggulan",
    heading: "Pembinaan Harian Santri",
    lead: (count) =>
      `${count} program inti yang berjalan setiap hari di seluruh unit pendidikan, memadukan penguatan hafalan, penguasaan sumber keilmuan klasik, dan keterampilan yang relevan bagi santri hari ini.`,
    allLink: "Lihat semua program unggulan",
  },
  news: {
    eyebrow: "Berita",
    heading: "Kabar Terbaru dari Pondok",
    lead: "Catatan kegiatan dan capaian santri di berbagai unit pendidikan.",
    readMore: "Baca selengkapnya",
    allLink: "Lihat semua berita",
  },
  cta: {
    spmb: {
      title: "Pendaftaran Santri Baru",
      body: "Bergabunglah bersama kami menjadi bagian dari keluarga besar Pesantren Cipansor. Kuota terbatas!",
      button: "Daftar Sekarang",
    },
    donate: {
      title: "Infaq & Shodaqoh",
      body: "Salurkan donasi terbaik Anda untuk pengembangan pendidikan dan pembangunan fasilitas pesantren.",
      button: "Salurkan Donasi",
    },
  },
  footer: {
    blurb: (markaz, legalName, year, visi) =>
      `${markaz} ${legalName} adalah lembaga pendidikan Islami dengan visi “${visi}”, berdiri sejak ${year}.`,
    linksHeading: "Tautan",
    unitsHeading: "Unit Pendidikan",
    contactHeading: "Hubungi Kami",
    viewOnMaps: "Lihat di Google Maps",
    rights: "Hak cipta dilindungi.",
    operatedBy: (legalName) =>
      `Situs resmi ${legalName}, dikelola langsung oleh yayasan.`,
    links: {
      profile: "Profil Pesantren",
      leadership: "Pimpinan",
      legal: "Legalitas & Transparansi",
      programs: "Program Unggulan",
      units: "Unit Pendidikan",
      facilities: "Fasilitas",
      activities: "Kegiatan",
      news: "Berita",
      gallery: "Galeri",
      spmb: "Pendaftaran (SPMB)",
      donate: "Wakaf & Infaq",
      contact: "Kontak",
      privacy: "Kebijakan Privasi",
    },
  },
};

const EN: HomeContent = {
  hero: {
    registerCta: "Register (SPMB)",
    profileCta: "About the Pesantren",
    imageAlt:
      "The grounds of Pesantren Cipansor and santri at their activities",
  },
  stats: {
    srHeading: "Pesantren Cipansor at a glance",
    established: {
      label: "Founded",
      description: (years) => `More than ${years} years of service`,
    },
    units: {
      label: "Educational units",
      description: "From kindergarten (TKQ) through to Takhosus",
    },
    programs: {
      label: "Flagship programmes",
      description: "From tahfidz and classical texts to leadership",
    },
    languages: {
      label: "Languages in daily use",
      description: "Arabic and English",
    },
  },
  about: {
    eyebrow: "About the Pesantren",
    heading:
      "Holding Religious Learning, Academic Study, and Technology in Balance",
    body: (markaz, legalName, year, visi) =>
      `${markaz} ${legalName} is an Islamic educational institution, established in ${year}, with the vision of “${visi}”. Santri are formed in a boarding environment that builds independence, discipline, and adab (right conduct), while being prepared to hold their own in a global age.`,
    commitments: [
      "An integrated curriculum: the national syllabus, pesantren learning, and technology",
      "Daily Qur'an memorisation and recitation through an unbroken chain of transmission",
      "Study of the classical Islamic texts and memorisation of selected hadith",
      "Arabic and English in everyday use",
    ],
    moreLink: "More about the pesantren",
    galleryLink: "See every documentation photograph",
  },
  units: {
    eyebrow: "Educational Units",
    heading: "One Path of Schooling, from Kindergarten through to Takhosus",
    lead: "Five units that connect to one another, so a santri can complete every stage without a break in their memorisation or in the forming of their character.",
    moreLink: "Read more",
    logoAlt: (unitName) => `Logo of ${unitName}`,
  },
  programs: {
    eyebrow: "Flagship Programmes",
    heading: "The Daily Formation of a Santri",
    lead: (count) =>
      `${count} core programmes run every day across all the educational units, joining strengthened memorisation, command of the classical sources, and the skills a santri needs today.`,
    allLink: "See all flagship programmes",
  },
  news: {
    eyebrow: "News",
    heading: "The Latest from the Pesantren",
    lead: "A record of what santri are doing and achieving across the educational units.",
    readMore: "Read the article",
    allLink: "See all news",
  },
  cta: {
    spmb: {
      title: "New Santri Admissions",
      body: "Join us and become part of the Pesantren Cipansor family. Places are limited.",
      button: "Register now",
    },
    donate: {
      title: "Infaq & Shodaqoh",
      body: "Give your best in infaq and shodaqoh — voluntary charity — towards the pesantren's teaching and its buildings.",
      button: "Give now",
    },
  },
  footer: {
    blurb: (markaz, legalName, year, visi) =>
      `${markaz} ${legalName} is an Islamic educational institution with the vision of “${visi}”, established in ${year}.`,
    linksHeading: "Links",
    unitsHeading: "Educational Units",
    contactHeading: "Contact Us",
    viewOnMaps: "View on Google Maps",
    rights: "All rights reserved.",
    operatedBy: (legalName) =>
      `The official website of ${legalName}, operated by the foundation itself.`,
    links: {
      profile: "About the Pesantren",
      leadership: "Leadership",
      legal: "Legal Status & Transparency",
      programs: "Flagship Programmes",
      units: "Educational Units",
      facilities: "Facilities",
      activities: "Student Activities",
      news: "News",
      gallery: "Gallery",
      spmb: "Admissions (SPMB)",
      donate: "Wakaf & Infaq",
      contact: "Contact",
      privacy: "Privacy Policy",
    },
  },
};

const AR: HomeContent = {
  hero: {
    registerCta: "التسجيل (SPMB)",
    profileCta: "نبذة عن المعهد",
    imageAlt: "أجواء معهد سيبانسور وأنشطة طلابه",
  },
  stats: {
    srHeading: "لمحة عن معهد سيبانسور",
    established: {
      label: "سنة التأسيس",
      description: (years) => `أكثر من ${years} عاماً في خدمة التعليم`,
    },
    units: {
      label: "الوحدات التعليمية",
      description: "من روضة القرآن إلى برنامج التخصّص",
    },
    programs: {
      label: "البرامج المتميّزة",
      description: "من التحفيظ والكتب التراثية إلى القيادة",
    },
    languages: {
      label: "لغتا التخاطب",
      description: "العربية والإنجليزية",
    },
  },
  about: {
    eyebrow: "نبذة عن المعهد",
    heading: "توازنٌ بين العلوم الشرعية والدراسة الأكاديمية والتقنية",
    body: (markaz, legalName, year, visi) =>
      `${markaz} ${legalName} مؤسسة تعليمية إسلامية تأسّست عام ${year}م، رؤيتها: «${visi}». يُربّى الطلاب في بيئة داخلية تنمّي الاستقلال والانضباط والأدب، ويُعدّون في الوقت نفسه لمنافسة أقرانهم في عصرٍ مفتوح على العالم.`,
    commitments: [
      "منهج متكامل: المنهج الوطني وعلوم المعهد والتقنية",
      "تحفيظ القرآن وتحسين تلاوته بسندٍ متّصل كل يوم",
      "دراسة الكتب التراثية وحفظ أحاديث مختارة",
      "التخاطب اليومي بالعربية والإنجليزية",
    ],
    moreLink: "المزيد عن المعهد",
    galleryLink: "مشاهدة جميع صور التوثيق",
  },
  units: {
    eyebrow: "الوحدات التعليمية",
    heading: "مسارٌ تعليميّ واحد، من رياض الأطفال إلى برنامج التخصّص",
    lead: "خمس وحدات تعليمية متّصل بعضها ببعض، فيستطيع الطالب أن يجتاز المراحل كلّها دون انقطاع في حفظه ولا في بناء شخصيته.",
    moreLink: "التفاصيل",
    logoAlt: (unitName) => `شعار ${unitName}`,
  },
  programs: {
    eyebrow: "البرامج المتميّزة",
    heading: "التكوين اليومي للطالب",
    lead: (count) =>
      `${count} برامج أساسية تجري كل يوم في جميع الوحدات التعليمية، تجمع بين تقوية الحفظ والتمكّن من المصادر التراثية والمهارات التي يحتاجها الطالب اليوم.`,
    allLink: "عرض جميع البرامج المتميّزة",
  },
  news: {
    eyebrow: "الأخبار",
    heading: "آخر أخبار المعهد",
    lead: "تسجيلٌ لأنشطة الطلاب وإنجازاتهم في مختلف الوحدات التعليمية.",
    readMore: "قراءة الخبر",
    allLink: "عرض جميع الأخبار",
  },
  cta: {
    spmb: {
      title: "قبول الطلاب الجدد",
      body: "انضمّ إلينا وكن من أسرة معهد سيبانسور. المقاعد محدودة.",
      button: "سجّل الآن",
    },
    donate: {
      title: "الإنفاق والصدقة",
      body: "قدّم أفضل ما تجود به نفسك لتطوير التعليم وبناء مرافق المعهد.",
      button: "تبرّع الآن",
    },
  },
  footer: {
    blurb: (markaz, legalName, year, visi) =>
      `${markaz} ${legalName} مؤسسة تعليمية إسلامية رؤيتها: «${visi}»، تأسّست عام ${year}م.`,
    linksHeading: "روابط",
    unitsHeading: "الوحدات التعليمية",
    contactHeading: "تواصل معنا",
    viewOnMaps: "عرض على خرائط جوجل",
    rights: "جميع الحقوق محفوظة.",
    operatedBy: (legalName) =>
      `الموقع الرسمي لـ${legalName}، تديره المؤسسة بنفسها.`,
    links: {
      profile: "نبذة عن المعهد",
      leadership: "الهيئة القيادية",
      legal: "الوضع القانوني والشفافية",
      programs: "البرامج المتميّزة",
      units: "الوحدات التعليمية",
      facilities: "المرافق",
      activities: "الأنشطة",
      news: "الأخبار",
      gallery: "معرض الصور",
      spmb: "التسجيل (SPMB)",
      donate: "الوقف والإنفاق",
      contact: "اتصل بنا",
      privacy: "سياسة الخصوصية",
    },
  },
};

const BY_LOCALE: Record<Locale, HomeContent> = { id: ID, en: EN, ar: AR };

export function homeContentFor(locale: Locale): HomeContent {
  return BY_LOCALE[locale] ?? ID;
}
