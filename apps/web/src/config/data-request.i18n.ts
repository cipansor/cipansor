import type { Locale } from "@/locales";

/**
 * Permintaan hak subjek data (UU 27/2022 Pasal 30, 32, 33, 40, 43–44), di tiga
 * bahasa situs publik (decisions/istilah-dan-penamaan.md).
 *
 * Halaman ini ada karena teks Kebijakan Privasi menyebut hak-hak itu tetapi
 * hanya menunjuk kontak panitia SPMB secara manual: tidak ada alur, tidak ada
 * tenggat, dan tidak ada bukti kapan sebuah permintaan dijawab. Formulirnya
 * publik karena pemohonnya adalah pendaftar SPMB yang belum punya akun —
 * justru merekalah yang paling perlu memakai haknya.
 *
 * Istilah domain (SPMB, NIS, wali) dan nama berkas yang dipegang keluarga
 * (nomor pendaftaran, tanggal lahir) ditulis apa adanya, seperti pada formulir
 * SPMB: itulah yang tertulis di berkas yang mereka pegang.
 */
export interface DataRequestContent {
  hero: {
    title: string;
    intro: string;
  };
  rights: {
    heading: string;
    intro: string;
    access: string;
    rectification: string;
    consentWithdrawal: string;
    erasure: string;
    /** Tenggat 3×24 jam dan dasar pasalnya, dalam kalimat yang bisa dibaca. */
    deadline: string;
  };
  tabs: { submit: string; verify: string };
  form: {
    heading: string;
    intro: string;
    type: string;
    registrationNo: string;
    registrationNoPlaceholder: string;
    birthDate: string;
    birthDateHint: string;
    requesterName: string;
    requesterContact: string;
    requesterContactHint: string;
    requesterRelation: string;
    requesterRelationPlaceholder: string;
    detail: string;
    detailPlaceholder: string;
    submit: string;
    submitting: string;
    /** Turnstile belum selesai, atau jaringannya memfilternya. */
    gateWaiting: string;
    gateBlocked: string;
    privacyLink: string;
  };
  submitted: {
    heading: string;
    requestNo: string;
    dueAt: string;
    sentTo: (contact: string) => string;
    nextStep: string;
    goVerify: string;
  };
  verify: {
    heading: string;
    intro: string;
    requestNo: string;
    code: string;
    codeHint: string;
    submit: string;
    submitting: string;
    successHeading: string;
    /** "Permintaan … tenggat …" — nomor dan tenggat disisipkan. */
    successBody: (requestNo: string, dueAt: string) => string;
    nextStep: string;
  };
  errors: { generic: string };
}

const ID: DataRequestContent = {
  hero: {
    title: "Permintaan Data Pribadi",
    intro:
      "Sampaikan permintaan akses, perbaikan, penghapusan, atau penarikan persetujuan atas data pribadi Anda atau anak Anda. Kami mencatat setiap permintaan beserta tenggatnya.",
  },
  rights: {
    heading: "Hak Anda menurut UU Pelindungan Data Pribadi",
    intro:
      "Undang-Undang No. 27 Tahun 2022 memberi Anda hak atas data pribadi yang kami proses. Empat di antaranya dapat Anda pakai lewat halaman ini.",
    access:
      "Akses dan salinan — mengetahui data apa yang kami proses, dan meminta salinannya (Pasal 30, 32).",
    rectification:
      "Perbaikan — memperbaiki atau memperbarui data yang tidak akurat (Pasal 30 ayat 1).",
    consentWithdrawal:
      "Penarikan persetujuan — menghentikan pemrosesan yang bersandar pada persetujuan Anda (Pasal 40 ayat 2).",
    erasure:
      "Penghapusan — meminta data dihapus, sejauh tidak dibatasi kewajiban penyimpanan arsip (Pasal 43–44).",
    deadline:
      "Akses, perbaikan, dan penarikan persetujuan kami selesaikan dalam 3×24 jam sejak permintaan diterima. Penghapusan mengikuti jadwal retensi arsip, dan kami sampaikan tenggatnya saat permintaan dicatat.",
  },
  tabs: { submit: "Ajukan permintaan", verify: "Masukkan kode verifikasi" },
  form: {
    heading: "Formulir permintaan",
    intro:
      "Isi data pendaftaran anak Anda. Sebagai bukti bahwa Anda benar keluarga pendaftar, kami kirim kode verifikasi ke kontak yang sudah terdaftar pada data pendaftaran — bukan ke kontak yang Anda tuliskan di sini.",
    type: "Jenis permintaan",
    registrationNo: "Nomor pendaftaran SPMB",
    registrationNoPlaceholder: "mis. SPMB-2026-000123",
    birthDate: "Tanggal lahir pendaftar",
    birthDateHint:
      "Tanggal lahir harus cocok dengan data pendaftaran; itu faktor kedua yang hanya diketahui keluarga.",
    requesterName: "Nama Anda",
    requesterContact: "Email atau nomor telepon Anda",
    requesterContactHint:
      "Kami pakai untuk menghubungi Anda kembali soal permintaan ini.",
    requesterRelation: "Hubungan dengan pendaftar",
    requesterRelationPlaceholder: "mis. Ayah, Ibu, Wali",
    detail: "Rincian permintaan",
    detailPlaceholder:
      "Jelaskan data apa yang Anda maksud dan apa yang Anda minta.",
    submit: "Kirim permintaan",
    submitting: "Mengirim…",
    gateWaiting: "Menunggu verifikasi keamanan…",
    gateBlocked:
      "Verifikasi keamanan tidak dapat dimuat dari jaringan Anda. Coba muat ulang halaman, atau hubungi panitia SPMB melalui halaman Kontak.",
    privacyLink: "Baca Kebijakan Privasi",
  },
  submitted: {
    heading: "Permintaan Anda tercatat",
    requestNo: "Nomor permintaan",
    dueAt: "Batas waktu penyelesaian",
    sentTo: (contact) => `Kode verifikasi dikirim ke ${contact}.`,
    nextStep:
      "Buka tab “Masukkan kode verifikasi”, masukkan nomor permintaan di atas beserta kode yang Anda terima. Tanpa langkah itu, identitas Anda belum terbukti dan data tidak dapat kami buka.",
    goVerify: "Masukkan kode verifikasi",
  },
  verify: {
    heading: "Verifikasi permintaan",
    intro:
      "Masukkan nomor permintaan yang Anda terima beserta kode verifikasi yang dikirim ke kontak terdaftar.",
    requestNo: "Nomor permintaan",
    code: "Kode verifikasi",
    codeHint: "Enam angka, berlaku 15 menit sejak dikirim.",
    submit: "Verifikasi",
    submitting: "Memverifikasi…",
    successHeading: "Identitas terverifikasi",
    successBody: (requestNo, dueAt) =>
      `Permintaan ${requestNo} sudah terverifikasi. Petugas pelindungan data pribadi akan menindaklanjutinya, paling lambat ${dueAt}.`,
    nextStep:
      "Kami menghubungi Anda melalui kontak yang Anda tuliskan bila ada yang perlu dilengkapi. Simpan nomor permintaan ini untuk menanyakan kabarnya.",
  },
  errors: { generic: "Permintaan tidak dapat diproses. Silakan coba lagi." },
};

const EN: DataRequestContent = {
  hero: {
    title: "Personal Data Requests",
    intro:
      "Ask for access to, correction of, or erasure of your or your child's personal data, or withdraw your consent. We record every request together with its deadline.",
  },
  rights: {
    heading: "Your rights under the Personal Data Protection Act",
    intro:
      "Law No. 27 of 2022 gives you rights over the personal data we process. Four of them can be exercised on this page.",
    access:
      "Access and a copy — to know what data we process, and to request a copy of it (Articles 30, 32).",
    rectification:
      "Rectification — to correct or update data that is inaccurate (Article 30(1)).",
    consentWithdrawal:
      "Withdrawal of consent — to stop processing that relies on your consent (Article 40(2)).",
    erasure:
      "Erasure — to have data deleted, insofar as archival retention duties do not limit it (Articles 43–44).",
    deadline:
      "We complete access, rectification and withdrawal of consent within 3×24 hours of receiving the request. Erasure follows the archival retention schedule, and we state its deadline when the request is recorded.",
  },
  tabs: { submit: "Submit a request", verify: "Enter the verification code" },
  form: {
    heading: "Request form",
    intro:
      "Enter your child's registration details. To show that you really are the registrant's family, we send a verification code to the contact already on file for the registration — not to the contact you type here.",
    type: "Type of request",
    registrationNo: "SPMB registration number",
    registrationNoPlaceholder: "e.g. SPMB-2026-000123",
    birthDate: "Registrant's date of birth",
    birthDateHint:
      "The date of birth must match the registration record; it is the second factor only the family knows.",
    requesterName: "Your name",
    requesterContact: "Your email or phone number",
    requesterContactHint: "We use it to get back to you about this request.",
    requesterRelation: "Your relationship to the registrant",
    requesterRelationPlaceholder: "e.g. Father, Mother, Guardian",
    detail: "Details of the request",
    detailPlaceholder:
      "Explain which data you mean and what you are asking for.",
    submit: "Send the request",
    submitting: "Sending…",
    gateWaiting: "Waiting for the security check…",
    gateBlocked:
      "The security check could not be loaded from your network. Try reloading the page, or contact the SPMB committee through the Contact page.",
    privacyLink: "Read the Privacy Policy",
  },
  submitted: {
    heading: "Your request has been recorded",
    requestNo: "Request number",
    dueAt: "Completion deadline",
    sentTo: (contact) => `A verification code was sent to ${contact}.`,
    nextStep:
      "Open the “Enter the verification code” tab, then enter the request number above with the code you received. Without that step your identity is unproven and we cannot open the data.",
    goVerify: "Enter the verification code",
  },
  verify: {
    heading: "Verify the request",
    intro:
      "Enter the request number you received together with the verification code sent to the registered contact.",
    requestNo: "Request number",
    code: "Verification code",
    codeHint: "Six digits, valid for 15 minutes from sending.",
    submit: "Verify",
    submitting: "Verifying…",
    successHeading: "Identity verified",
    successBody: (requestNo, dueAt) =>
      `Request ${requestNo} is verified. A personal data protection officer will follow it up, by ${dueAt} at the latest.`,
    nextStep:
      "We will contact you at the contact details you gave if anything needs completing. Keep this request number to ask about its progress.",
  },
  errors: { generic: "The request could not be processed. Please try again." },
};

const AR: DataRequestContent = {
  hero: {
    title: "طلبات البيانات الشخصية",
    intro:
      "اطلبوا الوصول إلى بياناتكم أو بيانات أبنائكم الشخصية أو تصحيحها أو حذفها، أو اسحبوا موافقتكم. نسجّل كل طلب مع مدّته المحدّدة.",
  },
  rights: {
    heading: "حقوقكم وفق قانون حماية البيانات الشخصية",
    intro:
      "يمنحكم القانون رقم 27 لسنة 2022 حقوقًا على البيانات الشخصية التي نعالجها. يمكنكم ممارسة أربعة منها في هذه الصفحة.",
    access:
      "الوصول والنسخة — معرفة البيانات التي نعالجها وطلب نسخة منها (المادتان 30 و32).",
    rectification:
      "التصحيح — تصحيح البيانات غير الدقيقة أو تحديثها (المادة 30 الفقرة 1).",
    consentWithdrawal:
      "سحب الموافقة — إيقاف المعالجة التي تستند إلى موافقتكم (المادة 40 الفقرة 2).",
    erasure:
      "الحذف — طلب حذف البيانات، ما لم تمنعه واجبات حفظ الأرشيف (المادتان 43–44).",
    deadline:
      "نُكمل الوصول والتصحيح وسحب الموافقة خلال ٣×٢٤ ساعة من استلام الطلب. أما الحذف فيتبع جدول حفظ الأرشيف، ونُبلّغكم بمدّته عند تسجيل الطلب.",
  },
  tabs: { submit: "تقديم الطلب", verify: "إدخال رمز التحقق" },
  form: {
    heading: "استمارة الطلب",
    intro:
      "أدخلوا بيانات تسجيل ابنكم. ولإثبات أنكم فعلًا من أسرة المتقدّم، نرسل رمز تحقق إلى بيانات التواصل المسجَّلة في طلب التسجيل — لا إلى بيانات التواصل التي تكتبونها هنا.",
    type: "نوع الطلب",
    registrationNo: "رقم التسجيل في SPMB",
    registrationNoPlaceholder: "مثال: SPMB-2026-000123",
    birthDate: "تاريخ ميلاد المتقدّم",
    birthDateHint:
      "يجب أن يطابق تاريخ الميلاد بيانات التسجيل؛ فهو العامل الثاني الذي تعرفه الأسرة وحدها.",
    requesterName: "اسمكم",
    requesterContact: "بريدكم الإلكتروني أو رقم هاتفكم",
    requesterContactHint: "نستخدمه للتواصل معكم بخصوص هذا الطلب.",
    requesterRelation: "صلة القرابة بالمتقدّم",
    requesterRelationPlaceholder: "مثال: الأب، الأم، الوصي",
    detail: "تفاصيل الطلب",
    detailPlaceholder: "وضّحوا أي بيانات تقصدون وما الذي تطلبونه.",
    submit: "إرسال الطلب",
    submitting: "جارٍ الإرسال…",
    gateWaiting: "في انتظار التحقق الأمني…",
    gateBlocked:
      "تعذّر تحميل التحقق الأمني من شبكتكم. جرّبوا إعادة تحميل الصفحة، أو تواصلوا مع لجنة القبول عبر صفحة التواصل.",
    privacyLink: "قراءة سياسة الخصوصية",
  },
  submitted: {
    heading: "سُجّل طلبكم",
    requestNo: "رقم الطلب",
    dueAt: "الموعد النهائي للإنجاز",
    sentTo: (contact) => `أُرسل رمز التحقق إلى ${contact}.`,
    nextStep:
      "افتحوا تبويب «إدخال رمز التحقق»، ثم أدخلوا رقم الطلب أعلاه مع الرمز الذي وصلكم. بدون هذه الخطوة لا تثبت هويتكم ولا يمكننا فتح البيانات.",
    goVerify: "إدخال رمز التحقق",
  },
  verify: {
    heading: "التحقق من الطلب",
    intro:
      "أدخلوا رقم الطلب الذي وصلكم مع رمز التحقق المرسل إلى بيانات التواصل المسجَّلة.",
    requestNo: "رقم الطلب",
    code: "رمز التحقق",
    codeHint: "ستة أرقام، صالح خمس عشرة دقيقة من إرساله.",
    submit: "تحقّق",
    submitting: "جارٍ التحقق…",
    successHeading: "تم التحقق من الهوية",
    successBody: (requestNo, dueAt) =>
      `تم التحقق من الطلب ${requestNo}. سيتابعه موظف حماية البيانات الشخصية في موعد أقصاه ${dueAt}.`,
    nextStep:
      "سنتواصل معكم عبر بيانات التواصل التي كتبتموها إن احتجنا إلى استكمال شيء. احفظوا رقم الطلب للسؤال عن حالته.",
  },
  errors: { generic: "تعذّر معالجة الطلب. يُرجى المحاولة مرة أخرى." },
};

const CONTENT: Record<Locale, DataRequestContent> = { id: ID, en: EN, ar: AR };

export function dataRequestContentFor(locale: Locale): DataRequestContent {
  return CONTENT[locale] ?? ID;
}
