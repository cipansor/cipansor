import {
  LayoutDashboard,
  Users,
  Building2,
  Mail,
  GraduationCap,
  BookOpen,
  Calendar,
  ClipboardCheck,
  BookMarked,
  Home,
  FileText,
  AlertTriangle,
  Award,
  Wallet,
  UserPlus,
  Clock,
  Library,
  Heart,
  Package,
  Bell,
  BarChart3,
  School,
  Settings,
  FileSpreadsheet,
  Baby,
  Receipt,
  Megaphone,
  Shield,
  UserCog,
  UtensilsCrossed,
  IdCard,
  CalendarDays,
  Send,
  ScrollText,
  Drama,
  HeartHandshake,
  BookCheck,
  ClipboardList,
  MessageSquare,
  MessagesSquare,
  Languages,
  Sparkles,
  Trophy,
  WashingMachine,
  ShoppingCart,
  CreditCard,
  ClipboardPenLine,
  FolderOpen,
  FileBarChart,
  Activity,
  ShoppingBag,
  MessageSquareWarning,
  Leaf,
  Globe,
  Mic,
  Microscope,
  FlaskConical,
  Briefcase,
  BookOpenCheck,
  NotebookPen,
  ShieldCheck,
  type LucideIcon,
  PhoneCall,
  CalendarX,
} from "lucide-react";
import {
  ADMIN_ROLE_CODES,
  GURU_BK_ROLE_CODES,
  PERMIT_STAFF_ROLE_CODES,
  SCHOOL_TEACHER_ROLE_CODES,
} from "@cipansor/shared";

/** TK Qur'an's teachers: their day-report item is the buku penghubung. */
const TK_TEACHER_ROLE_CODES = SCHOOL_TEACHER_ROLE_CODES.filter((code) =>
  code.startsWith("TKQ_"),
);
const NON_TK_TEACHER_ROLE_CODES = SCHOOL_TEACHER_ROLE_CODES.filter(
  (code) => !code.startsWith("TKQ_"),
);
/** School teachers who are not guru BK. */
const NON_BK_TEACHER_ROLE_CODES = SCHOOL_TEACHER_ROLE_CODES.filter(
  (code) => !GURU_BK_ROLE_CODES.includes(code),
);

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  roles?: string[]; // Legacy role support
  roleCodes?: string[]; // New RoleCode-based permissions
  realms?: string[]; // Realm-based filtering
  children?: NavItem[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
  /**
   * Shown only to someone who holds this duty. A duty is a relation, not a
   * role (decisions/peran-dan-tugas-tambahan.md), so the role code cannot
   * tell: `homeroom` is the wali kelas of a class in the current academic
   * year (`Class.homeroomTeacherId`), which the sidebar asks
   * GET /homeroom/my-classes for.
   */
  duty?: "homeroom";
}

/**
 * The one menu entry the page belongs to: the entry whose address is the
 * longest one the page sits at or under. "Inside its path" alone lit two
 * entries at once — Mengajar → Absensi (`/attendance`) and Wali Kelas →
 * Absensi Harian (`/attendance/record`) on the same page. A page with no entry
 * of its own still lights the section it sits in, as before.
 */
export function activeNavHref(
  groups: NavGroup[],
  pathname: string,
): string | null {
  let best: string | null = null;
  const consider = (href: string) => {
    const within = pathname === href || pathname.startsWith(`${href}/`);
    if (within && (best === null || href.length > best.length)) best = href;
  };
  for (const group of groups) {
    for (const item of group.items) {
      consider(item.href);
      for (const child of item.children ?? []) consider(child.href);
    }
  }
  return best;
}

/** The menu without the groups of duties the user does not hold. */
export function withDutiesHeld(
  navigation: NavGroup[],
  held: { homeroom: boolean },
): NavGroup[] {
  return navigation.filter((group) => !group.duty || held[group.duty]);
}

// Role codes by category for navigation permissions
const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "YAYASAN_KETUA",
  "TKQ_ADMIN",
  "TKQ_KEPALA_SEKOLAH",
  "SDIT_ADMIN",
  "SDIT_KEPALA_SEKOLAH",
  "SMPIT_ADMIN",
  "SMPIT_KEPALA_SEKOLAH",
  "SMAQ_ADMIN",
  "SMAQ_KEPALA_SEKOLAH",
];

const TEACHER_ROLES = [
  "TKQ_GURU",
  "SDIT_GURU",
  "SMPIT_GURU",
  "SMAQ_GURU",
  "SMPIT_GURU_BK",
  "SMAQ_GURU_BK",
];

const STAFF_ROLES = [
  "TKQ_TATA_USAHA",
  "SDIT_TATA_USAHA",
  "SMPIT_TATA_USAHA",
  "SMAQ_TATA_USAHA",
  "TKQ_BENDAHARA",
  "SDIT_BENDAHARA",
  "SMPIT_BENDAHARA",
  "SMAQ_BENDAHARA",
  "PESANTREN_TATA_USAHA",
  "PUSTAKAWAN",
  "PERAWAT",
  "KEAMANAN",
  "LABORAN",
  "BUSINESS_MANAGER",
  "BUSINESS_STAFF",
];

const STUDENT_ROLES = ["SDIT_SISWA", "SMPIT_SISWA", "SMAQ_SISWA"];

const PARENT_ROLES = [
  "TKQ_ORANG_TUA",
  "SDIT_ORANG_TUA",
  "SMPIT_ORANG_TUA",
  "SMAQ_ORANG_TUA",
];

const YAYASAN_ROLES = [
  "YAYASAN_PEMBINA",
  "YAYASAN_KETUA",
  "YAYASAN_SEKRETARIS",
  "YAYASAN_BENDAHARA",
  "YAYASAN_ANGGOTA",
  "YAYASAN_PENGAWAS",
];

// Pesantren leadership vs. field pengasuhan staff — they get different menus.
const PESANTREN_PIMPINAN_ROLES = ["PESANTREN_PENGASUH"];

const PESANTREN_PENGASUHAN_ROLES = ["USTADZ", "MUSYRIF", "MUHAFIDZ"];

const PESANTREN_ROLES = [
  ...PESANTREN_PIMPINAN_ROLES,
  ...PESANTREN_PENGASUHAN_ROLES,
];

// School committee — external oversight stakeholders, one per unit.
const KOMITE_ROLES = [
  "TKQ_KOMITE",
  "SDIT_KOMITE",
  "SMPIT_KOMITE",
  "SMAQ_KOMITE",
];

const ALUMNI_ROLES = ["SMPIT_ALUMNI", "SMAQ_ALUMNI"];

// Teacher-specific navigation
const teacherNavigation: NavGroup[] = [
  {
    title: "Ringkasan",
    items: [
      {
        title: "Dashboard",
        href: "/teacher",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    title: "Mengajar",
    items: [
      {
        title: "Tahfidz",
        href: "/tahfidz",
        icon: BookMarked,
      },
      {
        title: "Kelas Saya",
        href: "/classes",
        icon: BookOpen,
      },
      {
        title: "Siswa",
        href: "/students",
        icon: GraduationCap,
      },
      {
        title: "Absensi",
        href: "/attendance",
        icon: ClipboardCheck,
      },
      {
        // The same page: a TK guru writes a child's day for the wali
        // (buku penghubung); elsewhere it is the Mutabaah Yaumiyah.
        title: "Laporan Harian",
        href: "/daily-report",
        icon: NotebookPen,
        roleCodes: TK_TEACHER_ROLE_CODES,
      },
      {
        title: "Mutabaah Yaumiyah",
        href: "/daily-report",
        icon: Activity,
        roleCodes: NON_TK_TEACHER_ROLE_CODES,
      },
      {
        title: "Portfolio Siswa",
        href: "/portfolio",
        icon: FolderOpen,
      },
      {
        // The school counsellors: the readers of confidential sessions.
        title: "Bimbingan Konseling",
        href: "/counseling",
        icon: HeartHandshake,
        roleCodes: [...GURU_BK_ROLE_CODES],
      },
      {
        // A guru BK is told of the attendance patterns of their unit's
        // santri (decided 2026-09-28).
        title: "Pola Kehadiran",
        href: "/attendance/patterns",
        icon: CalendarX,
        roleCodes: [...GURU_BK_ROLE_CODES],
      },
    ],
  },
  {
    title: "Wali Kelas",
    duty: "homeroom",
    items: [
      {
        title: "Dashboard Wali Kelas",
        href: "/homeroom",
        icon: Home,
      },
      {
        // The same register as Absensi → Isi Absensi Harian; the page opens
        // on the class the user is wali kelas of (listed first by the API).
        title: "Absensi Harian",
        href: "/attendance/record",
        icon: ClipboardCheck,
      },
      {
        // Alpa with no reason, for the wali kelas to follow up with the wali
        // (decisions/absensi-harian.md); a santri mukim's is the musyrif's.
        title: "Tindak Lanjut Absensi",
        href: "/attendance/follow-ups",
        icon: PhoneCall,
      },
      {
        // Absent on 10% of the semester's days, or often late (decided
        // 2026-09-28): the wali kelas's pupils. A guru BK has it under
        // Mengajar, for their whole unit, and not twice.
        title: "Pola Kehadiran",
        href: "/attendance/patterns",
        icon: CalendarX,
        roleCodes: NON_BK_TEACHER_ROLE_CODES,
      },
      {
        title: "Catatan Perilaku",
        href: "/homeroom/behavior",
        icon: ClipboardList,
      },
      {
        title: "Pesan Orang Tua",
        href: "/homeroom/messages",
        icon: Send,
      },
      {
        // A day pupil's leave is the wali kelas's to decide (2026-09-25);
        // the page lists the ones waiting for them under "Perlu keputusan
        // saya".
        title: "Perizinan",
        href: "/permits",
        icon: FileText,
      },
    ],
  },
  {
    title: "Pesantren",
    items: [
      {
        title: "Jurnal Ibadah",
        href: "/ibadah",
        icon: Sparkles,
      },
      {
        title: "Muhadhoroh",
        href: "/muhadhoroh",
        icon: MessageSquare,
      },
      {
        title: "Muhadatsah",
        href: "/muhadatsah",
        icon: Languages,
      },
      {
        title: "Kitab Kuning",
        href: "/kitab-progress",
        icon: BookOpen,
      },
    ],
  },
  {
    title: "Kinerja",
    items: [
      {
        title: "Manajemen Kinerja",
        href: "/kinerja",
        icon: ClipboardPenLine,
        children: [
          {
            title: "Perjanjian Kinerja",
            href: "/kinerja/pk",
            icon: ClipboardList,
          },
          {
            title: "Evaluasi Periodik",
            href: "/kinerja/evaluasi",
            icon: ClipboardCheck,
          },
        ],
      },
    ],
  },
  {
    title: "Informasi",
    items: [
      {
        title: "E-Office (Persuratan)",
        href: "/e-office",
        icon: Mail,
      },
      {
        title: "Pengumuman",
        href: "/announcements",
        icon: Bell,
      },
      {
        title: "Aduan & Aspirasi",
        href: "/quality/complaints",
        icon: MessageSquareWarning,
      },
    ],
  },
];

// Staff-specific navigation
const staffNavigation: NavGroup[] = [
  {
    title: "Ringkasan",
    items: [
      {
        title: "Dashboard",
        href: "/staff",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    title: "Kinerja",
    items: [
      {
        title: "Manajemen Kinerja",
        href: "/kinerja",
        icon: ClipboardPenLine,
        children: [
          {
            title: "Perjanjian Kinerja",
            href: "/kinerja/pk",
            icon: ClipboardList,
          },
          {
            title: "Evaluasi Periodik",
            href: "/kinerja/evaluasi",
            icon: ClipboardCheck,
          },
        ],
      },
    ],
  },
  {
    title: "Layanan Siswa",
    items: [
      {
        title: "Data Siswa",
        href: "/students",
        icon: GraduationCap,
      },
      {
        title: "Kesehatan",
        href: "/health",
        icon: Heart,
      },
      {
        // Of the nine staff functions only tata usaha, keamanan (the gate)
        // and the nurse work with permits; the API refuses the rest.
        title: "Perizinan",
        href: "/permits",
        icon: FileText,
        roleCodes: [...PERMIT_STAFF_ROLE_CODES],
      },
      {
        title: "Pelanggaran",
        href: "/violations",
        icon: AlertTriangle,
      },
      {
        title: "Penghargaan",
        href: "/rewards",
        icon: Award,
      },
      {
        title: "Kampus Hijau",
        href: "/lingkungan",
        icon: Leaf,
      },
    ],
  },
  {
    title: "Administrasi",
    items: [
      {
        title: "Penerimaan (SPMB)",
        href: "/spmb",
        icon: UserPlus,
      },
      {
        title: "E-Office (Persuratan)",
        href: "/e-office",
        icon: Mail,
      },
      {
        title: "Keuangan",
        href: "/finance",
        icon: Wallet,
      },
      {
        title: "Pengumuman",
        href: "/announcements",
        icon: Bell,
      },
      {
        title: "Aduan & Aspirasi",
        href: "/quality/complaints",
        icon: MessageSquareWarning,
      },
    ],
  },
  {
    // One menu serves nine staff functions, so each service page is shown
    // only to the role that runs it (filtered in getNavigationForRoleCode;
    // `roleCodeRouteAccess` in rbac.ts opens the same pages). Until 2026-09-25
    // none of these roles could reach its own module.
    title: "Sarana & Layanan",
    items: [
      {
        title: "Perpustakaan",
        href: "/library",
        icon: Library,
        roleCodes: ["PUSTAKAWAN"],
        children: [
          {
            title: "Maktabah Digital",
            href: "/library/digital",
            icon: BookOpen,
            roleCodes: ["PUSTAKAWAN"],
          },
        ],
      },
      {
        // Laboratory equipment; /practicum is Amaliyah Tadris, not a lab.
        title: "Inventaris",
        href: "/inventory",
        icon: Package,
        roleCodes: ["LABORAN"],
      },
      {
        title: "Kantin & Koperasi",
        href: "/canteen",
        icon: ShoppingCart,
        roleCodes: ["BUSINESS_MANAGER", "BUSINESS_STAFF"],
      },
      {
        title: "Laundry",
        href: "/laundry",
        icon: WashingMachine,
        roleCodes: ["BUSINESS_MANAGER", "BUSINESS_STAFF"],
      },
      {
        title: "Unit Usaha",
        href: "/unit-usaha",
        icon: Briefcase,
        roleCodes: ["BUSINESS_MANAGER"],
      },
    ],
  },
];

// Student-specific navigation
const studentNavigation: NavGroup[] = [
  {
    title: "Ringkasan",
    items: [
      {
        title: "Dashboard",
        href: "/student",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    title: "Hafalan",
    items: [
      {
        title: "Hafalan Saya",
        href: "/tahfidz",
        icon: BookMarked,
      },
    ],
  },
  {
    title: "Akademik",
    items: [
      {
        title: "Ujian Online",
        href: "/student/exams",
        icon: BookCheck,
      },
      {
        title: "Portfolio Saya",
        href: "/portfolio",
        icon: FolderOpen,
      },
    ],
  },
  {
    title: "Pesantren",
    items: [
      {
        title: "Jurnal Ibadah",
        href: "/ibadah",
        icon: Sparkles,
      },
      {
        title: "Prestasi Ibadah",
        href: "/student/achievements",
        icon: Trophy,
      },
      {
        title: "Muhadhoroh",
        href: "/muhadhoroh",
        icon: MessageSquare,
      },
      {
        title: "Muhadatsah",
        href: "/muhadatsah",
        icon: Languages,
      },
      {
        title: "Kitab Kuning",
        href: "/kitab-progress",
        icon: BookOpen,
      },
      {
        title: "Muhasabah Harian",
        href: "/muhasabah",
        icon: Sparkles,
      },
    ],
  },
  {
    title: "Kegiatan",
    items: [
      {
        title: "Jadwal",
        href: "/schedule",
        icon: Calendar,
      },
      {
        title: "Pengumuman",
        href: "/announcements",
        icon: Bell,
      },
      {
        title: "Aduan & Aspirasi",
        href: "/quality/complaints",
        icon: MessageSquareWarning,
      },
    ],
  },
];

// Parent-specific navigation
const parentNavigation: NavGroup[] = [
  {
    title: "Ringkasan",
    items: [
      {
        title: "Dashboard",
        href: "/parent",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    title: "Anak Saya",
    items: [
      {
        title: "Data Anak",
        href: "/parent/children",
        icon: Baby,
      },
      {
        title: "Raport",
        href: "/parent/report-cards",
        icon: FileSpreadsheet,
      },
      {
        title: "Kesehatan",
        href: "/parent/health",
        icon: Heart,
      },
      {
        title: "Perizinan",
        href: "/parent/permits",
        icon: FileText,
      },
      {
        title: "Laporan Harian",
        href: "/parent/daily-report",
        icon: Activity,
      },
    ],
  },
  {
    title: "Kesiswaan",
    items: [
      {
        title: "Pelanggaran",
        href: "/parent/violations",
        icon: AlertTriangle,
      },
      {
        title: "Penghargaan",
        href: "/parent/rewards",
        icon: Award,
      },
      {
        title: "Ibadah",
        href: "/parent/ibadah",
        icon: BookOpenCheck,
      },
      {
        title: "Konseling",
        href: "/parent/counseling",
        icon: HeartHandshake,
      },
    ],
  },
  {
    title: "Keuangan",
    items: [
      {
        title: "Tagihan & Pembayaran",
        href: "/parent/finance",
        icon: Receipt,
      },
    ],
  },
  {
    title: "Komunikasi",
    items: [
      {
        title: "Buku Penghubung",
        href: "/parent/buku-penghubung",
        icon: NotebookPen,
      },
      {
        title: "Pesan",
        href: "/parent/messages",
        icon: MessageSquare,
      },
      {
        title: "Pengaturan Notifikasi",
        href: "/notifications/settings",
        icon: Bell,
      },
    ],
  },
  {
    title: "Informasi",
    items: [
      {
        title: "Pengumuman",
        href: "/announcements",
        icon: Megaphone,
      },
      {
        title: "Aduan & Aspirasi",
        href: "/quality/complaints",
        icon: MessageSquareWarning,
      },
    ],
  },
];

// Yayasan-specific navigation (for Yayasan admins and board members)
const yayasanNavigation: NavGroup[] = [
  {
    title: "Ringkasan",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
      },
      {
        title: "Analytics",
        href: "/analytics",
        icon: BarChart3,
      },
      {
        title: "Reports",
        href: "/reports",
        icon: FileSpreadsheet,
      },
    ],
  },
  {
    title: "Yayasan",
    items: [
      {
        title: "Yayasan",
        href: "/foundation",
        icon: Building2,
        children: [
          {
            title: "Units",
            href: "/units",
            icon: School,
          },
        ],
      },
      {
        title: "Penjaminan Mutu",
        href: "/quality",
        icon: Award,
        children: [
          {
            title: "Aduan & Aspirasi",
            href: "/quality/complaints",
            icon: MessageSquareWarning,
          },
        ],
      },
      {
        title: "Manajemen Risiko",
        href: "/risk-management",
        icon: Shield,
      },
      // Oversight across every unit. Until 2026-09-28 these two were only in
      // the unit admins' menu, and answered the yayasan's organs with "Unit ID
      // required" when opened by URL.
      {
        title: "Pengawasan Internal",
        href: "/pengawasan",
        icon: ClipboardCheck,
      },
      {
        title: "Kepatuhan Syariah",
        href: "/syariah",
        icon: BookCheck,
      },
    ],
  },
  {
    title: "Perencanaan & Kinerja",
    items: [
      {
        // Pengurus drafts and the Ketua submits the yayasan's plans, Pengawas
        // reviews and Pembina ratifies them; the kepala sekolah drafts the RKA
        // Unit. Until 2026-09-25 none of them had this link — the ratification
        // flow was reachable by typing the URL.
        title: "Perencanaan Strategis",
        href: "/perencanaan",
        icon: ClipboardList,
        children: [
          {
            title: "Peta Strategi",
            href: "/perencanaan/strategy-map",
            icon: Globe,
          },
        ],
      },
      {
        title: "Manajemen Kinerja",
        href: "/kinerja",
        icon: ClipboardPenLine,
        children: [
          {
            title: "Perjanjian Kinerja",
            href: "/kinerja/pk",
            icon: ClipboardList,
          },
          {
            title: "Evaluasi Periodik",
            href: "/kinerja/evaluasi",
            icon: ClipboardCheck,
          },
          {
            title: "Analitik Kinerja",
            href: "/kinerja/analytics",
            icon: BarChart3,
          },
        ],
      },
    ],
  },
  {
    title: "Keuangan",
    items: [
      {
        title: "Tagihan & SPP",
        href: "/finance",
        icon: Receipt,
        children: [
          {
            title: "Verifikasi Pembayaran",
            href: "/finance/verification",
            icon: Receipt,
          },
        ],
      },
      {
        title: "Laporan Keuangan",
        href: "/finance/accounting",
        icon: Wallet,
        children: [
          {
            title: "BOS/BOP",
            href: "/finance/bos",
            icon: Wallet,
          },
        ],
      },
      {
        title: "Donation/ZIS",
        href: "/donation",
        icon: HeartHandshake,
        children: [
          {
            title: "Public Portal",
            href: "/wakaf-infaq",
            icon: HeartHandshake,
          },
        ],
      },
      {
        title: "Procurement",
        href: "/procurement",
        icon: ShoppingBag,
      },
    ],
  },
  {
    title: "Informasi",
    items: [
      {
        title: "E-Office (Persuratan)",
        href: "/e-office",
        icon: Mail,
      },
      {
        title: "Pengumuman",
        href: "/announcements",
        icon: Megaphone,
      },
      {
        title: "Data Alumni",
        href: "/alumni",
        icon: GraduationCap,
      },
    ],
  },
];

// Admin navigation - for Super Admin and Unit Admins
const adminNavigation: NavGroup[] = [
  {
    title: "Ringkasan",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
      },
      {
        title: "Analytics",
        href: "/analytics",
        icon: BarChart3,
      },
      {
        title: "Reports",
        href: "/reports",
        icon: FileSpreadsheet,
      },
      {
        // Per-unit rapor configuration and generation. Restricted to the roles
        // whose `roleCodeRouteAccess` grants `/rapor-pesantren`: the four unit
        // admins and the super admin. Leaving it unrestricted would show it to
        // the yayasan roles, which share the UNIT_ADMIN bucket but are not
        // granted the route and would be bounced back to /dashboard.
        title: "Rapor Pesantren",
        href: "/rapor-pesantren",
        icon: FileSpreadsheet,
        roleCodes: [
          "SUPER_ADMIN",
          "TKQ_ADMIN",
          "SDIT_ADMIN",
          "SMPIT_ADMIN",
          "SMAQ_ADMIN",
        ],
      },
      {
        title: "EMIS Kemenag",
        href: "/emis",
        icon: FileSpreadsheet,
        roleCodes: [
          "SUPER_ADMIN",
          "TKQ_ADMIN",
          "SDIT_ADMIN",
          "SMPIT_ADMIN",
          "SMAQ_ADMIN",
        ],
      },
    ],
  },
  {
    title: "Akademik",
    items: [
      {
        title: "Students",
        href: "/students",
        icon: GraduationCap,
        children: [
          {
            title: "Student ID Card",
            href: "/students/id-card",
            icon: IdCard,
          },
          {
            title: "Certificates",
            href: "/students/certificates",
            icon: Award,
          },
          {
            title: "Transcript",
            href: "/students/transcript",
            icon: ScrollText,
          },
          {
            title: "Portfolio Siswa",
            href: "/portfolio",
            icon: FolderOpen,
          },
          {
            title: "Student Compliance",
            href: "/students/compliance",
            icon: Shield,
          },
        ],
      },
      {
        title: "Classes",
        href: "/classes",
        icon: BookOpen,
        children: [
          {
            title: "Academic Years",
            href: "/academic-years",
            icon: Calendar,
          },
          {
            title: "Mata Pelajaran & Jadwal",
            href: "/curriculum",
            icon: BookMarked,
          },
          {
            title: "Kurikulum Merdeka",
            href: "/curriculum/merdeka",
            icon: BookMarked,
          },
          {
            title: "Timetable",
            href: "/curriculum/schedules/timetable",
            icon: CalendarDays,
          },
        ],
      },
      {
        title: "Assessment",
        href: "/assessment",
        icon: ClipboardCheck,
        children: [
          {
            title: "Question Banks (CBT)",
            href: "/cbt/banks",
            icon: BookCheck,
          },
          {
            title: "Jadwal Ujian (CBT)",
            href: "/cbt/exams",
            icon: BookOpenCheck,
          },
          {
            title: "Raport Merdeka",
            href: "/assessment/raport-merdeka",
            icon: FileSpreadsheet,
          },
        ],
      },
      {
        title: "Attendance",
        href: "/attendance",
        icon: ClipboardCheck,
        children: [
          {
            title: "Attendance Calendar",
            href: "/attendance/calendar",
            icon: CalendarDays,
          },
          {
            title: "Academic Calendar",
            href: "/calendar",
            icon: CalendarDays,
          },
          {
            // TK reaches the same page as TK / PAUD → Laporan Harian.
            title: "Mutabaah Yaumiyah",
            href: "/daily-report",
            icon: Activity,
            roleCodes: ["SDIT_ADMIN", "SDIT_KEPALA_SEKOLAH"],
          },
        ],
      },
      {
        title: "Tahfidz",
        href: "/tahfidz",
        icon: BookMarked,
        children: [
          {
            title: "E-Simaan",
            href: "/tahfidz/e-simaan",
            icon: Mic,
          },
          {
            title: "Jadwal Simaan",
            href: "/tahfidz/simaan/schedule",
            icon: CalendarDays,
          },
          {
            title: "Peta Al-Quran",
            href: "/tahfidz/quran-map",
            icon: BookCheck,
          },
          {
            title: "Analitik Murojaah",
            href: "/tahfidz/murojaah/analytics",
            icon: BarChart3,
          },
        ],
      },
      {
        title: "TK / PAUD",
        href: "/tk",
        icon: Baby,
        children: [
          {
            title: "Penilaian TK",
            href: "/tk/assessment",
            icon: ClipboardPenLine,
          },
          {
            title: "Progres Penilaian",
            href: "/tk/assessment/progress",
            icon: BarChart3,
          },
          {
            // One daily-report page for every unit (decided 2026-09-27); a
            // class's day and the wali's view are on it and on /parent. SD
            // reaches it as Attendance → Mutabaah Yaumiyah.
            title: "Laporan Harian",
            href: "/daily-report",
            icon: NotebookPen,
            roleCodes: ["SUPER_ADMIN", "TKQ_ADMIN"],
          },
          {
            title: "Raport TK",
            href: "/tk/reports",
            icon: FileBarChart,
          },
        ],
      },
    ],
  },
  {
    title: "Kesantrian & Pesantren",
    items: [
      {
        title: "Jurnal Ibadah",
        href: "/ibadah",
        icon: Sparkles,
        children: [
          {
            title: "Muhasabah",
            href: "/muhasabah",
            icon: Sparkles,
          },
        ],
      },
      {
        title: "Muhadhoroh",
        href: "/muhadhoroh",
        icon: MessageSquare,
        children: [
          {
            title: "Muhadatsah",
            href: "/muhadatsah",
            icon: Languages,
          },
        ],
      },
      {
        title: "Kitab Kuning",
        href: "/kitab-progress",
        icon: BookOpen,
        children: [
          {
            title: "Takhosus",
            href: "/takhosus",
            icon: BookMarked,
          },
          {
            title: "Turats Lab",
            href: "/research",
            icon: ScrollText,
          },
          {
            title: "Amaliyah Tadris",
            href: "/practicum",
            icon: ClipboardPenLine,
          },
        ],
      },
      {
        title: "Dormitories",
        href: "/dormitories",
        icon: Home,
        children: [
          {
            title: "Perizinan",
            href: "/permits",
            icon: FileText,
          },
          {
            title: "Violations",
            href: "/violations",
            icon: AlertTriangle,
          },
          {
            title: "Rewards",
            href: "/rewards",
            icon: Award,
          },
        ],
      },
      {
        title: "Ekstrakurikuler",
        href: "/extracurricular",
        icon: Drama,
        children: [
          {
            title: "Qiyadah (Organisasi)",
            href: "/student-org",
            icon: Users,
          },
          {
            title: "Piket Santri",
            href: "/duty-roster",
            icon: ClipboardList,
          },
        ],
      },
      {
        title: "Bimbingan Konseling",
        href: "/counseling",
        icon: HeartHandshake,
      },
      {
        title: "Alumni",
        href: "/alumni",
        icon: GraduationCap,
        children: [
          {
            title: "Si-Taka (Sebaran)",
            href: "/alumni/placement",
            icon: Globe,
          },
        ],
      },
    ],
  },
  {
    title: "SDM",
    items: [
      {
        title: "Kepegawaian",
        href: "/hr",
        icon: Clock,
        children: [
          {
            title: "Staff Attendance",
            href: "/hr/attendance",
            icon: ClipboardCheck,
          },
          {
            title: "Teacher Compliance",
            href: "/hr/teachers/compliance",
            icon: Shield,
          },
        ],
      },
      {
        title: "Penggajian",
        href: "/payroll",
        icon: Wallet,
        children: [
          {
            title: "Komponen Gaji",
            href: "/hr/payroll/components",
            icon: CreditCard,
          },
          {
            title: "Periode Penggajian",
            href: "/hr/payroll/periods",
            icon: CalendarDays,
          },
          {
            title: "Gaji Pegawai",
            href: "/hr/payroll/staff-salary",
            icon: Wallet,
          },
        ],
      },
      {
        title: "Manajemen Talenta",
        href: "/talenta",
        icon: Sparkles,
        children: [
          {
            title: "Matriks Talenta",
            href: "/talenta/matrix",
            icon: LayoutDashboard,
          },
          {
            title: "Perencanaan Suksesi",
            href: "/talenta/succession",
            icon: Trophy,
          },
          {
            title: "Analitik Talenta",
            href: "/talenta/analytics",
            icon: BarChart3,
          },
        ],
      },
    ],
  },
  {
    title: "Keuangan",
    items: [
      {
        title: "Tagihan & SPP",
        href: "/finance",
        icon: Receipt,
        children: [
          {
            title: "Dompet Santri",
            href: "/finance/wallet",
            icon: CreditCard,
          },
        ],
      },
      {
        title: "Laporan Keuangan",
        href: "/finance/accounting",
        icon: Wallet,
        children: [
          {
            // Hub for neraca / laba rugi / arus kas / buku besar / neraca saldo.
            // Those six report pages had no menu path of their own.
            title: "Laporan Akuntansi",
            href: "/finance/reports",
            icon: FileBarChart,
          },
          {
            title: "BOS/BOP",
            href: "/finance/bos",
            icon: Wallet,
          },
          {
            title: "Konsolidasi Keuangan",
            href: "/foundation/finance/consolidation",
            icon: FileSpreadsheet,
            roleCodes: ["SUPER_ADMIN"],
          },
        ],
      },
      {
        title: "Donation/ZIS",
        href: "/donation",
        icon: HeartHandshake,
        children: [
          {
            title: "Scholarships",
            href: "/finance/scholarships",
            icon: Award,
          },
        ],
      },
      {
        title: "Procurement",
        href: "/procurement",
        icon: ShoppingBag,
      },
    ],
  },
  {
    title: "Pemasaran & Penerimaan",
    items: [
      {
        title: "Pemasaran",
        href: "/marketing",
        icon: BarChart3,
        children: [
          {
            title: "Campaigns",
            href: "/marketing/campaigns",
            icon: Megaphone,
          },
          {
            title: "Leads",
            href: "/marketing/leads",
            icon: Users,
          },
          {
            title: "Analitik Marketing",
            href: "/admin/marketing",
            icon: BarChart3,
            roleCodes: ["SUPER_ADMIN"],
          },
        ],
      },
      {
        // /spmb is the SPMB hub #439 introduced; /admissions keeps the one
        // page that hub has no equivalent of yet, so it does not go unreachable.
        title: "Penerimaan (SPMB)",
        href: "/spmb",
        icon: UserPlus,
        children: [
          {
            title: "Pendaftar",
            href: "/spmb/registrations",
            icon: Users,
          },
          {
            title: "Periode & Gelombang",
            href: "/spmb/periods",
            icon: Calendar,
          },
          {
            title: "Analitik Penerimaan",
            href: "/admissions/analytics",
            icon: BarChart3,
          },
        ],
      },
    ],
  },
  {
    // Perencanaan dan kinerja duduk dalam satu grup dengan sengaja. Manajemen
    // kinerja secara keilmuan adalah fungsi SDM, tetapi memindahkannya ke sana
    // memutus kedekatan RKA → Perjanjian Kinerja — justru rantai yang paling
    // sulit dipahami orang, dan yang kedekatan di menu ini ikut mengajarkannya.
    title: "Perencanaan & Kinerja",
    items: [
      {
        title: "Perencanaan Strategis",
        href: "/perencanaan",
        icon: ClipboardList,
        children: [
          {
            title: "Peta Strategi",
            href: "/perencanaan/strategy-map",
            icon: Globe,
          },
        ],
      },
      {
        title: "Manajemen Kinerja",
        href: "/kinerja",
        icon: ClipboardPenLine,
        children: [
          {
            title: "Perjanjian Kinerja",
            href: "/kinerja/pk",
            icon: ClipboardList,
          },
          {
            title: "Evaluasi Periodik",
            href: "/kinerja/evaluasi",
            icon: ClipboardCheck,
          },
          {
            title: "Analitik Kinerja",
            href: "/kinerja/analytics",
            icon: BarChart3,
          },
        ],
      },
      {
        title: "Dashboard GRC",
        href: "/grc-dashboard",
        icon: ShieldCheck,
        children: [
          {
            title: "Manajemen Risiko",
            href: "/risk-management",
            icon: Shield,
          },
          {
            title: "Pengawasan Internal",
            href: "/pengawasan",
            icon: ClipboardCheck,
          },
          {
            title: "Kepatuhan Syariah",
            href: "/syariah",
            icon: BookCheck,
          },
          {
            title: "Tata Laksana (SOP)",
            href: "/tata-laksana",
            icon: ScrollText,
          },
          {
            title: "Struktur Organisasi",
            href: "/organisasi",
            icon: UserCog,
          },
        ],
      },
      {
        title: "Penjaminan Mutu",
        href: "/quality",
        icon: Award,
        children: [
          {
            title: "Aduan & Aspirasi",
            href: "/quality/complaints",
            icon: MessageSquareWarning,
          },
          {
            title: "Kesiapan Akreditasi",
            href: "/foundation/accreditation/readiness",
            icon: Award,
            roleCodes: ["SUPER_ADMIN"],
          },
        ],
      },
      {
        title: "Projects",
        href: "/project",
        icon: FolderOpen,
      },
    ],
  },
  {
    title: "Sarana & Layanan",
    items: [
      {
        title: "Facilities",
        href: "/facilities",
        icon: Building2,
        children: [
          {
            title: "Inventory (Asset)",
            href: "/inventory",
            icon: Package,
          },
        ],
      },
      {
        title: "E-Office (Persuratan)",
        href: "/e-office",
        icon: Mail,
      },
      {
        title: "Library",
        href: "/library",
        icon: Library,
        children: [
          {
            title: "Maktabah Digital",
            href: "/library/digital",
            icon: BookOpen,
          },
        ],
      },
      {
        title: "Health (UKS)",
        href: "/health",
        icon: Heart,
        children: [
          {
            title: "Meals",
            href: "/meals",
            icon: UtensilsCrossed,
          },
          {
            title: "Canteen/Koperasi",
            href: "/canteen",
            icon: ShoppingCart,
          },
          {
            title: "Laundry",
            href: "/laundry",
            icon: WashingMachine,
          },
        ],
      },
      {
        title: "Reception",
        href: "/reception",
        icon: IdCard,
      },
      {
        // A unit's operator broadcasts to its unit; Super Admin writes no
        // content (decisions/siaran-pengumuman.md).
        title: "Pengumuman",
        href: "/announcements",
        icon: Megaphone,
        roleCodes: ADMIN_ROLE_CODES.filter((code) => code !== "SUPER_ADMIN"),
      },
      {
        title: "Unit Usaha",
        href: "/unit-usaha",
        icon: Briefcase,
      },
    ],
  },
  {
    title: "Sistem",
    items: [
      {
        // The unit's own page: its details and its accreditation
        // (decisions/akreditasi-unit.md), kept by the unit's admin.
        title: "Profil Unit",
        href: "/units/mine",
        icon: School,
        roleCodes: ["TKQ_ADMIN", "SDIT_ADMIN", "SMPIT_ADMIN", "SMAQ_ADMIN"],
      },
      {
        title: "Yayasan",
        href: "/foundation",
        icon: Building2,
        roleCodes: ["SUPER_ADMIN"],
        children: [
          {
            title: "Units",
            href: "/units",
            icon: School,
            roleCodes: ["SUPER_ADMIN"],
          },
        ],
      },
      {
        title: "Users & Roles",
        href: "/users",
        icon: UserCog,
        children: [
          {
            title: "Role Permissions",
            href: "/settings/roles",
            icon: Shield,
            roleCodes: ["SUPER_ADMIN"],
          },
        ],
      },
      {
        title: "Wilayah",
        href: "/wilayah",
        icon: Building2,
        roleCodes: ["SUPER_ADMIN"],
      },
      {
        title: "Settings",
        href: "/settings",
        icon: Settings,
        children: [
          {
            /**
             * The approval queue for electronic-signature keys.
             *
             * It had no entry here at all, and `/settings/esign` appeared nowhere
             * in the codebase but its own page file — so the only way to reach it
             * was to type the URL. The effect was a dead end for the whole
             * feature: a signer requests a key, nobody ever sees the request, no
             * key is ever issued, and no letter can be signed.
             */
            title: "Tanda Tangan Elektronik",
            href: "/settings/esign",
            icon: ShieldCheck,
            roleCodes: ["SUPER_ADMIN"],
            roles: ["SUPER_ADMIN"],
          },
          {
            // The editable persona (tone/style) of the public chatbot. Safety rules
            // are code-resident; this only controls how the assistant speaks.
            title: "Asisten AI",
            href: "/settings/chatbot",
            icon: MessageSquare,
            roleCodes: ["SUPER_ADMIN"],
            roles: ["SUPER_ADMIN"],
          },
          {
            // Riwayat tanya-jawab asisten publik. Dikunci ke SUPER_ADMIN dengan
            // alasan yang lebih keras daripada persona di atasnya: isinya kalimat
            // yang benar-benar diketik pengunjung, dan terhapus sendiri setelah 90
            // hari.
            title: "Riwayat Percakapan",
            href: "/settings/chatbot/percakapan",
            icon: MessagesSquare,
            roleCodes: ["SUPER_ADMIN"],
            roles: ["SUPER_ADMIN"],
          },
        ],
      },
    ],
  },
];

// Kepala Sekolah navigation - extended admin with focus on school operations
const kepalaSekolahNavigation: NavGroup[] = [
  {
    title: "Ringkasan",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
      },
      {
        title: "Analytics",
        href: "/analytics",
        icon: BarChart3,
      },
      {
        title: "Reports",
        href: "/reports",
        icon: FileSpreadsheet,
      },
      {
        // The kepala sekolah reads their unit's page and its accreditation;
        // they are the ones reminded before it runs out.
        title: "Profil Unit",
        href: "/units/mine",
        icon: School,
      },
    ],
  },
  {
    title: "Akademik",
    items: [
      {
        title: "Students",
        href: "/students",
        icon: GraduationCap,
        children: [
          {
            title: "Portfolio Siswa",
            href: "/portfolio",
            icon: FolderOpen,
          },
        ],
      },
      {
        title: "Classes",
        href: "/classes",
        icon: BookOpen,
        children: [
          {
            title: "Mata Pelajaran & Jadwal",
            href: "/curriculum",
            icon: BookMarked,
          },
        ],
      },
      {
        title: "Assessment",
        href: "/assessment",
        icon: ClipboardCheck,
      },
      {
        title: "Tahfidz",
        href: "/tahfidz",
        icon: BookMarked,
      },
      {
        title: "Attendance",
        href: "/attendance",
        icon: ClipboardCheck,
      },
      {
        // The TK kepala sekolah reads and supervises the children's days.
        title: "Laporan Harian",
        href: "/daily-report",
        icon: NotebookPen,
        roleCodes: ["TKQ_KEPALA_SEKOLAH"],
      },
      {
        title: "Admissions",
        href: "/admissions",
        icon: UserPlus,
      },
    ],
  },
  {
    title: "Kesantrian",
    items: [
      {
        title: "Perizinan",
        href: "/permits",
        icon: FileText,
      },
      {
        // A confidential session reaches the kepala sekolah as its referrals.
        title: "Bimbingan Konseling",
        href: "/counseling",
        icon: HeartHandshake,
      },
      {
        title: "Violations",
        href: "/violations",
        icon: AlertTriangle,
      },
      {
        title: "Rewards",
        href: "/rewards",
        icon: Award,
      },
    ],
  },
  {
    title: "SDM",
    items: [
      {
        title: "Kepegawaian",
        href: "/hr",
        icon: Clock,
        children: [
          {
            title: "Teachers",
            href: "/hr/employees",
            icon: Users,
          },
        ],
      },
    ],
  },
  {
    title: "Perencanaan & Kinerja",
    items: [
      {
        // Pengurus drafts and the Ketua submits the yayasan's plans, Pengawas
        // reviews and Pembina ratifies them; the kepala sekolah drafts the RKA
        // Unit. Until 2026-09-25 none of them had this link — the ratification
        // flow was reachable by typing the URL.
        title: "Perencanaan Strategis",
        href: "/perencanaan",
        icon: ClipboardList,
        children: [
          {
            title: "Peta Strategi",
            href: "/perencanaan/strategy-map",
            icon: Globe,
          },
        ],
      },
      {
        title: "Manajemen Kinerja",
        href: "/kinerja",
        icon: ClipboardPenLine,
        children: [
          {
            title: "Perjanjian Kinerja",
            href: "/kinerja/pk",
            icon: ClipboardList,
          },
          {
            title: "Evaluasi Periodik",
            href: "/kinerja/evaluasi",
            icon: ClipboardCheck,
          },
          {
            title: "Analitik Kinerja",
            href: "/kinerja/analytics",
            icon: BarChart3,
          },
        ],
      },
    ],
  },
  {
    title: "Sarana & Layanan",
    items: [
      {
        title: "E-Office (Persuratan)",
        href: "/e-office",
        icon: Mail,
      },
      {
        title: "Pengumuman",
        href: "/announcements",
        icon: Megaphone,
      },
    ],
  },
  {
    title: "Sistem",
    items: [
      {
        title: "Users & Staff",
        href: "/users",
        icon: UserCog,
      },
      {
        title: "Settings",
        href: "/settings",
        icon: Settings,
      },
    ],
  },
];

// Pesantren leadership (Pimpinan Pesantren / Kiai) — oversight across pengasuhan,
// tahfidz/diniyah, boarding services and reporting.
const pesantrenPimpinanNavigation: NavGroup[] = [
  {
    title: "Ringkasan",
    items: [
      { title: "Dashboard", href: "/teacher", icon: LayoutDashboard },
      { title: "Analitik", href: "/analytics", icon: BarChart3 },
    ],
  },
  {
    title: "Santri & Pengasuhan",
    items: [
      { title: "Data Santri", href: "/students", icon: GraduationCap },
      { title: "Musyrif & Halaqoh", href: "/musyrif", icon: UserCog },
      { title: "Asrama", href: "/dormitories", icon: Home },
      { title: "Perizinan", href: "/permits", icon: ScrollText },
      { title: "Pelanggaran", href: "/violations", icon: AlertTriangle },
      { title: "Prestasi & Reward", href: "/rewards", icon: Trophy },
    ],
  },
  {
    title: "Tahfidz & Diniyah",
    items: [
      { title: "Tahfidz", href: "/tahfidz", icon: BookMarked },
      { title: "Takhosus", href: "/takhosus", icon: BookCheck },
      { title: "Kitab Kuning", href: "/kitab-progress", icon: BookOpen },
      { title: "Jurnal Ibadah", href: "/ibadah", icon: Sparkles },
      { title: "Muhadhoroh", href: "/muhadhoroh", icon: Mic },
      { title: "Muhadatsah", href: "/muhadatsah", icon: Languages },
    ],
  },
  {
    title: "Kesantrian",
    items: [
      { title: "Muhasabah", href: "/muhasabah", icon: ClipboardPenLine },
      { title: "Konseling", href: "/counseling", icon: HeartHandshake },
      { title: "Kesehatan", href: "/health", icon: Heart },
      { title: "Piket & Jaga", href: "/duty-roster", icon: Clock },
    ],
  },
  {
    title: "Layanan Asrama",
    items: [
      { title: "Dapur & Konsumsi", href: "/meals", icon: UtensilsCrossed },
      { title: "Laundry", href: "/laundry", icon: WashingMachine },
      { title: "Kantin", href: "/canteen", icon: ShoppingCart },
    ],
  },
  {
    title: "Laporan",
    items: [
      {
        title: "Rapor Pesantren",
        href: "/rapor-pesantren",
        icon: FileSpreadsheet,
      },
      { title: "Laporan", href: "/reports", icon: FileBarChart },
    ],
  },
  {
    title: "Informasi",
    items: [
      { title: "E-Office (Persuratan)", href: "/e-office", icon: Mail },
      { title: "Pengumuman", href: "/announcements", icon: Bell },
      {
        title: "Aduan & Aspirasi",
        href: "/quality/complaints",
        icon: MessageSquareWarning,
      },
    ],
  },
];

// Pesantren field staff (Ustadz, Musyrif/ah, Muhafidz/ah, Murabbi, Wali Kamar)
// — day-to-day pengasuhan of the santri they are responsible for.
const pesantrenPengasuhanNavigation: NavGroup[] = [
  {
    title: "Ringkasan",
    items: [{ title: "Dashboard", href: "/teacher", icon: LayoutDashboard }],
  },
  {
    title: "Halaqoh & Tahfidz",
    items: [
      { title: "Tahfidz", href: "/tahfidz", icon: BookMarked },
      { title: "Takhosus", href: "/takhosus", icon: BookCheck },
      { title: "Kitab Kuning", href: "/kitab-progress", icon: BookOpen },
    ],
  },
  {
    title: "Pengasuhan",
    items: [
      { title: "Santri Binaan", href: "/students", icon: GraduationCap },
      {
        // A santri mukim's Alpa is followed up by their musyrif.
        title: "Tindak Lanjut Absensi",
        href: "/attendance/follow-ups",
        icon: PhoneCall,
      },
      {
        // A santri mukim's pattern is told to their musyrif too.
        title: "Pola Kehadiran",
        href: "/attendance/patterns",
        icon: CalendarX,
      },
      { title: "Asrama", href: "/dormitories", icon: Home },
      { title: "Musyrif", href: "/musyrif", icon: UserCog },
      { title: "Mutabaah Yaumiyah", href: "/daily-report", icon: Activity },
      { title: "Jurnal Ibadah", href: "/ibadah", icon: Sparkles },
      { title: "Muhasabah", href: "/muhasabah", icon: ClipboardPenLine },
    ],
  },
  {
    title: "Kedisiplinan",
    items: [
      { title: "Perizinan", href: "/permits", icon: ScrollText },
      { title: "Pelanggaran", href: "/violations", icon: AlertTriangle },
      { title: "Prestasi & Reward", href: "/rewards", icon: Trophy },
      { title: "Piket & Jaga", href: "/duty-roster", icon: Clock },
    ],
  },
  {
    title: "Kegiatan",
    items: [
      { title: "Muhadhoroh", href: "/muhadhoroh", icon: Mic },
      { title: "Muhadatsah", href: "/muhadatsah", icon: Languages },
      { title: "Jadwal", href: "/schedule", icon: Calendar },
    ],
  },
  {
    title: "Layanan",
    items: [
      { title: "Kesehatan", href: "/health", icon: Heart },
      { title: "Laundry", href: "/laundry", icon: WashingMachine },
      { title: "Konsumsi", href: "/meals", icon: UtensilsCrossed },
    ],
  },
  {
    title: "Laporan",
    items: [
      {
        title: "Rapor Pesantren",
        href: "/rapor-pesantren",
        icon: FileSpreadsheet,
      },
    ],
  },
  {
    title: "Informasi",
    items: [
      { title: "E-Office (Persuratan)", href: "/e-office", icon: Mail },
      { title: "Pengumuman", href: "/announcements", icon: Bell },
      {
        title: "Aduan & Aspirasi",
        href: "/quality/complaints",
        icon: MessageSquareWarning,
      },
    ],
  },
];

// Komite Sekolah — external stakeholders. Oversight and transparency only,
// no operational data entry.
const komiteNavigation: NavGroup[] = [
  {
    title: "Pengawasan",
    items: [
      { title: "Laporan Sekolah", href: "/reports", icon: FileBarChart },
      { title: "Analitik", href: "/analytics", icon: BarChart3 },
      { title: "Penjaminan Mutu", href: "/quality", icon: Shield },
    ],
  },
  {
    title: "Keuangan",
    items: [
      { title: "Tagihan & SPP", href: "/finance", icon: Receipt },
      { title: "Donasi & Wakaf", href: "/donation", icon: HeartHandshake },
    ],
  },
  {
    title: "Kesiswaan",
    items: [
      { title: "Data Siswa", href: "/students", icon: GraduationCap },
      { title: "Prestasi Siswa", href: "/rewards", icon: Trophy },
    ],
  },
  {
    title: "Partisipasi",
    items: [
      {
        title: "Aduan & Aspirasi",
        href: "/quality/complaints",
        icon: MessageSquareWarning,
      },
      { title: "Pengumuman", href: "/announcements", icon: Bell },
      { title: "Agenda Kegiatan", href: "/schedule", icon: Calendar },
    ],
  },
];

// Alumni across every unit (school, pesantren and PT).
const alumniNavigation: NavGroup[] = [
  {
    title: "Alumni",
    items: [
      { title: "Direktori Alumni", href: "/alumni", icon: Users },
      {
        title: "Penempatan Karier",
        href: "/alumni/placement",
        icon: Briefcase,
      },
      { title: "Sanad Keilmuan", href: "/alumni/sanad", icon: ScrollText },
    ],
  },
  {
    title: "Dokumen Saya",
    items: [
      { title: "Sertifikat", href: "/certificates", icon: Award },
      { title: "Portfolio", href: "/portfolio", icon: FolderOpen },
    ],
  },
  {
    title: "Kontribusi",
    items: [
      { title: "Donasi & Wakaf", href: "/donation", icon: HeartHandshake },
      {
        title: "Aduan & Aspirasi",
        href: "/quality/complaints",
        icon: MessageSquareWarning,
      },
    ],
  },
  {
    title: "Informasi",
    items: [{ title: "Pengumuman", href: "/announcements", icon: Bell }],
  },
];

export const navigationConfig: NavGroup[] = adminNavigation;

// Role category helpers
function isAdminRole(roleCode: string): boolean {
  return ADMIN_ROLES.includes(roleCode);
}

function isTeacherRole(roleCode: string): boolean {
  return TEACHER_ROLES.includes(roleCode);
}

function isStaffRole(roleCode: string): boolean {
  return STAFF_ROLES.includes(roleCode);
}

function isStudentRole(roleCode: string): boolean {
  return STUDENT_ROLES.includes(roleCode);
}

function isParentRole(roleCode: string): boolean {
  return PARENT_ROLES.includes(roleCode);
}

function isYayasanRole(roleCode: string): boolean {
  return YAYASAN_ROLES.includes(roleCode);
}

function isPrincipalRole(roleCode: string): boolean {
  if (!roleCode || typeof roleCode !== "string") return false;
  return roleCode.includes("KEPALA_SEKOLAH");
}

export interface ActiveRole {
  id: string;
  code: string;
  name: string;
  realm: string;
}

/**
 * Keep only the entries this role may see, at every depth.
 *
 * The filter used to check `group.items` alone, which was only correct while
 * nothing had children: a `roleCodes`-restricted entry nested under an
 * unrestricted parent — "Mutabaah Yaumiyah" (TKQ/SDIT only) under Attendance,
 * or the SUPER_ADMIN-only chatbot screens under Settings — rode straight past
 * it into the sidebar of roles that cannot open them.
 *
 * A parent whose children are ALL filtered out stays, as a plain link. It
 * opens a page of its own that this role may open; dropping it together with
 * its children took Settings and Users & Roles out of every unit admin's menu
 * once their SUPER_ADMIN-only screens were nested under them.
 */
function filterNavItemsByRoleCode(
  items: NavItem[],
  roleCode: string,
): NavItem[] {
  return items
    .filter((item) => !item.roleCodes || item.roleCodes.includes(roleCode))
    .map((item) => {
      if (!item.children?.length) return item;
      const children = filterNavItemsByRoleCode(item.children, roleCode);
      return children.length > 0
        ? { ...item, children }
        : { ...item, children: undefined };
    });
}

/**
 * Get navigation for a specific role code
 * Uses the new RoleCode-based system
 */
export function getNavigationForRoleCode(roleCode: string): NavGroup[] {
  if (!roleCode) return [];

  // Super Admin gets the admin navigation, less what is kept for other roles
  // only: the same page offered to two units under two names (TK's Laporan
  // Harian, SD's Mutabaah Yaumiyah) must not appear twice in one sidebar.
  if (roleCode === "SUPER_ADMIN") {
    return adminNavigation.map((group) => ({
      ...group,
      items: filterNavItemsByRoleCode(group.items, roleCode),
    }));
  }

  // Yayasan roles
  if (isYayasanRole(roleCode)) {
    return yayasanNavigation;
  }

  // Kepala Sekolah gets kepala sekolah navigation
  if (isPrincipalRole(roleCode)) {
    return kepalaSekolahNavigation;
  }

  // Admin roles get admin navigation
  if (isAdminRole(roleCode)) {
    return adminNavigation
      .map((group) => ({
        ...group,
        items: filterNavItemsByRoleCode(group.items, roleCode),
      }))
      .filter((group) => group.items.length > 0);
  }

  // Pesantren: leadership and field pengasuhan staff get different menus
  if (PESANTREN_PIMPINAN_ROLES.includes(roleCode)) {
    return pesantrenPimpinanNavigation;
  }

  if (PESANTREN_PENGASUHAN_ROLES.includes(roleCode)) {
    return pesantrenPengasuhanNavigation;
  }

  // Komite sekolah (external oversight) and alumni
  if (KOMITE_ROLES.includes(roleCode)) {
    return komiteNavigation;
  }

  if (ALUMNI_ROLES.includes(roleCode)) {
    return alumniNavigation;
  }

  // Teacher roles — one menu for guru and guru BK, with the entries only
  // some of them use ("Bimbingan Konseling": guru BK).
  if (isTeacherRole(roleCode)) {
    return teacherNavigation
      .map((group) => ({
        ...group,
        items: filterNavItemsByRoleCode(group.items, roleCode),
      }))
      .filter((group) => group.items.length > 0);
  }

  // Staff roles
  if (isStaffRole(roleCode)) {
    return staffNavigation
      .map((group) => ({
        ...group,
        items: filterNavItemsByRoleCode(group.items, roleCode),
      }))
      .filter((group) => group.items.length > 0);
  }

  // Student roles
  if (isStudentRole(roleCode)) {
    return studentNavigation;
  }

  // Parent roles
  if (isParentRole(roleCode)) {
    return parentNavigation;
  }

  // Default to basic navigation
  return [
    {
      title: "Overview",
      items: [
        {
          title: "Dashboard",
          href: "/dashboard",
          icon: LayoutDashboard,
        },
        {
          title: "Notifikasi Saya",
          href: "/notifications/me",
          icon: Bell,
        },
      ],
    },
    {
      title: "Settings",
      items: [
        {
          title: "Settings",
          href: "/settings",
          icon: Settings,
        },
      ],
    },
  ];
}

/**
 * Legacy function - for backward compatibility
 * Maps old UserRole to appropriate navigation
 */
export function getNavigationForRole(role: string): NavGroup[] {
  // Map legacy roles to new role codes
  const legacyToRoleCode: Record<string, string> = {
    SUPER_ADMIN: "SUPER_ADMIN",
    UNIT_ADMIN: "SMPIT_ADMIN", // Default to SMPIT_ADMIN for legacy
    TEACHER: "SMPIT_GURU",
    STAFF: "SMPIT_TATA_USAHA",
    STUDENT: "SMPIT_SISWA",
    PARENT: "SMPIT_ORANG_TUA",
  };

  const roleCode = legacyToRoleCode[role] || role;
  return getNavigationForRoleCode(roleCode);
}

// Export role categories for use elsewhere
export {
  ADMIN_ROLES,
  TEACHER_ROLES,
  STAFF_ROLES,
  STUDENT_ROLES,
  PARENT_ROLES,
  YAYASAN_ROLES,
  PESANTREN_ROLES,
  PESANTREN_PIMPINAN_ROLES,
  PESANTREN_PENGASUHAN_ROLES,
  KOMITE_ROLES,
  ALUMNI_ROLES,
  isAdminRole,
  isTeacherRole,
  isStaffRole,
  isStudentRole,
  isParentRole,
  isYayasanRole,
  isPrincipalRole,
};
