import {
  UserRole,
  UnitType,
  QuranAbility,
  Gender,
  AttendanceStatus,
  TahfidzActivityType,
  PermitType,
  PermitStatus,
  ViolationType,
  PaymentStatus,
  PaymentMethod,
  AdmissionStatus,
  LeaveType,
  LeaveStatus,
  StaffAttendanceStatus,
  BookStatus,
  BorrowingStatus,
  MedicalRecordType,
  NotificationType,
  NotificationStatus,
  AssetStatus,
  AssetCondition,
  SubjectType,
  DayOfWeek,
  ExamType,
  ExamStatus,
  GradeType,
  AlumniStatus,
  DonationType,
  AlumniEventType,
  Prisma,
  Realm,
  RoleCode,
  KitabCategory,
  KitabLevel,
  BusinessUnitType,
  MealType,
  MealAttendanceStatus,
  EnrollmentStatus,
  CounselingCategory,
  CounselingPriority,
  CounselingStatus,
  ComplaintCategory,
  ComplaintStatus,
  ComplaintPriority,
  VisitStatus,
  PackageStatus,
  LetterDirection,
  LetterUrgency,
  LetterNature,
  LetterStatus,
  EducationLevel,
  OccupationType,
  IncomeRange,
  PublicDonationType,
  DonationPaymentMethod,
  DonationStatus,
  CampaignStatus,
  DutyCategory,
  DutyStatus,
  MuhasabahMood,
  TakhosusStatus,
  HalaqohDay,
  MurojaahType,
  SimaanType,
  PurchaseRequestStatus,
  ReferralType,
  EventType,
  EventScope,
  NoteCategory,
  NotePriority,
  NoteVisibility,
  BehaviorType,
  BehaviorCategory,
  DailyMood,
  MealConsumption,
  ContractStatus,
  EmployeeDocumentType,
  EmploymentAction,
  PAUDAspect,
  PAUDAchievementLevel,
  PAUDReportPeriod,
  DocumentType,
  DocumentStatus,
  KitabAssessmentType,
  KitabProgressStatus,
  AssignmentType,
  SubmissionStatus,
  PayrollStatus,
  TalentCategory,
  PerformanceRating,
  PlanPriority,
  TaskPriority,
  ProjectStatus,
  SOPStatus,
  RiskCategory,
  RiskLikelihood,
  RiskImpact,
  RiskLevel,
  MitigationStrategy,
  QualityStandardType,
  AuditStatus,
  ExamAttemptStatus,
  LandOwnership,
  BuildingCondition,
  OrgPositionStatus,
  ComplianceStatus,
  FindingSeverity,
  FollowUpStatus,
  InternalAuditStatus,
  ShariaCategory,
  TrainingStatus,
  AssetDisposalReason,
  WasteCategory,
  EnvironmentProgramStatus,
  TahfidzMistakeType,
} from '@prisma/client';
import { createPrismaClient } from './client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { seedWilayahIndonesia } from './seeds/wilayah-indonesia';
import { seedKurikulumMerdeka, seedAccountCodes } from './seeds/kurikulum-merdeka';
import { seedPAUDIndicators } from './seeds/paud-indicators';
import { syncParentRoleAssignments, type ParentScopeClient } from '../src/utils/parent-scope';
import { seedImmunizationReference } from './seeds/immunization-reference';
import { seedStrategicPlans } from './seeds/strategic-plan-cipansor';
import { currentAcademicYear, nextAcademicYear } from '../src/lib/academic-calendar';
import { ensureDemoIntake } from './seeds/spmb-demo';
import { loadBrochureExtracurriculars } from './seeds/ekskul-2027-2028';
import { PERMISSIONS, permissionsForRoleCode } from '../src/modules/roles/permissions';
// Imported from source (not the built dist) so a stale @cipansor/shared build
// can't leave the seeded demo logins out of sync with what the web login page
// lists. This is the single source of truth for the per-role demo accounts.
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../../packages/shared/src/types/demo-accounts';
import { YAYASAN_ORGANS } from '../../../packages/shared/src/types/office-holders';
import { SECOND_FACTOR_ROLE_CODES } from '../../../packages/shared/src/roles';

// RoleCode comes straight from the generated Prisma client — do NOT keep a
// local copy here. A shadow copy previously drifted out of sync with the
// schema (it was missing every Perguruan Tinggi role) and broke the build
// whenever the enum gained values.

// Define System User ID constant
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

const prisma = createPrismaClient();

async function main() {
  // This seed wipes every table (TRUNCATE … CASCADE below) before loading demo
  // data, so pointing it at a live database destroys it — and `prisma db seed`
  // or a stray DATABASE_URL is all it takes. Demand an explicit opt-in that
  // only dev, CI and the demo-only staging database ever set.
  if (process.env.ALLOW_DESTRUCTIVE_SEED !== '1') {
    console.error(
      'Refusing to seed: prisma/seed.ts TRUNCATEs every table before loading demo data.\n' +
        'Set ALLOW_DESTRUCTIVE_SEED=1 to run it against a development, CI or staging database.\n' +
        'Never set it for production.'
    );
    process.exit(1);
  }

  console.log('🌱 Seeding database...');

  // Clean up existing data.
  // Previously this was a long, hand-ordered list of deleteMany() calls that had
  // to mirror every FK dependency. It drifted out of sync with the schema (e.g.
  // LearningOutcome/MerdekaAssessment/QuestionBank/Assignment all reference
  // Subject but were never deleted before it), making re-seeds fail on FK
  // violations. Truncating every table with CASCADE can't drift and is exactly
  // what a re-seed wants. _prisma_migrations is preserved.
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length > 0) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }

  // ============================================
  // PHASE 8: Wilayah Indonesia & Kurikulum Merdeka
  // ============================================
  await seedWilayahIndonesia(prisma);
  await seedAccountCodes(prisma);

  // ============================================
  // SYSTEM USER
  // ============================================
  // A placeholder row so that machine-written records have an author to point
  // at (talenta.service uses this id as the assessorId fallback). It is not a
  // login.
  //
  // It used to be created active, SUPER_ADMIN, with the password 'System123!'
  // — and it could log in. Not through a role assignment, which it never had,
  // but through the legacy `User.role` fallback in authService.login. Being
  // admin without 2FA, that login returns `requiresTwoFactorSetup` plus a
  // 10-minute token, so whoever knew the seeded password could enrol their own
  // authenticator on a super-admin account. isActive: false is checked before
  // any of that, and the password is now an unguessable random string rather
  // than a documented one.
  await prisma.user.create({
    data: {
      id: SYSTEM_USER_ID,
      name: 'SYSTEM',
      email: 'system@cipansor.or.id',
      passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
      role: UserRole.SUPER_ADMIN,
      isActive: false,
    },
  });
  console.log('✅ System user created (login disabled)');

  // ============================================
  // PHASE 3: Foundation / Yayasan
  // ============================================

  /**
   * Every unit sits at the one campus. The address, the official names, NPSNs
   * and permits are those of the permits and Kemendikdasmen's reference data
   * (decisions/spmb-2027-2028.md item 6); TK Qur'an has no NPSN there.
   */
  const UNIT_ADDRESS =
    'Jl. Raya Malangbong - Kadipaten RT 001 RW 001, Kp. Nyalindung, Desa Buniasih, Kec. Kadipaten, Kab. Tasikmalaya, Jawa Barat 46157';

  const foundation = await prisma.foundation.create({
    data: {
      name: 'Yayasan Pesantren Cipansor',
      legalName: 'Yayasan Pesantren Cipansor',
      // Akta Notaris No. 01, 5 April 2012 (LETTERHEAD.legalBasis).
      foundingDate: new Date('2012-04-05'),
      address: UNIT_ADDRESS,
      phone: '0811110400',
      email: 'halo@cipansor.or.id',
      website: 'https://cipansor.or.id',
      vision:
        'Menjadi lembaga pendidikan Islam terdepan yang menghasilkan generasi Qurani berakhlak mulia',
      mission:
        'Menyelenggarakan pendidikan Islam terpadu, membentuk karakter Islami, dan mengembangkan potensi santri secara optimal',
    },
  });

  console.log('✅ Foundation created');

  // The yayasan's organs as the yayasan published them (office-holders.ts):
  // names, positions and portraits. No phone numbers or e-mail — those are the
  // person's, entered by an admin — and no start date, which nobody here knows;
  // an invented "Sejak Jan 2020" beside a real name is a false statement.
  for (const group of YAYASAN_ORGANS) {
    for (const holder of group.holders) {
      await prisma.boardMember.create({
        data: {
          foundationId: foundation.id,
          name: holder.name,
          position: holder.position,
          photoUrl: holder.photo ?? null,
          isActive: true,
        },
      });
    }
  }

  console.log('✅ Board members created');

  // Create Units
  const smpIt = await prisma.unit.create({
    data: {
      foundationId: foundation.id,
      name: 'SMP IT Cipansor',
      officialName: 'SMP IT Pesantren Cipansor',
      npsn: '69988558',
      operatingPermitNumber: '503/0671/Kep.07/DPMPTSP/2019',
      operatingPermitDate: new Date('2019-05-02'),
      type: UnitType.SMP_IT,
      address: UNIT_ADDRESS,
      phone: '0811110400',
      email: 'smpit@cipansor.or.id',
    },
  });

  const sdIt = await prisma.unit.create({
    data: {
      foundationId: foundation.id,
      name: 'SD IT Cipansor',
      officialName: 'SD IT Pesantren Cipansor',
      npsn: '69888850',
      operatingPermitNumber: '642.2/0131/Disdik',
      operatingPermitDate: new Date('2015-01-16'),
      type: UnitType.SD_IT,
      address: UNIT_ADDRESS,
      phone: '0811110400',
      email: 'sdit@cipansor.or.id',
    },
  });

  const tkQuran = await prisma.unit.create({
    data: {
      foundationId: foundation.id,
      name: "TK Qur'an Cipansor",
      officialName: "TK Qur'an An Nur Pesantren Cipansor",
      type: UnitType.TK_QURAN,
      address: UNIT_ADDRESS,
      phone: '0811110400',
      email: 'tkquran@cipansor.or.id',
    },
  });

  const smaQuran = await prisma.unit.create({
    data: {
      foundationId: foundation.id,
      name: "SMA Qur'an Cipansor",
      officialName: "SMA Qur'an Pesantren Cipansor",
      npsn: '70038414',
      operatingPermitNumber: '5/011050/DPMPTSP/II/2023',
      operatingPermitDate: new Date('2023-02-07'),
      type: UnitType.SMA_QURAN,
      address: UNIT_ADDRESS,
      phone: '0811110400',
      email: 'smaquran@cipansor.or.id',
    },
  });

  console.log('✅ Units created');

  // ============================================
  // SEED ROLES - All possible roles in the system
  // ============================================

  const rolesData = [
    // Global
    {
      code: RoleCode.SUPER_ADMIN,
      name: 'Super Admin',
      realm: Realm.GLOBAL,
      description: 'Full access to entire system',
      permissions: Object.values(PERMISSIONS),
    },

    // Yayasan roles. No YAYASAN_ADMIN — foundation administration is done by
    // SUPER_ADMIN; what remains here are the governance organs.
    {
      code: RoleCode.YAYASAN_PEMBINA,
      name: 'Pembina',
      realm: Realm.YAYASAN,
      description: 'Pembina yayasan',
    },
    {
      code: RoleCode.YAYASAN_KETUA,
      name: 'Ketua Pengurus',
      realm: Realm.YAYASAN,
      description: 'Ketua pengurus yayasan',
    },
    {
      code: RoleCode.YAYASAN_SEKRETARIS,
      name: 'Sekretaris',
      realm: Realm.YAYASAN,
      description: 'Sekretaris pengurus yayasan',
    },
    {
      code: RoleCode.YAYASAN_BENDAHARA,
      name: 'Bendahara',
      realm: Realm.YAYASAN,
      description: 'Bendahara pengurus yayasan',
    },
    {
      code: RoleCode.YAYASAN_ANGGOTA,
      name: 'Anggota Pengurus',
      realm: Realm.YAYASAN,
      description: 'Anggota pengurus yayasan',
    },
    {
      code: RoleCode.YAYASAN_PENGAWAS,
      name: 'Pengawas',
      realm: Realm.YAYASAN,
      description: 'Pengawas yayasan',
    },

    // TK Qur'an roles
    {
      code: RoleCode.TKQ_ADMIN,
      name: "Admin TK Qur'an",
      realm: Realm.TK_QURAN,
      description: "Administrator TK Qur'an",
    },
    {
      code: RoleCode.TKQ_KEPALA_SEKOLAH,
      name: "Kepala TK Qur'an",
      realm: Realm.TK_QURAN,
      description: "Kepala sekolah TK Qur'an",
    },
    {
      code: RoleCode.TKQ_GURU,
      name: "Guru TK Qur'an",
      realm: Realm.TK_QURAN,
      description: "Guru TK Qur'an",
    },
    {
      code: RoleCode.TKQ_TATA_USAHA,
      name: "Tata Usaha TK Qur'an",
      realm: Realm.TK_QURAN,
      description: "Tata usaha TK Qur'an",
    },
    {
      code: RoleCode.TKQ_ORANG_TUA,
      name: "Orang Tua TK Qur'an",
      realm: Realm.TK_QURAN,
      description: "Orang tua siswa TK Qur'an",
    },
    // No TKQ_SISWA: TK Qur'an santri hold no login. Their Student records are
    // still created, with a User row carrying the legacy STUDENT role only.

    // SD IT (Islam Terpadu) roles
    {
      code: RoleCode.SDIT_ADMIN,
      name: 'Admin SD IT',
      realm: Realm.SD_IT,
      description: 'Administrator SD IT',
    },
    {
      code: RoleCode.SDIT_KEPALA_SEKOLAH,
      name: 'Kepala SD IT',
      realm: Realm.SD_IT,
      description: 'Kepala sekolah SD IT',
    },
    { code: RoleCode.SDIT_GURU, name: 'Guru SD IT', realm: Realm.SD_IT, description: 'Guru SD IT' },
    {
      code: RoleCode.SDIT_TATA_USAHA,
      name: 'Tata Usaha SD IT',
      realm: Realm.SD_IT,
      description: 'Tata usaha SD IT',
    },
    {
      code: RoleCode.SDIT_ORANG_TUA,
      name: 'Orang Tua SD IT',
      realm: Realm.SD_IT,
      description: 'Orang tua siswa SD IT',
    },
    {
      code: RoleCode.SDIT_SISWA,
      name: 'Siswa SD IT',
      realm: Realm.SD_IT,
      description: 'Siswa SD IT',
    },

    // SMP IT (Islam Terpadu) roles
    {
      code: RoleCode.SMPIT_ADMIN,
      name: 'Admin SMP IT',
      realm: Realm.SMP_IT,
      description: 'Administrator SMP IT',
    },
    {
      code: RoleCode.SMPIT_KEPALA_SEKOLAH,
      name: 'Kepala SMP IT',
      realm: Realm.SMP_IT,
      description: 'Kepala sekolah SMP IT',
    },
    {
      code: RoleCode.SMPIT_GURU,
      name: 'Guru SMP IT',
      realm: Realm.SMP_IT,
      description: 'Guru SMP IT',
    },
    {
      code: RoleCode.SMPIT_TATA_USAHA,
      name: 'Tata Usaha SMP IT',
      realm: Realm.SMP_IT,
      description: 'Tata usaha SMP IT',
    },
    {
      code: RoleCode.SMPIT_ORANG_TUA,
      name: 'Orang Tua SMP IT',
      realm: Realm.SMP_IT,
      description: 'Orang tua siswa SMP IT',
    },
    {
      code: RoleCode.SMPIT_SISWA,
      name: 'Siswa SMP IT',
      realm: Realm.SMP_IT,
      description: 'Siswa SMP IT',
    },

    // SMA Qur'an roles
    {
      code: RoleCode.SMAQ_ADMIN,
      name: "Admin SMA Qur'an",
      realm: Realm.SMA_QURAN,
      description: "Administrator SMA Qur'an",
    },
    {
      code: RoleCode.SMAQ_KEPALA_SEKOLAH,
      name: "Kepala SMA Qur'an",
      realm: Realm.SMA_QURAN,
      description: "Kepala sekolah SMA Qur'an",
    },
    {
      code: RoleCode.SMAQ_GURU,
      name: "Guru SMA Qur'an",
      realm: Realm.SMA_QURAN,
      description: "Guru SMA Qur'an",
    },
    {
      code: RoleCode.SMAQ_TATA_USAHA,
      name: "Tata Usaha SMA Qur'an",
      realm: Realm.SMA_QURAN,
      description: "Tata usaha SMA Qur'an",
    },
    {
      code: RoleCode.SMAQ_ORANG_TUA,
      name: "Orang Tua SMA Qur'an",
      realm: Realm.SMA_QURAN,
      description: "Orang tua siswa SMA Qur'an",
    },
    {
      code: RoleCode.SMAQ_SISWA,
      name: "Siswa SMA Qur'an",
      realm: Realm.SMA_QURAN,
      description: "Siswa SMA Qur'an",
    },

    // Granular school roles (guru BK / bendahara / komite / alumni) for each
    // unit. Wakasek and wali kelas are duties of a guru, not roles (merged
    // into *_GURU on 2026-09-26); wali kelas is Class.homeroomTeacherId.
    ...(
      [
        ['TKQ', "TK Qur'an", Realm.TK_QURAN],
        ['SDIT', 'SD IT', Realm.SD_IT],
        ['SMPIT', 'SMP IT', Realm.SMP_IT],
        ['SMAQ', "SMA Qur'an", Realm.SMA_QURAN],
      ] as const
    ).flatMap(([prefix, unitLabel, realm]) => [
      // Guru BK exists only at SMP IT and SMA Qur'an. TK Qur'an and SD IT have
      // no dedicated counselling teacher — the wali kelas covers it — so those
      // RoleCodes do not exist and must not be generated here.
      ...(prefix === 'SMPIT' || prefix === 'SMAQ'
        ? [
            {
              code: RoleCode[`${prefix}_GURU_BK`],
              name: `Guru BK ${unitLabel}`,
              realm,
              description: `Guru bimbingan konseling ${unitLabel}`,
            },
          ]
        : []),
      {
        code: RoleCode[`${prefix}_BENDAHARA`],
        name: `Bendahara ${unitLabel}`,
        realm,
        description: `Bendahara unit ${unitLabel}`,
      },
      {
        code: RoleCode[`${prefix}_KOMITE`],
        name: `Komite ${unitLabel}`,
        realm,
        description: `Komite sekolah ${unitLabel}`,
      },
      // Alumni portals exist from SMP IT upwards. TK Qur'an and SD IT leavers
      // continue within the pesantren rather than becoming alumni of a unit.
      ...(prefix === 'SMPIT' || prefix === 'SMAQ'
        ? [
            {
              code: RoleCode[`${prefix}_ALUMNI`],
              name: `Alumni ${unitLabel}`,
              realm,
              description: `Alumni ${unitLabel}`,
            },
          ]
        : []),
    ]),

    // Pesantren roles (cross-unit)
    {
      code: RoleCode.PESANTREN_PENGASUH,
      name: 'Pimpinan Pesantren (Kiai)',
      realm: Realm.PESANTREN,
      description: 'Kiai — pengasuh dan pemimpin tertinggi pesantren (UU 18/2019 Ps. 9 ayat 2)',
    },
    {
      code: RoleCode.PESANTREN_TATA_USAHA,
      name: 'Tata Usaha Pesantren',
      realm: Realm.PESANTREN,
      description: 'Administrasi pesantren',
    },
    {
      code: RoleCode.USTADZ,
      name: 'Ustadz',
      realm: Realm.PESANTREN,
      description: 'Guru pengampu kitab/pesantren',
    },
    {
      code: RoleCode.MUSYRIF,
      name: 'Musyrif / Musyrifah',
      realm: Realm.PESANTREN,
      description: 'Pembina asrama, wali kamar dan pembina akhlak (murabbi), putra atau putri',
    },
    {
      code: RoleCode.MUHAFIDZ,
      name: 'Muhafidz / Muhafidzah',
      realm: Realm.PESANTREN,
      description: 'Pengampu tahfidz, putra atau putri',
    },

    // Cross-unit support staff (yayasan-wide services)
    {
      code: RoleCode.PUSTAKAWAN,
      name: 'Pustakawan',
      realm: Realm.YAYASAN,
      description: 'Pengelola perpustakaan',
    },
    {
      code: RoleCode.PERAWAT,
      name: 'Perawat',
      realm: Realm.YAYASAN,
      description: 'Perawat / petugas UKS & klinik',
    },
    {
      code: RoleCode.KEAMANAN,
      name: 'Keamanan',
      realm: Realm.YAYASAN,
      description: 'Satpam / petugas keamanan',
    },
    {
      code: RoleCode.LABORAN,
      name: 'Laboran',
      realm: Realm.YAYASAN,
      description: 'Petugas laboratorium & praktikum',
    },

    // Business Unit roles
    {
      code: RoleCode.BUSINESS_MANAGER,
      name: 'Manajer Unit Usaha',
      realm: Realm.UNIT_USAHA,
      description: 'Manajer unit usaha (kantin, laundry, koperasi, dll)',
    },
    {
      code: RoleCode.BUSINESS_STAFF,
      name: 'Staf Unit Usaha',
      realm: Realm.UNIT_USAHA,
      description: 'Staf unit usaha',
    },
  ];

  const roles: Record<string, any> = {};
  for (const roleData of rolesData) {
    // Only SUPER_ADMIN used to carry a `permissions` array, so 80 of the 81
    // roles were seeded with none and every hasPermission()-gated endpoint
    // returned 403 for them. Resolve from the shared matrix instead of
    // relying on each entry above to remember.
    const role = await prisma.role.create({
      data: {
        ...roleData,
        permissions:
          'permissions' in roleData && roleData.permissions
            ? roleData.permissions
            : permissionsForRoleCode(roleData.code),
      },
    });
    roles[roleData.code] = role;
  }

  const rolesWithoutPermissions = rolesData.filter(
    (r) => permissionsForRoleCode(r.code).length === 0 && r.code !== 'SUPER_ADMIN'
  );
  console.log(
    `✅ Roles created (${rolesData.length}; ${rolesWithoutPermissions.length} intentionally permission-less: students, parents, alumni)`
  );

  // ============================================
  // DEMO ACCOUNTS — one working login per RoleCode (81 total).
  // Source of truth: packages/shared/src/types/demo-accounts.ts, which the web
  // login page also renders — so every advertised credential actually logs in.
  // All share DEMO_PASSWORD. Emails are on @cipansor.or.id like every other
  // account — the old @demo.cipansor.or.id domain is gone. It had become a
  // security marker (auth.service.ts exempted that suffix from 2FA), which is
  // no way to decide whether a deployment is a demo, and it put the word "demo"
  // in front of anyone signing in to the real portal. Collisions with the
  // hand-authored users below are prevented by the local parts, which are
  // realm-prefixed (`smpit.guru`, `yayasan.ketua`), not by the domain.
  // ============================================
  /**
   * Boarding-side and shared-service roles, whose codes carry no unit prefix.
   *
   * These people serve the pesantren (asrama, tahfidz, kitab) and the shared
   * services — keamanan, perawat, pustakawan, laboran — none of which belong to
   * one school. The data model gives a user exactly one `unitId`, so there is no
   * honest way to express that here.
   *
   * They are pointed at SMP IT because that is where the boarding santri are
   * seeded, which makes their unit-scoped queries return the right rows today.
   * It is the least-wrong single choice, not a correct one: the moment boarding
   * santri exist in SMA Qur'an as well, a musyrif will be unable to see the
   * santri in their own asrama. Fixing that needs cross-unit scope for these
   * roles, the same way isFoundationScopedRole() handles the yayasan board.
   */
  const PESANTREN_REALM_ROLES = new Set([
    'PESANTREN_PENGASUH',
    'PESANTREN_TATA_USAHA',
    'USTADZ',
    'MUSYRIF',
    'MUHAFIDZ',
    'KEAMANAN',
    'PERAWAT',
    'PUSTAKAWAN',
    'LABORAN',
  ]);
  const demoUnitIdFor = (code: string): string | undefined => {
    if (code.startsWith('TKQ_')) return tkQuran.id;
    if (code.startsWith('SDIT_')) return sdIt.id;
    if (code.startsWith('SMPIT_')) return smpIt.id;
    if (code.startsWith('SMAQ_')) return smaQuran.id;
    // Boarding-side and shared-service roles: see PESANTREN_REALM_ROLES above
    // for why they land on SMP IT and what that costs.
    if (PESANTREN_REALM_ROLES.has(code)) return smpIt.id;
    // SUPER_ADMIN, YAYASAN_* and the business-unit roles are deliberately
    // left unit-less: the first two are foundation-wide, and business units
    // are a separate entity from the academic units.
    return undefined;
  };
  // Legacy UserRole bucket per RoleCode. Mirrors the web ROLE_CODE_TO_LEGACY /
  // backend deriveLegacyRole so middleware routes each demo user to the right
  // dashboard. Unmapped edge roles (komite → STAFF, alumni → STUDENT) get a
  // sensible bucket rather than a dead undefined.
  const demoLegacyRoleFor = (code: string): UserRole => {
    if (code === 'SUPER_ADMIN') return UserRole.SUPER_ADMIN;
    if (code.startsWith('YAYASAN_') || code.endsWith('_ADMIN')) return UserRole.UNIT_ADMIN;
    if (code.endsWith('_SISWA') || code.endsWith('_ALUMNI')) return UserRole.STUDENT;
    if (code.endsWith('_ORANG_TUA')) return UserRole.PARENT;
    const teacherSuffix = ['_GURU', '_KEPALA_SEKOLAH', '_GURU_BK'];
    if (teacherSuffix.some((s) => code.endsWith(s))) return UserRole.TEACHER;
    const teacherExact = ['PESANTREN_PENGASUH', 'USTADZ', 'MUSYRIF', 'MUHAFIDZ'];
    if (teacherExact.includes(code)) return UserRole.TEACHER;
    return UserRole.STAFF;
  };
  const demoPasswordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  // Kept so the domain rows for these personas can be created further down,
  // once classes, students and teachers exist.
  const demoUsers = new Map<string, { id: string; name: string; unitId?: string }>();
  // Every account, including a role's second persona, for the per-person
  // domain rows (Teacher, Student, parent link) built further down.
  const demoPersonas: Array<
    [string, { id: string; name: string; unitId?: string; homeroom?: boolean }]
  > = [];
  let demoCreated = 0;
  for (const acc of DEMO_ACCOUNTS) {
    const role = roles[acc.roleCode];
    if (!role) {
      console.warn(`⚠️  Demo account skipped — unknown roleCode ${acc.roleCode}`);
      continue;
    }
    const unitId = demoUnitIdFor(acc.roleCode);
    const demoUser = await prisma.user.create({
      data: {
        name: acc.name,
        email: acc.email,
        passwordHash: demoPasswordHash,
        role: demoLegacyRoleFor(acc.roleCode),
        unitId,
        isActive: true,
      },
    });
    await prisma.userRoleAssignment.create({
      data: {
        userId: demoUser.id,
        roleId: role.id,
        unitId,
        isPrimary: true,
        isActive: true,
      },
    });
    // Several musyrif and muhafidz personas share one role since 2026-09-25;
    // the first account listed for a role is the one looked up by role.
    const persona = { id: demoUser.id, name: acc.name, unitId };
    demoPersonas.push([acc.roleCode, { ...persona, homeroom: acc.homeroom }]);
    if (!demoUsers.has(acc.roleCode)) demoUsers.set(acc.roleCode, persona);
    demoCreated++;
  }
  console.log(`✅ Demo accounts created (${demoCreated} of ${DEMO_ACCOUNTS.length})`);

  // Secondary role assignments.
  //
  // The loop above gives every demo account exactly one role, which meant no
  // seeded user ever had two — so the role switcher in the header had nothing
  // to switch between and silently collapsed to a static badge on every
  // account. The component, the store action and POST /roles/switch were all
  // fine; only the data never exercised them.
  //
  // These pairings are the ones that genuinely occur in a pesantren: a kepala
  // sekolah who still teaches, and a yayasan treasurer who also keeps a unit's
  // books. The second is deliberately cross-realm (YAYASAN + SD_IT) so the
  // switcher's realm grouping is exercised too. The third is Cipansor's own:
  // the Kiai, Pimpinan Pesantren, also sits on the yayasan's Pembina (UU
  // 16/2001 Ps. 29 bars Pembina only from Pengurus and Pengawas; a pesantren
  // leader is a "pelaksana kegiatan", Ps. 35 ayat 3).
  const SECONDARY_ROLES: Array<{ primary: string; secondary: string }> = [
    { primary: 'SMPIT_KEPALA_SEKOLAH', secondary: 'SMPIT_GURU' },
    { primary: 'YAYASAN_BENDAHARA', secondary: 'SDIT_BENDAHARA' },
    { primary: 'PESANTREN_PENGASUH', secondary: 'YAYASAN_PEMBINA' },
  ];
  let secondaryCreated = 0;
  for (const pair of SECONDARY_ROLES) {
    const holder = demoUsers.get(pair.primary);
    const secondaryRole = roles[pair.secondary];
    if (!holder || !secondaryRole) {
      console.warn(`⚠️  Secondary role skipped — ${pair.primary} → ${pair.secondary}`);
      continue;
    }
    await prisma.userRoleAssignment.create({
      data: {
        userId: holder.id,
        roleId: secondaryRole.id,
        unitId: demoUnitIdFor(pair.secondary),
        isPrimary: false,
        isActive: true,
      },
    });
    secondaryCreated++;
  }
  console.log(`✅ Secondary role assignments created (${secondaryCreated})`);

  // Create Super Admin with role assignment
  const superAdminUser = await prisma.user.create({
    data: {
      name: 'Super Admin',
      email: 'superadmin@cipansor.or.id',
      passwordHash: await bcrypt.hash('SuperAdmin123!', 10),
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    },
  });

  await prisma.userRoleAssignment.create({
    data: {
      userId: superAdminUser.id,
      roleId: roles[RoleCode.SUPER_ADMIN].id,
      isPrimary: true,
      isActive: true,
    },
  });

  // No "Admin Yayasan" user. Foundation-level administration belongs to
  // SUPER_ADMIN, so this account had no role left to hold.

  // Create Unit Admins with role assignments
  const adminPesantrenUser = await prisma.user.create({
    data: {
      name: 'Admin SMP IT',
      email: 'admin.smpit@cipansor.or.id',
      passwordHash: await bcrypt.hash('Admin123!', 10),
      role: UserRole.UNIT_ADMIN,
      unitId: smpIt.id,
      isActive: true,
    },
  });

  await prisma.userRoleAssignment.create({
    data: {
      userId: adminPesantrenUser.id,
      roleId: roles[RoleCode.SMPIT_ADMIN].id,
      unitId: smpIt.id,
      isPrimary: true,
      isActive: true,
    },
  });

  const adminSdItUser = await prisma.user.create({
    data: {
      name: 'Admin SD IT',
      email: 'admin.sdit@cipansor.or.id',
      passwordHash: await bcrypt.hash('Admin123!', 10),
      role: UserRole.UNIT_ADMIN,
      unitId: sdIt.id,
      isActive: true,
    },
  });

  await prisma.userRoleAssignment.create({
    data: {
      userId: adminSdItUser.id,
      roleId: roles[RoleCode.SDIT_ADMIN].id,
      unitId: sdIt.id,
      isPrimary: true,
      isActive: true,
    },
  });

  // Kepala Sekolah SD IT and SMP IT.
  //
  // These used to be created here as a SECOND set of accounts — "Hj. Aminah,
  // S.Pd" on kepala.sdit@ and "Drs. H. Sulaiman, M.Pd" on kepala.smpit@ —
  // beside the ones DEMO_ACCOUNTS already creates. Every unit therefore had
  // two active kepala sekolah with different logins and different passwords,
  // and the invented pair was the one most screens found first.
  //
  // DEMO_ACCOUNTS carries the names on record with Dapodik: Dadan Ali Ridwan
  // for SD IT, Cecep Helmi Syawali for SMP IT. There is one kepala sekolah per
  // unit, so look the real one up rather than inventing a rival.
  //
  // The SMPIT_GURU pairing the old block added by hand is already covered by
  // SECONDARY_ROLES above.
  const demoUserOrThrow = (roleCode: RoleCode) => {
    const found = demoUsers.get(roleCode);
    if (!found) {
      throw new Error(`No demo account for ${roleCode} — DEMO_ACCOUNTS and seed.ts have drifted`);
    }
    return found;
  };

  const kepalaSmpItUser = demoUserOrThrow(RoleCode.SMPIT_KEPALA_SEKOLAH);
  const kepalaSdItUser = demoUserOrThrow(RoleCode.SDIT_KEPALA_SEKOLAH);

  // The yayasan's organs, the same way. A second set of accounts used to be
  // created here — ketua@, pembina@, sekretaris@ and bendahara@, with invented
  // names and passwords of their own — beside the yayasan.*@ accounts that
  // DEMO_ACCOUNTS creates with the real office holders' names. Ketua and
  // Pembina are separate people (UU 16/2001 Ps. 29; the database enforces it
  // with trg_yayasan_organ_exclusive), and DEMO_ACCOUNTS keeps them apart.
  const ketuaYayasanUser = demoUserOrThrow(RoleCode.YAYASAN_KETUA);
  const pembinaYayasanUser = demoUserOrThrow(RoleCode.YAYASAN_PEMBINA);
  const sekretarisYayasanUser = demoUserOrThrow(RoleCode.YAYASAN_SEKRETARIS);
  const bendaharaYayasanUser = demoUserOrThrow(RoleCode.YAYASAN_BENDAHARA);

  // The SD IT head also teaches, mirroring the SMP IT pairing.
  await prisma.userRoleAssignment.create({
    data: {
      userId: kepalaSdItUser.id,
      roleId: roles[RoleCode.SDIT_GURU].id,
      unitId: sdIt.id,
      isPrimary: false,
      isActive: true,
    },
  });

  // Create Teachers (User + Teacher profile) with role assignments
  const teacherPesantrenUser = await prisma.user.create({
    data: {
      name: 'Ustadz Ahmad',
      email: 'ahmad@cipansor.or.id',
      passwordHash: await bcrypt.hash('Teacher123!', 10),
      role: UserRole.TEACHER,
      unitId: smpIt.id,
      isActive: true,
    },
  });

  await prisma.userRoleAssignment.create({
    data: {
      userId: teacherPesantrenUser.id,
      roleId: roles[RoleCode.SMPIT_GURU].id,
      unitId: smpIt.id,
      isPrimary: true,
      isActive: true,
    },
  });

  const teacherPesantren = await prisma.teacher.create({
    data: {
      userId: teacherPesantrenUser.id,
      unitId: smpIt.id,
      nip: '198501012010011001',
    },
  });

  const teacherSdItUser = await prisma.user.create({
    data: {
      name: 'Ibu Fatimah',
      email: 'fatimah@cipansor.or.id',
      passwordHash: await bcrypt.hash('Teacher123!', 10),
      role: UserRole.TEACHER,
      unitId: sdIt.id,
      isActive: true,
    },
  });

  await prisma.userRoleAssignment.create({
    data: {
      userId: teacherSdItUser.id,
      roleId: roles[RoleCode.SDIT_GURU].id,
      unitId: sdIt.id,
      isPrimary: true,
      isActive: true,
    },
  });

  const teacherSdIt = await prisma.teacher.create({
    data: {
      userId: teacherSdItUser.id,
      unitId: sdIt.id,
      nip: '198601022012012002',
    },
  });

  // Create Tata Usaha for SMP IT
  const tuSmpItUser = await prisma.user.create({
    data: {
      name: 'Bpk. Bambang',
      email: 'tu.smpit@cipansor.or.id',
      passwordHash: await bcrypt.hash('TataUsaha123!', 10),
      role: UserRole.STAFF,
      unitId: smpIt.id,
      isActive: true,
    },
  });

  await prisma.userRoleAssignment.create({
    data: {
      userId: tuSmpItUser.id,
      roleId: roles[RoleCode.SMPIT_TATA_USAHA].id,
      unitId: smpIt.id,
      isPrimary: true,
      isActive: true,
    },
  });

  // Tata Usaha SD IT comes from DEMO_ACCOUNTS (Iwan Setiadi, sdit.tu@), for
  // the same reason as the kepala sekolah above: this block used to add a
  // second holder of SDIT_TATA_USAHA, "Ibu Sari" on tu.sdit@.

  console.log('✅ Users and Teachers created');

  // Create Academic Years (global, not per unit).
  //
  // Derived from the clock, never hardcoded: the literal '2024/2025' that used
  // to live here was still being reseeded in 2026, which is how the public SPMB
  // page ended up announcing that admissions closed on 31 May 2024.
  const currentYear = currentAcademicYear();
  const intakeYear = nextAcademicYear();

  const academicYear = await prisma.academicYear.create({
    data: {
      name: currentYear.name,
      isActive: true,
      startDate: currentYear.startDate,
      endDate: currentYear.endDate,
    },
  });

  // The intake the open admission waves below recruit for. Not active — the
  // school is still teaching `currentYear`; exactly one year may be active and
  // `academic-year.service` enforces that on every write.
  const nextYear = await prisma.academicYear.create({
    data: {
      name: intakeYear.name,
      isActive: false,
      startDate: intakeYear.startDate,
      endDate: intakeYear.endDate,
    },
  });

  console.log(
    `✅ Academic years created (${currentYear.name} active, ${intakeYear.name} upcoming)`
  );

  // Create Classes
  const class7A = await prisma.class.create({
    data: {
      unitId: smpIt.id,
      academicYearId: academicYear.id,
      name: '7A',
      level: '7',
      capacity: 30,
      homeroomTeacherId: teacherPesantren.id,
    },
  });

  const class1A = await prisma.class.create({
    data: {
      unitId: sdIt.id,
      academicYearId: academicYear.id,
      name: '1A',
      level: '1',
      capacity: 25,
      homeroomTeacherId: teacherSdIt.id,
    },
  });

  console.log('✅ Classes created');

  // Create Students
  const students = [];

  // Assign students to different units/realms
  const studentConfigs = [
    {
      name: 'Muhammad Rizky',
      gender: Gender.MALE,
      email: 'student1@cipansor.or.id',
      unitId: smpIt.id,
      roleCode: RoleCode.SMPIT_SISWA,
    },
    {
      name: 'Ahmad Fauzan',
      gender: Gender.MALE,
      email: 'student2@cipansor.or.id',
      unitId: smpIt.id,
      roleCode: RoleCode.SMPIT_SISWA,
    },
    {
      name: 'Siti Aisyah',
      gender: Gender.FEMALE,
      email: 'student3@cipansor.or.id',
      unitId: sdIt.id,
      roleCode: RoleCode.SDIT_SISWA,
    },
    {
      name: 'Abdullah Rahman',
      gender: Gender.MALE,
      email: 'student5@cipansor.or.id',
      unitId: smaQuran.id,
      roleCode: RoleCode.SMAQ_SISWA,
    },
  ];

  /**
   * Family circumstances, one per studentConfigs entry.
   *
   * Every santri had zero socio-economic data, so the scholarship scoring ran
   * on nothing and every applicant tied at 0 on the "penghasilan" criterion.
   * These are ordinary Kabupaten Tasikmalaya households — a smallholder
   * farmer, a market trader, a civil servant, a labourer — so a demo ranking
   * has something real to sort.
   *
   * The third entry is deliberately a yatim living with an uncle: that is the
   * case the old fatherIncome-only scoring ranked *last* despite being the
   * neediest, and it is worth having in the demo data as a standing check.
   */
  const familyProfiles = [
    {
      // Petani penggarap, ibu di rumah. Anak sulung dari empat bersaudara.
      numberOfSiblings: 3,
      childOrder: 1,
      livingWith: 'Orang tua',
      fatherName: 'Dedi Supriadi',
      fatherEducation: EducationLevel.SMA,
      fatherOccupation: OccupationType.PETANI,
      fatherIncome: IncomeRange.RANGE_1JT_2JT,
      motherName: 'Euis Kurniasih',
      motherEducation: EducationLevel.SMP,
      motherOccupation: OccupationType.IBU_RUMAH_TANGGA,
      motherIncome: IncomeRange.TIDAK_BERPENGHASILAN,
      isPkh: true,
      kipNumber: '3206071204120001',
    },
    {
      // Buruh harian + warung kecil. Dua penghasilan kecil.
      numberOfSiblings: 2,
      childOrder: 2,
      livingWith: 'Orang tua',
      fatherName: 'Asep Saepudin',
      fatherEducation: EducationLevel.SMP,
      fatherOccupation: OccupationType.BURUH,
      fatherIncome: IncomeRange.RANGE_1JT_2JT,
      motherName: 'Neneng Hasanah',
      motherEducation: EducationLevel.SMP,
      motherOccupation: OccupationType.PEDAGANG,
      motherIncome: IncomeRange.KURANG_500K,
      isKks: true,
    },
    {
      // Yatim. Ayah wafat, ibu berdagang di pasar, tinggal bersama paman.
      numberOfSiblings: 1,
      childOrder: 1,
      livingWith: 'Wali (paman)',
      fatherName: 'Alm. Ujang Solihin',
      fatherEducation: EducationLevel.SMA,
      fatherOccupation: OccupationType.SUDAH_MENINGGAL,
      fatherIncome: null,
      motherName: 'Imas Maesaroh',
      motherEducation: EducationLevel.SD,
      motherOccupation: OccupationType.PEDAGANG,
      motherIncome: IncomeRange.KURANG_500K,
      guardianName: 'Rahmat Hidayat',
      guardianRelation: 'Paman',
      guardianEducation: EducationLevel.SMA,
      guardianOccupation: OccupationType.WIRASWASTA,
      guardianIncome: IncomeRange.RANGE_2JT_5JT,
      isPkh: true,
    },
    {
      // Guru PNS dan perawat. Keluarga mampu — pembanding di peringkat.
      numberOfSiblings: 1,
      childOrder: 2,
      livingWith: 'Orang tua',
      fatherName: 'Wawan Setiawan',
      fatherEducation: EducationLevel.S1,
      fatherOccupation: OccupationType.PNS,
      fatherIncome: IncomeRange.RANGE_5JT_10JT,
      motherName: 'Lilis Nurhayati',
      motherEducation: EducationLevel.D3,
      motherOccupation: OccupationType.PEGAWAI_SWASTA,
      motherIncome: IncomeRange.RANGE_2JT_5JT,
    },
    {
      // Pedagang kelontong, ibu menjahit di rumah.
      numberOfSiblings: 4,
      childOrder: 3,
      livingWith: 'Orang tua',
      fatherName: 'Endang Sutisna',
      fatherEducation: EducationLevel.SMA,
      fatherOccupation: OccupationType.PEDAGANG,
      fatherIncome: IncomeRange.RANGE_2JT_5JT,
      motherName: 'Yuyun Yuningsih',
      motherEducation: EducationLevel.SMA,
      motherOccupation: OccupationType.WIRASWASTA,
      motherIncome: IncomeRange.KURANG_500K,
      isPkh: true,
    },
  ];

  for (let i = 0; i < studentConfigs.length; i++) {
    const studentData = studentConfigs[i];
    const user = await prisma.user.create({
      data: {
        name: studentData.name,
        email: studentData.email,
        passwordHash: await bcrypt.hash('Student123!', 10),
        role: UserRole.STUDENT,
        unitId: studentData.unitId,
        isActive: true,
      },
    });

    // Assign student role
    await prisma.userRoleAssignment.create({
      data: {
        userId: user.id,
        roleId: roles[studentData.roleCode].id,
        unitId: studentData.unitId,
        isPrimary: true,
        isActive: true,
      },
    });

    const student = await prisma.student.create({
      data: {
        userId: user.id,
        unitId: studentData.unitId,
        nis: `2024${String(i + 1).padStart(4, '0')}`,
        nisn: `00${String(i + 1).padStart(8, '0')}`,
        gender: studentData.gender,
        birthPlace: 'Sukabumi',
        birthDate: new Date(
          `2012-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`
        ),
        address: `Jl. Santri No. ${i + 1}, Sukabumi`,
        parentName: familyProfiles[i].fatherName,
        parentPhone: `0812345678${String(i).padStart(2, '0')}`,
        fatherPhone: `0812345678${String(i).padStart(2, '0')}`,
        ...familyProfiles[i],
      },
    });

    students.push(student);

    // Enroll in class (only SMP IT students)
    if (studentData.roleCode === RoleCode.SMPIT_SISWA) {
      await prisma.classEnrollment.create({
        data: {
          studentId: student.id,
          classId: class7A.id,
          status: 'active',
        },
      });
    }
  }

  console.log('✅ Students created and enrolled');

  // ---------------------------------------------------------------------
  // TK Qur'an pupils — recorded, but with no account
  // ---------------------------------------------------------------------
  //
  // The RoleCode enum has no TKQ_SISWA on purpose: children of this age do not
  // hold logins. Nothing then created any TK pupils, so TK Qur'an ended up with
  // three teachers, no class and nobody enrolled — and the PAUD development
  // assessment attached itself to a SMA Qur'an santri, because that was the
  // only student left to point at.
  //
  // A pupil without a login is still a pupil. Each gets a Student row, and a
  // User row that is an *identity*: it carries the name (Student has no name
  // column of its own), has `passwordHash: null` so no credential exists at
  // all, is inactive so login is refused before anything else, and holds no
  // role assignment. See utils/student-login-policy.ts.
  const classTkA = await prisma.class.create({
    data: {
      unitId: tkQuran.id,
      academicYearId: academicYear.id,
      name: 'TK A',
      level: 'A',
      capacity: 20,
    },
  });

  const tkPupilConfigs = [
    { name: 'Aisyah Nur Fadhilah', gender: Gender.FEMALE, birthDate: '2021-03-14' },
    { name: 'Umar Abdul Aziz', gender: Gender.MALE, birthDate: '2021-07-02' },
    { name: 'Khadijah Salsabila', gender: Gender.FEMALE, birthDate: '2020-11-20' },
  ];

  const tkPupils = [];
  for (let i = 0; i < tkPupilConfigs.length; i++) {
    const data = tkPupilConfigs[i];
    const identity = await prisma.user.create({
      data: {
        name: data.name,
        // Not a mailbox — an identifier. The column is unique and required, and
        // these children have no address of their own.
        email: `tkq-${String(i + 1).padStart(3, '0')}@cipansor.or.id`,
        passwordHash: null,
        role: UserRole.STUDENT,
        unitId: tkQuran.id,
        isActive: false,
      },
    });

    const pupil = await prisma.student.create({
      data: {
        userId: identity.id,
        unitId: tkQuran.id,
        nis: `2024TK${String(i + 1).padStart(2, '0')}`,
        nisn: `01${String(i + 1).padStart(8, '0')}`,
        gender: data.gender,
        birthPlace: 'Tasikmalaya',
        birthDate: new Date(data.birthDate),
        address: 'Kp. Cipansor, Kec. Kadipaten, Kab. Tasikmalaya',
        parentName: `Orang tua ${data.name.split(' ')[0]}`,
        parentPhone: `08122200${String(i + 1).padStart(2, '0')}`,
      },
    });

    await prisma.classEnrollment.create({
      data: { studentId: pupil.id, classId: classTkA.id, status: 'active' },
    });

    tkPupils.push(pupil);
  }

  console.log(`✅ TK Qur'an pupils created (${tkPupils.length}, no logins)`);

  // Create Parent users (wali santri) with role assignments
  const parentUsers = [];
  const parentNames = [
    {
      name: 'Bapak Rizky (Wali)',
      email: 'parent1@cipansor.or.id',
      studentIdx: 0,
      unitId: smpIt.id,
      roleCode: RoleCode.SMPIT_ORANG_TUA,
    },
    {
      name: 'Ibu Fauzan (Wali)',
      email: 'parent2@cipansor.or.id',
      studentIdx: 1,
      unitId: smpIt.id,
      roleCode: RoleCode.SMPIT_ORANG_TUA,
    },
    {
      name: 'Bapak Aisyah (Wali)',
      email: 'parent3@cipansor.or.id',
      studentIdx: 2,
      unitId: sdIt.id,
      roleCode: RoleCode.SDIT_ORANG_TUA,
    },
  ];

  for (const parentData of parentNames) {
    const parentUser = await prisma.user.create({
      data: {
        name: parentData.name,
        email: parentData.email,
        passwordHash: await bcrypt.hash('Parent123!', 10),
        role: UserRole.PARENT,
        unitId: parentData.unitId,
        isActive: true,
      },
    });

    await prisma.userRoleAssignment.create({
      data: {
        userId: parentUser.id,
        roleId: roles[parentData.roleCode].id,
        unitId: parentData.unitId,
        isPrimary: true,
        isActive: true,
      },
    });

    parentUsers.push({ user: parentUser, studentIdx: parentData.studentIdx });
  }

  console.log('✅ Parent users created');

  // Create StudentParent connections
  for (const p of parentUsers) {
    if (students[p.studentIdx]) {
      await prisma.studentParent.create({
        data: {
          studentId: students[p.studentIdx].id,
          parentId: p.user.id,
          relation: p.studentIdx === 1 ? 'mother' : 'father',
          isPrimary: true,
        },
      });
    }
  }
  console.log('✅ StudentParent relations created');

  // ============================================
  // DEMO PERSONAS — give them the domain rows their portals read from.
  //
  // The demo loop above created 81 logins, but only User + role assignment.
  // A `*_SISWA` account with no `Student` row, a `*_ORANG_TUA` with no
  // `StudentParent` link and a `*_GURU` with no `Teacher` row all log in fine
  // and then land on a portal with nothing in it — every list empty, every
  // per-student call 404. The Playwright role audit read that as a dozen
  // "near-blank" pages before the cause was traced here.
  //
  // Each persona gets a real row in its own unit, so the demo shows the
  // product working rather than a shell.
  // ============================================
  const demoUnitClasses = new Map<string, string>([
    [smpIt.id, class7A.id],
    [sdIt.id, class1A.id],
    // TK Qur'an has no demo student; its pupils are all in TK A.
    [tkQuran.id, classTkA.id],
  ]);

  /** One class per unit, so students of every realm can be enrolled. */
  const classForUnit = async (unitId: string, level: string): Promise<string> => {
    const existing = demoUnitClasses.get(unitId);
    if (existing) return existing;
    const created = await prisma.class.create({
      data: {
        unitId,
        academicYearId: academicYear.id,
        name: `${level}A`,
        level,
        capacity: 30,
      },
    });
    demoUnitClasses.set(unitId, created.id);
    return created.id;
  };

  const demoStudentByUnit = new Map<string, string>();
  // Teacher rows of the wali kelas personas (`homeroom` in DEMO_ACCOUNTS),
  // made homeroom of their unit's demo class below.
  const demoHomeroomByUnit = new Map<string, string>();
  let demoStudents = 0;
  let demoTeachers = 0;
  let demoParents = 0;
  let demoNis = 9000;

  for (const [roleCode, demo] of demoPersonas) {
    if (!demo.unitId) continue;

    const isStudent = roleCode.endsWith('_SISWA');
    const isParent = roleCode.endsWith('_ORANG_TUA');
    // A kepala sekolah is an office, not a teaching record, so they get no
    // Teacher row — except where SECONDARY_ROLES also hands them a teaching
    // role. That pairing exists to model "a kepala sekolah who still teaches"
    // and to give the role switcher something to switch between; without the
    // Teacher row the teaching half of it is broken, because
    // GET /dashboard/teacher resolves the caller through `findTeacherIdForUser`
    // and 403s an account that has none.
    const teachesViaSecondaryRole = SECONDARY_ROLES.some(
      (pair) =>
        pair.primary === roleCode &&
        demoLegacyRoleFor(pair.secondary) === UserRole.TEACHER &&
        !pair.secondary.endsWith('_KEPALA_SEKOLAH')
    );
    const isTeacher =
      demoLegacyRoleFor(roleCode) === UserRole.TEACHER &&
      (!roleCode.endsWith('_KEPALA_SEKOLAH') || teachesViaSecondaryRole);

    if (isStudent) {
      const student = await prisma.student.create({
        data: {
          userId: demo.id,
          unitId: demo.unitId,
          nis: String(++demoNis),
          nisn: `00${String(demoNis).padStart(8, '0')}`,
          gender: Gender.MALE,
          birthPlace: 'Tasikmalaya',
          birthDate: new Date('2012-05-17'),
          address: 'Kp. Cipansor, Kec. Kadipaten, Kab. Tasikmalaya',
          parentPhone: '081234567890',
          // Cycle the same family profiles so every demo santri has economic
          // circumstances too. Without this, ten of the fourteen santri had no
          // household data and the scholarship ranking could not separate them.
          ...familyProfiles[demoStudents % familyProfiles.length],
          parentName: familyProfiles[demoStudents % familyProfiles.length].fatherName,
        },
      });
      await prisma.classEnrollment.create({
        data: {
          studentId: student.id,
          classId: await classForUnit(demo.unitId, '7'),
          status: 'active',
        },
      });
      // Remember it so this unit's demo parent can be linked to it below.
      demoStudentByUnit.set(demo.unitId, student.id);
      demoStudents++;
    } else if (isTeacher) {
      const teacher = await prisma.teacher.create({
        data: {
          userId: demo.id,
          unitId: demo.unitId,
          nip: `1990${String(demoNis++).padStart(11, '0')}`,
        },
      });
      if (demo.homeroom) demoHomeroomByUnit.set(demo.unitId, teacher.id);
      demoTeachers++;
    } else if (isParent) {
      demoParents++; // linked in the second pass, once every student exists
    }
  }

  // TK Qur'an has no demo student of its own — there is no TKQ_SISWA role to
  // create one from — so the demo TK parent had nobody to be a parent of and
  // opened a portal with no child in it. Point it at a real TK pupil.
  if (tkPupils.length > 0) {
    demoStudentByUnit.set(tkQuran.id, tkPupils[0].id);
  }

  // The wali kelas persona is the wali kelas of the class its unit's demo
  // santri sits in (TK A for TK Qur'an). A day pupil's leave is the wali
  // kelas's to decide (2026-09-25), and since 2026-09-27 the Wali Kelas menu
  // and the homeroom pages follow this relation, not a role: a persona that is
  // wali kelas of no class would have neither.
  for (const [unitId, teacherId] of demoHomeroomByUnit) {
    const classId = demoUnitClasses.get(unitId);
    if (!classId) continue;
    await prisma.class.update({ where: { id: classId }, data: { homeroomTeacherId: teacherId } });
  }

  // Second pass: the parent of a unit is linked to that unit's demo student.
  // Done separately because map iteration order does not guarantee the
  // student was created before the parent.
  for (const [roleCode, demo] of demoPersonas) {
    if (!roleCode.endsWith('_ORANG_TUA') || !demo.unitId) continue;
    const studentId = demoStudentByUnit.get(demo.unitId);
    if (!studentId) continue;
    await prisma.studentParent.create({
      data: { studentId, parentId: demo.id, relation: 'father', isPrimary: true },
    });
  }

  console.log(
    `✅ Demo personas wired (${demoStudents} students, ${demoTeachers} teachers, ${demoParents} parents)`
  );

  // ---------------------------------------------------------------------
  // Families: siblings across units, and parents who are also something else
  // ---------------------------------------------------------------------
  //
  // Until now every wali had exactly one child in exactly one unit, so three
  // situations the pesantren actually has were unrepresented:
  //
  //   - a family with children at several jenjang at once. A wali with a child
  //     in TK, one in SD and one in SMP must reach all three units, which means
  //     three parent-role assignments on ONE account, not three accounts.
  //   - komite sekolah members. All four were seeded with zero children, but a
  //     komite is drawn from the wali murid — a member with no child in the
  //     school is not a komite member.
  //   - a wali who is also staff. A guru whose own child studies here, or a
  //     pengurus yayasan who is also a parent, is one person with one login and
  //     more than one role.
  //
  // The Bahtiar family is the first: three siblings, one wali, three units.
  const bahtiarChildren: Array<{ id: string }> = [];

  const bahtiarTk = await prisma.user.create({
    data: {
      name: 'Zahra Bahtiar',
      email: 'tkq-b01@cipansor.or.id',
      passwordHash: null,
      role: UserRole.STUDENT,
      unitId: tkQuran.id,
      isActive: false,
    },
  });
  bahtiarChildren.push(
    await prisma.student.create({
      data: {
        userId: bahtiarTk.id,
        unitId: tkQuran.id,
        nis: '2024TKB1',
        nisn: '0120000001',
        gender: Gender.FEMALE,
        birthPlace: 'Tasikmalaya',
        birthDate: new Date('2021-01-09'),
        address: 'Kp. Cipansor, Kec. Kadipaten, Kab. Tasikmalaya',
        parentName: 'Bapak Hendra Bahtiar',
        parentPhone: '081223340001',
      },
    })
  );

  for (const sibling of [
    {
      name: 'Yusuf Bahtiar',
      email: 'yusuf.bahtiar@cipansor.or.id',
      unit: sdIt,
      classId: class1A.id,
      nis: '2024SDB1',
      nisn: '0120000002',
      gender: Gender.MALE,
      birthDate: '2017-04-18',
      roleCode: RoleCode.SDIT_SISWA,
    },
    {
      name: 'Hafshah Bahtiar',
      email: 'hafshah.bahtiar@cipansor.or.id',
      unit: smpIt,
      classId: class7A.id,
      nis: '2024SMB1',
      nisn: '0120000003',
      gender: Gender.FEMALE,
      birthDate: '2012-09-05',
      roleCode: RoleCode.SMPIT_SISWA,
    },
  ]) {
    const siblingUser = await prisma.user.create({
      data: {
        name: sibling.name,
        email: sibling.email,
        passwordHash: await bcrypt.hash('Student123!', 10),
        role: UserRole.STUDENT,
        unitId: sibling.unit.id,
        isActive: true,
      },
    });
    // Without this the account has users.role = STUDENT but no assignment, so
    // it could only log in through the legacy User.role fallback. Once that
    // fallback is removed these two siblings are locked out entirely — an
    // account that exists, has a password, and cannot sign in.
    await prisma.userRoleAssignment.create({
      data: {
        userId: siblingUser.id,
        roleId: roles[sibling.roleCode].id,
        unitId: sibling.unit.id,
        isPrimary: true,
        isActive: true,
      },
    });
    const created = await prisma.student.create({
      data: {
        userId: siblingUser.id,
        unitId: sibling.unit.id,
        nis: sibling.nis,
        // Dulu `013${nis.slice(-5)}` → '0134SDB1': 8 karakter dan berhuruf, dua
        // NISN tak sah yang ikut tergelar ke produksi. NISN itu 10 digit angka.
        nisn: sibling.nisn,
        gender: sibling.gender,
        birthPlace: 'Tasikmalaya',
        birthDate: new Date(sibling.birthDate),
        address: 'Kp. Cipansor, Kec. Kadipaten, Kab. Tasikmalaya',
        parentName: 'Bapak Hendra Bahtiar',
        parentPhone: '081223340001',
      },
    });
    await prisma.classEnrollment.create({
      data: { studentId: created.id, classId: sibling.classId, status: 'active' },
    });
    bahtiarChildren.push(created);
  }

  const waliBahtiar = await prisma.user.create({
    data: {
      name: 'Bapak Hendra Bahtiar',
      email: 'hendra.bahtiar@cipansor.or.id',
      passwordHash: await bcrypt.hash('Parent123!', 10),
      role: UserRole.PARENT,
      // No single unit: the reconciliation below gives this account one parent
      // role per unit its children study in.
      unitId: null,
      isActive: true,
    },
  });

  for (const child of bahtiarChildren) {
    await prisma.studentParent.create({
      data: { studentId: child.id, parentId: waliBahtiar.id, relation: 'father', isPrimary: true },
    });
  }

  // Komite members are wali murid. Each is linked to a child already enrolled
  // in the school whose komite they sit on.
  const komiteChildByRole: Array<{ roleCode: string; studentId?: string }> = [
    { roleCode: 'TKQ_KOMITE', studentId: tkPupils[1]?.id },
    { roleCode: 'SDIT_KOMITE', studentId: students[2]?.id },
    { roleCode: 'SMPIT_KOMITE', studentId: students[1]?.id },
    { roleCode: 'SMAQ_KOMITE', studentId: students[3]?.id },
  ];
  for (const entry of komiteChildByRole) {
    const komite = demoUsers.get(entry.roleCode);
    if (!komite || !entry.studentId) continue;
    await prisma.studentParent.create({
      data: {
        studentId: entry.studentId,
        parentId: komite.id,
        relation: 'mother',
        isPrimary: false,
      },
    });
  }

  // Staff who are also wali. One guru and one pengurus yayasan, each a single
  // account that will end up holding both roles.
  const staffWali: Array<{ roleCode: string; studentId?: string }> = [
    { roleCode: 'SDIT_GURU', studentId: students[0]?.id },
    { roleCode: 'YAYASAN_ANGGOTA', studentId: tkPupils[2]?.id },
  ];
  for (const entry of staffWali) {
    const staff = demoUsers.get(entry.roleCode);
    if (!staff || !entry.studentId) continue;
    await prisma.studentParent.create({
      data: {
        studentId: entry.studentId,
        parentId: staff.id,
        relation: 'father',
        isPrimary: false,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Parent roles are derived from the children, never written by hand
  // ---------------------------------------------------------------------
  //
  // The rule: a wali holds exactly one `*_ORANG_TUA` assignment per unit in
  // which they have a child. Computing it here, after every StudentParent row
  // exists, means the two can never drift — a wali cannot be scoped to a unit
  // no child of theirs attends, and cannot be missing one where a child does.
  //
  // Perguruan Tinggi has no guardian role and is skipped on purpose: a
  // mahasiswa is an adult, and inventing a wali role for them would be
  // modelling something the institution does not do.
  // The rule itself lives in utils/parent-scope.ts so that this seed and the
  // SPMB onboarding path cannot disagree about it. Running it after every
  // StudentParent row exists means a wali is scoped to exactly the units their
  // children study in — never one more, never one fewer.
  let parentRolesAdded = 0;
  const parentIds = [
    ...new Set(
      (await prisma.studentParent.findMany({ select: { parentId: true } })).map((l) => l.parentId)
    ),
  ];
  for (const parentId of parentIds) {
    parentRolesAdded += await syncParentRoleAssignments(
      prisma as unknown as ParentScopeClient,
      parentId
    );
  }

  console.log(
    `✅ Families wired (Bahtiar siblings across 3 units, komite & staff as wali, ${parentRolesAdded} parent roles derived)`
  );

  // Create Attendance records for today
  const today = new Date();
  for (const student of students) {
    await prisma.attendance.create({
      data: {
        studentId: student.id,
        classId: class7A.id,
        date: today,
        status: AttendanceStatus.PRESENT,
        recordedById: teacherPesantrenUser.id,
      },
    });
  }

  console.log('✅ Attendance records created');

  // Create Tahfidz records
  for (const student of students.slice(0, 3)) {
    await prisma.tahfidzRecord.create({
      data: {
        studentId: student.id,
        activityType: TahfidzActivityType.ZIYADAH,
        surahNumber: 1,
        surahName: 'Al-Fatihah',
        ayahStart: 1,
        ayahEnd: 7,
        juz: 1,
        totalAyah: 7,
        score: 90,
        notes: 'Hafalan baik dan lancar',
        recordedById: teacherPesantrenUser.id,
      },
    });
  }

  console.log('✅ Tahfidz records created');

  // Create TahfidzTargets for students
  for (const student of students) {
    await prisma.tahfidzTarget.create({
      data: {
        studentId: student.id,
        academicYearId: academicYear.id,
        targetJuz: 5,
        notes: 'Target semester ini minimal 5 Juz',
      },
    });
  }
  console.log('✅ Tahfidz targets created');

  // ============================================
  // PHASE 2: Dormitories, Permits, Violations, Rewards, Finance
  // ============================================

  // Create Dormitories
  // No unitId: both asrama are run by the yayasan and take santri from SD IT,
  // SMP IT and SMA Qur'an alike — which is exactly what the room assignments
  // below do. Naming one school here is what made SMP IT look like the owner.
  const dormitoryPutra = await prisma.dormitory.create({
    data: {
      name: 'Asrama Putra Al-Hikmah',
      code: 'AP-01',
      gender: Gender.MALE,
      capacity: 100,
      description: 'Asrama putra dengan fasilitas lengkap',
    },
  });

  const dormitoryPutri = await prisma.dormitory.create({
    data: {
      name: 'Asrama Putri Al-Hikmah',
      code: 'AW-01',
      gender: Gender.FEMALE,
      capacity: 80,
      description: 'Asrama putri dengan lingkungan yang nyaman',
    },
  });

  console.log('✅ Dormitories created');

  // Create Rooms
  const rooms: Array<{ room: Awaited<ReturnType<typeof prisma.room.create>>; gender: Gender }> = [];

  // Putra rooms
  for (let i = 1; i <= 5; i++) {
    const room = await prisma.room.create({
      data: {
        dormitoryId: dormitoryPutra.id,
        name: `Kamar P${i}`,
        floor: Math.ceil(i / 2),
        capacity: 8,
        description: `Kamar putra lantai ${Math.ceil(i / 2)}`,
      },
    });
    rooms.push({ room, gender: Gender.MALE });
  }

  // Putri rooms
  for (let i = 1; i <= 4; i++) {
    const room = await prisma.room.create({
      data: {
        dormitoryId: dormitoryPutri.id,
        name: `Kamar W${i}`,
        floor: Math.ceil(i / 2),
        capacity: 6,
        description: `Kamar putri lantai ${Math.ceil(i / 2)}`,
      },
    });
    rooms.push({ room, gender: Gender.FEMALE });
  }

  console.log('✅ Rooms created');

  // Create Room Assignments
  let maleRoomIndex = 0;
  let femaleRoomIndex = 0; // Index for female rooms (0-3)

  for (const student of students) {
    const studentData = await prisma.student.findUnique({
      where: { id: student.id },
      select: { gender: true },
    });

    let roomData;
    if (studentData?.gender === Gender.MALE) {
      roomData = rooms[maleRoomIndex % 5];
      maleRoomIndex++;
    } else {
      // Female rooms start at index 5, there are 4 female rooms (indices 5-8)
      roomData = rooms[5 + (femaleRoomIndex % 4)];
      femaleRoomIndex++;
    }

    await prisma.roomAssignment.create({
      data: {
        roomId: roomData.room.id,
        studentId: student.id,
        assignedAt: currentYear.startDate,
        isActive: true,
        notes: `Penempatan awal tahun ajaran ${currentYear.name}`,
      },
    });
  }

  // Boarding is compulsory at SMP IT and SMA Qur'an, so a santri there without
  // a bed is missing data, not a santri who lives at home. The demo personas
  // are created before the asrama exists and so were never placed — which is
  // why production currently shows santri who must board and have no kamar.
  // TK Qur'an is deliberately not included: those pupils go home daily.
  const mandatoryBoarders = await prisma.student.findMany({
    where: {
      status: 'active',
      unit: { type: { in: [UnitType.SMP_IT, UnitType.SMA_QURAN] } },
      roomAssignments: { none: { isActive: true } },
    },
    select: { id: true, gender: true },
  });

  for (const boarder of mandatoryBoarders) {
    let roomData;
    if (boarder.gender === Gender.MALE) {
      roomData = rooms[maleRoomIndex % 5];
      maleRoomIndex++;
    } else {
      roomData = rooms[5 + (femaleRoomIndex % 4)];
      femaleRoomIndex++;
    }

    await prisma.roomAssignment.create({
      data: {
        roomId: roomData.room.id,
        studentId: boarder.id,
        assignedAt: currentYear.startDate,
        isActive: true,
        notes: `Penempatan awal tahun ajaran ${currentYear.name}`,
      },
    });
  }

  console.log(`✅ Room assignments created (+${mandatoryBoarders.length} santri wajib mondok)`);

  // Create Permits
  const permitStatuses = [
    PermitStatus.PENDING,
    PermitStatus.APPROVED,
    PermitStatus.COMPLETED,
    PermitStatus.REJECTED,
  ];
  const permitTypes = [PermitType.PULANG, PermitType.KELUAR, PermitType.SAKIT, PermitType.KELUARGA];

  for (let i = 0; i < 4; i++) {
    const student = students[i % students.length];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + i);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 2);

    await prisma.permit.create({
      data: {
        studentId: student.id,
        type: permitTypes[i],
        status: permitStatuses[i],
        reason: `Alasan izin ${permitTypes[i].toLowerCase()}: keperluan keluarga`,
        startDate,
        endDate,
        approvedById:
          permitStatuses[i] !== PermitStatus.PENDING ? teacherPesantrenUser.id : undefined,
        approvedAt: permitStatuses[i] !== PermitStatus.PENDING ? new Date() : undefined,
        returnedAt: permitStatuses[i] === PermitStatus.COMPLETED ? new Date() : undefined,
      },
    });
  }

  console.log('✅ Permits created');

  // Create Violations
  const violationDescriptions = [
    {
      type: ViolationType.MINOR,
      category: 'ibadah',
      desc: 'Terlambat sholat berjamaah',
      points: 5,
    },
    {
      type: ViolationType.MINOR,
      category: 'kebersihan',
      desc: 'Tidak merapikan tempat tidur',
      points: 3,
    },
    {
      type: ViolationType.MODERATE,
      category: 'ketertiban',
      desc: 'Tidak mengikuti kegiatan wajib',
      points: 10,
    },
    {
      type: ViolationType.MAJOR,
      category: 'ketertiban',
      desc: 'Keluar asrama tanpa izin',
      points: 25,
    },
  ];

  for (let i = 0; i < violationDescriptions.length; i++) {
    const student = students[i % students.length];
    const violation = violationDescriptions[i];
    const occurredAt = new Date();
    occurredAt.setDate(occurredAt.getDate() - (i + 1));

    await prisma.violation.create({
      data: {
        studentId: student.id,
        type: violation.type,
        category: violation.category,
        description: violation.desc,
        occurredAt,
        points: violation.points,
        reportedById: teacherPesantrenUser.id,
        action: 'Diberi peringatan lisan',
      },
    });
  }

  console.log('✅ Violations created');

  // Create Rewards
  const rewardDescriptions = [
    { category: 'tahfidz', desc: 'Juara 1 Lomba Hafalan', points: 50 },
    { category: 'akhlak', desc: 'Santri teladan bulan ini', points: 30 },
    { category: 'kebersihan', desc: 'Membantu kegiatan kebersihan', points: 10 },
    { category: 'tahfidz', desc: 'Memenangkan kompetisi tahfidz antar pesantren', points: 100 },
  ];

  for (let i = 0; i < rewardDescriptions.length; i++) {
    const student = students[i % students.length];
    const reward = rewardDescriptions[i];
    const givenAt = new Date();
    givenAt.setDate(givenAt.getDate() - i);

    await prisma.reward.create({
      data: {
        studentId: student.id,
        category: reward.category,
        description: reward.desc,
        givenAt,
        points: reward.points,
        givenById: teacherPesantrenUser.id,
      },
    });
  }

  console.log('✅ Rewards created');

  // Create Payment Types
  const paymentTypesData = [
    {
      name: 'SPP Bulanan',
      code: 'SPP',
      amount: new Prisma.Decimal(500000),
      description: 'Biaya pendidikan bulanan',
    },
    {
      name: 'Biaya Makan',
      code: 'MAKAN',
      amount: new Prisma.Decimal(750000),
      description: 'Biaya makan 3x sehari',
    },
    {
      name: 'Biaya Asrama',
      code: 'ASRAMA',
      amount: new Prisma.Decimal(300000),
      description: 'Biaya penginapan asrama',
    },
    {
      name: 'Seragam',
      code: 'SRGM',
      amount: new Prisma.Decimal(1500000),
      description: 'Biaya seragam lengkap',
      isRecurring: false,
    },
    {
      name: 'Kegiatan Ekstrakurikuler',
      code: 'EKSKUL',
      amount: new Prisma.Decimal(100000),
      description: 'Biaya kegiatan tambahan',
    },
  ];

  const createdPaymentTypes = [];
  for (const pt of paymentTypesData) {
    const paymentType = await prisma.paymentType.create({
      data: {
        unitId: smpIt.id,
        name: pt.name,
        code: pt.code,
        amount: pt.amount,
        description: pt.description,
        isRecurring: pt.isRecurring ?? true,
      },
    });
    createdPaymentTypes.push(paymentType);
  }

  console.log('✅ Payment types created');

  // Create Invoices and Payments
  const months = ['Juli', 'Agustus', 'September'];
  let invoiceCounter = 1;
  const sppPaymentType = createdPaymentTypes.find((pt) => pt.code === 'SPP')!;

  for (const student of students.slice(0, 3)) {
    for (let monthIdx = 0; monthIdx < months.length; monthIdx++) {
      const dueDate = new Date(2024, 6 + monthIdx, 10); // 10th of each month
      const status =
        monthIdx === 0
          ? PaymentStatus.PAID
          : monthIdx === 1
            ? PaymentStatus.PARTIAL
            : PaymentStatus.PENDING;

      const totalAmount = Number(sppPaymentType.amount);

      const invoice = await prisma.invoice.create({
        data: {
          studentId: student.id,
          paymentTypeId: sppPaymentType.id,
          invoiceNumber: `INV-2024${String(invoiceCounter++).padStart(5, '0')}`,
          dueDate,
          amount: new Prisma.Decimal(totalAmount),
          paidAmount:
            status === PaymentStatus.PAID
              ? new Prisma.Decimal(totalAmount)
              : status === PaymentStatus.PARTIAL
                ? new Prisma.Decimal(totalAmount / 2)
                : new Prisma.Decimal(0),
          status,
          period: `${months[monthIdx]} 2024`,
          notes: `Tagihan SPP untuk bulan ${months[monthIdx]}`,
        },
      });

      // Create payment for paid/partial invoices
      if (status === PaymentStatus.PAID || status === PaymentStatus.PARTIAL) {
        const paymentAmount = status === PaymentStatus.PAID ? totalAmount : totalAmount / 2;
        const paidAt = new Date(dueDate);
        paidAt.setDate(paidAt.getDate() - 2);

        await prisma.payment.create({
          data: {
            invoiceId: invoice.id,
            amount: new Prisma.Decimal(paymentAmount),
            paidAt,
            method: PaymentMethod.BANK_TRANSFER,
            referenceNo: `TRF-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            notes: `Pembayaran via transfer bank`,
          },
        });
      }
    }
  }

  console.log('✅ Invoices and payments created');

  // ============================================
  // PHASE 3: Staff / HR Data
  // ============================================

  // Create Staff users and profiles
  // Each entry carries the RoleCode its job actually is. These four were the
  // only seeded users created with a legacy `role` and no UserRoleAssignment,
  // so they logged in solely through the legacy fallback in authService.login
  // — arriving with an empty permission list, which silently fails every
  // hasPermission-gated route. Removing that fallback would lock them out
  // outright, so the assignment they should always have had is created below.
  const staffData = [
    {
      name: 'Pak Bambang Sutejo',
      email: 'bambang@cipansor.or.id',
      position: 'Kepala TU',
      department: 'Administrasi',
      roleCode: RoleCode.SMPIT_TATA_USAHA,
    },
    {
      name: 'Ibu Dewi Kartika',
      email: 'dewi@cipansor.or.id',
      position: 'Staff Keuangan',
      department: 'Keuangan',
      roleCode: RoleCode.SMPIT_BENDAHARA,
    },
    {
      name: 'Pak Rudi Hartono',
      email: 'rudi@cipansor.or.id',
      position: 'Security',
      department: 'Keamanan',
      roleCode: RoleCode.KEAMANAN,
    },
    {
      name: 'Ibu Sri Wahyuni',
      email: 'sri@cipansor.or.id',
      position: 'Petugas Kesehatan',
      department: 'Kesehatan',
      roleCode: RoleCode.PERAWAT,
    },
  ];

  const staffRecords = [];
  for (let i = 0; i < staffData.length; i++) {
    const data = staffData[i];
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: await bcrypt.hash('Staff123!', 10),
        role: UserRole.STAFF,
        unitId: smpIt.id,
        isActive: true,
      },
    });

    await prisma.userRoleAssignment.create({
      data: {
        userId: user.id,
        roleId: roles[data.roleCode].id,
        unitId: smpIt.id,
        isPrimary: true,
        isActive: true,
      },
    });

    const staff = await prisma.staff.create({
      data: {
        userId: user.id,
        unitId: smpIt.id,
        nip: `199${i}0101202001${String(i + 1).padStart(3, '0')}`,
        position: data.position,
        department: data.department,
        joinDate: new Date(`2020-0${i + 1}-01`),
      },
    });
    staffRecords.push(staff);
  }

  console.log('✅ Staff created');

  // Create Staff Attendance for the past week
  const staffAttendanceStatuses = [
    StaffAttendanceStatus.PRESENT,
    StaffAttendanceStatus.PRESENT,
    StaffAttendanceStatus.LATE,
    StaffAttendanceStatus.PRESENT,
    StaffAttendanceStatus.SICK,
    StaffAttendanceStatus.PRESENT,
    StaffAttendanceStatus.LEAVE,
  ];

  for (const staff of staffRecords) {
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const date = new Date();
      date.setDate(date.getDate() - dayOffset);
      date.setHours(0, 0, 0, 0);

      const status =
        staffAttendanceStatuses[
          (staff.id.charCodeAt(0) + dayOffset) % staffAttendanceStatuses.length
        ];

      const checkIn = new Date(date);
      checkIn.setHours(
        7 + (status === StaffAttendanceStatus.LATE ? 1 : 0),
        30 + Math.floor(Math.random() * 30),
        0
      );

      const checkOut = new Date(date);
      checkOut.setHours(16, Math.floor(Math.random() * 60), 0);

      await prisma.staffAttendance.create({
        data: {
          staffId: staff.id,
          date,
          status,
          checkIn:
            status === StaffAttendanceStatus.PRESENT || status === StaffAttendanceStatus.LATE
              ? checkIn
              : undefined,
          checkOut:
            status === StaffAttendanceStatus.PRESENT || status === StaffAttendanceStatus.LATE
              ? checkOut
              : undefined,
          notes:
            status === StaffAttendanceStatus.SICK
              ? 'Izin sakit dengan surat dokter'
              : status === StaffAttendanceStatus.LEAVE
                ? 'Cuti tahunan'
                : status === StaffAttendanceStatus.LATE
                  ? 'Terlambat karena macet'
                  : undefined,
        },
      });
    }
  }

  console.log('✅ Staff attendance created');

  // Create Leave requests
  const leaveData = [
    {
      staffIdx: 0,
      type: LeaveType.ANNUAL,
      days: 3,
      status: LeaveStatus.APPROVED,
      reason: 'Liburan keluarga',
    },
    {
      staffIdx: 1,
      type: LeaveType.SICK,
      days: 2,
      status: LeaveStatus.APPROVED,
      reason: 'Sakit demam',
    },
    {
      staffIdx: 2,
      type: LeaveType.MARRIAGE,
      days: 5,
      status: LeaveStatus.PENDING,
      reason: 'Menghadiri pernikahan anak',
    },
    {
      staffIdx: 3,
      type: LeaveType.OTHER,
      days: 1,
      status: LeaveStatus.REJECTED,
      reason: 'Urusan pribadi',
    },
  ];

  for (const leave of leaveData) {
    const staff = staffRecords[leave.staffIdx];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 7);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + leave.days - 1);

    await prisma.leave.create({
      data: {
        staffId: staff.id,
        type: leave.type,
        startDate,
        endDate,
        totalDays: leave.days,
        reason: leave.reason,
        status: leave.status,
        approvedById: leave.status !== LeaveStatus.PENDING ? teacherPesantrenUser.id : undefined,
        approvedAt: leave.status !== LeaveStatus.PENDING ? new Date() : undefined,
        rejectedNote:
          leave.status === LeaveStatus.REJECTED ? 'Tidak memenuhi persyaratan cuti' : undefined,
      },
    });
  }

  console.log('✅ Leave requests created');

  // ============================================
  // PHASE 3: SPMB (penerimaan santri baru)
  // ============================================

  // SMP IT's intake for next year, in the module's shape: one period with two
  // waves around today — wave 1 open, wave 2 still ahead — and the brochure's
  // fees and requirements (seeds/spmb-demo.ts). Dates derive from the seed run,
  // so a freshly seeded system always has a registration a visitor can
  // complete.
  const admissionPeriod = await ensureDemoIntake(prisma, {
    unit: 'SMP_IT',
    unitId: smpIt.id,
    academicYear: nextYear,
    quotas: [50, 20],
  });
  const [admissionWave1] = admissionPeriod.waves;

  console.log('✅ Admission period created');

  // Create Registrants with various statuses
  const registrantData: Array<{
    name: string;
    gender: Gender;
    status: AdmissionStatus;
    parentName: string;
    quranAbility?: QuranAbility;
    memorizedJuz?: number;
  }> = [
    {
      name: 'Farid Hidayat',
      gender: Gender.MALE,
      status: AdmissionStatus.ENROLLED,
      parentName: 'Bapak Hidayat',
    },
    {
      name: 'Nurul Aini',
      gender: Gender.FEMALE,
      status: AdmissionStatus.ACCEPTED,
      parentName: 'Bapak Ahmad',
    },
    {
      name: 'Rizki Ramadhan',
      gender: Gender.MALE,
      status: AdmissionStatus.TEST_COMPLETED,
      parentName: 'Bapak Ramadhan',
      quranAbility: QuranAbility.TAHFIDZ,
      memorizedJuz: 5,
    },
    {
      name: 'Salsabila Putri',
      gender: Gender.FEMALE,
      status: AdmissionStatus.DOCUMENT_CHECK,
      parentName: 'Bapak Putra',
      quranAbility: QuranAbility.TARTIL,
    },
    {
      name: 'Akbar Maulana',
      gender: Gender.MALE,
      status: AdmissionStatus.REGISTERED,
      parentName: 'Bapak Maulana',
      quranAbility: QuranAbility.LANCAR,
    },
    {
      name: 'Azzahra Aulia',
      gender: Gender.FEMALE,
      status: AdmissionStatus.REJECTED,
      parentName: 'Bapak Aulia',
    },
  ];

  let regCounter = 1;
  for (const reg of registrantData) {
    const registrant = await prisma.registrant.create({
      data: {
        admissionPeriodId: admissionPeriod.id,
        waveId: admissionWave1.id,
        // These are the applicants of the wave that is open right now, so the
        // number carries the intake year rather than the year the seed was written.
        registrationNo: `REG-${intakeYear.startYear}-${String(regCounter++).padStart(4, '0')}`,
        // `fullName` is the canonical field the API reads; `name` is the
        // legacy column kept in sync (see admissions service writes).
        fullName: reg.name,
        name: reg.name,
        gender: reg.gender,
        quranAbility: reg.quranAbility,
        memorizedJuz: reg.memorizedJuz,
        birthPlace: 'Sukabumi',
        birthDate: new Date('2012-05-15'),
        address: 'Jl. Pendaftaran No. ' + regCounter + ', Sukabumi',
        phone: `0812345600${regCounter}`,
        email: `${reg.name.toLowerCase().replace(' ', '.')}@gmail.com`,
        previousSchool: 'SD Negeri Sukabumi ' + regCounter,
        parentName: reg.parentName,
        parentPhone: `0812345700${regCounter}`,
        parentEmail: `parent${regCounter}@gmail.com`,
        parentOccupation: 'Wiraswasta',
        status: reg.status,
        testScore:
          reg.status === AdmissionStatus.TEST_COMPLETED ||
          reg.status === AdmissionStatus.ACCEPTED ||
          reg.status === AdmissionStatus.ENROLLED
            ? new Prisma.Decimal(75 + Math.random() * 20)
            : undefined,
        interviewScore:
          reg.status === AdmissionStatus.ACCEPTED || reg.status === AdmissionStatus.ENROLLED
            ? new Prisma.Decimal(70 + Math.random() * 25)
            : undefined,
        tahfidzScore:
          reg.status === AdmissionStatus.ACCEPTED || reg.status === AdmissionStatus.ENROLLED
            ? new Prisma.Decimal(80 + Math.random() * 15)
            : undefined,
        acceptedAt:
          reg.status === AdmissionStatus.ACCEPTED || reg.status === AdmissionStatus.ENROLLED
            ? new Date()
            : undefined,
        enrolledAt: reg.status === AdmissionStatus.ENROLLED ? new Date() : undefined,
        // Daftar ulang settled for those who got that far. Enrollment is gated
        // on this now (utils/admission-fee-gate), so leaving it null would
        // make the accepted demo registrant un-enrollable and the SPMB demo a
        // dead end. Registrants still in selection have not paid, which is
        // correct: the fee falls due on acceptance, not on applying.
        registrationFeePaidAt:
          reg.status === AdmissionStatus.ACCEPTED || reg.status === AdmissionStatus.ENROLLED
            ? new Date()
            : undefined,
        registrationFeeAmount:
          reg.status === AdmissionStatus.ACCEPTED || reg.status === AdmissionStatus.ENROLLED
            ? admissionPeriod.registrationFee
            : undefined,
        notes:
          reg.status === AdmissionStatus.REJECTED
            ? 'Tidak memenuhi persyaratan usia minimum'
            : undefined,
      },
    });

    // Create registrant documents
    await prisma.registrantDocument.createMany({
      data: [
        {
          registrantId: registrant.id,
          name: 'Akta Kelahiran',
          type: 'akta',
          isVerified: reg.status !== AdmissionStatus.REGISTERED,
        },
        {
          registrantId: registrant.id,
          name: 'Kartu Keluarga',
          type: 'kk',
          isVerified: reg.status !== AdmissionStatus.REGISTERED,
        },
        {
          registrantId: registrant.id,
          name: 'Pas Foto',
          type: 'foto',
          isVerified: reg.status !== AdmissionStatus.REGISTERED,
        },
      ],
    });
  }
  // The wave's counters say what its registrants are, as a public registration
  // keeps them.
  await prisma.admissionWave.update({
    where: { id: admissionWave1.id },
    data: {
      registeredCount: registrantData.length,
      acceptedCount: registrantData.filter(
        (r) => r.status === AdmissionStatus.ACCEPTED || r.status === AdmissionStatus.ENROLLED
      ).length,
    },
  });

  console.log('✅ Registrants created');

  // ============================================
  // PHASE 4: PERPUSTAKAAN (LIBRARY)
  // ============================================

  // Create Book Categories
  const bookCategoriesData = [
    { name: 'Fiqih', code: 'FIQ', description: 'Buku-buku Fiqih Islam' },
    { name: 'Hadits', code: 'HAD', description: 'Buku-buku Hadits dan Ilmu Hadits' },
    { name: 'Tafsir', code: 'TAF', description: 'Buku-buku Tafsir Al-Quran' },
    { name: 'Akhlak', code: 'AKH', description: 'Buku-buku Akhlak dan Tasawuf' },
    { name: 'Umum', code: 'UMM', description: 'Buku-buku Pengetahuan Umum' },
  ];

  const bookCategories = [];
  for (const cat of bookCategoriesData) {
    const category = await prisma.bookCategory.create({
      data: {
        unitId: smpIt.id,
        name: cat.name,
        code: cat.code,
        description: cat.description,
      },
    });
    bookCategories.push(category);
  }

  console.log('✅ Book categories created');

  // Create Books
  const booksData = [
    {
      title: 'Fiqih Sunnah',
      author: 'Sayyid Sabiq',
      categoryIdx: 0,
      isbn: '978-979-1234-01-1',
      quantity: 5,
    },
    {
      title: 'Riyadhus Shalihin',
      author: 'Imam An-Nawawi',
      categoryIdx: 1,
      isbn: '978-979-1234-02-2',
      quantity: 3,
    },
    {
      title: 'Tafsir Ibnu Katsir',
      author: 'Ibnu Katsir',
      categoryIdx: 2,
      isbn: '978-979-1234-03-3',
      quantity: 2,
    },
    {
      title: 'Ihya Ulumuddin',
      author: 'Imam Al-Ghazali',
      categoryIdx: 3,
      isbn: '978-979-1234-04-4',
      quantity: 4,
    },
    {
      title: 'Ensiklopedia Islam',
      author: 'Tim Penulis',
      categoryIdx: 4,
      isbn: '978-979-1234-05-5',
      quantity: 6,
    },
    {
      title: 'Bulughul Maram',
      author: 'Ibnu Hajar Al-Asqalani',
      categoryIdx: 1,
      isbn: '978-979-1234-06-6',
      quantity: 4,
    },
    {
      title: 'Fathul Bari',
      author: 'Ibnu Hajar Al-Asqalani',
      categoryIdx: 1,
      isbn: '978-979-1234-07-7',
      quantity: 2,
    },
    {
      title: 'Tafsir Al-Misbah',
      author: 'M. Quraish Shihab',
      categoryIdx: 2,
      isbn: '978-979-1234-08-8',
      quantity: 3,
    },
  ];

  const books = [];
  for (const bookData of booksData) {
    const book = await prisma.book.create({
      data: {
        unitId: smpIt.id,
        categoryId: bookCategories[bookData.categoryIdx].id,
        title: bookData.title,
        author: bookData.author,
        isbn: bookData.isbn,
        publisher: 'Penerbit Islam Nusantara',
        publishYear: 2020 + Math.floor(Math.random() * 4),
        language: 'Indonesia',
        pageCount: 200 + Math.floor(Math.random() * 500),
        shelfLocation: `${bookCategories[bookData.categoryIdx].code}-${String(Math.floor(Math.random() * 10) + 1).padStart(2, '0')}`,
        quantity: bookData.quantity,
        available: bookData.quantity - 1,
        description: `${bookData.title} karya ${bookData.author}`,
        status: BookStatus.AVAILABLE,
      },
    });
    books.push(book);
  }

  console.log('✅ Books created');

  // Create Borrowings
  const borrowingsData = [
    { studentIdx: 0, bookIdx: 0, daysAgo: 14, status: BorrowingStatus.RETURNED },
    { studentIdx: 1, bookIdx: 1, daysAgo: 7, status: BorrowingStatus.ACTIVE },
    { studentIdx: 2, bookIdx: 2, daysAgo: 21, status: BorrowingStatus.OVERDUE },
    { studentIdx: 0, bookIdx: 3, daysAgo: 3, status: BorrowingStatus.ACTIVE },
    { studentIdx: 3, bookIdx: 4, daysAgo: 10, status: BorrowingStatus.RETURNED },
  ];

  for (const borrow of borrowingsData) {
    const borrowedAt = new Date();
    borrowedAt.setDate(borrowedAt.getDate() - borrow.daysAgo);
    const dueDate = new Date(borrowedAt);
    dueDate.setDate(dueDate.getDate() + 14); // 2 weeks loan period

    await prisma.borrowing.create({
      data: {
        bookId: books[borrow.bookIdx].id,
        borrowerId: students[borrow.studentIdx].id,
        borrowerType: 'STUDENT',
        borrowedAt,
        dueDate,
        status: borrow.status,
        returnedAt: borrow.status === BorrowingStatus.RETURNED ? new Date() : undefined,
        lateFee: borrow.status === BorrowingStatus.OVERDUE ? new Prisma.Decimal(5000) : undefined,
        processedBy: teacherPesantrenUser.id,
      },
    });
  }

  console.log('✅ Borrowings created');

  // ============================================
  // PHASE 4: UKS (HEALTH / KESEHATAN)
  // ============================================

  // Create Medications
  const medicationsData = [
    {
      name: 'Paracetamol',
      genericName: 'Acetaminophen',
      type: 'tablet',
      dosageForm: '500mg',
      quantity: 100,
    },
    {
      name: 'Amoxicillin',
      genericName: 'Amoxicillin Trihydrate',
      type: 'kapsul',
      dosageForm: '500mg',
      quantity: 50,
    },
    {
      name: 'OBH Combi',
      genericName: 'Obat Batuk Hitam',
      type: 'sirup',
      dosageForm: '60ml',
      quantity: 20,
    },
    {
      name: 'Minyak Kayu Putih',
      genericName: 'Cajuput Oil',
      type: 'minyak',
      dosageForm: '30ml',
      quantity: 15,
    },
    {
      name: 'Betadine',
      genericName: 'Povidone-Iodine',
      type: 'cairan',
      dosageForm: '60ml',
      quantity: 10,
    },
    {
      name: 'Antangin JRG',
      genericName: 'Herbal',
      type: 'tablet',
      dosageForm: '1 strip',
      quantity: 30,
    },
  ];

  const medications = [];
  for (const med of medicationsData) {
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 2);

    const medication = await prisma.medication.create({
      data: {
        unitId: smpIt.id,
        name: med.name,
        genericName: med.genericName,
        type: med.type,
        dosageForm: med.dosageForm,
        quantity: med.quantity,
        minStock: 10,
        expiryDate,
        supplier: 'Apotek Sehat Jaya',
      },
    });
    medications.push(medication);
  }

  console.log('✅ Medications created');

  // Create Medical Records
  const medicalRecordsData = [
    {
      studentIdx: 0,
      type: MedicalRecordType.ILLNESS,
      complaint: 'Demam dan batuk',
      diagnosis: 'Flu',
      treatment: 'Istirahat dan minum obat',
    },
    {
      studentIdx: 1,
      type: MedicalRecordType.INJURY,
      complaint: 'Luka gores di lutut',
      diagnosis: 'Luka ringan',
      treatment: 'Dibersihkan dan dibalut',
    },
    {
      studentIdx: 2,
      type: MedicalRecordType.CHECKUP,
      complaint: 'Pemeriksaan rutin',
      diagnosis: 'Sehat',
      treatment: 'Tidak ada',
    },
    {
      studentIdx: 3,
      type: MedicalRecordType.FIRST_AID,
      complaint: 'Pusing dan lemas',
      diagnosis: 'Kelelahan',
      treatment: 'Istirahat dan minum air',
    },
    {
      studentIdx: 0,
      type: MedicalRecordType.REFERRAL,
      complaint: 'Sakit perut berkepanjangan',
      diagnosis: 'Perlu pemeriksaan lanjut',
      treatment: 'Dirujuk ke RS',
    },
  ];

  for (let i = 0; i < medicalRecordsData.length; i++) {
    const record = medicalRecordsData[i];
    const visitDate = new Date();
    visitDate.setDate(visitDate.getDate() - i * 3);

    await prisma.medicalRecord.create({
      data: {
        studentId: students[record.studentIdx].id,
        type: record.type,
        visitDate,
        complaint: record.complaint,
        diagnosis: record.diagnosis,
        treatment: record.treatment,
        prescription: record.type === MedicalRecordType.ILLNESS ? 'Paracetamol 3x1' : undefined,
        referredTo: record.type === MedicalRecordType.REFERRAL ? 'RS Sukabumi Medika' : undefined,
        recordedById: teacherPesantrenUser.id,
      },
    });
  }

  console.log('✅ Medical records created');

  // Create Medication Usage Logs
  for (let i = 0; i < 3; i++) {
    const givenAt = new Date();
    givenAt.setDate(givenAt.getDate() - i);

    await prisma.medicationUsageLog.create({
      data: {
        medicationId: medications[i].id,
        studentId: students[i].id,
        quantity: 2,
        reason: 'Pengobatan sakit ' + ['demam', 'batuk', 'flu'][i],
        givenById: teacherPesantrenUser.id,
        givenAt,
      },
    });
  }

  console.log('✅ Medication usage logs created');

  // ============================================
  // PHASE 4: INVENTARIS (INVENTORY)
  // ============================================

  // Create Asset Categories
  const assetCategoriesData = [
    { name: 'Mebel', code: 'MBL', description: 'Meja, kursi, lemari, dll' },
    { name: 'Elektronik', code: 'ELK', description: 'Komputer, AC, proyektor, dll' },
    { name: 'Kendaraan', code: 'KND', description: 'Mobil, motor, sepeda' },
    { name: 'Peralatan Dapur', code: 'DPR', description: 'Kompor, kulkas, peralatan masak' },
    { name: 'Alat Olahraga', code: 'OLR', description: 'Bola, matras, alat fitness' },
  ];

  const assetCategories = [];
  for (const cat of assetCategoriesData) {
    const category = await prisma.assetCategory.create({
      data: {
        name: cat.name,
        code: cat.code,
        description: cat.description,
      },
    });
    assetCategories.push(category);
  }

  console.log('✅ Asset categories created');

  // Create Assets
  const assetsData = [
    {
      name: 'Meja Guru',
      categoryIdx: 0,
      brand: 'Informa',
      price: 1500000,
      location: 'Ruang Guru',
      condition: AssetCondition.GOOD,
    },
    {
      name: 'Kursi Plastik',
      categoryIdx: 0,
      brand: 'Napoly',
      price: 150000,
      location: 'Ruang Kelas',
      condition: AssetCondition.FAIR,
    },
    {
      name: 'Proyektor Epson',
      categoryIdx: 1,
      brand: 'Epson',
      price: 8500000,
      location: 'Aula',
      condition: AssetCondition.EXCELLENT,
    },
    {
      name: 'AC Split 1 PK',
      categoryIdx: 1,
      brand: 'Daikin',
      price: 5000000,
      location: 'Ruang Kepala',
      condition: AssetCondition.GOOD,
    },
    {
      name: 'Komputer Desktop',
      categoryIdx: 1,
      brand: 'HP',
      price: 12000000,
      location: 'Lab Komputer',
      condition: AssetCondition.GOOD,
    },
    {
      name: 'Mobil Operasional',
      categoryIdx: 2,
      brand: 'Toyota Avanza',
      price: 200000000,
      location: 'Garasi',
      condition: AssetCondition.GOOD,
    },
    {
      name: 'Kulkas 2 Pintu',
      categoryIdx: 3,
      brand: 'Samsung',
      price: 7500000,
      location: 'Dapur',
      condition: AssetCondition.GOOD,
    },
    {
      name: 'Bola Sepak',
      categoryIdx: 4,
      brand: 'Mikasa',
      price: 350000,
      location: 'Gudang Olahraga',
      condition: AssetCondition.FAIR,
    },
  ];

  const assets = [];
  let assetCounter = 1;
  for (const assetData of assetsData) {
    const purchaseDate = new Date();
    purchaseDate.setFullYear(purchaseDate.getFullYear() - Math.floor(Math.random() * 3));

    const warrantyExpiry = new Date(purchaseDate);
    warrantyExpiry.setFullYear(warrantyExpiry.getFullYear() + 2);

    const asset = await prisma.asset.create({
      data: {
        unitId: smpIt.id,
        categoryId: assetCategories[assetData.categoryIdx].id,
        code: `INV-${assetCategories[assetData.categoryIdx].code}-${String(assetCounter++).padStart(4, '0')}`,
        name: assetData.name,
        brand: assetData.brand,
        purchaseDate,
        purchasePrice: new Prisma.Decimal(assetData.price),
        supplier: 'Supplier ' + assetData.brand,
        location: assetData.location,
        condition: assetData.condition,
        status: AssetStatus.ACTIVE,
        warrantyExpiry,
      },
    });
    assets.push(asset);
  }

  console.log('✅ Assets created');

  // Create Asset Maintenance Logs
  const maintenanceData = [
    {
      assetIdx: 2,
      type: 'servis',
      description: 'Pembersihan filter dan penggantian lampu',
      cost: 500000,
    },
    { assetIdx: 3, type: 'perbaikan', description: 'Pengisian freon AC', cost: 350000 },
    { assetIdx: 5, type: 'servis', description: 'Servis berkala 20.000 km', cost: 1500000 },
    { assetIdx: 4, type: 'penggantian', description: 'Upgrade RAM 8GB ke 16GB', cost: 800000 },
  ];

  for (let i = 0; i < maintenanceData.length; i++) {
    const maint = maintenanceData[i];
    const maintenanceDate = new Date();
    maintenanceDate.setDate(maintenanceDate.getDate() - i * 30);

    const nextSchedule = new Date(maintenanceDate);
    nextSchedule.setMonth(nextSchedule.getMonth() + 6);

    await prisma.assetMaintenance.create({
      data: {
        assetId: assets[maint.assetIdx].id,
        maintenanceDate,
        type: maint.type,
        description: maint.description,
        cost: new Prisma.Decimal(maint.cost),
        vendor: 'Jasa Teknik Sukabumi',
        performedBy: 'Teknisi Eksternal',
        nextSchedule,
      },
    });
  }

  console.log('✅ Asset maintenance logs created');

  // ============================================
  // PHASE 4: KOMUNIKASI (NOTIFICATIONS)
  // ============================================

  // Create Announcements
  const announcementsData = [
    {
      title: 'Libur Semester Ganjil',
      content:
        'Libur semester ganjil akan dilaksanakan pada tanggal 20 Desember 2024 s/d 5 Januari 2025.',
      priority: 2,
      targetRoles: ['STUDENT', 'PARENT', 'TEACHER'],
    },
    {
      title: 'Jadwal Ujian Akhir Semester',
      content:
        'Ujian Akhir Semester akan dilaksanakan pada tanggal 10-18 Desember 2024. Mohon persiapkan diri dengan baik.',
      priority: 1,
      targetRoles: ['STUDENT', 'PARENT'],
    },
    {
      title: 'Pembayaran SPP Bulan Desember',
      content: 'Batas akhir pembayaran SPP bulan Desember adalah tanggal 10 Desember 2024.',
      priority: 1,
      targetRoles: ['PARENT'],
    },
    {
      title: 'Kegiatan Maulid Nabi',
      content:
        'Peringatan Maulid Nabi Muhammad SAW akan diadakan pada tanggal 12 Rabiul Awal. Seluruh santri wajib hadir.',
      priority: 0,
      targetRoles: ['STUDENT', 'TEACHER', 'STAFF'],
    },
  ];

  for (let i = 0; i < announcementsData.length; i++) {
    const ann = announcementsData[i];
    const publishedAt = new Date();
    publishedAt.setDate(publishedAt.getDate() - i);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await prisma.announcement.create({
      data: {
        unitId: smpIt.id,
        title: ann.title,
        content: ann.content,
        type: NotificationType.ANNOUNCEMENT,
        priority: ann.priority,
        publishedAt,
        expiresAt,
        targetRoles: ann.targetRoles,
        createdById: teacherPesantrenUser.id,
      },
    });
  }

  console.log('✅ Announcements created');

  // Create Personal Notifications for students
  const notificationsData = [
    {
      title: 'Tagihan SPP',
      message: 'Tagihan SPP bulan Desember telah tersedia. Silakan lakukan pembayaran.',
      type: NotificationType.PAYMENT,
    },
    {
      title: 'Jadwal Tasmi',
      message: 'Jadwal tasmi Anda adalah hari Senin pukul 08:00.',
      type: NotificationType.REMINDER,
    },
    {
      title: 'Hasil Ujian',
      message: 'Hasil ujian Fiqih telah tersedia. Silakan cek di halaman akademik.',
      type: NotificationType.ACADEMIC,
    },
    {
      title: 'Peringatan Kehadiran',
      message: 'Kehadiran Anda di bawah 80%. Mohon tingkatkan kehadiran.',
      type: NotificationType.ALERT,
    },
  ];

  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const studentUser = await prisma.user.findUnique({ where: { id: student.userId } });
    if (!studentUser) continue;

    // Create 2 notifications per student
    for (let j = 0; j < 2; j++) {
      const notifData = notificationsData[(i + j) % notificationsData.length];
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - j);

      await prisma.notification.create({
        data: {
          userId: studentUser.id,
          type: notifData.type,
          title: notifData.title,
          message: notifData.message,
          status: j === 0 ? NotificationStatus.UNREAD : NotificationStatus.READ,
          readAt: j === 0 ? undefined : new Date(),
          createdAt,
        },
      });
    }
  }

  console.log('✅ Notifications created');

  // ============================================
  // PHASE 5: KURIKULUM (CURRICULUM)
  // ============================================

  // Create Subjects
  const subjectsData = [
    { code: 'MTK', name: 'Matematika', type: SubjectType.ACADEMIC, credits: 4 },
    { code: 'IPA', name: 'Ilmu Pengetahuan Alam', type: SubjectType.ACADEMIC, credits: 4 },
    { code: 'IPS', name: 'Ilmu Pengetahuan Sosial', type: SubjectType.ACADEMIC, credits: 3 },
    { code: 'BIN', name: 'Bahasa Indonesia', type: SubjectType.ACADEMIC, credits: 4 },
    { code: 'BIG', name: 'Bahasa Inggris', type: SubjectType.ACADEMIC, credits: 3 },
    { code: 'FIQ', name: 'Fiqih', type: SubjectType.RELIGIOUS, credits: 2 },
    { code: 'AQD', name: 'Aqidah Akhlak', type: SubjectType.RELIGIOUS, credits: 2 },
    { code: 'QHD', name: 'Quran Hadits', type: SubjectType.RELIGIOUS, credits: 2 },
    { code: 'SKI', name: 'Sejarah Kebudayaan Islam', type: SubjectType.RELIGIOUS, credits: 2 },
    { code: 'THF', name: 'Tahfidz Al-Quran', type: SubjectType.TAHFIDZ, credits: 4 },
    { code: 'ARB', name: 'Bahasa Arab', type: SubjectType.RELIGIOUS, credits: 3 },
    { code: 'PJK', name: 'Pendidikan Jasmani', type: SubjectType.EXTRACURRICULAR, credits: 2 },
  ];

  const subjects = [];
  for (const subj of subjectsData) {
    const subject = await prisma.subject.create({
      data: {
        unitId: smpIt.id,
        code: subj.code,
        name: subj.name,
        type: subj.type,
        credits: subj.credits,
        level: '7',
        isActive: true,
      },
    });
    subjects.push(subject);
  }

  console.log('✅ Subjects created');

  // Seed Kurikulum Merdeka Learning Outcomes (sekarang subjects sudah ada)
  await seedKurikulumMerdeka(prisma, smpIt.id, academicYear.id);

  // Assign teacher to subjects
  for (let i = 0; i < 4; i++) {
    await prisma.teacherSubject.create({
      data: {
        teacherId: teacherPesantren.id,
        subjectId: subjects[i].id,
        classId: class7A.id,
        isActive: true,
      },
    });
  }

  console.log('✅ Teacher subjects assigned');

  // Create Schedules
  const schedulesData = [
    { subjectIdx: 0, day: DayOfWeek.MONDAY, startTime: '07:30', endTime: '08:50' },
    { subjectIdx: 5, day: DayOfWeek.MONDAY, startTime: '09:00', endTime: '09:45' },
    { subjectIdx: 9, day: DayOfWeek.MONDAY, startTime: '10:00', endTime: '11:30' },
    { subjectIdx: 1, day: DayOfWeek.TUESDAY, startTime: '07:30', endTime: '08:50' },
    { subjectIdx: 6, day: DayOfWeek.TUESDAY, startTime: '09:00', endTime: '09:45' },
    { subjectIdx: 10, day: DayOfWeek.TUESDAY, startTime: '10:00', endTime: '11:30' },
    { subjectIdx: 2, day: DayOfWeek.WEDNESDAY, startTime: '07:30', endTime: '08:50' },
    { subjectIdx: 7, day: DayOfWeek.WEDNESDAY, startTime: '09:00', endTime: '09:45' },
    { subjectIdx: 3, day: DayOfWeek.THURSDAY, startTime: '07:30', endTime: '08:50' },
    { subjectIdx: 8, day: DayOfWeek.THURSDAY, startTime: '09:00', endTime: '09:45' },
    { subjectIdx: 4, day: DayOfWeek.FRIDAY, startTime: '07:30', endTime: '08:50' },
    { subjectIdx: 11, day: DayOfWeek.FRIDAY, startTime: '09:00', endTime: '10:30' },
  ];

  // The Guru SMP IT persona teaches one lesson in 7A without being its wali
  // kelas, so the demo has a teacher who takes a class's register by teaching
  // in it (2026-09-27: daily attendance is recorded by the wali kelas, a
  // teacher with a lesson in the class, or the unit's operator).
  const smpGuruPersona = await prisma.teacher.findFirst({
    where: { user: { email: 'smpit.guru@cipansor.or.id' }, deletedAt: null },
    select: { id: true },
  });
  const PERSONA_LESSON = 5; // Monday 09:00, subjects[5]
  if (smpGuruPersona) {
    await prisma.teacherSubject.create({
      data: {
        teacherId: smpGuruPersona.id,
        subjectId: subjects[PERSONA_LESSON].id,
        classId: class7A.id,
        isActive: true,
      },
    });
  }

  for (const sched of schedulesData) {
    await prisma.schedule.create({
      data: {
        unitId: smpIt.id,
        academicYearId: academicYear.id,
        classId: class7A.id,
        subjectId: subjects[sched.subjectIdx].id,
        teacherId:
          sched.subjectIdx === PERSONA_LESSON && smpGuruPersona
            ? smpGuruPersona.id
            : teacherPesantren.id,
        dayOfWeek: sched.day,
        startTime: sched.startTime,
        endTime: sched.endTime,
        room: 'Ruang 7A',
        isActive: true,
      },
    });
  }

  console.log('✅ Schedules created');

  // Create Lesson Plans
  const lessonPlansData = [
    {
      subjectIdx: 0,
      title: 'Bilangan Bulat',
      topic: 'Operasi Bilangan Bulat',
      objectives: 'Siswa dapat melakukan operasi penjumlahan dan pengurangan bilangan bulat',
    },
    {
      subjectIdx: 5,
      title: 'Thaharah',
      topic: 'Wudhu dan Tayamum',
      objectives: 'Siswa dapat memahami tata cara wudhu dan tayamum yang benar',
    },
    {
      subjectIdx: 9,
      title: 'Surah Al-Baqarah',
      topic: 'Hafalan Ayat 1-5',
      objectives: 'Siswa dapat menghafal Surah Al-Baqarah ayat 1-5 dengan tartil',
    },
  ];

  for (const lp of lessonPlansData) {
    const plannedDate = new Date();
    plannedDate.setDate(plannedDate.getDate() + lp.subjectIdx);

    await prisma.lessonPlan.create({
      data: {
        subjectId: subjects[lp.subjectIdx].id,
        teacherId: teacherPesantren.id,
        classId: class7A.id,
        title: lp.title,
        topic: lp.topic,
        objectives: lp.objectives,
        materials: 'Buku paket, LKS, papan tulis',
        activities: 'Pembukaan, materi inti, latihan soal, penutup',
        assessment: 'Tes tertulis dan praktik',
        duration: 90,
        plannedDate,
      },
    });
  }

  console.log('✅ Lesson plans created');

  // ============================================
  // PHASE 5: PENILAIAN (ASSESSMENT)
  // ============================================

  // Create Exams
  const examsData = [
    {
      subjectIdx: 0,
      type: ExamType.DAILY_TEST,
      title: 'Ulangan Harian 1 - Bilangan Bulat',
      maxScore: 100,
      passingScore: 70,
    },
    {
      subjectIdx: 0,
      type: ExamType.MIDTERM,
      title: 'UTS Matematika',
      maxScore: 100,
      passingScore: 70,
    },
    {
      subjectIdx: 5,
      type: ExamType.DAILY_TEST,
      title: 'Ulangan Harian Fiqih - Thaharah',
      maxScore: 100,
      passingScore: 75,
    },
    {
      subjectIdx: 9,
      type: ExamType.TAHFIDZ_TEST,
      title: 'Ujian Tahfidz - Juz 30',
      maxScore: 100,
      passingScore: 80,
    },
  ];

  const exams = [];
  for (let i = 0; i < examsData.length; i++) {
    const examData = examsData[i];
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() - (10 - i * 3));

    const exam = await prisma.exam.create({
      data: {
        unitId: smpIt.id,
        academicYearId: academicYear.id,
        subjectId: subjects[examData.subjectIdx].id,
        classId: class7A.id,
        teacherId: teacherPesantren.id,
        type: examData.type,
        title: examData.title,
        description: `${examData.title} untuk kelas 7A`,
        scheduledAt,
        duration: 60,
        maxScore: new Prisma.Decimal(examData.maxScore),
        passingScore: new Prisma.Decimal(examData.passingScore),
        weight: new Prisma.Decimal(1),
        status: ExamStatus.GRADED,
      },
    });
    exams.push(exam);
  }

  console.log('✅ Exams created');

  // Create Grades for students
  const gradeScores = [85, 78, 92, 88, 75];

  for (let examIdx = 0; examIdx < exams.length; examIdx++) {
    const exam = exams[examIdx];
    for (let studentIdx = 0; studentIdx < students.length; studentIdx++) {
      const student = students[studentIdx];
      const score =
        gradeScores[(studentIdx + examIdx) % gradeScores.length] + (Math.random() * 10 - 5);
      const percentage = score;
      const letterGrade =
        percentage >= 90
          ? 'A'
          : percentage >= 80
            ? 'B'
            : percentage >= 70
              ? 'C'
              : percentage >= 60
                ? 'D'
                : 'E';

      await prisma.grade.create({
        data: {
          studentId: student.id,
          subjectId: exam.subjectId,
          examId: exam.id,
          academicYearId: academicYear.id,
          type: exam.type === ExamType.TAHFIDZ_TEST ? GradeType.TAHFIDZ : GradeType.EXAM,
          score: new Prisma.Decimal(score),
          maxScore: new Prisma.Decimal(100),
          percentage: new Prisma.Decimal(percentage),
          letterGrade,
          gradedById: teacherPesantrenUser.id,
        },
      });
    }
  }

  console.log('✅ Grades created');

  // Create Report Cards
  for (const student of students.slice(0, 3)) {
    const reportCard = await prisma.reportCard.create({
      data: {
        studentId: student.id,
        classId: class7A.id,
        academicYearId: academicYear.id,
        semester: 1,
        averageScore: new Prisma.Decimal(82.5 + Math.random() * 10),
        rank: students.indexOf(student) + 1,
        totalStudents: students.length,
        attendance: { present: 45, absent: 2, sick: 3, excused: 0 },
        tahfidzSummary: { lastJuz: 30, lastSurah: 'An-Nas', totalAyah: 100 },
        teacherNotes: 'Santri yang rajin dan tekun dalam belajar',
        isPublished: false,
      },
    });

    // Add report card details
    for (let i = 0; i < 5; i++) {
      await prisma.reportCardDetail.create({
        data: {
          reportCardId: reportCard.id,
          subjectName: subjects[i].name,
          dailyScore: new Prisma.Decimal(75 + Math.random() * 20),
          midtermScore: new Prisma.Decimal(70 + Math.random() * 25),
          finalScore: new Prisma.Decimal(75 + Math.random() * 20),
          averageScore: new Prisma.Decimal(75 + Math.random() * 15),
          letterGrade: 'B',
          description: 'Capaian pembelajaran baik',
        },
      });
    }
  }

  console.log('✅ Report cards created');

  // ============================================
  // PHASE 6: ALUMNI & ANALYTICS
  // ============================================

  // Create Alumni (graduates from past years)
  const alumniData = [
    {
      name: 'Ahmad Zaki Rahman',
      gender: Gender.MALE,
      graduationYear: 2020,
      email: 'ahmad.zaki@gmail.com',
      phone: '081200000001',
      notes: 'Alumni angkatan 2020 yang sukses di bidang IT',
      lastClass: 'XII IPA 1',
      tahfidzLevel: '30 Juz',
      city: 'Jakarta',
      province: 'DKI Jakarta',
    },
    {
      name: 'Siti Maryam Azzahra',
      gender: Gender.FEMALE,
      graduationYear: 2020,
      email: 'maryam.azzahra@gmail.com',
      phone: '081200000002',
      notes: 'Pengajar tahfidz di pesantren',
      lastClass: 'XII IPA 1',
      tahfidzLevel: '30 Juz',
      city: 'Bogor',
      province: 'Jawa Barat',
    },
    {
      name: 'Muhammad Firdaus',
      gender: Gender.MALE,
      graduationYear: 2021,
      email: 'firdaus.dokter@gmail.com',
      phone: '081200000003',
      notes: 'Dokter umum dan alumni berprestasi',
      lastClass: 'XII IPA 1',
      tahfidzLevel: '20 Juz',
      city: 'Jakarta',
      province: 'DKI Jakarta',
    },
    {
      name: 'Fatimah Nur Rahma',
      gender: Gender.FEMALE,
      graduationYear: 2021,
      email: 'fatimah.rahma@gmail.com',
      phone: '081200000004',
      notes: 'Pengusaha muda di bidang fashion muslim',
      lastClass: 'XII IPA 1',
      tahfidzLevel: '15 Juz',
      city: 'Bandung',
      province: 'Jawa Barat',
    },
    {
      name: 'Abdullah Hasan',
      gender: Gender.MALE,
      graduationYear: 2022,
      email: 'abdullah.hasan@gmail.com',
      phone: '081200000005',
      notes: 'Imam dan guru tahfidz',
      lastClass: 'XII IPA 1',
      tahfidzLevel: '30 Juz',
      city: 'Sukabumi',
      province: 'Jawa Barat',
    },
    {
      name: 'Aisyah Putri Dewi',
      gender: Gender.FEMALE,
      graduationYear: 2022,
      email: 'aisyah.dewi@gmail.com',
      phone: '081200000006',
      notes: 'Guru Bahasa Indonesia',
      lastClass: 'XII IPS 1',
      tahfidzLevel: '10 Juz',
      city: 'Sukabumi',
      province: 'Jawa Barat',
    },
    {
      name: 'Umar Faruk',
      gender: Gender.MALE,
      graduationYear: 2023,
      email: 'umar.faruk@gmail.com',
      phone: '081200000007',
      notes: 'Fresh graduate, sedang mencari pekerjaan',
      lastClass: 'XII IPA 1',
      tahfidzLevel: '25 Juz',
      city: 'Sukabumi',
      province: 'Jawa Barat',
    },
    {
      name: 'Khadijah Salsabila',
      gender: Gender.FEMALE,
      graduationYear: 2023,
      email: 'khadijah.sabil@gmail.com',
      phone: '081200000008',
      notes: 'Mahasiswa Fakultas Ekonomi UI',
      lastClass: 'XII IPS 1',
      tahfidzLevel: '15 Juz',
      city: 'Depok',
      province: 'Jawa Barat',
    },
  ];

  const alumni = [];
  for (let idx = 0; idx < alumniData.length; idx++) {
    const data = alumniData[idx];
    const alum = await prisma.alumni.create({
      data: {
        unitId: smpIt.id,
        registrationNo: `ALM-${data.graduationYear}-${String(idx + 1).padStart(4, '0')}`,
        name: data.name,
        gender: data.gender,
        graduationYear: data.graduationYear,
        phone: data.phone,
        email: data.email,
        address: 'Jl. Sukabumi Raya No. ' + (idx + 1),
        city: data.city,
        province: data.province,
        lastClass: data.lastClass,
        tahfidzLevel: data.tahfidzLevel,
        status: idx < 6 ? AlumniStatus.ACTIVE : AlumniStatus.INACTIVE,
        notes: data.notes,
      },
    });
    alumni.push(alum);
  }

  console.log('✅ Alumni created');

  // Create Alumni Careers
  const careerHistory = [
    {
      alumniIdx: 0,
      careers: [
        {
          company: 'PT Startup Indonesia',
          position: 'Junior Developer',
          startDate: new Date('2020-07-01'),
          endDate: new Date('2022-06-30'),
          isCurrent: false,
        },
        {
          company: 'PT Telkom Indonesia',
          position: 'Software Engineer',
          startDate: new Date('2022-07-01'),
          endDate: null,
          isCurrent: true,
        },
      ],
    },
    {
      alumniIdx: 2,
      careers: [
        {
          company: 'RSUD Sukabumi',
          position: 'Dokter Muda',
          startDate: new Date('2021-06-01'),
          endDate: new Date('2023-05-31'),
          isCurrent: false,
        },
        {
          company: 'RS Islam Jakarta',
          position: 'Dokter',
          startDate: new Date('2023-06-01'),
          endDate: null,
          isCurrent: true,
        },
      ],
    },
    {
      alumniIdx: 3,
      careers: [
        {
          company: 'CV Berkah Jaya',
          position: 'Founder',
          startDate: new Date('2022-01-01'),
          endDate: null,
          isCurrent: true,
        },
      ],
    },
  ];

  let totalCareers = 0;
  for (const hist of careerHistory) {
    for (const career of hist.careers) {
      await prisma.alumniCareer.create({
        data: {
          alumniId: alumni[hist.alumniIdx].id,
          company: career.company,
          position: career.position,
          startDate: career.startDate,
          endDate: career.endDate,
          isCurrent: career.isCurrent,
          description: `Bekerja sebagai ${career.position} di ${career.company}`,
        },
      });
      totalCareers++;
    }
  }

  console.log('✅ Alumni careers created');

  // Create Alumni Education
  const educationHistory = [
    {
      alumniIdx: 0,
      education: [
        {
          institution: 'Universitas Indonesia',
          degree: 'S1',
          field: 'Teknik Informatika',
          startYear: 2020,
          endYear: 2024,
        },
      ],
    },
    {
      alumniIdx: 2,
      education: [
        {
          institution: 'Universitas Airlangga',
          degree: 'S1',
          field: 'Kedokteran Umum',
          startYear: 2021,
          endYear: 2027,
        },
      ],
    },
    {
      alumniIdx: 7,
      education: [
        {
          institution: 'Universitas Indonesia',
          degree: 'S1',
          field: 'Ekonomi',
          startYear: 2023,
          endYear: null,
        },
      ],
    },
  ];

  let totalEducation = 0;
  for (const hist of educationHistory) {
    for (const edu of hist.education) {
      await prisma.alumniEducation.create({
        data: {
          alumniId: alumni[hist.alumniIdx].id,
          institution: edu.institution,
          degree: edu.degree,
          field: edu.field,
          startYear: edu.startYear,
          endYear: edu.endYear,
          isCompleted: edu.endYear !== null,
        },
      });
      totalEducation++;
    }
  }

  console.log('✅ Alumni education created');

  // Create Alumni Donations
  const donationsData = [
    {
      alumniIdx: 0,
      type: DonationType.MONETARY,
      amount: 5000000,
      description: 'Donasi pembangunan musholla',
    },
    {
      alumniIdx: 2,
      type: DonationType.MONETARY,
      amount: 10000000,
      description: 'Donasi beasiswa santri kurang mampu',
    },
    {
      alumniIdx: 3,
      type: DonationType.GOODS,
      amount: 2000000,
      description: 'Sumbangan buku pelajaran',
    },
    {
      alumniIdx: 4,
      type: DonationType.SERVICE,
      amount: 0,
      description: 'Mengajar tahfidz selama 1 bulan',
    },
    { alumniIdx: 0, type: DonationType.MONETARY, amount: 3000000, description: 'Donasi Ramadhan' },
    {
      alumniIdx: 2,
      type: DonationType.MONETARY,
      amount: 5000000,
      description: 'Donasi kurban',
      isAnonymous: true,
    },
  ];

  for (let idx = 0; idx < donationsData.length; idx++) {
    const don = donationsData[idx];
    await prisma.alumniDonation.create({
      data: {
        alumniId: alumni[don.alumniIdx].id,
        unitId: smpIt.id,
        type: don.type,
        amount: don.amount ? new Prisma.Decimal(don.amount) : null,
        description: don.description,
        donatedAt: new Date(2024, idx, 15),
        receiptNo: `DON-2024-${String(idx + 1).padStart(4, '0')}`,
        isAnonymous: don.isAnonymous || false,
      },
    });
  }

  console.log('✅ Alumni donations created');

  // Create Alumni Events
  const eventsData = [
    {
      type: AlumniEventType.REUNION,
      name: 'Reuni Akbar Alumni 2024',
      description: 'Reuni tahunan seluruh alumni Pondok Pesantren Al-Hikmah',
      eventDate: new Date('2024-08-17'),
      location: 'Aula Utama PP Al-Hikmah',
      capacity: 500,
      status: 'completed',
    },
    {
      type: AlumniEventType.CHARITY,
      name: 'Bakti Sosial Alumni',
      description: 'Kegiatan bakti sosial alumni untuk masyarakat sekitar',
      eventDate: new Date('2024-12-15'),
      location: 'Desa Cipansor',
      capacity: 100,
      status: 'upcoming',
    },
    {
      type: AlumniEventType.SEMINAR,
      name: 'Seminar Karir untuk Santri',
      description: 'Sharing session dari alumni sukses untuk santri',
      eventDate: new Date('2025-01-20'),
      location: 'Gedung Serba Guna',
      capacity: 200,
      status: 'upcoming',
    },
    {
      type: AlumniEventType.GATHERING,
      name: 'Halal Bihalal Alumni 1445 H',
      description: 'Silaturahmi pasca lebaran',
      eventDate: new Date('2024-04-28'),
      location: 'Masjid PP Al-Hikmah',
      capacity: 300,
      status: 'completed',
    },
  ];

  const events = [];
  for (let idx = 0; idx < eventsData.length; idx++) {
    const evt = eventsData[idx];
    const event = await prisma.alumniEvent.create({
      data: {
        unitId: smpIt.id,
        type: evt.type,
        name: evt.name,
        description: evt.description,
        eventDate: evt.eventDate,
        location: evt.location,
        capacity: evt.capacity,
        status: evt.status,
        isPublic: true,
      },
    });
    events.push(event);
  }

  console.log('✅ Alumni events created');

  // Create Alumni Event Attendees
  const attendeeData = [
    { eventIdx: 0, alumniIdxs: [0, 1, 2, 3, 4, 5], status: 'attended' },
    { eventIdx: 1, alumniIdxs: [0, 2, 4], status: 'registered' },
    { eventIdx: 2, alumniIdxs: [0, 1, 2, 3], status: 'registered' },
    { eventIdx: 3, alumniIdxs: [0, 1, 2, 3, 4, 5, 6, 7], status: 'attended' },
  ];

  let totalAttendees = 0;
  for (const att of attendeeData) {
    for (const alumniIdx of att.alumniIdxs) {
      await prisma.alumniEventAttendee.create({
        data: {
          eventId: events[att.eventIdx].id,
          alumniId: alumni[alumniIdx].id,
          status: att.status,
          attendedAt: att.status === 'attended' ? events[att.eventIdx].eventDate : null,
        },
      });
      totalAttendees++;
    }
  }

  console.log('✅ Alumni event attendees created');

  // ============================================
  // SEED SUMMARY
  // ============================================

  console.log('\n📊 Seed Summary:');
  console.log(`   Foundation: 1`);
  console.log(`   Board Members: ${YAYASAN_ORGANS.flatMap((g) => g.holders).length}`);
  console.log(`   Units: 4`);
  console.log(`   Roles: 24`);
  console.log(`   Users: ${students.length + 15 + staffData.length + 1}`); // +1 for System User
  console.log(`   Staff: ${staffData.length}`);
  console.log(`   Students: ${students.length}`);
  console.log(`   Classes: 2`);
  console.log(`   Enrollments: 2`);
  console.log(`   Attendance: ${students.length}`);
  console.log(`   Tahfidz: 3`);
  console.log(`   Dormitories: 2`);
  console.log(`   Rooms: 9`);
  console.log(`   Room Assignments: ${students.length}`);
  console.log(`   Permits: 4`);
  console.log(`   Violations: 4`);
  console.log(`   Rewards: 4`);
  console.log(`   Payment Types: ${paymentTypesData.length}`);
  console.log(`   Invoices: 9`);
  console.log(`   Payments: 6`);
  console.log(`   Staff Attendance: ${staffData.length * 7}`);
  console.log(`   Leave Requests: ${leaveData.length}`);
  console.log(`   Admission Periods: 1 (SMP IT, ${admissionPeriod.waves.length} waves)`);
  console.log(`   Registrants: ${registrantData.length}`);
  console.log(`   Book Categories: ${bookCategoriesData.length}`);
  console.log(`   Books: ${booksData.length}`);
  console.log(`   Borrowings: ${borrowingsData.length}`);
  console.log(`   Medications: ${medicationsData.length}`);
  console.log(`   Medical Records: ${medicalRecordsData.length}`);
  console.log(`   Medication Usages: 3`);
  console.log(`   Asset Categories: ${assetCategoriesData.length}`);
  console.log(`   Assets: ${assetsData.length}`);
  console.log(`   Asset Maintenance: ${maintenanceData.length}`);
  console.log(`   Announcements: ${announcementsData.length}`);
  console.log(`   Notifications: ${students.length * 2}`);
  console.log(`   Subjects: ${subjectsData.length}`);
  console.log(`   Teacher Subjects: 4`);
  console.log(`   Schedules: ${schedulesData.length}`);
  console.log(`   Lesson Plans: ${lessonPlansData.length}`);
  console.log(`   Exams: ${examsData.length}`);
  console.log(`   Grades: ${examsData.length * students.length}`);
  console.log(`   Report Cards: 3`);
  console.log(`   Alumni: ${alumniData.length}`);
  console.log(`   Alumni Careers: ${totalCareers}`);
  console.log(`   Alumni Education: ${totalEducation}`);
  console.log(`   Alumni Donations: ${donationsData.length}`);
  console.log(`   Alumni Events: ${eventsData.length}`);
  console.log(`   Event Attendees: ${totalAttendees}`);

  console.log('\n🔑 Login Credentials:');
  console.log('\n   === SUPER ADMIN (GLOBAL) ===');
  console.log('   Super Admin: superadmin@cipansor.or.id / SuperAdmin123!');

  console.log('\n   === YAYASAN ===');
  console.log('   The yayasan.*@ demo accounts (DEMO_ACCOUNTS) / the shared demo password');

  // No PAUD block is printed here on purpose. It used to advertise
  // admin@paud.sch.id / Admin123! and student4@paud.sch.id / Student123! —
  // credentials for accounts this seed does not create. Printing a login that
  // does not exist sends whoever trusts the output hunting for a fault in the
  // login page. TK Qur'an children hold no accounts at all.

  console.log('\n   === SD IT ===');
  console.log('   Admin SD IT: admin.sdit@cipansor.or.id / Admin123!');
  console.log('   Kepala Sekolah SD IT: kepala.sdit@cipansor.or.id / Kepala123!');
  console.log('   Guru SD IT: fatimah@cipansor.or.id / Teacher123!');
  console.log('   Orang Tua SD IT: parent3@cipansor.or.id / Parent123!');
  console.log('   Siswa SD IT: student3@cipansor.or.id / Student123!');

  console.log('\n   === SMP IT ===');
  console.log('   Admin SMP IT: admin.smpit@cipansor.or.id / Admin123!');
  console.log('   Kepala Sekolah SMP IT: kepala.smpit@cipansor.or.id / Kepala123!');
  console.log('   Guru SMP IT: ahmad@cipansor.or.id / Teacher123!');
  console.log('   Orang Tua SMP IT: parent1@cipansor.or.id / Parent123!');
  console.log('   Siswa SMP IT: student1@cipansor.or.id / Student123!');

  console.log("\n   === SMA AL-QUR'AN ===");
  console.log("   Admin SMA Al-Qur'an: admin@cipansor.or.id / Admin123!");
  console.log("   Siswa SMA Al-Qur'an: student5@cipansor.or.id / Student123!");

  // ============================================
  // PHASE 9: PAUD Enhancement Seeds
  // ============================================
  await seedPAUDIndicators(prisma);
  await seedImmunizationReference(prisma);
  await seedBehavioralValues();

  // ============================================
  // PHASE 10: Demo Data Enhancements (Canteen, Laundry, Meals, Kitab Progress, etc.)
  // ============================================
  console.log('🌱 Seeding Phase 10 demo data enhancements...');

  // 1. KitabKuning
  const iqraBooks = [
    {
      title: 'Iqra Jilid 1',
      author: "KH. As'ad Humam",
      category: KitabCategory.OTHER,
      level: KitabLevel.PEMULA,
      totalPages: 32,
    },
    {
      title: 'Iqra Jilid 2',
      author: "KH. As'ad Humam",
      category: KitabCategory.OTHER,
      level: KitabLevel.PEMULA,
      totalPages: 32,
    },
    {
      title: 'Iqra Jilid 3',
      author: "KH. As'ad Humam",
      category: KitabCategory.OTHER,
      level: KitabLevel.PEMULA,
      totalPages: 32,
    },
    {
      title: 'Iqra Jilid 4',
      author: "KH. As'ad Humam",
      category: KitabCategory.OTHER,
      level: KitabLevel.PEMULA,
      totalPages: 32,
    },
    {
      title: 'Iqra Jilid 5',
      author: "KH. As'ad Humam",
      category: KitabCategory.OTHER,
      level: KitabLevel.PEMULA,
      totalPages: 32,
    },
    {
      title: 'Iqra Jilid 6',
      author: "KH. As'ad Humam",
      category: KitabCategory.OTHER,
      level: KitabLevel.PEMULA,
      totalPages: 32,
    },
    {
      title: 'Safinatun Najah',
      author: 'Syekh Salim bin Samir Al-Hadhrami',
      category: KitabCategory.FIQH,
      level: KitabLevel.PEMULA,
      totalPages: 96,
    },
    {
      title: 'Al-Ajurrumiyyah',
      author: 'Ibnu Ajurrum',
      category: KitabCategory.NAHWU,
      level: KitabLevel.DASAR,
      totalPages: 64,
    },
    {
      title: 'Riyadhus Shalihin',
      author: 'Imam An-Nawawi',
      category: KitabCategory.HADITS,
      level: KitabLevel.MENENGAH,
      totalPages: 450,
    },
  ];

  const createdKitabs = [];
  for (const book of iqraBooks) {
    const k = await prisma.kitabKuning.create({
      data: {
        title: book.title,
        author: book.author,
        category: book.category,
        level: book.level,
        totalPages: book.totalPages,
        description: `Buku panduan pembelajaran: ${book.title}`,
        isActive: true,
      },
    });
    createdKitabs.push(k);
  }
  console.log('   ✅ KitabKuning created');

  // KitabProgress (for first 3 students)
  if (students.length >= 3 && createdKitabs.length >= 8) {
    await prisma.kitabProgress.create({
      data: {
        kitabId: createdKitabs[0].id,
        studentId: students[0].id,
        teacherId: teacherPesantren.id,
        currentPage: 32,
        currentBab: 1,
        completedAt: new Date(),
        grade: 'Mumtaz',
        notes: 'Selesai membaca Jilid 1 dengan sangat lancar',
        academicYearId: academicYear.id,
      },
    });

    await prisma.kitabProgress.create({
      data: {
        kitabId: createdKitabs[7].id,
        studentId: students[1].id,
        teacherId: teacherPesantren.id,
        currentPage: 12,
        currentBab: 2,
        notes: 'Sedang menghafal bab Kalam',
        academicYearId: academicYear.id,
      },
    });

    await prisma.kitabProgress.create({
      data: {
        kitabId: createdKitabs[6].id,
        studentId: students[2].id,
        teacherId: teacherPesantren.id,
        currentPage: 25,
        currentBab: 3,
        notes: 'Mempelajari rukun wudhu',
        academicYearId: academicYear.id,
      },
    });
  }
  console.log('   ✅ KitabProgress records created');

  // 2. Business Units & Canteen
  const canteenBU = await prisma.businessUnit.create({
    data: {
      unitId: smpIt.id,
      name: 'Koperasi & Kantin Pesantren',
      code: 'KOP-01',
      type: BusinessUnitType.CANTEEN,
      description: 'Unit usaha koperasi dan kantin SMP IT Al-Hikmah',
      isActive: true,
    },
  });

  const laundryBU = await prisma.businessUnit.create({
    data: {
      unitId: smpIt.id,
      name: 'Jasa Laundry Al-Hikmah',
      code: 'LDR-01',
      type: BusinessUnitType.LAUNDRY,
      description: 'Layanan laundry pakaian santri',
      isActive: true,
    },
  });
  console.log('   ✅ BusinessUnits created');

  const foodCategory = await prisma.canteenCategory.create({
    data: {
      unitId: smpIt.id,
      businessUnitId: canteenBU.id,
      name: 'Makanan',
      description: 'Makanan berat dan ringan',
      isActive: true,
    },
  });

  const drinkCategory = await prisma.canteenCategory.create({
    data: {
      unitId: smpIt.id,
      businessUnitId: canteenBU.id,
      name: 'Minuman',
      description: 'Aneka minuman dingin dan hangat',
      isActive: true,
    },
  });

  const stationeryCategory = await prisma.canteenCategory.create({
    data: {
      unitId: smpIt.id,
      businessUnitId: canteenBU.id,
      name: 'Alat Tulis',
      description: 'Buku, pensil, bolpoin, dll',
      isActive: true,
    },
  });
  console.log('   ✅ Canteen categories created');

  const nasgor = await prisma.canteenItem.create({
    data: {
      unitId: smpIt.id,
      businessUnitId: canteenBU.id,
      categoryId: foodCategory.id,
      code: 'CNT-001',
      name: 'Nasi Goreng Spesial',
      price: new Prisma.Decimal(12000),
      costPrice: new Prisma.Decimal(8000),
      stock: 50,
      unit: 'porsi',
      isAvailable: true,
    },
  });

  const esteh = await prisma.canteenItem.create({
    data: {
      unitId: smpIt.id,
      businessUnitId: canteenBU.id,
      categoryId: drinkCategory.id,
      code: 'CNT-002',
      name: 'Es Teh Manis',
      price: new Prisma.Decimal(3000),
      costPrice: new Prisma.Decimal(1500),
      stock: 100,
      unit: 'gelas',
      isAvailable: true,
    },
  });

  const bukutulis = await prisma.canteenItem.create({
    data: {
      unitId: smpIt.id,
      businessUnitId: canteenBU.id,
      categoryId: stationeryCategory.id,
      code: 'CNT-003',
      name: 'Buku Tulis Sinar Dunia 38 Lembar',
      price: new Prisma.Decimal(4000),
      costPrice: new Prisma.Decimal(3200),
      stock: 200,
      unit: 'pcs',
      isAvailable: true,
    },
  });
  console.log('   ✅ Canteen items created');

  // Canteen Transactions
  if (students.length > 0) {
    const canteenTx1 = await prisma.canteenTransaction.create({
      data: {
        unitId: smpIt.id,
        businessUnitId: canteenBU.id,
        transactionNo: `CNT-20260630-0001`,
        studentId: students[0].id,
        subtotal: new Prisma.Decimal(15000),
        total: new Prisma.Decimal(15000),
        paymentMethod: 'WALLET',
        status: 'COMPLETED',
        cashierId: teacherPesantrenUser.id,
        notes: 'Belanja makan malam santri',
      },
    });

    await prisma.canteenTransactionItem.create({
      data: {
        transactionId: canteenTx1.id,
        itemId: nasgor.id,
        itemName: nasgor.name,
        quantity: 1,
        unitPrice: nasgor.price,
        subtotal: nasgor.price,
        total: nasgor.price,
      },
    });

    await prisma.canteenTransactionItem.create({
      data: {
        transactionId: canteenTx1.id,
        itemId: esteh.id,
        itemName: esteh.name,
        quantity: 1,
        unitPrice: esteh.price,
        subtotal: esteh.price,
        total: esteh.price,
      },
    });

    const canteenTx2 = await prisma.canteenTransaction.create({
      data: {
        unitId: smpIt.id,
        businessUnitId: canteenBU.id,
        transactionNo: `CNT-20260630-0002`,
        studentId: students[1].id,
        subtotal: new Prisma.Decimal(8000),
        total: new Prisma.Decimal(8000),
        paymentMethod: 'CASH',
        status: 'COMPLETED',
        cashierId: teacherPesantrenUser.id,
        notes: 'Membeli alat tulis',
      },
    });

    await prisma.canteenTransactionItem.create({
      data: {
        transactionId: canteenTx2.id,
        itemId: bukutulis.id,
        itemName: bukutulis.name,
        quantity: 2,
        unitPrice: bukutulis.price,
        subtotal: new Prisma.Decimal(8000),
        total: new Prisma.Decimal(8000),
      },
    });
  }
  console.log('   ✅ Canteen transactions created');

  // 3. Laundry
  const regulerPricing = await prisma.laundryPricing.create({
    data: {
      unitId: smpIt.id,
      businessUnitId: laundryBU.id,
      name: 'Cuci Setrika Reguler',
      pricePerKg: new Prisma.Decimal(6000),
      minWeight: new Prisma.Decimal(1),
      processDays: 2,
      isExpress: false,
    },
  });

  const expressPricing = await prisma.laundryPricing.create({
    data: {
      unitId: smpIt.id,
      businessUnitId: laundryBU.id,
      name: 'Cuci Setrika Express',
      pricePerKg: new Prisma.Decimal(10000),
      minWeight: new Prisma.Decimal(1),
      processDays: 1,
      isExpress: true,
    },
  });
  console.log('   ✅ Laundry pricing tiers created');

  if (students.length > 0) {
    const laundryTx1 = await prisma.laundryTransaction.create({
      data: {
        unitId: smpIt.id,
        businessUnitId: laundryBU.id,
        transactionNo: `LDR-20260630-0001`,
        studentId: students[0].id,
        pricingId: regulerPricing.id,
        weight: new Prisma.Decimal(3.5),
        pricePerKg: regulerPricing.pricePerKg,
        subtotal: new Prisma.Decimal(21000),
        total: new Prisma.Decimal(21000),
        paymentMethod: 'WALLET',
        paymentStatus: 'PAID',
        status: 'READY',
        estimatedAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        receivedById: teacherPesantrenUser.id,
        notes: 'Pakaian seragam dan kaos',
      },
    });

    await prisma.laundryItem.create({
      data: {
        transactionId: laundryTx1.id,
        itemType: 'Seragam Sekolah',
        quantity: 3,
        notes: 'Warna putih jgn dicampur',
      },
    });

    await prisma.laundryItem.create({
      data: {
        transactionId: laundryTx1.id,
        itemType: 'Celana Panjang',
        quantity: 2,
      },
    });
  }
  console.log('   ✅ Laundry transactions created');

  // 4. Meals (Konsumsi)
  const menuDate1 = new Date();
  const menuDate2 = new Date();
  menuDate2.setDate(menuDate2.getDate() - 1);

  const breakfastMenu = await prisma.mealMenu.create({
    data: {
      unitId: smpIt.id,
      date: menuDate1,
      mealType: MealType.BREAKFAST,
      mainDish: 'Nasi Kuning',
      sideDish: 'Telur Balado, Orek Tempe',
      drink: 'Teh Hangat',
      calories: 450,
      createdById: teacherPesantrenUser.id,
    },
  });

  const lunchMenu = await prisma.mealMenu.create({
    data: {
      unitId: smpIt.id,
      date: menuDate1,
      mealType: MealType.LUNCH,
      mainDish: 'Nasi Putih',
      sideDish: 'Ayam Goreng Lengkuas',
      vegetable: 'Sayur Asem',
      dessert: 'Semangka',
      drink: 'Air Putih',
      calories: 650,
      createdById: teacherPesantrenUser.id,
    },
  });

  const dinnerMenu = await prisma.mealMenu.create({
    data: {
      unitId: smpIt.id,
      date: menuDate1,
      mealType: MealType.DINNER,
      mainDish: 'Nasi Putih',
      sideDish: 'Lele Goreng Kremes',
      vegetable: 'Lalapan & Sambal',
      drink: 'Air Putih',
      calories: 600,
      createdById: teacherPesantrenUser.id,
    },
  });
  console.log('   ✅ Meal menus created');

  if (students.length > 0) {
    await prisma.mealAttendance.create({
      data: {
        menuId: breakfastMenu.id,
        studentId: students[0].id,
        status: MealAttendanceStatus.PRESENT,
        portions: 1,
        recordedById: teacherPesantrenUser.id,
      },
    });

    await prisma.mealAttendance.create({
      data: {
        menuId: lunchMenu.id,
        studentId: students[0].id,
        status: MealAttendanceStatus.PRESENT,
        portions: 1,
        recordedById: teacherPesantrenUser.id,
      },
    });

    await prisma.mealAttendance.create({
      data: {
        menuId: dinnerMenu.id,
        studentId: students[0].id,
        status: MealAttendanceStatus.SICK,
        portions: 1,
        notes: 'Santri demam, porsi diantar ke kamar asrama',
        recordedById: teacherPesantrenUser.id,
      },
    });
  }
  console.log('   ✅ Meal attendances created');

  // 5. Extracurriculars — the brochure's, as production gets them
  // (seeds/ekskul-2027-2028.ts); two of SMP IT's then get a demo schedule,
  // coach and members.
  await loadBrochureExtracurriculars(prisma);
  const brochureEkskul = (code: string) =>
    prisma.extracurricular.findFirstOrThrow({ where: { unitId: smpIt.id, code } });
  const scout = await prisma.extracurricular.update({
    where: { id: (await brochureEkskul('PRAMUKA')).id },
    data: {
      description: 'Latihan kepramukaan mingguan wajib',
      scheduleDay: [DayOfWeek.FRIDAY],
      scheduleTime: '14:00-15:30',
      venue: 'Lapangan Upacara',
      maxParticipants: 100,
      coachId: teacherPesantren.id,
      isCompulsory: true,
    },
  });
  const englishClub = await prisma.extracurricular.update({
    where: { id: (await brochureEkskul('ENGLISH-CLUB')).id },
    data: {
      description: 'Percakapan, pidato, dan permainan berbahasa Inggris',
      scheduleDay: [DayOfWeek.SUNDAY],
      scheduleTime: '15:45-17:15',
      venue: 'Aula Utama',
      maxParticipants: 20,
      coachId: teacherPesantren.id,
    },
  });
  console.log('   ✅ Extracurricular activities created');

  if (students.length >= 2) {
    await prisma.extracurricularEnrollment.create({
      data: {
        extracurricularId: scout.id,
        studentId: students[0].id,
        status: EnrollmentStatus.ACTIVE,
      },
    });

    await prisma.extracurricularEnrollment.create({
      data: {
        extracurricularId: englishClub.id,
        studentId: students[0].id,
        status: EnrollmentStatus.ACTIVE,
      },
    });

    await prisma.extracurricularEnrollment.create({
      data: {
        extracurricularId: scout.id,
        studentId: students[1].id,
        status: EnrollmentStatus.ACTIVE,
      },
    });
  }
  console.log('   ✅ Extracurricular enrollments created');

  // 6. Duty Roster (Piket)
  const masjidDuty = await prisma.dutyType.create({
    data: {
      unitId: smpIt.id,
      name: 'Piket Kebersihan Masjid',
      code: 'PKT-MSJ',
      category: DutyCategory.WORSHIP,
      description: 'Menyapu, mengepel lantai masjid, dan merapikan mukena',
      location: 'Masjid Utama Al-Hikmah',
      startTime: '05:00',
      endTime: '05:30',
    },
  });

  const asramaDuty = await prisma.dutyType.create({
    data: {
      unitId: smpIt.id,
      name: 'Piket Kebersihan Koridor Asrama',
      code: 'PKT-ASM',
      category: DutyCategory.DORMITORY,
      description: 'Menyapu koridor asrama dan membuang sampah',
      location: 'Koridor Gedung Asrama Putra',
      startTime: '05:00',
      endTime: '05:30',
    },
  });
  console.log('   ✅ Duty types created');

  if (students.length >= 2) {
    await prisma.dutyRoster.create({
      data: {
        dutyTypeId: masjidDuty.id,
        studentId: students[0].id,
        date: menuDate1,
        dayOfWeek: DayOfWeek.MONDAY,
        status: DutyStatus.COMPLETED,
        completedAt: new Date(),
        verifiedById: teacherPesantrenUser.id,
        verifiedAt: new Date(),
        notes: 'Melaksanakan tugas dengan baik',
      },
    });

    await prisma.dutyRoster.create({
      data: {
        dutyTypeId: asramaDuty.id,
        studentId: students[1].id,
        date: menuDate1,
        dayOfWeek: DayOfWeek.MONDAY,
        status: DutyStatus.PENDING,
      },
    });
  }
  console.log('   ✅ Duty rosters created');

  // 7. Daily Ibadah & Muhasabah
  const sholatTahajudTarget = await prisma.dailyIbadahTarget.create({
    data: {
      unitId: smpIt.id,
      name: 'Sholat Tahajud',
      category: 'SHOLAT',
      description: 'Melaksanakan sholat tahajud minimal 2 rakaat',
      points: 15,
      targetType: 'DAILY',
      targetCount: 2,
      targetUnit: 'TIMES',
    },
  });

  const dhuhaTarget = await prisma.dailyIbadahTarget.create({
    data: {
      unitId: smpIt.id,
      name: 'Sholat Dhuha',
      category: 'SHOLAT',
      description: 'Melaksanakan sholat dhuha minimal 2 rakaat',
      points: 10,
      targetType: 'DAILY',
      targetCount: 2,
      targetUnit: 'TIMES',
    },
  });

  const tilawahTarget = await prisma.dailyIbadahTarget.create({
    data: {
      unitId: smpIt.id,
      name: 'Tilawah Al-Quran',
      category: 'TILAWAH',
      description: 'Tilawah mandiri harian',
      points: 20,
      targetType: 'DAILY',
      targetCount: 1,
      targetUnit: 'JUZ',
    },
  });
  console.log('   ✅ Daily ibadah targets created');

  if (students.length > 0) {
    await prisma.dailyIbadahRecord.create({
      data: {
        targetId: sholatTahajudTarget.id,
        studentId: students[0].id,
        date: menuDate1,
        isCompleted: true,
        actualCount: 2,
        pointsEarned: 15,
        notes: 'Tahajud di masjid jam 03.15',
        verifiedBy: teacherPesantrenUser.id,
        verifiedAt: new Date(),
      },
    });

    await prisma.dailyIbadahRecord.create({
      data: {
        targetId: tilawahTarget.id,
        studentId: students[0].id,
        date: menuDate1,
        isCompleted: true,
        actualCount: 1,
        pointsEarned: 20,
        notes: "Tilawah juz 30 selesai ba'da subuh",
        verifiedBy: teacherPesantrenUser.id,
        verifiedAt: new Date(),
      },
    });

    // Daily Muhasabah
    await prisma.dailyMuhasabah.create({
      data: {
        studentId: students[0].id,
        date: menuDate1,
        sholatSubuh: true,
        sholatDzuhur: true,
        sholatAshar: true,
        sholatMaghrib: true,
        sholatIsya: true,
        sholatTahajud: true,
        sholatDhuha: true,
        sholatRawatib: 4,
        puasaSunnah: false,
        tilawahPages: 10,
        tilawahJuz: 1,
        dzikirPagi: true,
        dzikirSore: true,
        istighfar: 100,
        shalawat: 100,
        mood: MuhasabahMood.EXCELLENT,
        gratitude:
          'Sangat bersyukur hari ini bisa menyelesaikan target tilawah dan hafalan dengan lancar.',
        notes: 'Alhamdulillah hari ini penuh barokah.',
      },
    });
  }
  console.log('   ✅ Ibadah records & Muhasabah created');

  // 8. Muhadhoroh & Muhadatsah
  if (students.length >= 2) {
    await prisma.muhadhoroh.create({
      data: {
        unitId: smpIt.id,
        studentId: students[0].id,
        scheduledAt: menuDate2,
        topic: 'Urgensi Menuntut Ilmu dalam Islam',
        language: 'Arabic',
        duration: 10,
        contentScore: 85,
        deliveryScore: 80,
        languageScore: 88,
        totalScore: 84,
        grade: 'Jayyid Jiddan',
        feedback: 'Pelafalan bahasa Arab sangat fasih, namun performa panggung perlu lebih aktif.',
        evaluatorId: teacherPesantren.id,
        evaluatedAt: new Date(),
        status: 'COMPLETED',
      },
    });

    await prisma.muhadatsah.create({
      data: {
        unitId: smpIt.id,
        studentId: students[0].id,
        partnerId: students[1].id,
        scheduledAt: menuDate2,
        language: 'English',
        topic: 'Daily Activities at Dormitory',
        duration: 15,
        fluencyScore: 80,
        grammarScore: 78,
        vocabularyScore: 82,
        pronunciationScore: 80,
        totalScore: 80,
        grade: 'Good',
        feedback: 'Both students spoke fluently. Keep practicing daily vocabulary.',
        evaluatorId: teacherPesantren.id,
        evaluatedAt: new Date(),
        status: 'COMPLETED',
      },
    });
  }
  console.log('   ✅ Muhadhoroh & Muhadatsah records created');

  // 9. Counseling (Bimbingan Konseling)
  let counselingSession;
  if (students.length > 0) {
    counselingSession = await prisma.counselingSession.create({
      data: {
        unitId: smpIt.id,
        studentId: students[0].id,
        counselorId: teacherPesantren.id,
        category: CounselingCategory.ACADEMIC,
        priority: CounselingPriority.MEDIUM,
        title: 'Bimbingan Konsultasi Metode Menghafal Cepat',
        description:
          'Santri merasa agak lambat dalam menghafal juz baru dan meminta tips taktik hafalan.',
        scheduledAt: new Date(),
        duration: 45,
        location: 'Ruang Bimbingan Konseling',
        status: CounselingStatus.COMPLETED,
        startedAt: new Date(),
        endedAt: new Date(Date.now() + 45 * 60 * 1000),
        summary:
          'Telah diajarkan metode Kitabah (menulis sebelum menghafal) serta metode pengulangan (murojaah) berkala.',
        recommendations:
          "Santri disarankan menulis 5 baris ayat sebelum tidur dan menghafalnya ba'da subuh.",
        isConfidential: true,
      },
    });
  }

  if (students.length > 0 && counselingSession) {
    await prisma.counselingNote.create({
      data: {
        sessionId: counselingSession.id,
        content: 'Santri sangat kooperatif selama sesi bimbingan dan menunjukkan komitmen tinggi.',
        noteType: 'observation',
        createdById: teacherPesantrenUser.id,
      },
    });

    await prisma.counselingReferral.create({
      data: {
        sessionId: counselingSession.id,
        type: ReferralType.INTERNAL,
        referredTo: 'Ustadz Ahmad (Wali Kamar)',
        reason: 'Mohon pantau aktivitas murojaah santri sebelum tidur di asrama.',
        referredAt: new Date(),
        createdById: teacherPesantrenUser.id,
      },
    });
  }
  console.log('   ✅ Counseling sessions created');

  // 10. GuestBook & visits & packages
  await prisma.guestBook.create({
    data: {
      unitId: smpIt.id,
      name: 'Ir. H. Joko Santoso',
      institution: 'Kementerian Agama Kota Sukabumi',
      purpose: 'Monitoring dan evaluasi fasilitas ruang kelas dan laboratorium sekolah',
      phone: '081234567899',
      checkIn: new Date(),
      visitorCount: 2,
      vehicleNumber: 'B 1234 KAA',
      receivedById: teacherPesantrenUser.id,
      notes: 'Kunjungan kedinasan formal',
    },
  });

  if (students.length > 0) {
    await prisma.studentVisit.create({
      data: {
        studentId: students[0].id,
        unitId: smpIt.id,
        visitorName: 'Bapak Hidayat',
        relationship: 'Orang Tua (Ayah)',
        needs: 'Mengantar pakaian hangat tambahan serta obat asma',
        checkIn: new Date(),
        status: VisitStatus.COMPLETED,
        notes: 'Wali santri hanya berkunjung di area gazebo depan',
      },
    });

    await prisma.studentPackage.create({
      data: {
        studentId: students[0].id,
        unitId: smpIt.id,
        senderName: 'Ibu Hidayat',
        senderPhone: '08123457001',
        expedition: 'J&T Express',
        content: 'Paket makanan kering, snack, dan kaos kaki',
        receivedAt: new Date(),
        receivedById: teacherPesantrenUser.id,
        status: PackageStatus.RECEIVED,
        notes: 'Paket disimpan di pos keamanan asrama',
      },
    });
  }
  console.log('   ✅ GuestBook, visits & packages created');

  // 11. E-Office (Letter)
  await prisma.letter.create({
    data: {
      unitId: smpIt.id,
      direction: LetterDirection.INCOMING,
      agendaNumber: 'AGN/2026/0045',
      letterNumber: 'SRT-KEMENAG-109',
      date: menuDate2,
      receivedAt: new Date(),
      subject: 'Surat Undangan Pelatihan Akreditasi Penjaminan Mutu',
      content:
        'Surat undangan resmi dari Kemenag untuk delegasi guru mengikuti diklat penjaminan mutu di Bandung.',
      urgency: LetterUrgency.IMMEDIATE,
      nature: LetterNature.PUBLIC,
      status: LetterStatus.DISPOSED,
      senderName: 'Dr. H. Ahmad Yani',
      senderInstance: 'Kantor Kementerian Agama Jawa Barat',
      createdById: teacherPesantrenUser.id,
    },
  });

  await prisma.letter.create({
    data: {
      unitId: smpIt.id,
      direction: LetterDirection.OUTGOING,
      letterNumber: '085/SMPIT-AH/VII/2026',
      date: new Date(),
      subject: 'Surat Pemberitahuan Rapat Komite Wali Santri',
      content:
        'Pemberitahuan resmi rapat pleno awal tahun ajaran baru bersama pengurus komite yayasan.',
      urgency: LetterUrgency.NORMAL,
      nature: LetterNature.PUBLIC,
      status: LetterStatus.SIGNED,
      recipientName: 'Seluruh Wali Santri Kelas VII',
      recipientInstance: 'Komite Wali Santri',
      createdById: teacherPesantrenUser.id,
    },
  });
  console.log('   ✅ Letters created');

  // 12. Donation/ZIS
  const campaign = await prisma.donationCampaign.create({
    data: {
      unitId: smpIt.id,
      title: 'Wakaf Pembangunan Menara Masjid Al-Hikmah',
      slug: 'wakaf-menara-masjid',
      description:
        'Program wakaf dan donasi terbuka untuk merampungkan pembangunan menara masjid utama Al-Hikmah.',
      targetAmount: new Prisma.Decimal(250000000),
      collectedAmount: new Prisma.Decimal(125000000),
      donorCount: 25,
      startDate: new Date('2026-06-01'),
      status: CampaignStatus.ACTIVE,
      createdById: teacherPesantrenUser.id,
    },
  });

  await prisma.donation.create({
    data: {
      campaignId: campaign.id,
      unitId: smpIt.id,
      donorName: 'H. Muhammad Yusuf',
      donorPhone: '081234567890',
      isAnonymous: false,
      type: PublicDonationType.WAKAF,
      amount: new Prisma.Decimal(50000000),
      paymentMethod: DonationPaymentMethod.BANK_TRANSFER,
      receiptNumber: `RCP-2026-0001`,
      status: DonationStatus.VERIFIED,
      message: 'Semoga menjadi amal jariyah untuk keluarga besar',
      verifiedById: teacherPesantrenUser.id,
      verifiedAt: new Date(),
      donatedAt: new Date(),
    },
  });

  await prisma.donation.create({
    data: {
      unitId: smpIt.id,
      donorName: 'Hamba Allah',
      isAnonymous: true,
      type: PublicDonationType.INFAK,
      amount: new Prisma.Decimal(500000),
      paymentMethod: DonationPaymentMethod.QRIS,
      receiptNumber: `RCP-2026-0002`,
      status: DonationStatus.VERIFIED,
      verifiedById: teacherPesantrenUser.id,
      verifiedAt: new Date(),
      donatedAt: new Date(),
    },
  });
  console.log('   ✅ Donation campaigns & donations created');

  // 13. Scholarships
  const scholarship = await prisma.scholarship.create({
    data: {
      unitId: smpIt.id,
      name: 'Beasiswa Santri Huffadz Berprestasi',
      description:
        'Pembebasan biaya SPP 100% bagi santri yang mencapai hafalan minimal 5 Juz dalam satu semester',
      source: 'YAYASAN',
      type: 'FULL',
      quota: 10,
      requirements: 'Hafal minimal 5 juz, nilai akhlak Mumtaz',
      isActive: true,
      startDate: new Date('2026-07-01'),
    },
  });

  if (students.length > 0) {
    await prisma.scholarshipRecipient.create({
      data: {
        scholarshipId: scholarship.id,
        studentId: students[0].id,
        academicYearId: academicYear.id,
        status: 'ACTIVE',
        startDate: new Date(),
        approvedById: teacherPesantrenUser.id,
        approvedAt: new Date(),
        notes: 'Pencapaian hafalan 7 Juz beruntung mendapatkan beasiswa penuh',
      },
    });
  }
  console.log('   ✅ Scholarships created');

  // 14. Halaqoh & Takhosus
  const halaqoh = await prisma.halaqoh.create({
    data: {
      unitId: smpIt.id,
      name: 'Halaqoh Abu Bakar As-Siddiq',
      code: 'HLQ-001',
      teacherId: teacherPesantrenUser.id,
      level: 2,
      capacity: 15,
      scheduleDay: [HalaqohDay.MONDAY, HalaqohDay.THURSDAY],
      scheduleTime: '05:00-06:30',
      location: 'Masjid Lantai 2',
      description: 'Halaqoh tahfidz intensif tingkat menengah',
    },
  });

  let takhosusEnrollment;
  if (students.length > 0) {
    takhosusEnrollment = await prisma.takhosusEnrollment.create({
      data: {
        studentId: students[0].id,
        halaqohId: halaqoh.id,
        status: TakhosusStatus.ACTIVE,
        targetJuz: 30,
        currentJuz: 5,
        completedJuz: 4,
        notes: 'Santri sangat disiplin mengikuti halaqoh',
      },
    });
  }

  if (students.length > 0 && takhosusEnrollment) {
    // Seed MurojaahRecord
    await prisma.murojaahRecord.create({
      data: {
        studentId: students[0].id,
        enrollmentId: takhosusEnrollment.id,
        halaqohId: halaqoh.id,
        recordedById: teacherPesantrenUser.id,
        murojaahType: MurojaahType.YAUMIYAH,
        murojaahDate: new Date(),
        juzStart: 1,
        juzEnd: 3,
        pagesReviewed: 30,
        durationMinutes: 45,
        qualityScore: 90,
        mistakeCount: 2,
        fluencyLevel: 4,
        notes: 'Murojaah sangat lancar, sedikit kesalahan tajwid di Juz 2',
      },
    });

    // Seed SimaanExam
    await prisma.simaanExam.create({
      data: {
        studentId: students[0].id,
        enrollmentId: takhosusEnrollment.id,
        halaqohId: halaqoh.id,
        simaanType: SimaanType.BIL_GHAIB,
        examDate: new Date(),
        sessionNumber: 1,
        totalSessions: 1,
        juzStart: 1,
        juzEnd: 5,
        overallScore: 92,
        tajwidScore: 90,
        fashohaScore: 94,
        tartilScore: 92,
        grade: 'Mumtaz',
        passed: true,
        notes: 'Ujian simaan 5 Juz sekali duduk berhasil dengan nilai memuaskan.',
      },
    });

    // Seed SanadRecord
    await prisma.sanadRecord.create({
      data: {
        enrollmentId: takhosusEnrollment.id,
        teacherId: teacherPesantrenUser.id,
        juz: 1,
        surahStart: 1,
        surahEnd: 2,
        certifiedAt: new Date(),
        grade: 'Mumtaz',
        notes: 'Sanad Juz 1 sah diberikan setelah setoran sempurna',
      },
    });
  }
  console.log('   ✅ Halaqoh & Takhosus created');

  // 15. BOS/BOP Allocation & Expense Logs
  const curYear = new Date().getFullYear();
  await prisma.auditLog.create({
    data: {
      userId: teacherPesantrenUser.id,
      action: 'CREATE',
      entity: 'BOS_ALLOCATION',
      entityId: `${smpIt.id}-${curYear}-Q1`,
      newValues: {
        unitId: smpIt.id,
        year: curYear,
        quarter: 1,
        totalAmount: 10000000,
        allocations: [
          { componentCode: 'BOS-01', amount: 2000000 },
          { componentCode: 'BOS-05', amount: 3000000 },
          { componentCode: 'BOS-07', amount: 5000000 },
        ],
      } as any,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: teacherPesantrenUser.id,
      action: 'CREATE',
      entity: 'BOS_EXPENSE',
      entityId: `${smpIt.id}-${curYear}-Q1`,
      newValues: {
        unitId: smpIt.id,
        componentCode: 'BOS-05',
        componentName: 'Pengelolaan Sekolah',
        amount: 1500000,
        date: new Date(),
        description: 'Pembelian Kertas A4 dan ATK Kantor',
        receiptNumber: 'RCP-BOS-001',
        vendor: 'Toko Buku Sejahtera',
      } as any,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: teacherPesantrenUser.id,
      action: 'CREATE',
      entity: 'BOS_EXPENSE',
      entityId: `${smpIt.id}-${curYear}-Q1`,
      newValues: {
        unitId: smpIt.id,
        componentCode: 'BOS-07',
        componentName: 'Langganan Daya dan Jasa',
        amount: 2500000,
        date: new Date(),
        description: 'Pembayaran Listrik Bulanan',
        receiptNumber: 'RCP-BOS-002',
        vendor: 'PLN Persero',
      } as any,
    },
  });
  console.log('   ✅ BOS Allocation & Expense Logs created');

  // 16. Procurement Seeding (Suppliers & PurchaseRequests)
  const supplier1 = await prisma.supplier.create({
    data: {
      name: 'Toko Buku Barokah',
      address: 'Jl. Ahmad Yani No. 45, Sukabumi',
      phone: '081234567011',
      email: 'sales@barokahbook.com',
      contactPerson: 'Bapak Ahmad',
      category: 'STATIONERY',
      rating: 5,
      bankName: 'Bank Syariah Indonesia',
      bankAccount: '7112233445',
      isActive: true,
    },
  });

  const supplier2 = await prisma.supplier.create({
    data: {
      name: 'CV Utama Jaya Teknik',
      address: 'Kawasan Industri Cikembar, Sukabumi',
      phone: '081234567022',
      email: 'info@utamajaya.co.id',
      contactPerson: 'Ibu Lilis',
      category: 'MAINTENANCE',
      rating: 4,
      bankName: 'Bank Mandiri',
      bankAccount: '1300012345678',
      isActive: true,
    },
  });
  console.log('   ✅ Suppliers created');

  const pr1 = await prisma.purchaseRequest.create({
    data: {
      unitId: smpIt.id,
      code: 'PR-202606-0001',
      requesterId: teacherPesantrenUser.id,
      preferredSupplierId: supplier1.id,
      date: new Date(),
      description: 'Pengadaan buku panduan hafalan tahfidz baru dan kitab kuning tingkat pemula',
      totalEstimated: new Prisma.Decimal(2500000),
      status: PurchaseRequestStatus.APPROVED,
      approvedById: teacherPesantrenUser.id,
      approvedAt: new Date(),
    },
  });

  await prisma.purchaseRequestItem.create({
    data: {
      requestId: pr1.id,
      itemName: 'Kitab Safinatun Najah',
      quantity: 50,
      unit: 'pcs',
      estimatedPrice: new Prisma.Decimal(20000),
      totalPrice: new Prisma.Decimal(1000000),
    },
  });

  await prisma.purchaseRequestItem.create({
    data: {
      requestId: pr1.id,
      itemName: 'Buku Mutabaah Hafalan Santri',
      quantity: 100,
      unit: 'pcs',
      estimatedPrice: new Prisma.Decimal(15000),
      totalPrice: new Prisma.Decimal(1500000),
    },
  });

  const pr2 = await prisma.purchaseRequest.create({
    data: {
      unitId: smpIt.id,
      code: 'PR-202606-0002',
      requesterId: teacherPesantrenUser.id,
      preferredSupplierId: supplier2.id,
      date: new Date(),
      description: 'Pengadaan unit AC untuk ruang kelas multimedia dan kantor administrasi',
      totalEstimated: new Prisma.Decimal(9000000),
      status: PurchaseRequestStatus.PENDING,
    },
  });

  await prisma.purchaseRequestItem.create({
    data: {
      requestId: pr2.id,
      itemName: 'AC Split Panasonic 1 PK',
      quantity: 2,
      unit: 'unit',
      estimatedPrice: new Prisma.Decimal(4500000),
      totalPrice: new Prisma.Decimal(9000000),
    },
  });
  console.log('   ✅ Purchase Requests & Items created');

  // ============================================
  // PHASE 11: Comprehensive Demo Data (Empty Table Fill)
  // ============================================
  console.log('\n🔧 Seeding Phase 11 comprehensive demo data...');

  // --- Calendar Events ---
  await prisma.calendarEvent.createMany({
    data: [
      {
        title: 'Ujian Tengah Semester Ganjil',
        description: 'Pelaksanaan UTS semester ganjil untuk seluruh unit.',
        eventType: EventType.ACADEMIC,
        scope: EventScope.ALL_UNITS,
        startDate: new Date('2024-10-14'),
        endDate: new Date('2024-10-18'),
        isAllDay: true,
        isPublic: true,
        color: '#3B82F6',
        createdById: superAdminUser.id,
      },
      {
        unitId: smpIt.id,
        title: 'Khataman Al-Quran Akbar',
        description: 'Acara khataman Al-Quran untuk santri yang telah khatam 30 juz.',
        eventType: EventType.RELIGIOUS,
        scope: EventScope.SPECIFIC_UNIT,
        startDate: new Date('2024-12-20'),
        isAllDay: true,
        location: 'Masjid Utama Al-Hikmah',
        isPublic: true,
        color: '#10B981',
        createdById: adminPesantrenUser.id,
      },
      {
        title: 'Libur Semester Ganjil',
        description: 'Libur akhir semester ganjil tahun ajaran 2024/2025.',
        eventType: EventType.HOLIDAY,
        scope: EventScope.ALL_UNITS,
        startDate: new Date('2024-12-23'),
        endDate: new Date('2025-01-04'),
        isAllDay: true,
        isPublic: true,
        color: '#EF4444',
        createdById: superAdminUser.id,
      },
      {
        unitId: smpIt.id,
        title: 'Rapat Dewan Guru Bulanan',
        description: 'Rapat koordinasi guru dan musyrif membahas perkembangan santri.',
        eventType: EventType.MEETING,
        scope: EventScope.SPECIFIC_UNIT,
        startDate: new Date('2024-11-05'),
        isAllDay: false,
        startTime: '09:00',
        endTime: '11:00',
        location: 'Ruang Rapat Utama',
        isPublic: false,
        color: '#8B5CF6',
        createdById: adminPesantrenUser.id,
      },
    ],
  });
  console.log('   ✅ Calendar events created');

  // --- Islamic Events ---
  await prisma.islamicEvent.createMany({
    data: [
      {
        name: 'Maulid Nabi Muhammad SAW',
        nameArabic: 'المولد النبوي',
        type: 'HARI_BESAR',
        hijriMonth: 3,
        hijriDay: 12,
        gregorianDate: new Date('2024-09-27'),
        gregorianYear: 2024,
        description: 'Peringatan kelahiran Nabi Muhammad SAW.',
        activities: 'Pembacaan maulid, ceramah, dan dzikir bersama.',
        isHoliday: true,
        isRecurring: true,
      },
      {
        name: 'Isra Miraj',
        nameArabic: 'الإسراء والمعراج',
        type: 'HARI_BESAR',
        hijriMonth: 7,
        hijriDay: 27,
        gregorianDate: new Date('2025-01-27'),
        gregorianYear: 2025,
        description:
          'Peringatan perjalanan Nabi Muhammad SAW dari Masjidil Haram ke Masjidil Aqsa.',
        activities: 'Ceramah, sholat sunnah, dan muhasabah.',
        isHoliday: true,
        isRecurring: true,
      },
      {
        name: 'Puasa Senin-Kamis',
        type: 'PUASA_SUNNAH',
        hijriMonth: 1,
        hijriDay: 1,
        description: 'Puasa sunnah Senin dan Kamis yang dijalankan rutin oleh santri.',
        activities: 'Puasa sunnah dan kajian kitab kuning.',
        isHoliday: false,
        isRecurring: true,
      },
      {
        name: 'Nuzulul Quran',
        nameArabic: 'نزول القرآن',
        type: 'HARI_BESAR',
        hijriMonth: 9,
        hijriDay: 17,
        gregorianDate: new Date('2025-03-17'),
        gregorianYear: 2025,
        description: 'Peringatan turunnya Al-Quran kepada Nabi Muhammad SAW.',
        activities: 'Khataman Al-Quran, tadarus bersama, ceramah.',
        isHoliday: true,
        isRecurring: true,
      },
    ],
  });
  console.log('   ✅ Islamic events created');

  // --- Daily Schedule Template & Activities (Pesantren) ---
  const scheduleTemplate = await prisma.dailyScheduleTemplate.create({
    data: {
      unitId: smpIt.id,
      name: 'Jadwal Hari Biasa (Senin-Kamis)',
      isDefault: true,
      isActive: true,
    },
  });

  const scheduleTemplateFriday = await prisma.dailyScheduleTemplate.create({
    data: {
      unitId: smpIt.id,
      name: 'Jadwal Hari Jumat',
      isDefault: false,
      isActive: true,
    },
  });

  await prisma.dailyActivity.createMany({
    data: [
      {
        templateId: scheduleTemplate.id,
        name: 'Sholat Subuh Berjamaah',
        startTime: '04:30',
        endTime: '05:00',
        location: 'Masjid Utama',
        isMandatory: true,
        sequence: 1,
      },
      {
        templateId: scheduleTemplate.id,
        name: 'Tahfidz Pagi (Ziyadah)',
        startTime: '05:00',
        endTime: '06:00',
        location: 'Kelas Tahfidz',
        isMandatory: true,
        sequence: 2,
      },
      {
        templateId: scheduleTemplate.id,
        name: 'Mandi & Sarapan',
        startTime: '06:00',
        endTime: '07:00',
        location: 'Asrama & Kantin',
        isMandatory: true,
        sequence: 3,
      },
      {
        templateId: scheduleTemplate.id,
        name: 'KBM (Pelajaran Umum)',
        startTime: '07:00',
        endTime: '12:00',
        location: 'Ruang Kelas',
        isMandatory: true,
        sequence: 4,
      },
      {
        templateId: scheduleTemplate.id,
        name: 'Sholat Dzuhur Berjamaah',
        startTime: '12:00',
        endTime: '12:30',
        location: 'Masjid Utama',
        isMandatory: true,
        sequence: 5,
      },
      {
        templateId: scheduleTemplate.id,
        name: 'Makan Siang',
        startTime: '12:30',
        endTime: '13:00',
        location: 'Kantin',
        isMandatory: true,
        sequence: 6,
      },
      {
        templateId: scheduleTemplate.id,
        name: 'Istirahat / Tidur Siang',
        startTime: '13:00',
        endTime: '14:00',
        location: 'Asrama',
        isMandatory: false,
        sequence: 7,
      },
      {
        templateId: scheduleTemplate.id,
        name: 'KBM (Pelajaran Diniyah)',
        startTime: '14:00',
        endTime: '15:15',
        location: 'Ruang Kelas',
        isMandatory: true,
        sequence: 8,
      },
      {
        templateId: scheduleTemplate.id,
        name: 'Sholat Ashar Berjamaah',
        startTime: '15:15',
        endTime: '15:45',
        location: 'Masjid Utama',
        isMandatory: true,
        sequence: 9,
      },
      {
        templateId: scheduleTemplate.id,
        name: 'Murojaah Sore',
        startTime: '15:45',
        endTime: '17:00',
        location: 'Kelas Tahfidz',
        isMandatory: true,
        sequence: 10,
      },
      {
        templateId: scheduleTemplate.id,
        name: 'Sholat Maghrib & Tilawah',
        startTime: '17:45',
        endTime: '19:00',
        location: 'Masjid Utama',
        isMandatory: true,
        sequence: 11,
      },
      {
        templateId: scheduleTemplate.id,
        name: 'Makan Malam',
        startTime: '19:00',
        endTime: '19:30',
        location: 'Kantin',
        isMandatory: true,
        sequence: 12,
      },
      {
        templateId: scheduleTemplate.id,
        name: 'Sholat Isya & Kajian Malam',
        startTime: '19:30',
        endTime: '20:30',
        location: 'Masjid Utama',
        isMandatory: true,
        sequence: 13,
      },
      {
        templateId: scheduleTemplate.id,
        name: 'Belajar Mandiri',
        startTime: '20:30',
        endTime: '22:00',
        location: 'Asrama',
        isMandatory: true,
        sequence: 14,
      },
      {
        templateId: scheduleTemplateFriday.id,
        name: 'Sholat Subuh Berjamaah',
        startTime: '04:30',
        endTime: '05:00',
        location: 'Masjid Utama',
        isMandatory: true,
        sequence: 1,
      },
      {
        templateId: scheduleTemplateFriday.id,
        name: 'Muhadhoroh / Kultum',
        startTime: '05:00',
        endTime: '06:00',
        location: 'Aula',
        isMandatory: true,
        sequence: 2,
      },
      {
        templateId: scheduleTemplateFriday.id,
        name: 'Olahraga & Kerja Bakti',
        startTime: '06:30',
        endTime: '08:00',
        location: 'Lapangan',
        isMandatory: true,
        sequence: 3,
      },
      {
        templateId: scheduleTemplateFriday.id,
        name: 'Sholat Jumat',
        startTime: '11:30',
        endTime: '13:00',
        location: 'Masjid Utama',
        isMandatory: true,
        sequence: 4,
      },
    ],
  });
  console.log('   ✅ Daily schedule templates & activities created');

  // --- Musyrif (Dormitory Supervisor) ---
  const musyrif1 = await prisma.musyrif.create({
    data: {
      userId: teacherPesantrenUser.id,
      unitId: smpIt.id,
      teacherId: teacherPesantren.id,
      code: 'MSF-001',
      phone: '081234567890',
      isActive: true,
      joinDate: new Date('2023-07-15'),
      notes: 'Musyrif senior, bertanggung jawab atas asrama putra.',
    },
  });

  await prisma.musyrifAssignment.create({
    data: {
      musyrifId: musyrif1.id,
      dormitoryId: dormitoryPutra.id,
      role: 'KOORDINATOR',
      startDate: new Date('2024-07-15'),
      isActive: true,
    },
  });

  // The demo musyrif personas look after real asrama and kamar. A boarder's
  // leave is their musyrif's to decide (2026-09-25); without a Musyrif row and
  // an assignment these logins were musyrif in name only and could decide
  // nothing. The murabbi keeps no asrama: pembinaan akhlak is not a kamar.
  const musyrifDuties: Array<
    [email: string, dormitoryId: string, roomId: string | null, role: string]
  > = [
    ['pesantren.musyrif@cipansor.or.id', dormitoryPutra.id, null, 'KOORDINATOR'],
    ['pesantren.musyrifah@cipansor.or.id', dormitoryPutri.id, null, 'KOORDINATOR'],
    ['pesantren.walikamar@cipansor.or.id', dormitoryPutra.id, rooms[0].room.id, 'PEMBINA'],
  ];
  for (const [email, dormitoryId, roomId, role] of musyrifDuties) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, unitId: true },
    });
    if (!user) continue;
    const musyrif = await prisma.musyrif.create({
      data: {
        userId: user.id,
        unitId: user.unitId ?? smpIt.id,
        isActive: true,
        joinDate: currentYear.startDate,
      },
    });
    await prisma.musyrifAssignment.create({
      data: {
        musyrifId: musyrif.id,
        dormitoryId,
        roomId,
        role,
        startDate: currentYear.startDate,
        isActive: true,
      },
    });
  }
  console.log('   ✅ Musyrif & assignments created');

  // --- Santri Wallet & Transactions ---
  if (students.length > 0) {
    const wallet1 = await prisma.santriWallet.create({
      data: {
        studentId: students[0].id,
        balance: new Prisma.Decimal(150000),
        lastTopUp: new Date(),
      },
    });

    await prisma.walletTransaction.createMany({
      data: [
        {
          walletId: wallet1.id,
          type: 'TOPUP',
          amount: new Prisma.Decimal(200000),
          balanceBefore: new Prisma.Decimal(0),
          balanceAfter: new Prisma.Decimal(200000),
          description: 'Top-up saldo oleh wali santri',
          createdById: parentUsers[0]?.user?.id || teacherPesantrenUser.id,
        },
        {
          walletId: wallet1.id,
          type: 'PURCHASE',
          amount: new Prisma.Decimal(-35000),
          balanceBefore: new Prisma.Decimal(200000),
          balanceAfter: new Prisma.Decimal(165000),
          description: 'Pembelian di kantin - Nasi Goreng + Es Teh',
          referenceType: 'CANTEEN',
        },
        {
          walletId: wallet1.id,
          type: 'PURCHASE',
          amount: new Prisma.Decimal(-15000),
          balanceBefore: new Prisma.Decimal(165000),
          balanceAfter: new Prisma.Decimal(150000),
          description: 'Laundry - 3 kg pakaian',
          referenceType: 'LAUNDRY',
        },
      ],
    });

    if (students.length > 1) {
      await prisma.santriWallet.create({
        data: {
          studentId: students[1].id,
          balance: new Prisma.Decimal(75000),
          lastTopUp: new Date(),
        },
      });
    }
  }
  console.log('   ✅ Santri wallets & transactions created');

  // --- Student Notes ---
  if (students.length > 0) {
    await prisma.studentNote.createMany({
      data: [
        {
          studentId: students[0].id,
          classId: class7A.id,
          academicYearId: academicYear.id,
          category: NoteCategory.ACHIEVEMENT,
          title: 'Juara 1 Musabaqah Tilawatil Quran',
          content:
            'Muhammad Rizky berhasil meraih juara 1 MTQ tingkat kecamatan. Bacaan tajwid dan makhorijul huruf sangat baik.',
          priority: NotePriority.LOW,
          visibility: NoteVisibility.TEACHERS,
          createdById: teacherPesantrenUser.id,
        },
        {
          studentId: students[0].id,
          classId: class7A.id,
          academicYearId: academicYear.id,
          category: NoteCategory.SPIRITUAL,
          title: 'Progres Hafalan Sangat Baik',
          content:
            'Santri menunjukkan peningkatan signifikan dalam hafalan. Sudah menyelesaikan juz 30 dan sedang melanjutkan juz 29.',
          priority: NotePriority.MEDIUM,
          visibility: NoteVisibility.PARENTS,
          createdById: teacherPesantrenUser.id,
        },
        {
          studentId: students[1]?.id || students[0].id,
          classId: class7A.id,
          academicYearId: academicYear.id,
          category: NoteCategory.CONCERN,
          title: 'Perlu Perhatian Khusus Pelajaran Matematika',
          content:
            'Ahmad Fauzan menunjukkan kesulitan dalam memahami materi pecahan dan aljabar. Disarankan les tambahan.',
          priority: NotePriority.HIGH,
          visibility: NoteVisibility.HOMEROOM_ONLY,
          requiresFollowUp: true,
          followUpDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdById: teacherPesantrenUser.id,
        },
      ],
    });
  }
  console.log('   ✅ Student notes created');

  // --- Behavior Records ---
  if (students.length > 0) {
    await prisma.behaviorRecord.createMany({
      data: [
        {
          studentId: students[0].id,
          classId: class7A.id,
          academicYearId: academicYear.id,
          date: new Date(),
          behaviorType: BehaviorType.POSITIVE,
          category: BehaviorCategory.RELIGIOUS,
          description: "Rutin memimpin dzikir ba'da sholat maghrib tanpa diminta.",
          points: 10,
          recordedById: teacherPesantrenUser.id,
        },
        {
          studentId: students[0].id,
          classId: class7A.id,
          academicYearId: academicYear.id,
          date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          behaviorType: BehaviorType.POSITIVE,
          category: BehaviorCategory.COOPERATION,
          description: 'Membantu teman baru beradaptasi di asrama, mengajarkan tata tertib.',
          points: 5,
          recordedById: teacherPesantrenUser.id,
        },
        {
          studentId: students[1]?.id || students[0].id,
          classId: class7A.id,
          academicYearId: academicYear.id,
          date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          behaviorType: BehaviorType.NEGATIVE,
          category: BehaviorCategory.PUNCTUALITY,
          description: 'Terlambat hadir ke sholat subuh berjamaah.',
          points: -3,
          actionTaken: 'Dinasihati dan diberi tugas membersihkan masjid.',
          recordedById: teacherPesantrenUser.id,
        },
      ],
    });
  }
  console.log('   ✅ Behavior records created');

  // --- Daily Student Report (for SD IT / PAUD) ---
  if (students.length > 2) {
    const dailyReport = await prisma.dailyStudentReport.create({
      data: {
        studentId: students[2].id,
        unitId: sdIt.id,
        academicYearId: academicYear.id,
        reportDate: today,
        unitType: UnitType.SD_IT,
        arrivalTime: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 7, 15),
        mood: DailyMood.HAPPY,
        healthStatus: 'Sehat',
        hadBreakfast: true,
        mealStatus: MealConsumption.HABIS,
        snackStatus: MealConsumption.SETENGAH,
        sholatDhuha: true,
        sholatDzuhur: true,
        tahfidzActivity: 'Menghafal surat Al-Mulk ayat 1-10',
        activitiesSummary:
          'Hari ini belajar Matematika (pecahan), Bahasa Indonesia (membaca), dan Tahfidz.',
        achievements: 'Mendapat bintang untuk kelancaran membaca.',
        behaviorNotes: 'Sopan dan aktif bertanya di kelas.',
        teacherNotes: 'Siti menunjukkan perkembangan yang baik hari ini.',
        departureTime: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 30),
        pickedUpBy: 'Bapak Aisyah',
        createdById: teacherSdItUser.id,
      },
    });

    await prisma.dailyHomework.createMany({
      data: [
        {
          reportId: dailyReport.id,
          subjectName: 'Matematika',
          description: 'Kerjakan latihan soal pecahan halaman 45 nomor 1-10.',
          dueDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        },
        {
          reportId: dailyReport.id,
          subjectName: 'Bahasa Indonesia',
          description: 'Baca cerita pendek "Petualangan di Hutan" dan tulis 5 pertanyaan.',
          dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        },
      ],
    });
  }
  console.log('   ✅ Daily student reports & homework created');

  // --- Growth Records ---
  if (students.length > 2) {
    await prisma.growthRecord.createMany({
      data: [
        {
          studentId: students[2].id,
          unitId: sdIt.id,
          recordDate: new Date('2024-08-15'),
          weight: 25.5,
          height: 120.3,
          ageMonths: 84,
          nutritionStatus: 'Normal',
          notes: 'Pertumbuhan sesuai usia.',
          recordedById: teacherSdItUser.id,
        },
        {
          studentId: students[2].id,
          unitId: sdIt.id,
          recordDate: new Date('2025-02-15'),
          weight: 27.0,
          height: 123.1,
          ageMonths: 90,
          nutritionStatus: 'Normal',
          notes: 'Kenaikan BB dan TB normal.',
          recordedById: teacherSdItUser.id,
        },
        {
          studentId: students[0].id,
          unitId: smpIt.id,
          recordDate: new Date('2024-08-20'),
          weight: 42.0,
          height: 155.5,
          ageMonths: 150,
          nutritionStatus: 'Normal',
          notes: 'BMI normal.',
          recordedById: teacherPesantrenUser.id,
        },
      ],
    });
  }
  console.log('   ✅ Growth records created');

  // --- Immunization Records ---
  if (students.length > 2) {
    await prisma.immunizationRecord.createMany({
      data: [
        {
          studentId: students[2].id,
          unitId: sdIt.id,
          vaccineName: 'Campak Rubella (MR)',
          vaccineCode: 'MR',
          doseNumber: 2,
          scheduledDate: new Date('2024-09-15'),
          administeredDate: new Date('2024-09-15'),
          administeredAt: 'UKS SD IT Ar-Rahman',
          batchNumber: 'MR-2024-001',
          status: 'COMPLETED',
          recordedById: teacherSdItUser.id,
        },
        {
          studentId: students[2].id,
          unitId: sdIt.id,
          vaccineName: 'DT (Difteri Tetanus)',
          vaccineCode: 'DT',
          doseNumber: 1,
          scheduledDate: new Date('2024-10-20'),
          administeredDate: new Date('2024-10-20'),
          administeredAt: 'Puskesmas Sukabumi',
          batchNumber: 'DT-2024-045',
          status: 'COMPLETED',
          recordedById: teacherSdItUser.id,
        },
        {
          studentId: students[3]?.id || students[0].id,
          unitId: tkQuran.id,
          vaccineName: 'Polio (IPV)',
          vaccineCode: 'IPV',
          doseNumber: 4,
          scheduledDate: new Date('2025-03-01'),
          status: 'PENDING',
        },
      ],
    });
  }
  console.log('   ✅ Immunization records created');

  // --- Complaints ---
  const complaint1 = await prisma.complaint.create({
    data: {
      unitId: smpIt.id,
      userId: parentUsers[0]?.user?.id || teacherPesantrenUser.id,
      category: ComplaintCategory.FACILITY,
      subject: 'AC Ruang Kelas 7A Tidak Berfungsi',
      description:
        'Sudah 3 hari AC di ruang kelas 7A mati. Santri merasa kepanasan terutama saat jam siang.',
      location: 'Ruang Kelas 7A, Lantai 2',
      status: ComplaintStatus.IN_PROGRESS,
      priority: ComplaintPriority.HIGH,
      isAnonymous: false,
      assignedToId: adminPesantrenUser.id,
    },
  });

  await prisma.complaintComment.create({
    data: {
      complaintId: complaint1.id,
      userId: adminPesantrenUser.id,
      content: 'Sudah dihubungi teknisi AC. Diperkirakan akan diperbaiki besok pagi.',
      isInternal: false,
    },
  });

  await prisma.complaint.create({
    data: {
      unitId: smpIt.id,
      category: ComplaintCategory.SERVICE,
      subject: 'Variasi Menu Makan Kurang',
      description:
        'Mohon ditambahkan variasi menu makan siang. Beberapa santri mengeluhkan menu yang monoton.',
      status: ComplaintStatus.RESOLVED,
      priority: ComplaintPriority.NORMAL,
      isAnonymous: true,
      resolution:
        'Sudah dikoordinasikan dengan bagian dapur untuk menambahkan 5 menu baru mulai minggu depan.',
      resolvedAt: new Date(),
    },
  });
  console.log('   ✅ Complaints & comments created');

  // --- Department (HRM) ---
  const deptKurikulum = await prisma.department.create({
    data: {
      unitId: smpIt.id,
      code: 'KUR',
      name: 'Kurikulum & Pengajaran',
      description: 'Bagian yang menangani kurikulum, pengajaran, dan evaluasi akademik.',
      managerId: kepalaSmpItUser?.id || adminPesantrenUser.id,
      isActive: true,
    },
  });

  await prisma.department.create({
    data: {
      unitId: smpIt.id,
      code: 'KEP',
      name: 'Kepesantrenan',
      description: 'Bagian yang menangani kegiatan kepesantrenan, asrama, dan pembinaan santri.',
      managerId: teacherPesantrenUser.id,
      isActive: true,
    },
  });

  await prisma.department.create({
    data: {
      unitId: smpIt.id,
      code: 'TU',
      name: 'Tata Usaha',
      description: 'Bagian administrasi dan tata usaha.',
      isActive: true,
    },
  });
  console.log('   ✅ Departments created');

  // --- Leave Balance ---
  await prisma.leaveBalance.createMany({
    data: [
      {
        unitId: smpIt.id,
        academicYearId: academicYear.id,
        userId: teacherPesantrenUser.id,
        leaveType: LeaveType.ANNUAL,
        totalDays: 12,
        usedDays: 3,
        remainingDays: 9,
        notes: 'Sisa cuti tahunan.',
      },
      {
        unitId: smpIt.id,
        academicYearId: academicYear.id,
        userId: teacherPesantrenUser.id,
        leaveType: LeaveType.SICK,
        totalDays: 14,
        usedDays: 1,
        remainingDays: 13,
      },
      {
        unitId: sdIt.id,
        academicYearId: academicYear.id,
        userId: teacherSdItUser.id,
        leaveType: LeaveType.ANNUAL,
        totalDays: 12,
        usedDays: 2,
        remainingDays: 10,
      },
    ],
  });
  console.log('   ✅ Leave balances created');

  // --- Employment Contract ---
  await prisma.employmentContract.createMany({
    data: [
      {
        userId: teacherPesantrenUser.id,
        contractNumber: 'KTR-2023-001',
        type: 'PKWTT',
        startDate: new Date('2023-07-01'),
        status: ContractStatus.ACTIVE,
        notes: 'Guru tetap bidang studi Al-Quran dan Hadits.',
      },
      {
        userId: teacherSdItUser.id,
        contractNumber: 'KTR-2023-002',
        type: 'PKWT',
        startDate: new Date('2023-08-01'),
        endDate: new Date('2025-07-31'),
        status: ContractStatus.ACTIVE,
        notes: 'Kontrak guru 2 tahun.',
      },
      {
        userId: adminPesantrenUser.id,
        contractNumber: 'KTR-2022-003',
        type: 'PKWTT',
        startDate: new Date('2022-01-15'),
        status: ContractStatus.ACTIVE,
        notes: 'Staf administrasi tetap.',
      },
    ],
  });
  console.log('   ✅ Employment contracts created');

  // --- Employee Document ---
  await prisma.employeeDocument.createMany({
    data: [
      {
        userId: teacherPesantrenUser.id,
        name: 'Ijazah S1 Pendidikan Agama Islam',
        type: EmployeeDocumentType.IJAZAH,
        fileUrl: '/documents/employee/ijazah-ahmad-pai.pdf',
        notes: 'Universitas Islam Negeri Sunan Gunung Djati, Bandung.',
      },
      {
        userId: teacherPesantrenUser.id,
        name: 'Sertifikat Profesi Guru',
        type: EmployeeDocumentType.SERTIFIKAT,
        fileUrl: '/documents/employee/sertifikasi-guru-ahmad.pdf',
        notes: 'Sertifikat pendidik nomor registrasi 2023-00012.',
      },
      {
        userId: adminPesantrenUser.id,
        name: 'KTP Elektronik',
        type: EmployeeDocumentType.KTP,
        fileUrl: '/documents/employee/ktp-admin.pdf',
        expiryDate: new Date('2029-12-31'),
      },
    ],
  });
  console.log('   ✅ Employee documents created');

  // --- Employment History ---
  await prisma.employmentHistory.createMany({
    data: [
      {
        userId: teacherPesantrenUser.id,
        action: EmploymentAction.HIRED,
        previousPosition: '',
        newPosition: 'Guru Al-Quran dan Hadits',
        newDepartment: 'Kurikulum & Pengajaran',
        effectiveDate: new Date('2023-07-01'),
        notes: 'Diterima sebagai guru tetap.',
      },
      {
        userId: teacherPesantrenUser.id,
        action: EmploymentAction.PROMOTED,
        previousPosition: 'Guru Al-Quran dan Hadits',
        newPosition: 'Wali Kelas 7A & Koordinator Tahfidz',
        previousDepartment: 'Kurikulum & Pengajaran',
        newDepartment: 'Kurikulum & Pengajaran',
        effectiveDate: new Date('2024-07-15'),
        notes: 'Dipromosikan sebagai wali kelas dan koordinator tahfidz.',
      },
    ],
  });
  console.log('   ✅ Employment history created');

  // --- Extracurricular Attendance ---
  if (students.length >= 2) {
    await prisma.extracurricularAttendance.createMany({
      data: [
        {
          extracurricularId: scout.id,
          studentId: students[0].id,
          date: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7),
          status: AttendanceStatus.PRESENT,
          notes: 'Mengikuti latihan dengan baik.',
          recordedById: teacherPesantrenUser.id,
        },
        {
          extracurricularId: scout.id,
          studentId: students[1].id,
          date: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7),
          status: AttendanceStatus.PRESENT,
          recordedById: teacherPesantrenUser.id,
        },
        {
          extracurricularId: englishClub.id,
          studentId: students[0].id,
          date: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 5),
          status: AttendanceStatus.PRESENT,
          notes: 'Latihan pidato sebelum lomba.',
          recordedById: teacherPesantrenUser.id,
        },
      ],
    });
  }
  console.log('   ✅ Extracurricular attendance created');

  // --- Extracurricular Achievement ---
  if (students.length > 0) {
    await prisma.extracurricularAchievement.createMany({
      data: [
        {
          extracurricularId: scout.id,
          studentId: students[0].id,
          title: 'Juara 2 Lomba Pioneering',
          description: 'Meraih juara 2 lomba pioneering tingkat kwartir ranting.',
          level: 'Kecamatan',
          rank: 'Juara 2',
          organizer: 'Kwartir Ranting Kecamatan Sukabumi',
          eventDate: new Date('2024-11-10'),
        },
        {
          extracurricularId: englishClub.id,
          title: 'Juara 1 Lomba Speech',
          description: 'Anggota English Club meraih juara 1 lomba speech se-Kabupaten Sukabumi.',
          level: 'Kabupaten',
          rank: 'Juara 1',
          organizer: 'Kemenag Kabupaten Sukabumi',
          eventDate: new Date('2024-12-05'),
        },
      ],
    });
  }
  console.log('   ✅ Extracurricular achievements created');

  // --- Asset Assignment ---
  const allAssets = await prisma.asset.findMany({ take: 3 });
  if (allAssets.length > 0) {
    await prisma.assetAssignment.create({
      data: {
        assetId: allAssets[0].id,
        userId: teacherPesantrenUser.id,
        assignedAt: new Date('2024-08-01'),
        conditionBefore: AssetCondition.GOOD,
        notes: 'Digunakan untuk kegiatan belajar mengajar di ruang kelas 7A.',
        status: 'ACTIVE',
      },
    });

    if (allAssets.length > 1) {
      await prisma.assetAssignment.create({
        data: {
          assetId: allAssets[1].id,
          userId: adminPesantrenUser.id,
          assignedAt: currentYear.startDate,
          conditionBefore: AssetCondition.GOOD,
          notes: 'Inventaris kantor Tata Usaha.',
          status: 'ACTIVE',
        },
      });
    }
  }
  console.log('   ✅ Asset assignments created');

  // --- Hafidz Student (completed memorization) ---
  if (students.length > 0) {
    await prisma.hafidzStudent.create({
      data: {
        studentId: students[0].id,
        completedAt: new Date('2024-11-15'),
        notes:
          'Alhamdulillah, telah menyelesaikan hafalan 30 juz dengan predikat Mumtaz (Istimewa).',
      },
    });
  }
  console.log('   ✅ Hafidz student records created');

  // --- Messages (Internal Communication) ---
  await prisma.message.createMany({
    data: [
      {
        senderId: adminPesantrenUser.id,
        recipientId: teacherPesantrenUser.id,
        subject: 'Jadwal Rapat Persiapan UTS',
        content:
          "Assalamu'alaikum Ustadz Ahmad,\n\nMohon hadir di rapat persiapan UTS hari Senin jam 09:00 di ruang rapat utama.\n\nJazakallahu khairan.",
        isRead: true,
      },
      {
        senderId: teacherPesantrenUser.id,
        recipientId: adminPesantrenUser.id,
        subject: 'Laporan Perkembangan Santri Bulan Oktober',
        content:
          "Assalamu'alaikum,\n\nBerikut laporan perkembangan santri kelas 7A untuk bulan Oktober 2024. Total santri aktif: 28, rata-rata hafalan baru: 2 halaman/minggu.\n\nWassalam.",
        isRead: false,
      },
      {
        senderId: superAdminUser.id,
        recipientId: adminPesantrenUser.id,
        subject: 'Pengumuman: Update Sistem Informasi',
        content:
          "Assalamu'alaikum,\n\nDiberitahukan bahwa sistem Cipansor akan diperbarui pada hari Sabtu, 30 November 2024 pukul 22:00-00:00 WIB. Mohon pastikan semua data sudah tersimpan sebelum waktu tersebut.\n\nTerima kasih.",
        isRead: true,
      },
    ],
  });
  console.log('   ✅ Internal messages created');

  // --- Special Diet ---
  if (students.length > 2) {
    await prisma.specialDiet.createMany({
      data: [
        {
          studentId: students[2].id,
          dietType: 'Alergi Telur',
          allergies: ['Telur', 'Produk telur'],
          medicalNotes:
            'Diagnosis alergi dari dr. Rina, Puskesmas Sukabumi. Batasan: Tidak boleh mengonsumsi makanan yang mengandung telur dalam bentuk apapun.',
          isActive: true,
          approvedById: teacherSdItUser.id,
          approvedAt: new Date(),
          startDate: new Date(),
        },
        {
          studentId: students[0].id,
          dietType: 'Asma - Pantang Dingin',
          allergies: [],
          medicalNotes:
            'Riwayat asma ringan. Batasan: Hindari minuman dingin dan es. Makanan tidak boleh terlalu pedas.',
          isActive: true,
          approvedById: teacherPesantrenUser.id,
          approvedAt: new Date(),
          startDate: new Date(),
        },
      ],
    });
  }
  console.log('   ✅ Special diet records created');

  // --- Foundation Document ---
  await prisma.foundationDocument.createMany({
    data: [
      {
        foundationId: foundation.id,
        name: 'Akta Pendirian Yayasan',
        type: 'akta',
        fileUrl: '/documents/foundation/akta-pendirian.pdf',
        notes: 'Akta notaris pendirian Yayasan Pesantren Cipansor.',
        issueDate: new Date(),
      },
      {
        foundationId: foundation.id,
        name: 'SK Kemenkumham',
        type: 'sk',
        fileUrl: '/documents/foundation/sk-kemenkumham.pdf',
        notes: 'Surat Keputusan pengesahan dari Kementerian Hukum dan HAM.',
        issueDate: new Date(),
      },
      {
        foundationId: foundation.id,
        name: 'NPWP Yayasan',
        type: 'lainnya',
        fileUrl: '/documents/foundation/npwp-yayasan.pdf',
        notes: 'Nomor Pokok Wajib Pajak Yayasan.',
        issueDate: new Date(),
      },
    ],
  });
  console.log('   ✅ Foundation documents created');

  // ============================================
  // PHASE 12: Comprehensive Demo Data Part 2 (Additional Empty Models)
  // ============================================
  console.log('\n🔧 Seeding Phase 12 comprehensive demo data (Additional Empty Models)...');

  // --- Student Documents & Digital Certificates ---
  if (students.length > 0) {
    await prisma.studentDocument.createMany({
      data: [
        {
          studentId: students[0].id,
          documentType: DocumentType.BIRTH_CERTIFICATE,
          title: 'Akta Kelahiran - Muhammad Rizky',
          description: 'Dokumen resmi akta kelahiran santri.',
          fileUrl: '/documents/students/akta-rizky.pdf',
          status: DocumentStatus.VERIFIED,
          uploadedById: superAdminUser.id,
          verifiedById: adminPesantrenUser.id,
          verifiedAt: new Date(),
        },
        {
          studentId: students[0].id,
          documentType: DocumentType.FAMILY_CARD,
          title: 'Kartu Keluarga - Rizky',
          fileUrl: '/documents/students/kk-rizky.pdf',
          status: DocumentStatus.VERIFIED,
          uploadedById: superAdminUser.id,
          verifiedById: adminPesantrenUser.id,
          verifiedAt: new Date(),
        },
      ],
    });

    await prisma.digitalCertificate.create({
      data: {
        studentId: students[0].id,
        certificateType: 'TAHFIDZ',
        title: 'Sertifikat Tahfidz Juz 30',
        description: "Diberikan atas keberhasilan menyelesaikan hafalan Al-Qur'an Juz 30.",
        certificateNumber: 'CERT-TFZ-30-2024001',
        // Right domain, wrong path: `/verify/<number>` has never been a route
        // here. Seed rows are what the certificates screen renders on a fresh
        // database, so a dead link seeded in is a dead link demonstrated.
        qrCode: 'CERT-TFZ-30-2024001',
        verificationUrl: 'https://cipansor.or.id/public/verify-sanad?code=CERT-TFZ-30-2024001',
        grade: 'MUMTAZ',
        issueDate: new Date('2024-10-15'),
        signatoryName: 'KH. Abdullah Syukur',
        signatoryTitle: 'Pimpinan Yayasan Pesantren Cipansor',
        // What the printed syahadah carries. A freshly minted certificate now
        // stores this at mint time so its public download reproduces the
        // issued document; the seed row mirrors that so a fresh database
        // demonstrates the real flow rather than a generic certificate.
        metadata: {
          qiraahType: "Hafs 'an 'Asim",
          completedJuz: [30],
          musyrifName: 'Ust. Ahmad Fauzi',
        },
        isPublic: true,
        createdById: superAdminUser.id,
      },
    });
  }
  console.log('   ✅ Student documents and digital certificates created');

  // --- Kitab Master, Assignment, Progress & Records ---
  const kitabFathulMuin = await prisma.kitab.create({
    data: {
      unitId: smpIt.id,
      name: "Fathul Mu'in",
      author: 'Syekh Zainuddin Al-Malibari',
      category: KitabCategory.FIQH,
      level: KitabLevel.MENENGAH,
      description: "Kitab fiqih madzhab Syafi'i yang populer digunakan di pesantren.",
      totalBab: 4,
      totalHalaman: 150,
      isActive: true,
    },
  });

  const kitabTafsirJalalain = await prisma.kitab.create({
    data: {
      unitId: smpIt.id,
      name: 'Tafsir Al-Jalalain',
      author: 'Jalaluddin Al-Mahalli & Jalaluddin As-Suyuthi',
      category: KitabCategory.TAFSIR,
      level: KitabLevel.LANJUT,
      description: "Kitab tafsir Al-Qur'an klasik.",
      totalBab: 30,
      totalHalaman: 600,
      isActive: true,
    },
  });

  if (kitabFathulMuin && teacherPesantren) {
    const kitabAssign1 = await prisma.kitabAssignment.create({
      data: {
        kitabId: kitabFathulMuin.id,
        classId: class7A.id,
        academicYearId: academicYear.id,
        teacherId: teacherPesantren.id,
        semester: 'GANJIL',
        targetBab: 2,
        notes: 'Target semester ganjil menyelesaikan Bab Ibadah dan Bab Muamalah.',
      },
    });

    if (students.length > 0) {
      const studentProgress = await prisma.kitabStudentProgress.create({
        data: {
          studentId: students[0].id,
          kitabAssignmentId: kitabAssign1.id,
          currentBab: 1,
          currentHalaman: 25,
          status: KitabProgressStatus.IN_PROGRESS,
          notes: 'Pemahaman materi fiqih thoharoh cukup baik.',
        },
      });

      await prisma.kitabProgressRecord.create({
        data: {
          studentId: students[0].id,
          kitabAssignmentId: kitabAssign1.id,
          kitabId: kitabFathulMuin.id,
          date: new Date(),
          assessmentType: KitabAssessmentType.SOROGAN,
          babNumber: 1,
          halamanStart: 20,
          halamanEnd: 25,
          score: 85,
          predicate: 'A',
          isPassed: true,
          notes: 'Setoran lancar, pemahaman tajam.',
          recordedById: teacherPesantrenUser.id,
        },
      });
    }
  }
  console.log('   ✅ Kitab models and assignments created');

  // --- Portfolio & Showcase ---
  if (students.length > 0) {
    const portfolio = await prisma.portfolio.create({
      data: {
        studentId: students[0].id,
        title: 'Esai Nilai-Nilai Kepemimpinan dalam Islam',
        type: 'ACADEMIC',
        category: 'Pelajaran Agama',
        description:
          'Tugas akhir mata pelajaran Aqidah Akhlak mengenai kepemimpinan Khulafaur Rasyidin.',
        reflection:
          'Saya belajar banyak tentang pentingnya sifat amanah dan shiddiq dari kepemimpinan para Khalifah.',
        academicYearId: academicYear.id,
        score: new Prisma.Decimal(92.5),
        feedback: 'Analisis mendalam dengan sumber pustaka yang lengkap. Kerja bagus!',
        isPublic: true,
        isShowcase: true,
        reviewedBy: teacherPesantrenUser.id,
        reviewedAt: new Date(),
      },
    });

    const pFile = await prisma.portfolioFile.create({
      data: {
        portfolioId: portfolio.id,
        fileName: 'esai-kepemimpinan-islam.pdf',
        fileUrl: '/documents/portfolios/esai-kepemimpinan.pdf',
        fileType: 'document',
        isCover: true,
      },
    });

    await prisma.portfolioComment.create({
      data: {
        portfolioId: portfolio.id,
        userId: parentUsers[0]?.user?.id || teacherPesantrenUser.id,
        content: 'Sangat bangga melihat tulisan ini. Terus tingkatkan prestasimu, nak!',
      },
    });
  }
  console.log('   ✅ Student portfolio documents created');

  // --- Rapor Pesantren (Islamic Education Report Cards) ---
  if (students.length > 0) {
    await prisma.raporPesantren.create({
      data: {
        studentId: students[0].id,
        unitId: smpIt.id,
        academicYearId: academicYear.id,
        semester: 1,
        status: 'PUBLISHED',
        tahfidzData: {
          tahfidzScore: 88,
          tahfidzGrade: 'Mumtaz',
          recentSurahs: ['Juz 30', 'Juz 29'],
        },
        takhosusData: {
          takhosusName: 'Takhosus Hifdzil Quran',
          attendanceRate: 95,
        },
        ibadahData: {
          sholatFardhuPercentage: 100,
          sholatRawatibCount: 30,
        },
        muhadhorohData: {
          speechSkillScore: 85,
          speechGrade: 'Baik',
        },
        overallScore: 89.5,
        overallGrade: 'A',
        notes: "Pertahankan prestasi akademik dan hafalan Al-Qur'an.",
        musyrifNotes: 'Perilaku sangat baik dan teladan bagi teman-teman di asrama.',
        headTeacherNotes: 'Sangat baik dalam interaksi sosial dan kegiatan ibadah.',
        principalNotes: 'Naik ke kelas berikutnya dengan predikat Istimewa.',
        publishedAt: new Date(),
      },
    });
  }
  console.log('   ✅ Rapor Pesantren created');

  // --- PAUD Development Assessment & Narrative Reports ---
  //
  // Assessed against a TK pupil, not `students[3]`. That index is Abdullah
  // Rahman of SMA Qur'an — a teenager — and the rows still claimed
  // `unitId: tkQuran.id`, so an early-childhood development record described
  // someone ten years too old for it. There were simply no TK pupils to point
  // at until they were seeded above.
  if (tkPupils.length > 0) {
    const paudIndicators = await prisma.pAUDDevelopmentIndicator.findMany({
      where: { OR: [{ unitId: tkQuran.id }, { unitId: null }] },
      take: 2,
    });

    if (paudIndicators.length > 0) {
      const paudAssessment = await prisma.pAUDDevelopmentAssessment.create({
        data: {
          studentId: tkPupils[0].id,
          unitId: tkQuran.id,
          academicYearId: academicYear.id,
          semester: 'GANJIL',
          periodType: PAUDReportPeriod.SEMESTER,
          periodDate: new Date('2024-11-25'),
          aspect: PAUDAspect.NAM,
          indicatorId: paudIndicators[0].id,
          achievementLevel: PAUDAchievementLevel.BSH,
          narrativeText:
            'Anak menunjukkan sikap sopan santun dan terbiasa melafalkan doa harian secara mandiri.',
          teacherNotes: 'Sangat baik dalam menghafal surat pendek.',
          assessedById: teacherSdItUser.id,
        },
      });

      await prisma.pAUDAssessmentEvidence.create({
        data: {
          assessmentId: paudAssessment.id,
          fileUrl: '/images/assessments/nam-doa.jpg',
          fileType: 'image',
          fileName: 'berdoa-bersama.jpg',
          caption: 'Berdoa secara khusyuk sebelum memulai pelajaran.',
        },
      });
    }

    const narrativeReport = await prisma.pAUDNarrativeReport.create({
      data: {
        studentId: tkPupils[0].id,
        unitId: tkQuran.id,
        academicYearId: academicYear.id,
        semester: 'GANJIL',
        narrativeNAM:
          'Alhamdulillah, dalam aspek nilai agama dan moral, anak terbiasa mengucapkan salam, mau berbagi makanan dengan temannya, dan lancar melafalkan surat Al-Fatihah serta surat-surat pendek.',
        narrativeFM:
          'Dalam aspek fisik motorik, anak sangat aktif bergerak dan terampil dalam melipat kertas origami serta menyusun balok kayu.',
        narrativeKOG:
          'Dalam aspek kognitif, anak sudah dapat membedakan pola warna dasar dan mengelompokkan bentuk-bentuk geometri secara tepat.',
        narrativeBHS:
          'Dalam aspek bahasa, anak dapat mengutarakan keinginan dengan kalimat yang lengkap dan senang mendengarkan cerita guru.',
        narrativeSE:
          'Dalam aspek sosial emosional, anak bersikap ramah, menunjukkan kepedulian terhadap teman yang sedang sedih, dan mau antre giliran.',
        narrativeSNI:
          'Dalam aspek seni, anak sangat percaya diri saat bernyanyi lagu anak islami di depan kelas dan gemar mewarnai gambar pemandangan.',
        overallStrengths: 'Sangat menonjol dalam hafalan doa harian dan sifat peduli sesama.',
        areasForDevelopment: 'Perlu bimbingan untuk konsentrasi lebih lama saat kegiatan menulis.',
        parentRecommendations:
          'Disarankan mengajak anak berlatih memegang pensil dengan benar di rumah.',
        totalDays: 100,
        presentDays: 95,
        sickDays: 3,
        excusedDays: 2,
        status: 'FINALIZED',
        finalizedAt: new Date(),
        createdById: teacherSdItUser.id,
      },
    });

    await prisma.pAUDReportPhoto.create({
      data: {
        reportId: narrativeReport.id,
        photoUrl: '/images/reports/paud-activity.jpg',
        caption: 'Mewarnai gambar pemandangan dengan rapi.',
        orderNumber: 1,
      },
    });
  }
  console.log('   ✅ PAUD Narrative reports and assessments created');

  // ============================================
  // PHASE 13: Extra Empty Table Fill for Demo
  // ============================================
  console.log('\n🔧 Seeding Phase 13 extra empty table fill for demo...');

  // 1. Academic Assignments & Submissions
  console.log('   Seeding Assignments & Submissions...');
  const assignment1 = await prisma.assignment.create({
    data: {
      unitId: smpIt.id,
      academicYearId: academicYear.id,
      teacherId: teacherPesantren.id,
      subjectId: subjects[0].id, // Matematika
      classId: class7A.id,
      title: 'Tugas Operasi Aljabar',
      description: 'Selesaikan soal latihan halaman 45 nomor 1 sampai 5 di buku PR masing-masing.',
      type: AssignmentType.INDIVIDUAL,
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    },
  });

  const assignment2 = await prisma.assignment.create({
    data: {
      unitId: smpIt.id,
      academicYearId: academicYear.id,
      teacherId: teacherPesantren.id,
      subjectId: subjects[0].id, // Matematika
      classId: class7A.id,
      title: 'Projek Geometri Bangun Ruang',
      description: 'Buatlah model jaring-jaring kubus dan balok menggunakan kertas karton tebal.',
      type: AssignmentType.GROUP,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  if (students.length >= 2) {
    await prisma.assignmentSubmission.create({
      data: {
        assignmentId: assignment1.id,
        studentId: students[0].id,
        content:
          'Saya sudah mengerjakan tugas Aljabar, berikut adalah link pengerjaan tugas saya pak.',
        status: SubmissionStatus.SUBMITTED,
        submittedAt: new Date(),
      },
    });

    await prisma.assignmentSubmission.create({
      data: {
        assignmentId: assignment1.id,
        studentId: students[1].id,
        content: 'Tugas Aljabar Ahmad Fauzan selesai.',
        status: SubmissionStatus.GRADED,
        grade: new Prisma.Decimal(95.0),
        feedback: 'Hasil pengerjaan sangat rapi dan semua jawaban benar. Sangat bagus!',
        submittedAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
      },
    });
  }
  console.log('   ✅ Assignments & Submissions created');

  // 2. Kurikulum Merdeka LearningObjectives & assessments & results
  console.log('   Seeding Kurikulum Merdeka Objectives & Assessments...');
  // Find learning outcome for Matematika
  const loMtk = await prisma.learningOutcome.findFirst({
    where: { subjectId: subjects[0].id },
  });

  if (loMtk) {
    const loId = loMtk.id;

    // Seed learning objective
    const loObjective1 = await prisma.learningObjective.create({
      data: {
        learningOutcomeId: loId,
        code: 'TP-MTK-7A-01',
        description:
          'Siswa dapat menjelaskan konsep bilangan bulat dan melakukan operasi aritmatika dasar pada bilangan bulat.',
        indicators: [
          'Mampu mengurutkan bilangan bulat',
          'Mampu menjumlahkan dan mengurangkan bilangan bulat',
          'Mampu mengalikan dan membagi bilangan bulat',
        ],
        sequence: 1,
        isActive: true,
      },
    });

    const loObjective2 = await prisma.learningObjective.create({
      data: {
        learningOutcomeId: loId,
        code: 'TP-MTK-7A-02',
        description:
          'Siswa dapat memecahkan masalah kontekstual yang berkaitan dengan bilangan bulat.',
        indicators: [
          'Mampu mengidentifikasi informasi penting dalam soal cerita',
          'Mampu merumuskan model matematika',
          'Mampu menyelesaikan model matematika',
        ],
        sequence: 2,
        isActive: true,
      },
    });

    // Seed TeachingModule
    await prisma.teachingModule.create({
      data: {
        learningObjectiveId: loObjective1.id,
        teacherId: teacherPesantren.id,
        classId: class7A.id,
        title: 'Modul Ajar: Bilangan Bulat dan Operasinya',
        topic: 'Bilangan Bulat',
        duration: 90,
        objectives:
          'Peserta didik memahami sifat-sifat operasi hitung bilangan bulat dan dapat menerapkannya.',
        prerequisites: 'Kemampuan penjumlahan dan pengurangan bilangan cacah dasar',
        targetLearners: 'Regular / umum',
        materials: ['Buku paket matematika kelas 7', 'LKS', 'Proyektor'],
        activities: [
          'Pendahuluan (15 menit): Apersepsi kehidupan sehari-hari',
          'Kegiatan Inti (60 menit): Diskusi kelompok dan latihan soal',
          'Penutup (15 menit): Refleksi pembelajaran',
        ],
        assessmentPlan: { formatif: 'Kuis tertulis', sumatif: 'Tes akhir bab' },
        differentiation: { pengayaan: 'Tugas menantang', remedial: 'Bimbingan khusus' },
        isPublished: true,
      },
    });

    // Seed MerdekaAssessment
    const merdekaAssessment = await prisma.merdekaAssessment.create({
      data: {
        unitId: smpIt.id,
        classId: class7A.id,
        subjectId: subjects[0].id,
        learningObjectiveId: loObjective1.id,
        teacherId: teacherPesantren.id,
        academicYearId: academicYear.id,
        title: 'Asesmen Formatif: Bilangan Bulat',
        category: 'FORMATIF',
        description: 'Ujian formatif pertama untuk bab Bilangan Bulat.',
        instructions: 'Kerjakan soal-soal berikut secara mandiri tanpa menggunakan kalkulator.',
        assessmentDate: new Date(),
        duration: 45,
        maxScore: new Prisma.Decimal(100.0),
        weight: new Prisma.Decimal(1.0),
        status: 'COMPLETED',
      },
    });

    // Seed MerdekaAssessmentResult
    if (students.length >= 2) {
      await prisma.merdekaAssessmentResult.create({
        data: {
          assessmentId: merdekaAssessment.id,
          studentId: students[0].id,
          score: new Prisma.Decimal(88.0),
          percentage: new Prisma.Decimal(88.0),
          grade: 'B+',
          feedback: 'Bagus, pertahankan prestasimu dan teliti lagi saat menghitung pembagian.',
          gradedById: teacherPesantrenUser.id,
        },
      });

      await prisma.merdekaAssessmentResult.create({
        data: {
          assessmentId: merdekaAssessment.id,
          studentId: students[1].id,
          score: new Prisma.Decimal(96.0),
          percentage: new Prisma.Decimal(96.0),
          grade: 'A',
          feedback: 'Sangat luar biasa! Jawaban sangat rapi dan logis.',
          gradedById: teacherPesantrenUser.id,
        },
      });
    }
  }
  console.log('   ✅ Kurikulum Merdeka Objectives & Assessments created');

  // 3. P5 Projects & Assessments
  console.log('   Seeding P5 Projects & Assessments...');
  let p5Theme = await prisma.p5Theme.findFirst();
  if (!p5Theme) {
    p5Theme = await prisma.p5Theme.create({
      data: {
        code: 'GAYA_HIDUP',
        name: 'Gaya Hidup Berkelanjutan',
        description:
          'Membangun kesadaran santri untuk berperilaku ramah lingkungan dan mengelola sampah.',
        isActive: true,
      },
    });
  }
  if (p5Theme) {
    const p5Project = await prisma.p5Project.create({
      data: {
        unitId: smpIt.id,
        academicYearId: academicYear.id,
        themeId: p5Theme.id,
        classId: class7A.id,
        title: 'Komposku Subur, Bumiku Makmur',
        description:
          'Projek pengolahan sampah organik pesantren menjadi pupuk kompos berkualitas tinggi guna menyuburkan tanaman lingkungan asrama.',
        objectives: [
          'Membangun kepedulian santri terhadap pengelolaan sampah',
          'Mengembangkan kreativitas santri dalam memanfaatkan sampah organik',
          'Menumbuhkan kerja sama tim antar santri',
        ],
        dimensions: ['BERIMAN', 'BERGOTONG_ROYONG', 'KREATIF'],
        activities: [
          'Sosialisasi dampak sampah dan konsep 3R',
          'Praktik pemilahan sampah organik dan anorganik',
          'Pembuatan wadah komposter dan pengolahan kompos',
          'Pemanenan kompos and aplikasi pada kebun pesantren',
        ],
        startDate: new Date('2024-09-01'),
        endDate: new Date('2024-11-30'),
        supervisorId: teacherPesantren.id,
        status: 'ACTIVE',
      },
    });

    if (students.length >= 2) {
      await prisma.p5Assessment.create({
        data: {
          projectId: p5Project.id,
          studentId: students[0].id,
          beriman: 'BSH',
          berkebinekaan: 'BSH',
          bergotongroyong: 'SB',
          mandiri: 'BSH',
          bernalarkritis: 'BSH',
          kreatif: 'BSH',
          overallGrade: 'BSH',
          notes:
            'Muhammad Rizky sangat bersemangat saat memimpin kelompoknya mengumpulkan daun kering di kebun.',
          assessedById: teacherPesantren.id,
        },
      });

      await prisma.p5Assessment.create({
        data: {
          projectId: p5Project.id,
          studentId: students[1].id,
          beriman: 'BSH',
          berkebinekaan: 'BSH',
          bergotongroyong: 'BSH',
          mandiri: 'SB',
          bernalarkritis: 'BSH',
          kreatif: 'SB',
          overallGrade: 'SB',
          notes:
            'Ahmad Fauzan menunjukkan kreativitas tinggi dalam mendesain wadah komposter dari barang bekas.',
          assessedById: teacherPesantren.id,
        },
      });
    }
  }
  console.log('   ✅ P5 Projects & Assessments created');

  // 4. Questions & CBT Exam Attempts
  console.log('   Seeding Questions & CBT Exam Attempts...');
  const qBank = await prisma.questionBank.create({
    data: {
      unitId: smpIt.id,
      subjectId: subjects[0].id, // Matematika
      teacherId: teacherPesantren.id,
      title: 'Kumpulan Soal Matematika Kelas VII Semester Ganjil',
      description: 'Bank soal kelas 7 semester ganjil',
    },
  });

  const question1 = await prisma.question.create({
    data: {
      bankId: qBank.id,
      type: 'MULTIPLE_CHOICE',
      content: 'Berapakah hasil dari operasi bilangan bulat: -15 + 8 x (-2)?',
      options: ['-31', '-14', '46', '1'],
      answerKey: '-31',
      points: 25,
    },
  });

  const question2 = await prisma.question.create({
    data: {
      bankId: qBank.id,
      type: 'MULTIPLE_CHOICE',
      content:
        'Suhu mula-mula suatu ruangan adalah -5 derajat Celcius. Setelah penghangat ruangan dinyalakan, suhunya naik 12 derajat Celcius. Berapa suhu ruangan sekarang?',
      options: ['-17', '7', '17', '-7'],
      answerKey: '7',
      points: 25,
    },
  });

  const exam = await prisma.exam.findFirst({
    where: { unitId: smpIt.id },
  });

  if (exam && students.length > 0) {
    const examAttempt = await prisma.examAttempt.create({
      data: {
        examId: exam.id,
        studentId: students[0].id,
        score: new Prisma.Decimal(75.0),
        status: ExamAttemptStatus.COMPLETED,
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        finishedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
      },
    });

    await prisma.examAnswer.create({
      data: {
        attemptId: examAttempt.id,
        questionId: question1.id,
        answer: '-31',
        isCorrect: true,
        score: new Prisma.Decimal(25.0),
      },
    });

    await prisma.examAnswer.create({
      data: {
        attemptId: examAttempt.id,
        questionId: question2.id,
        answer: '7',
        isCorrect: true,
        score: new Prisma.Decimal(25.0),
      },
    });
  }
  console.log('   ✅ Questions & CBT Exam Attempts created');

  // 5. E-Office Correspondence Reviewers & Recipients
  console.log('   Seeding Letter Reviewers & Recipients...');
  const letter = await prisma.letter.findFirst();
  if (letter) {
    await prisma.letterReviewer.create({
      data: {
        letterId: letter.id,
        reviewerId: adminPesantrenUser.id,
        order: 1,
        status: 'APPROVED',
        notes: 'Surat sudah sesuai format, disetujui.',
        reviewedAt: new Date(),
      },
    });

    await prisma.letterRecipient.create({
      data: {
        letterId: letter.id,
        userId: teacherPesantrenUser.id,
        isCC: false,
        readAt: new Date(),
      },
    });
  }
  console.log('   ✅ Letter Reviewers & Recipients created');

  // 6. Finance & Budgets
  console.log('   Seeding Accounting Financial Periods, Budgets & Journal Entries...');
  const finPeriod = await prisma.financialPeriod.create({
    data: {
      unitId: smpIt.id,
      name: 'Juni 2026',
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-30'),
      isClosed: false,
      notes: 'Periode aktif akuntansi berjalan.',
    },
  });

  const mtkAccount = await prisma.accountCode.findFirst({
    where: { code: '5104' }, // Beban ATK
  });

  const electricityAccount = await prisma.accountCode.findFirst({
    where: { code: '5105' }, // Beban Listrik
  });

  const kasAccount = await prisma.accountCode.findFirst({
    where: { code: '1101' }, // Kas Tunai
  });

  const sppAccount = await prisma.accountCode.findFirst({
    where: { code: '4101' }, // Pendapatan SPP
  });

  if (mtkAccount) {
    await prisma.budget.create({
      data: {
        unitId: smpIt.id,
        academicYearId: academicYear.id,
        accountId: mtkAccount.id,
        amount: new Prisma.Decimal(5000000.0),
        usedAmount: new Prisma.Decimal(1250000.0),
        periodType: 'YEARLY',
        notes: 'Anggaran belanja Alat Tulis Kantor SMP IT.',
        createdById: superAdminUser.id,
      },
    });
  }

  if (electricityAccount) {
    await prisma.budget.create({
      data: {
        unitId: smpIt.id,
        academicYearId: academicYear.id,
        accountId: electricityAccount.id,
        amount: new Prisma.Decimal(12000000.0),
        usedAmount: new Prisma.Decimal(4500000.0),
        periodType: 'YEARLY',
        notes: 'Anggaran tagihan listrik bulanan kampus pesantren.',
        createdById: superAdminUser.id,
      },
    });
  }

  if (kasAccount && sppAccount) {
    await prisma.journalEntry.create({
      data: {
        unitId: smpIt.id,
        accountId: kasAccount.id,
        date: new Date(),
        description: 'Penerimaan SPP siswa Muhammad Rizky kelas 7A',
        debit: new Prisma.Decimal(500000.0),
        credit: new Prisma.Decimal(0.0),
        reference: 'INV-2024001',
        referenceType: 'INVOICE',
        createdById: superAdminUser.id,
      },
    });

    await prisma.journalEntry.create({
      data: {
        unitId: smpIt.id,
        accountId: sppAccount.id,
        date: new Date(),
        description: 'Penerimaan SPP siswa Muhammad Rizky kelas 7A',
        debit: new Prisma.Decimal(0.0),
        credit: new Prisma.Decimal(500000.0),
        reference: 'INV-2024001',
        referenceType: 'INVOICE',
        createdById: superAdminUser.id,
      },
    });
  }
  console.log('   ✅ Accounting Periods, Budgets & Journals created');

  // 7. HR Payroll
  console.log('   Seeding Salary Components, Employee Salaries & Payroll Periods...');
  const compGajiPokok = await prisma.salaryComponent.create({
    data: {
      code: 'BASIC_SALARY',
      name: 'Gaji Pokok',
      type: 'EARNING',
      description: 'Komponen gaji pokok pokok',
      isFixed: true,
      isPercentage: false,
      defaultAmount: new Prisma.Decimal(3000000.0),
      isTaxable: true,
      sortOrder: 1,
    },
  });

  const compTunjMakan = await prisma.salaryComponent.create({
    data: {
      code: 'MEAL_ALLOWANCE',
      name: 'Tunjangan Uang Makan',
      type: 'EARNING',
      description: 'Tunjangan konsumsi makan harian karyawan',
      isFixed: true,
      isPercentage: false,
      defaultAmount: new Prisma.Decimal(500000.0),
      isTaxable: true,
      sortOrder: 2,
    },
  });

  const compPph21 = await prisma.salaryComponent.create({
    data: {
      code: 'PPH21_DEDUCTION',
      name: 'Potongan PPh 21',
      type: 'DEDUCTION',
      description: 'Potongan pajak penghasilan pasal 21',
      isFixed: false,
      isPercentage: false,
      defaultAmount: new Prisma.Decimal(50000.0),
      isTaxable: false,
      sortOrder: 3,
    },
  });

  const allStaff = await prisma.staff.findMany({ include: { user: true } });
  for (const staff of allStaff) {
    const empSalary = await prisma.employeeSalary.create({
      data: {
        staffId: staff.id,
        baseSalary: new Prisma.Decimal(3500000.0),
        bankName: 'Bank Mandiri',
        bankAccount: '1330099887766',
        bankHolder: staff.user.name,
        taxStatus: 'TK/0',
        effectiveAt: new Date('2024-01-01'),
        notes: 'Pengaturan gaji awal kontrak.',
      },
    });

    await prisma.employeeSalaryItem.create({
      data: {
        salaryId: empSalary.id,
        componentId: compGajiPokok.id,
        amount: new Prisma.Decimal(3000000.0),
        isPercentage: false,
      },
    });

    await prisma.employeeSalaryItem.create({
      data: {
        salaryId: empSalary.id,
        componentId: compTunjMakan.id,
        amount: new Prisma.Decimal(500000.0),
        isPercentage: false,
      },
    });
  }

  const payPeriod = await prisma.payrollPeriod.create({
    data: {
      unitId: smpIt.id,
      name: 'Gaji Bulanan Juni 2026',
      month: 6,
      year: 2026,
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-30'),
      payDate: new Date('2026-06-25'),
      status: PayrollStatus.PAID,
      totalAmount: new Prisma.Decimal(allStaff.length * 3500000.0),
      employeeCount: allStaff.length,
      createdById: superAdminUser.id,
      paidAt: new Date(),
    },
  });

  for (const staff of allStaff) {
    const payroll = await prisma.payroll.create({
      data: {
        periodId: payPeriod.id,
        staffId: staff.id,
        employeeNo: staff.nip || 'NIP-001',
        employeeName: staff.user.name,
        department: staff.department || 'Akademik',
        position: staff.position,
        baseSalary: new Prisma.Decimal(3500000.0),
        totalEarnings: new Prisma.Decimal(3500000.0),
        totalDeductions: new Prisma.Decimal(50000.0),
        netSalary: new Prisma.Decimal(3450000.0),
        taxableIncome: new Prisma.Decimal(0.0),
        taxAmount: new Prisma.Decimal(0.0),
        taxStatus: 'TK/0',
        bankName: 'Bank Mandiri',
        bankAccount: '1330099887766',
        bankHolder: staff.user.name,
        workDays: 25,
        presentDays: 24,
        absentDays: 1,
        lateDays: 2,
        overtimeHours: new Prisma.Decimal(5.0),
        status: PayrollStatus.PAID,
      },
    });

    await prisma.payrollItem.create({
      data: {
        payrollId: payroll.id,
        componentId: compGajiPokok.id,
        componentCode: compGajiPokok.code,
        componentName: compGajiPokok.name,
        type: 'EARNING',
        amount: new Prisma.Decimal(3000000.0),
        isPercentage: false,
      },
    });

    await prisma.payrollItem.create({
      data: {
        payrollId: payroll.id,
        componentId: compTunjMakan.id,
        componentCode: compTunjMakan.code,
        componentName: compTunjMakan.name,
        type: 'EARNING',
        amount: new Prisma.Decimal(500000.0),
        isPercentage: false,
      },
    });

    await prisma.payrollItem.create({
      data: {
        payrollId: payroll.id,
        componentId: compPph21.id,
        componentCode: compPph21.code,
        componentName: compPph21.name,
        type: 'DEDUCTION',
        amount: new Prisma.Decimal(50000.0),
        isPercentage: false,
      },
    });
  }
  console.log('   ✅ Payroll Components, Salaries & Periods created');

  // 8. Projects & Board
  console.log('   Seeding Projects & Kanban Boards...');
  const project1 = await prisma.project.create({
    data: {
      unitId: smpIt.id,
      name: 'Pembangunan Gedung Kelas Baru Tahap II',
      description: 'Proyek pembangunan 3 lokal ruang kelas baru tingkat SMP IT di lantai 2.',
      status: ProjectStatus.IN_PROGRESS,
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-08-31'),
      managerId: adminPesantrenUser.id,
    },
  });

  await prisma.projectMember.create({
    data: {
      projectId: project1.id,
      userId: adminPesantrenUser.id,
      role: 'MANAGER',
    },
  });

  await prisma.projectMember.create({
    data: {
      projectId: project1.id,
      userId: teacherPesantrenUser.id,
      role: 'MEMBER',
    },
  });

  const colToDo = await prisma.projectColumn.create({
    data: {
      projectId: project1.id,
      name: 'To Do',
      order: 1,
    },
  });

  const colInProgress = await prisma.projectColumn.create({
    data: {
      projectId: project1.id,
      name: 'In Progress',
      order: 2,
    },
  });

  const colDone = await prisma.projectColumn.create({
    data: {
      projectId: project1.id,
      name: 'Done',
      order: 3,
    },
  });

  await prisma.projectTask.create({
    data: {
      projectId: project1.id,
      columnId: colToDo.id,
      title: 'Pemasangan genteng dan plafon',
      description: 'Pemasangan genteng tanah liat dan plafon gypsum lokal kelas 2.',
      priority: TaskPriority.HIGH,
    },
  });

  await prisma.projectTask.create({
    data: {
      projectId: project1.id,
      columnId: colInProgress.id,
      title: 'Plester dinding dan instalasi listrik',
      description: 'Plester dinding hebel kelas baru dan pemasangan kabel stopkontak.',
      priority: TaskPriority.MEDIUM,
    },
  });

  await prisma.projectTask.create({
    data: {
      projectId: project1.id,
      columnId: colDone.id,
      title: 'Pengecoran tiang pancang pondasi',
      description: 'Pengecoran beton ready-mix untuk struktur tiang penyangga utama.',
      priority: TaskPriority.URGENT,
    },
  });
  console.log('   ✅ Projects, Columns & Tasks created');

  // 9. SOP & Revisions
  console.log('   Seeding Standard Operating Procedures...');
  const sop1 = await prisma.standardOperatingProcedure.create({
    data: {
      unitId: smpIt.id,
      documentNumber: 'SOP-RECEPT-001',
      title: 'Prosedur Penerimaan Tamu dan Kunjungan Wali Santri',
      category: 'RECEPTION',
      content:
        'Langkah-langkah penerimaan tamu:\n1. Tamu wajib melapor ke petugas piket / satpam pesantren.\n2. Mengisi buku tamu digital dan menitipkan kartu identitas (KTP/SIM).\n3. Petugas mengkonfirmasi ke bagian kepengasuhan.\n4. Wali santri hanya diperbolehkan bertemu di area pendopo utama pesantren.',
      status: SOPStatus.APPROVED,
      createdById: adminPesantrenUser.id,
    },
  });

  await prisma.sOPRevision.create({
    data: {
      sopId: sop1.id,
      version: 1,
      changeNotes: 'Inisiasi draf awal prosedur penerimaan tamu.',
      revisedById: adminPesantrenUser.id,
    },
  });
  console.log('   ✅ SOPs & Revisions created');

  // 10. Risk Management
  console.log('   Seeding Risk Registers & Mitigations...');
  const risk1 = await prisma.risk.create({
    data: {
      unitId: smpIt.id,
      code: 'RSK-001',
      description:
        'Risiko keterlambatan pembayaran SPP santri di atas tanggal 10 setiap bulannya, yang dapat menghambat cashflow operasional yayasan.',
      category: RiskCategory.FINANCIAL,
      likelihood: RiskLikelihood.POSSIBLE,
      impact: RiskImpact.MAJOR,
      riskScore: 12,
      riskLevel: RiskLevel.HIGH,
      status: 'OPEN',
      ownerId: adminPesantrenUser.id,
      createdById: adminPesantrenUser.id,
    },
  });

  await prisma.riskMitigation.create({
    data: {
      riskId: risk1.id,
      strategy: MitigationStrategy.REDUCE,
      actionPlan:
        'Menerapkan notifikasi tagihan otomatis via WhatsApp blast H-3 sebelum jatuh tempo, serta pembatasan akses portal santri jika menunggak 2 bulan.',
      isCompleted: false,
      progress: 50,
      createdById: adminPesantrenUser.id,
    },
  });
  console.log('   ✅ Risk Registers & Mitigations created');

  // 11. Quality & Audits
  console.log('   Seeding Quality Standards & Audits...');
  const qualStd = await prisma.qualityStandard.create({
    data: {
      type: QualityStandardType.STANDAR_PROSES,
      name: 'Standar Perencanaan Pembelajaran',
      description:
        'Setiap guru mata pelajaran wajib menyerahkan Modul Ajar / RPP lengkap sebelum semester baru dimulai.',
    },
  });

  const qualInd = await prisma.qualityIndicator.create({
    data: {
      standardId: qualStd.id,
      code: 'IND-KUR-01-A',
      name: 'Rasio Kelengkapan Modul Ajar Guru',
      description:
        'Jumlah guru yang memiliki modul ajar yang disetujui dibagi dengan total guru aktif.',
      targetScore: 100,
    },
  });

  const qualAudit = await prisma.qualityAudit.create({
    data: {
      unitId: smpIt.id,
      code: 'AMI-2024-01',
      name: 'Audit Mutu Internal Proses Akademik 2024/2025',
      academicYearId: academicYear.id,
      startDate: new Date('2024-06-10'),
      endDate: new Date('2024-06-15'),
      status: AuditStatus.COMPLETED,
      leadAuditorId: superAdminUser.id,
    },
  });

  await prisma.qualityAuditItem.create({
    data: {
      auditId: qualAudit.id,
      indicatorId: qualInd.id,
      score: 85.0,
      notes: 'Masih terdapat 2 guru baru yang belum menyelesaikan Modul Ajar Matematika.',
    },
  });
  console.log('   ✅ Quality Standards & Audits created');

  // 12. Talent Management & Succession Plans
  console.log('   Seeding Talent Profiles & Succession Plans...');
  const tProfile = await prisma.talentProfile.create({
    data: {
      userId: teacherPesantrenUser.id,
      unitId: smpIt.id,
      category: TalentCategory.HIGH_POTENTIAL,
      currentRole: 'Guru Tetap SMP IT / Wali Kelas 7A',
      potentialRole: 'Kepala Bidang Kurikulum SMP IT',
      readinessLevel: '1-2 TAHUN',
      strengths: 'Kemampuan mengajar sangat baik, memahami kurikulum merdeka, disukai santri.',
      developmentAreas: 'Perlu penguatan kepemimpinan organisasi dan sertifikasi kepengawasan.',
      careerAspiration: 'Ingin berkarir di manajemen sekolah tingkat menengah.',
      lastAssessedAt: new Date(),
    },
  });

  await prisma.talentAssessment.create({
    data: {
      talentId: tProfile.id,
      assessorId: superAdminUser.id,
      period: '2024/2025 Ganjil',
      performanceRating: PerformanceRating.EXCEEDS,
      potentialRating: PerformanceRating.EXCEEDS,
      overallScore: 89.5,
      competencies: { pedagogik: 92, kepribadian: 88, sosial: 90, profesional: 88 },
      feedback:
        'Ustadz Ahmad memiliki kompetensi profesional yang sangat baik. Sangat layak didorong untuk menduduki posisi struktural akademik.',
      developmentPlan: 'Mengikuti program pelatihan manajemen sekolah terakreditasi.',
      assessedAt: new Date(),
    },
  });

  await prisma.successionPlan.create({
    data: {
      unitId: smpIt.id,
      positionTitle: 'Kepala Bidang Kurikulum SMP IT',
      currentHolderId: adminPesantrenUser.id,
      successorId: tProfile.id,
      readinessLevel: '1-2 TAHUN',
      priority: PlanPriority.HIGH,
      notes:
        'Ust. Ahmad diproyeksikan menggantikan karena pemahaman IT dan kurikulum merdeka yang menonjol.',
      targetDate: new Date('2026-07-01'),
    },
  });
  console.log('   ✅ Talent Profiles & Succession Plans created');

  // ============================================
  // PHASE 14: Comprehensive Demo Data for Empty Tables
  // ============================================
  console.log('\n🔧 Seeding Phase 14 comprehensive demo data (Additional Empty Models)...');

  // 1. Assets & Facilities (lands, buildings, room_types, facility_rooms, asset_audits, asset_audit_items, asset_disposals)
  console.log('   Seeding Lands, Buildings & Facility Rooms...');
  const land = await prisma.land.create({
    data: {
      unitId: smpIt.id,
      code: 'LND-001',
      address: 'Jl. Pesantren No. 1, Kota Sukabumi',
      area: new Prisma.Decimal(5000.0),
      ownership: LandOwnership.MILIK_SENDIRI,
      certificateNo: 'CERT-LND-001',
      certificateDate: new Date('2010-05-20'),
      acquisitionDate: new Date('2009-12-15'),
      acquisitionValue: new Prisma.Decimal(2500000000.0),
      notes: 'Tanah utama kampus pesantren.',
    },
  });

  const building = await prisma.building.create({
    data: {
      unitId: smpIt.id,
      landId: land.id,
      code: 'BLD-A',
      name: 'Gedung Umar bin Khattab',
      floors: 3,
      buildingArea: new Prisma.Decimal(1200.0),
      yearBuilt: 2012,
      condition: BuildingCondition.BAIK,
      notes: 'Gedung utama untuk ruang kelas dan administrasi.',
    },
  });

  const roomTypeKelas = await prisma.roomType.create({
    data: {
      code: 'KELAS',
      name: 'Ruang Kelas',
      description: 'Ruang untuk kegiatan belajar mengajar teori.',
    },
  });

  const roomTypeLab = await prisma.roomType.create({
    data: {
      code: 'LAB_KOMP',
      name: 'Laboratorium Komputer',
      description: 'Ruang praktikum komputer.',
    },
  });

  const roomTypePerpus = await prisma.roomType.create({
    data: {
      code: 'PERPUS',
      name: 'Perpustakaan',
      description: 'Ruang perpustakaan sekolah.',
    },
  });

  const facilityRoom1 = await prisma.facilityRoom.create({
    data: {
      unitId: smpIt.id,
      buildingId: building.id,
      roomTypeId: roomTypeKelas.id,
      code: 'RM-7A',
      name: 'Ruang Kelas 7A',
      floor: 1,
      length: new Prisma.Decimal(9.0),
      width: new Prisma.Decimal(8.0),
      area: new Prisma.Decimal(72.0),
      capacity: 32,
      condition: BuildingCondition.BAIK,
      facilities: ['AC', 'Proyektor', 'Whiteboard', '32 Kursi', '32 Meja'],
    },
  });

  const facilityRoom2 = await prisma.facilityRoom.create({
    data: {
      unitId: smpIt.id,
      buildingId: building.id,
      roomTypeId: roomTypeLab.id,
      code: 'RM-LAB-01',
      name: 'Lab Komputer 1',
      floor: 2,
      length: new Prisma.Decimal(12.0),
      width: new Prisma.Decimal(8.0),
      area: new Prisma.Decimal(96.0),
      capacity: 25,
      condition: BuildingCondition.BAIK,
      facilities: ['AC', 'Proyektor', '25 PC Klien', '1 PC Server', 'LAN Switch'],
    },
  });

  // Link some existing assets to the new facility rooms
  const allAssetsForFacilities = await prisma.asset.findMany();
  for (let i = 0; i < allAssetsForFacilities.length; i++) {
    await prisma.asset.update({
      where: { id: allAssetsForFacilities[i].id },
      data: { roomId: facilityRoom1.id },
    });
  }

  // Asset Audits & Items
  const assetAudit = await prisma.assetAudit.create({
    data: {
      unitId: smpIt.id,
      date: new Date(),
      notes: 'Audit sarana prasarana tengah tahun.',
      status: 'COMPLETED',
      createdById: adminPesantrenUser.id,
    },
  });

  if (allAssetsForFacilities.length > 0) {
    await prisma.assetAuditItem.create({
      data: {
        auditId: assetAudit.id,
        assetId: allAssetsForFacilities[0].id,
        systemStatus: 'ACTIVE',
        actualStatus: 'FOUND',
        condition: AssetCondition.GOOD,
        notes: 'Asset dalam kondisi terawat.',
      },
    });

    // Asset Disposal
    await prisma.assetDisposal.create({
      data: {
        assetId: allAssetsForFacilities[0].id,
        date: new Date(),
        reason: AssetDisposalReason.DAMAGED,
        notes: 'Kerusakan total pada unit catu daya.',
        approvedById: superAdminUser.id,
      },
    });
  }
  console.log('   ✅ Asset & Facilities records created');

  // 2. Org Structure (org_units, org_positions)
  console.log('   Seeding Org Units & Org Positions...');
  const orgUnitPendidikan = await prisma.orgUnit.create({
    data: {
      unitId: smpIt.id,
      name: 'Direktorat Pendidikan',
      code: 'DIR-EDU',
      description: 'Mengurus seluruh kegiatan akademik dan kurikulum.',
      level: 1,
      sortOrder: 1,
    },
  });

  const orgUnitKeuangan = await prisma.orgUnit.create({
    data: {
      unitId: smpIt.id,
      name: 'Bagian Keuangan',
      code: 'DIV-FIN',
      description: 'Mengurus keuangan dan akuntansi pesantren.',
      level: 1,
      sortOrder: 2,
    },
  });

  await prisma.orgPosition.create({
    data: {
      orgUnitId: orgUnitPendidikan.id,
      title: 'Direktur Pendidikan',
      code: 'POS-DIR-EDU',
      level: 2,
      status: OrgPositionStatus.ACTIVE,
      holderId: adminPesantrenUser.id,
      description: 'Memimpin dan merumuskan kebijakan kurikulum.',
    },
  });

  await prisma.orgPosition.create({
    data: {
      orgUnitId: orgUnitKeuangan.id,
      title: 'Staff Administrasi Keuangan',
      code: 'POS-FIN-STAFF',
      level: 4,
      status: OrgPositionStatus.ACTIVE,
      holderId: teacherPesantrenUser.id,
      description: 'Melakukan input pembukuan harian.',
    },
  });
  console.log('   ✅ Org Units & Positions created');

  // 3. E-Office (filing_classifications, agenda_numbers, dispositions)
  console.log('   Seeding E-Office filing, agenda, & dispositions...');
  const filingClass1 = await prisma.filingClassification.create({
    data: {
      code: '000',
      name: 'Umum',
      description: 'Urusan umum, ketatausahaan, dan administrasi.',
      retention: 5,
      isActive: true,
    },
  });

  const filingClass2 = await prisma.filingClassification.create({
    data: {
      code: '420',
      name: 'Pendidikan',
      description: 'Urusan kurikulum, kesiswaan, dan pengajaran.',
      retention: 10,
      isActive: true,
    },
  });

  await prisma.agendaNumber.create({
    data: {
      unitId: smpIt.id,
      academicYearId: academicYear.id,
      type: 'INCOMING',
      lastNumber: 1,
      format: '[NO]/SMPIT-AH/IN/[YEAR]',
    },
  });

  await prisma.agendaNumber.create({
    data: {
      unitId: smpIt.id,
      academicYearId: academicYear.id,
      type: 'OUTGOING',
      lastNumber: 1,
      format: '[NO]/SMPIT-AH/OUT/[YEAR]',
    },
  });

  // Link classification to existing letters
  const allLetters = await prisma.letter.findMany();
  for (const l of allLetters) {
    await prisma.letter.update({
      where: { id: l.id },
      data: { classificationId: filingClass2.id },
    });
  }

  if (allLetters.length > 0) {
    await prisma.disposition.create({
      data: {
        letterId: allLetters[0].id,
        senderId: adminPesantrenUser.id,
        recipientId: teacherPesantrenUser.id,
        instruction:
          'Tolong koordinasikan dengan bagian kurikulum untuk tindak lanjut pelatihan ini.',
        deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        status: 'IN_PROGRESS',
        notes: 'Musyawarah awal direncanakan hari Kamis.',
      },
    });
  }
  console.log('   ✅ E-Office helper tables created');

  // 4. Green Campus (environment_programs, waste_management, green_campus_indicators)
  console.log('   Seeding Green Campus data...');
  await prisma.environmentProgram.create({
    data: {
      unitId: smpIt.id,
      title: 'Aksi Tanam 1000 Pohon',
      description: 'Penghijauan lingkungan asrama dan area kebun pesantren.',
      category: 'PENGHIJAUAN',
      status: EnvironmentProgramStatus.ACTIVE,
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-08-31'),
      progress: 45,
      picId: teacherPesantrenUser.id,
    },
  });

  await prisma.environmentProgram.create({
    data: {
      unitId: smpIt.id,
      title: 'Gerakan Zero Single-Use Plastic',
      description: 'Kampanye bebas plastik sekali pakai di kantin sekolah.',
      category: 'KAMPANYE',
      status: EnvironmentProgramStatus.ACTIVE,
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-12-31'),
      progress: 20,
      picId: adminPesantrenUser.id,
    },
  });

  await prisma.wasteManagement.create({
    data: {
      unitId: smpIt.id,
      category: WasteCategory.ORGANIC,
      weight: 25.5,
      method: 'Daur Ulang',
      recordDate: new Date(),
      notes: 'Sampah organik dialihkan ke komposter P5.',
      recordedById: teacherPesantrenUser.id,
    },
  });

  await prisma.greenCampusIndicator.create({
    data: {
      unitId: smpIt.id,
      name: 'Rasio Luas Terbuka Hijau',
      category: 'LANDSCAPE',
      targetValue: 40.0,
      currentValue: 35.0,
      unit: '%',
      period: 'TAHUNAN',
      recordDate: new Date(),
      notes: 'Perlu perluasan taman di belakang asrama putri.',
    },
  });

  await prisma.greenCampusIndicator.create({
    data: {
      unitId: smpIt.id,
      name: 'Efisiensi Konsumsi Air Bersih',
      category: 'WATER',
      targetValue: 80.0,
      currentValue: 75.0,
      unit: 'L/hari/orang',
      period: 'BULANAN',
      recordDate: new Date(),
      notes: 'Penggunaan sensor keran air otomatis mulai dipasang.',
    },
  });
  console.log('   ✅ Green Campus tables created');

  // 6. Strategic Planning (strategic_plans, plan_objectives, plan_indicators, plan_activities)
  //    The yayasan's RPJP → Renstra → RKA cascade, modelled on the three
  //    mock-up planning documents. RPJP/Renstra/RKA are foundation-wide
  //    (unitId null), so they surface to the yayasan board and every unit's
  //    staff via the foundation-scope read path in perencanaan.service.
  console.log('   Seeding Strategic Plans (RPJP → Renstra → RKA Yayasan → RKA Unit)...');
  const { rpjp, renstra, rka, smpRka } = await seedStrategicPlans(prisma, {
    createdById: superAdminUser.id,
    approvedById: pembinaYayasanUser.id,
    ketua: ketuaYayasanUser.id,
    sekretaris: sekretarisYayasanUser.id,
    bendahara: bendaharaYayasanUser.id,
    kepalaSd: kepalaSdItUser.id,
    kepalaSmp: kepalaSmpItUser.id,
    kepalaSma: adminPesantrenUser.id,
    koordinator: teacherPesantrenUser.id,
    unitSmpId: smpIt.id,
  });
  console.log(
    `   ✅ Strategic Planning: RPJP(${rpjp.id.slice(0, 8)}) → Renstra(${renstra.id.slice(0, 8)}) → RKA(${rka.id.slice(0, 8)}) + unit RKA(${smpRka.id.slice(0, 8)})`
  );

  // 7. Supervision & Audits (internal_audits, audit_findings, audit_follow_ups)
  console.log('   Seeding Internal Audits & Findings...');
  const intAudit = await prisma.internalAudit.create({
    data: {
      unitId: smpIt.id,
      title: 'Audit Operasional Keuangan Semester Ganjil',
      auditType: 'Keuangan',
      scope: 'Verifikasi kecocokan slip pembayaran SPP fisik dengan entri database.',
      status: InternalAuditStatus.COMPLETED,
      executedDate: new Date('2026-06-15'),
      completedDate: new Date('2026-06-18'),
      leadAuditorId: superAdminUser.id,
      plannedDate: new Date('2026-06-15'),
    },
  });

  const finding = await prisma.auditFinding.create({
    data: {
      auditId: intAudit.id,
      findingNumber: 'FND-001',
      title: 'Selisih input nominal kas masuk',
      description:
        'Selisih input nominal kas masuk sebesar Rp500.000 pada minggu kedua bulan Juni.',
      rootCause: 'Pencatatan manual tanpa verifikasi ganda.',
      recommendation: 'Lakukan rekonsiliasi harian secara ketat.',
      severity: FindingSeverity.MINOR,
      category: 'Keuangan',
    },
  });

  await prisma.auditFollowUp.create({
    data: {
      findingId: finding.id,
      action: 'Mengevaluasi mutasi rekening koran Mandiri dan mengoreksi jurnal penyesuaian.',
      status: FollowUpStatus.IN_PROGRESS,
      evidence: 'Pekerjaan rekonsiliasi sedang berjalan oleh Bendahara.',
      verifiedById: superAdminUser.id,
      dueDate: new Date('2026-07-15'),
    },
  });
  console.log('   ✅ Audit & Supervision tables created');

  // 8. Sharia Compliance (sharia_compliances, sharia_audits)
  console.log('   Seeding Sharia Compliances & Audits...');
  const compliance = await prisma.shariaCompliance.create({
    data: {
      unitId: smpIt.id,
      category: ShariaCategory.MUAMALAH,
      title: "Kesesuaian Akad Ba'i al-Murabahah",
      description: 'Pemeriksaan kesesuaian transaksi jual beli murabahah.',
      standard:
        'Kantin wajib memisahkan barang milik pemasok dengan barang milik kantin secara jelas sebelum dijual.',
      status: ComplianceStatus.COMPLIANT,
      score: 100,
      notes: 'Kantin telah mematuhi akad pemisahan barang dagangan.',
    },
  });

  await prisma.shariaAudit.create({
    data: {
      complianceId: compliance.id,
      auditorId: adminPesantrenUser.id,
      auditDate: new Date(),
      findings: 'Akad sewa kantin menggunakan akad ijarah yang sah. Pembagian hasil kantin bersih.',
      recommendation: 'Tingkatkan edukasi fikih muamalah bagi para penjaga kantin.',
      score: 95.0,
    },
  });
  console.log('   ✅ Sharia Compliance tables created');

  // 9. Operations & Miscellaneous
  console.log('   Seeding Operations & Miscellaneous tables...');
  // Canteen stock movements
  const canteenItem = await prisma.canteenItem.findFirst();
  if (canteenItem) {
    await prisma.canteenStockMovement.create({
      data: {
        itemId: canteenItem.id,
        type: 'IN',
        quantity: 50,
        stockBefore: 10,
        stockAfter: 60,
        notes: 'Restock mingguan dari supplier.',
        createdById: adminPesantrenUser.id,
      },
    });
  }

  // Laundry Status Logs
  const laundryTx = await prisma.laundryTransaction.findFirst();
  if (laundryTx) {
    await prisma.laundryStatusLog.create({
      data: {
        transactionId: laundryTx.id,
        fromStatus: 'RECEIVED',
        toStatus: 'PROCESSING',
        notes: 'Pakaian sedang dicuci menggunakan mesin laundry utama.',
        createdById: adminPesantrenUser.id,
      },
    });
  }

  // Scholarship Discounts
  const scholarshipForDiscounts = await prisma.scholarship.findFirst();
  const payComponent = await prisma.paymentComponent.create({
    data: {
      unitId: smpIt.id,
      code: 'SPP',
      name: 'Sumbangan Pembinaan Pendidikan',
      category: 'RUTIN',
      amount: new Prisma.Decimal(500000.0),
    },
  });

  if (scholarshipForDiscounts && payComponent) {
    await prisma.scholarshipDiscount.create({
      data: {
        scholarshipId: scholarshipForDiscounts.id,
        componentId: payComponent.id,
        discountType: 'PERCENTAGE',
        discountValue: new Prisma.Decimal(100.0), // 100% discount
      },
    });
  }

  // Task Comments
  const projectTask = await prisma.projectTask.findFirst();
  if (projectTask) {
    await prisma.taskComment.create({
      data: {
        taskId: projectTask.id,
        userId: teacherPesantrenUser.id,
        content: 'Tolong pastikan instalasi listrik sudah dipasang pipa paralon agar rapi.',
      },
    });
  }

  // Training Programs & Enrollments
  const training = await prisma.trainingProgram.create({
    data: {
      unitId: smpIt.id,
      title: 'Pelatihan Sertifikasi Kompetensi Guru Abad 21',
      description: 'Pelatihan pedagogi digital menggunakan teknologi LMS interaktif.',
      category: 'Pedagogik',
      trainer: 'Balai Diklat Keagamaan',
      startDate: new Date('2026-07-20'),
      endDate: new Date('2026-07-25'),
      maxParticipants: 30,
      budget: new Prisma.Decimal(2500000.0),
      status: TrainingStatus.ONGOING,
      location: 'Aula Syariah',
      createdById: superAdminUser.id,
    },
  });

  const staffList = await prisma.staff.findMany();
  if (staffList.length > 0) {
    await prisma.trainingEnrollment.create({
      data: {
        programId: training.id,
        userId: staffList[0].userId,
        status: 'ENROLLED',
      },
    });
  }

  // Unit Comparison Reports
  await prisma.unitComparisonReport.create({
    data: {
      academicYearId: academicYear.id,
      reportType: 'FINANCIAL_BENCHMARK',
      periodType: 'YEARLY',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-12-31'),
      reportData: {
        title: 'Laporan Tolok Ukur Keuangan Lintas Unit 2026',
        units: [
          { name: 'SMP IT Al-Hikmah', revenue: 75000000, expense: 52000000 },
          { name: 'SD IT Ar-Rahman', revenue: 60000000, expense: 41000000 },
          { name: "TK Qur'an Cipansor", revenue: 25000000, expense: 18000000 },
        ],
      },
    },
  });

  // Murojaah Mistakes
  const murojaahRecord = await prisma.murojaahRecord.findFirst();
  if (murojaahRecord) {
    await prisma.murojaahMistake.create({
      data: {
        murojaahId: murojaahRecord.id,
        juz: 2,
        surahNumber: 2,
        ayahNumber: 142,
        mistakeType: TahfidzMistakeType.LUPA,
        description: 'Lupa bagian awal ayat, perlu diulang berkali-kali.',
      },
    });
  }

  // Simaan Examiners
  const simaanExam = await prisma.simaanExam.findFirst();
  if (simaanExam) {
    await prisma.simaanExaminer.create({
      data: {
        simaanId: simaanExam.id,
        examinerId: teacherPesantrenUser.id,
        notes: 'Penguji utama kelancaran tajwid dan makhraj.',
      },
    });
  }

  // Dashboard history snapshots
  await prisma.dashboardHistory.create({
    data: {
      unitId: smpIt.id,
      metrics: {
        totalStudents: 4,
        totalTeachers: 2,
        totalStaff: 4,
        activeClasses: 2,
      },
    },
  });

  await prisma.dashboardHistory.create({
    data: {
      unitId: smpIt.id,
      metrics: {
        totalStudents: 5,
        totalTeachers: 2,
        totalStaff: 4,
        activeClasses: 2,
      },
    },
  });

  // Dashboard metric snapshots
  await prisma.dashboardMetricSnapshot.create({
    data: {
      unitId: smpIt.id,
      metricType: 'student_attendance_rate',
      metricValue: 94.5,
      periodType: 'MONTHLY',
      periodDate: new Date('2026-06-01'),
    },
  });

  // Ibadah leaderboards
  await prisma.ibadahLeaderboard.create({
    data: {
      studentId: students[0].id,
      unitId: smpIt.id,
      periodType: 'WEEKLY',
      periodStart: new Date('2026-06-30'),
      periodEnd: new Date('2026-07-06'),
      totalPoints: 120,
      rank: 1,
    },
  });

  // Daily Report Photos
  const dailyReport = await prisma.dailyStudentReport.findFirst();
  if (dailyReport) {
    await prisma.dailyReportPhoto.create({
      data: {
        reportId: dailyReport.id,
        photoUrl: '/images/reports/sholat-subuh.jpg',
        caption: 'Dokumentasi sholat subuh berjamaah di masjid asrama.',
      },
    });
  }

  // Quality Evidences
  const qualityInd = await prisma.qualityIndicator.findFirst({
    where: { code: 'IND-KUR-01-A' },
  });
  if (qualityInd) {
    await prisma.qualityEvidence.create({
      data: {
        unitId: smpIt.id,
        indicatorId: qualityInd.id,
        academicYearId: academicYear.id,
        name: 'Dokumen Modul Ajar Matematika K-Merdeka',
        fileUrl: '/documents/quality/modul-mtk-approved.pdf',
        description: 'Bukti unggahan dokumen RPP/Modul Ajar guru matematika semester ganjil.',
        uploadedById: teacherPesantrenUser.id,
      },
    });
  }

  // Marketing Campaigns & Interactions
  const marketingCampaign = await prisma.marketingCampaign.create({
    data: {
      unitId: smpIt.id,
      name: 'Pameran Pendidikan Sukabumi 2026',
      code: 'CMP-2026-EDUEXPO',
      description: 'Pameran stan edukasi Cipansor untuk menjaring calon santri baru.',
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-05'),
      budget: new Prisma.Decimal(12500000.0),
      isActive: true,
      createdById: superAdminUser.id,
    },
  });

  const singleRegistrant = await prisma.registrant.findFirst();
  if (singleRegistrant) {
    await prisma.registrant.update({
      where: { id: singleRegistrant.id },
      data: { campaignId: marketingCampaign.id },
    });

    await prisma.marketingInteraction.create({
      data: {
        registrantId: singleRegistrant.id,
        date: new Date(),
        type: 'CALL',
        notes: 'Orang tua berminat dan menanyakan tentang fasilitas asrama SMP IT.',
        nextActionDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        recordedById: adminPesantrenUser.id,
      },
    });
  }

  console.log('   ✅ Operations & Miscellaneous tables created');

  console.log('🔧 Phase 11, 12, 13 & 14 comprehensive demo data completed!\n');

  // Demo accounts keep their published password. A new row is flagged to
  // choose a new password at first sign-in (the column default: someone else
  // set it), which is right for a real account and wrong for a demo account
  // shared by every tester and by the e2e suite — the first person in would
  // lock everyone else out. A real deployment flags every account once, at the
  // release, with scripts/require-password-change-all.ts.
  const unflagged = await prisma.user.updateMany({
    where: { mustChangePassword: true },
    data: { mustChangePassword: false },
  });
  console.log(`🔑 ${unflagged.count} demo account(s) keep their seeded password`);

  // ============================================
  // E2E: deterministic 2FA for admin accounts
  // ============================================
  // Admins/super-admins are forced through a 2FA gate on login. For local e2e
  // (and deterministic manual testing) we can pre-enable 2FA with a FIXED secret
  // so a valid TOTP can be generated offline. Opt-in via E2E_FIXED_2FA=1 so the
  // fixed secret never lands in a real environment's seed.
  if (process.env.E2E_FIXED_2FA === '1') {
    const fixedSecret = process.env.E2E_2FA_SECRET || 'NTGHH5U5LDHIYARFFNGFQKQHARJU7GBE';
    // Everyone login forces through 2FA: the legacy admin column, plus any
    // active assignment in SECOND_FACTOR_ROLE_CODES — admins, the organs (whose
    // legacy column is STAFF on some accounts, e.g. yayasan.ketua@) and the unit heads.
    const secondFactorCodes = [...SECOND_FACTOR_ROLE_CODES] as RoleCode[];
    const updated = await prisma.user.updateMany({
      where: {
        OR: [
          { role: { in: [UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN] } },
          { userRoles: { some: { isActive: true, role: { code: { in: secondFactorCodes } } } } },
        ],
      },
      data: {
        isTwoFactorEnabled: true,
        twoFactorSecret: fixedSecret,
        twoFactorSecretPending: null,
      },
    });
    console.log(
      `🔐 [E2E] Pre-enabled 2FA on ${updated.count} admin account(s) with a fixed secret`
    );
  }

  // Invariant check. An active account with no active UserRoleAssignment can
  // only sign in through the legacy User.role fallback, and that fallback is
  // being removed — such an account has a password and cannot use it. Two
  // siblings shipped in exactly that state because their seed block created
  // the user and the student row but not the assignment, and nothing looked.
  const orphanAccounts = await prisma.user.findMany({
    where: { isActive: true, userRoles: { none: { isActive: true } } },
    select: { email: true },
  });

  if (orphanAccounts.length > 0) {
    throw new Error(
      `Seed produced ${orphanAccounts.length} active account(s) with no active role ` +
        `assignment, which cannot log in: ${orphanAccounts.map((u) => u.email).join(', ')}`
    );
  }

  // Invariant check. A school has one head. This seed used to create a second
  // one per unit — "Hj. Aminah, S.Pd" beside Dadan Ali Ridwan for SD IT,
  // "Drs. H. Sulaiman, M.Pd" beside Cecep Helmi Syawali for SMP IT — on a
  // different email pattern and a different password, so both answered and the
  // invented one usually answered first. Nothing noticed for months because no
  // check ever counted them. Names on record with Dapodik live in
  // DEMO_ACCOUNTS; anything that adds a rival holder should fail here loudly.
  const kepalaHolders = await prisma.userRoleAssignment.findMany({
    where: {
      isActive: true,
      user: { isActive: true },
      role: { code: { endsWith: '_KEPALA_SEKOLAH' } },
    },
    select: {
      unitId: true,
      role: { select: { code: true } },
      user: { select: { name: true, email: true } },
    },
  });

  const byRoleAndUnit = new Map<string, typeof kepalaHolders>();
  for (const holder of kepalaHolders) {
    const key = `${holder.role.code}@${holder.unitId ?? 'global'}`;
    byRoleAndUnit.set(key, [...(byRoleAndUnit.get(key) ?? []), holder]);
  }

  const contested = [...byRoleAndUnit.entries()].filter(([, holders]) => holders.length > 1);

  if (contested.length > 0) {
    throw new Error(
      `Seed produced more than one active kepala sekolah for ${contested.length} ` +
        `unit(s): ` +
        contested
          .map(
            ([key, holders]) =>
              `${key} -> ${holders.map((h) => `${h.user.name} <${h.user.email}>`).join(' AND ')}`
          )
          .join('; ')
    );
  }

  // Riwayat unit diturunkan dari rombel yang baru saja dibuat. Backfill-nya
  // hidup di migrasi 20260912020000 dan hanya berjalan sekali; basis data yang
  // disemai ulang (dev, CI, e2e) tidak melewatinya, jadi tanpa langkah ini
  // tabel riwayatnya kosong dan setiap pertanyaan "saat itu unitnya apa" jatuh
  // ke unit sekarang — tepat kekeliruan yang tabel ini ada untuk menghapus.
  await seedUnitEnrollments();

  console.log('\n✅ Database seeded successfully!');
}

/**
 * Turunkan `StudentUnitEnrollment` dari setiap pendaftaran kelas yang ada.
 *
 * Aturannya sengaja sama persis dengan backfill di migrasi
 * `20260912020000_student_unit_enrollment`: satu baris per (santri, unit, tahun
 * ajaran), tanggal masuk diambil dari `enrolledAt` hanya bila tanggal itu jatuh
 * di dalam rentang tahun ajarannya, dan tahun ajaran yang sudah lewat ditutup
 * dengan tanggal selesainya.
 */
async function seedUnitEnrollments() {
  console.log('🌱 Seeding student unit enrollments (riwayat unit)...');

  const enrollments = await prisma.classEnrollment.findMany({
    select: {
      studentId: true,
      enrolledAt: true,
      class: {
        select: {
          unitId: true,
          academicYearId: true,
          level: true,
          academicYear: { select: { startDate: true, endDate: true } },
        },
      },
    },
  });

  const now = new Date();
  const perKunci = new Map<
    string,
    {
      studentId: string;
      unitId: string;
      academicYearId: string;
      entryDate: Date;
      exitDate: Date | null;
      gradeLevel: string | null;
    }
  >();

  for (const e of enrollments) {
    const kelas = e.class;
    if (!kelas?.academicYear) continue;
    const { startDate, endDate } = kelas.academicYear;
    const masukAkal = e.enrolledAt >= startDate && e.enrolledAt <= endDate;
    const entryDate = masukAkal ? e.enrolledAt : startDate;
    const kunci = `${e.studentId}|${kelas.unitId}|${kelas.academicYearId}`;
    const ada = perKunci.get(kunci);
    if (!ada || entryDate < ada.entryDate) {
      perKunci.set(kunci, {
        studentId: e.studentId,
        unitId: kelas.unitId,
        academicYearId: kelas.academicYearId,
        entryDate,
        exitDate: endDate < now ? endDate : null,
        gradeLevel: kelas.level ?? null,
      });
    }
  }

  for (const baris of perKunci.values()) {
    await prisma.studentUnitEnrollment.upsert({
      where: {
        studentId_unitId_academicYearId: {
          studentId: baris.studentId,
          unitId: baris.unitId,
          academicYearId: baris.academicYearId,
        },
      },
      create: baris,
      update: { gradeLevel: baris.gradeLevel },
    });
  }

  console.log(`✅ Riwayat unit: ${perKunci.size} baris`);

  // NIS per unit (student_unit_identifiers): NIS seed adalah NIS unit santri
  // sekarang — sama dengan backfill migrasi 20260914010000. Tanpa ini basis data
  // CI (db push + seed) tidak punya satu pun baris, dan dokumen resmi hanya
  // hidup dari jalur cadangan `students.nis`.
  const santri = await prisma.student.findMany({ select: { id: true, unitId: true, nis: true } });
  for (const s of santri) {
    await prisma.studentUnitIdentifier.upsert({
      where: { studentId_unitId: { studentId: s.id, unitId: s.unitId } },
      create: { studentId: s.id, unitId: s.unitId, nis: s.nis.trim() },
      update: { nis: s.nis.trim() },
    });
  }
  console.log(`✅ NIS per unit: ${santri.length} baris`);
}

// SAFTI behavioral values — master data for Perjanjian Kinerja evaluations.
async function seedBehavioralValues() {
  console.log('🌱 Seeding SAFTI behavioral values...');
  const values = [
    {
      name: 'Siddiq',
      description:
        'Integritas: Jujur, berani membela kebenaran, dan selaras antara pikiran, perkataan, serta perbuatan.',
      weight: 1,
    },
    {
      name: 'Amanah',
      description:
        'Akuntabilitas: Bertanggung jawab terhadap tugas, dapat dipercaya, dan memiliki komitmen tinggi.',
      weight: 1,
    },
    {
      name: 'Fathonah',
      description:
        'Profesionalisme & Inovasi: Kompeten, cerdas dalam mencari solusi, dan terus belajar.',
      weight: 1,
    },
    {
      name: 'Tabligh',
      description:
        'Komunikasi & Kolaborasi: Menyampaikan informasi dengan benar, transparan, dan mampu bekerja sama.',
      weight: 1,
    },
    {
      name: 'Istiqomah',
      description: 'Konsistensi: Memiliki keteguhan hati, disiplin, dan pantang menyerah.',
      weight: 1,
    },
  ];

  for (const v of values) {
    await prisma.behavioralValue.upsert({
      where: { name: v.name },
      update: v,
      create: v,
    });
  }
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
