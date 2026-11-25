import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';

/**
 * Penjaga cakupan penyapuan `ERASURE`.
 *
 * `executeErasure` menulis daftar kolom dengan tangan, dan `ERASURE`
 * MENGANONIMKAN baris `Student`/`Registrant`/`User`, bukan menghapusnya —
 * sehingga `onDelete: Cascade` tidak pernah menyala dan setiap kolom teks
 * bebas yang menyebut subjek harus disapu eksplisit. Karena daftarnya manual,
 * setiap kolom baru pada skema dapat lolos tanpa terlihat; itulah yang membuat
 * kelas cacat ini berulang putaran demi putaran pada PR #1140 (CWE-212).
 *
 * Uji ini membaca DMMF (skema yang benar-benar terpasang) dan menuntut setiap
 * kolom `String`/`Json` pada model yang `executeErasure` tulis ulang untuk
 * berada di salah satu dari tiga keranjang:
 *
 *   - `SWEPT`   — kolom ditimpa penanda / dikosongkan (harus muncul sebagai
 *                 `field:` di `data-subject-requests.service.ts`);
 *   - `RETAINED` — sengaja dipertahankan, dengan alasan yang dapat diperiksa;
 *   - `IGNORED` — struktural/rujukan (id, kunci asing, enum berbentuk String),
 *                 bukan data pribadi.
 *
 * Menambah kolom pada salah satu model ini akan menggagalkan uji sampai kolom
 * itu diklasifikasikan — sehingga putaran berikutnya tak perlu menemukannya
 * satu per satu lewat tinjauan.
 */

type Buckets = { swept: string[]; retained: string[]; ignored: string[] };

/**
 * Model yang `executeErasure`/`eraseStudent`/`eraseRegistrant` tulis ulang.
 *
 * Daftar ini adalah keputusan lengkap untuk **setiap** kolom `String`/`Json`
 * pada setiap model yang menyimpan `studentId`/`registrantId`, ditambah tabel
 * anak yang menaut subjek lewat id induknya (baris induk tidak dihapus, jadi
 * `onDelete: Cascade` tidak menyelamatkan anaknya), ditambah model yang menaut
 * subjek lewat `userId` saja. Model tanpa kolom teks sama sekali tidak muncul
 * di sini — tidak ada yang perlu diputuskan.
 *
 * `retained` berarti "sengaja dibiarkan apa adanya, dengan alasan": nilai
 * akademik/keuangan (angka, predikat, nomor dokumen, status), kosakata tetap
 * yang terikat CHECK, dan jejak audit keuangan. `ignored` adalah kolom
 * struktural — id dan kunci asing.
 */
const COVERAGE: Record<string, Buckets> = {
  Alumni: {
    swept: [
      'address',
      'birthPlace',
      'city',
      'country',
      'email',
      'name',
      'notes',
      'phone',
      'photo',
      'province',
    ],
    retained: ['registrationNo', 'lastClass', 'tahfidzLevel'],
    ignored: ['id', 'studentId', 'unitId'],
  },
  AlumniCareer: {
    swept: ['company', 'description', 'industry', 'location', 'position'],
    retained: [],
    ignored: ['id', 'alumniId'],
  },
  AlumniDonation: {
    swept: ['description', 'notes', 'purpose'],
    retained: ['receiptNo'],
    ignored: ['id', 'alumniId', 'unitId'],
  },
  AlumniEducation: {
    swept: [
      'achievements',
      'admissionPath',
      'degree',
      'field',
      'institution',
      'location',
      'scholarshipName',
    ],
    retained: [],
    ignored: ['id', 'alumniId'],
  },
  AlumniEventAttendee: {
    swept: ['notes'],
    retained: ['status'],
    ignored: ['id', 'eventId', 'alumniId'],
  },
  Announcement: {
    swept: ['attachmentUrl', 'content', 'title'],
    retained: ['targetRoles', 'classIds', 'studentIds'],
    ignored: ['id', 'unitId', 'withdrawnById', 'createdById'],
  },
  AssignmentSubmission: {
    swept: ['attachments', 'content', 'feedback'],
    retained: [],
    ignored: ['id', 'assignmentId', 'studentId'],
  },
  Attendance: {
    swept: ['notes'],
    retained: [],
    ignored: ['id', 'studentId', 'classId', 'recordedById'],
  },
  AttendanceFollowUp: {
    swept: ['note'],
    retained: [],
    ignored: ['id', 'attendanceId', 'contactedById'],
  },
  BehaviorRecord: {
    swept: ['actionTaken', 'description'],
    retained: [],
    ignored: ['id', 'studentId', 'classId', 'academicYearId', 'witnessedById', 'recordedById'],
  },
  Borrowing: {
    swept: ['notes'],
    retained: ['borrowerType'],
    ignored: ['id', 'bookId', 'borrowerId', 'studentId', 'processedBy'],
  },
  CanteenTransaction: {
    swept: ['customerName', 'notes'],
    retained: ['transactionNo', 'paymentMethod', 'status'],
    ignored: ['id', 'unitId', 'businessUnitId', 'studentId', 'walletId', 'cashierId'],
  },
  CanteenTransactionItem: {
    swept: ['notes'],
    retained: ['itemName'],
    ignored: ['id', 'transactionId', 'itemId'],
  },
  ClinicAppointment: {
    swept: ['complaint'],
    retained: ['status'],
    ignored: ['id', 'unitId', 'patientId', 'studentId', 'userId', 'processedById'],
  },
  Complaint: {
    swept: ['attachments', 'description', 'location', 'resolution', 'subject'],
    retained: [],
    ignored: ['id', 'unitId', 'userId', 'buildingId', 'roomId', 'assetId', 'assignedToId'],
  },
  ComplaintComment: { swept: ['content'], retained: [], ignored: ['id', 'complaintId', 'userId'] },
  CounselingNote: {
    swept: ['content'],
    retained: ['noteType'],
    ignored: ['id', 'sessionId', 'createdById'],
  },
  CounselingReferral: {
    swept: ['contactInfo', 'institution', 'outcome', 'reason', 'referredTo'],
    retained: [],
    ignored: ['id', 'sessionId', 'createdById'],
  },
  CounselingSession: {
    swept: ['description', 'psychologyData', 'recommendations', 'summary', 'title'],
    retained: ['location'],
    ignored: ['id', 'unitId', 'studentId', 'counselorId'],
  },
  CourseCertificate: {
    swept: ['fileUrl'],
    retained: ['certificateNo'],
    ignored: ['id', 'enrollmentId'],
  },
  CourseEnrollment: {
    swept: ['externalEmail', 'externalName', 'externalPhone'],
    retained: [],
    ignored: ['id', 'courseId', 'studentId', 'invoiceId'],
  },
  DailyHomework: {
    swept: ['description', 'subjectName'],
    retained: [],
    ignored: ['id', 'reportId'],
  },
  DailyIbadahRecord: {
    swept: ['notes'],
    retained: [],
    ignored: ['id', 'targetId', 'studentId', 'verifiedBy'],
  },
  DailyMuhasabah: {
    swept: ['gratitude', 'improvement', 'notes'],
    retained: [],
    ignored: ['id', 'studentId'],
  },
  DailyReportPhoto: { swept: ['caption', 'photoUrl'], retained: [], ignored: ['id', 'reportId'] },
  DailyStudentReport: {
    swept: [
      'achievements',
      'activitiesSummary',
      'behaviorNotes',
      'healthStatus',
      'homeActivity',
      'pickedUpBy',
      'tahfidzActivity',
      'teacherNotes',
      'toiletNotes',
    ],
    retained: ['notifiedVia'],
    ignored: ['id', 'studentId', 'unitId', 'academicYearId', 'createdById'],
  },
  DataSubjectRequest: {
    swept: [
      'actions',
      'rejectionReason',
      'verificationCodeHash',
      'subjectLabel',
      'requesterName',
      'requesterContact',
      'requesterRelation',
      'detail',
    ],
    retained: ['requestNo'],
    ignored: [
      'id',
      'subjectStudentId',
      'subjectRegistrantId',
      'subjectUserId',
      'requesterUserId',
      'handledById',
    ],
  },
  DigitalCertificate: {
    swept: ['description', 'metadata', 'pdfUrl', 'thumbnailUrl', 'title'],
    retained: [
      'certificateType',
      'certificateNumber',
      'qrCode',
      'verificationUrl',
      'grade',
      'signatoryName',
      'signatoryTitle',
      'signatureUrl',
    ],
    ignored: ['id', 'studentId', 'createdById'],
  },
  DutyRoster: {
    swept: ['notes'],
    retained: [],
    ignored: ['id', 'dutyTypeId', 'studentId', 'verifiedById', 'substituteId'],
  },
  ExamAnswer: { swept: ['answer'], retained: [], ignored: ['id', 'attemptId', 'questionId'] },
  ExtracurricularAchievement: {
    swept: ['certificateUrl', 'description', 'photoUrl', 'title'],
    retained: ['level', 'rank', 'organizer'],
    ignored: ['id', 'extracurricularId', 'studentId'],
  },
  ExtracurricularAttendance: {
    swept: ['notes'],
    retained: [],
    ignored: ['id', 'extracurricularId', 'studentId', 'recordedById'],
  },
  ExtracurricularEnrollment: {
    swept: ['notes'],
    retained: ['grade'],
    ignored: ['id', 'extracurricularId', 'studentId'],
  },
  Grade: {
    swept: ['notes'],
    retained: ['letterGrade'],
    ignored: ['id', 'studentId', 'subjectId', 'examId', 'academicYearId', 'gradedById'],
  },
  GrowthRecord: {
    swept: ['notes'],
    retained: ['nutritionStatus'],
    ignored: ['id', 'studentId', 'unitId', 'recordedById'],
  },
  HafidzStudent: { swept: ['notes'], retained: [], ignored: ['id', 'studentId'] },
  ImmunizationRecord: {
    swept: ['notes'],
    retained: ['vaccineName', 'vaccineCode', 'administeredAt', 'batchNumber', 'status'],
    ignored: ['id', 'studentId', 'unitId', 'recordedById'],
  },
  Invoice: {
    swept: ['notes'],
    retained: ['invoiceNumber', 'period'],
    ignored: ['id', 'studentId', 'paymentTypeId'],
  },
  KitabProgress: {
    swept: ['notes'],
    retained: ['grade'],
    ignored: ['id', 'kitabId', 'studentId', 'teacherId', 'academicYearId'],
  },
  KitabProgressRecord: {
    swept: ['notes', 'teacherFeedback', 'topic'],
    retained: ['predicate'],
    ignored: ['id', 'studentId', 'kitabAssignmentId', 'kitabId', 'recordedById'],
  },
  KitabStudentProgress: {
    swept: ['notes'],
    retained: [],
    ignored: ['id', 'studentId', 'kitabAssignmentId'],
  },
  LaundryItem: { swept: ['notes'], retained: ['itemType'], ignored: ['id', 'transactionId'] },
  LaundryStatusLog: {
    swept: ['notes'],
    retained: ['fromStatus', 'toStatus'],
    ignored: ['id', 'transactionId', 'createdById'],
  },
  LaundryTransaction: {
    swept: ['notes'],
    retained: ['transactionNo', 'paymentMethod', 'paymentStatus', 'status'],
    ignored: [
      'id',
      'unitId',
      'businessUnitId',
      'studentId',
      'walletId',
      'pricingId',
      'receivedById',
      'deliveredById',
    ],
  },
  LegacyIdentifierAudit: {
    swept: ['value'],
    retained: ['field', 'reason', 'keptStudentId'],
    ignored: ['id', 'studentId'],
  },
  MarketingInteraction: {
    swept: ['notes'],
    retained: ['type'],
    ignored: ['id', 'registrantId', 'recordedById'],
  },
  MealAttendance: {
    swept: ['notes'],
    retained: [],
    ignored: ['id', 'menuId', 'studentId', 'recordedById'],
  },
  MedicalRecord: {
    swept: ['complaint', 'diagnosis', 'notes', 'prescription', 'referredTo', 'treatment'],
    retained: ['bloodPressure'],
    ignored: ['id', 'studentId', 'patientId', 'recordedById'],
  },
  MedicationUsageLog: {
    swept: ['reason'],
    retained: [],
    ignored: ['id', 'medicationId', 'studentId', 'givenById'],
  },
  MerdekaAssessmentResult: {
    swept: ['attachments', 'feedback'],
    retained: ['grade'],
    ignored: ['id', 'assessmentId', 'studentId', 'gradedById'],
  },
  Message: {
    swept: ['content', 'subject'],
    retained: ['category'],
    ignored: ['id', 'senderId', 'recipientId', 'parentId'],
  },
  Muhadatsah: {
    swept: ['feedback', 'recordingUrl', 'topic'],
    retained: ['language', 'grade', 'status'],
    ignored: ['id', 'unitId', 'studentId', 'partnerId', 'evaluatorId'],
  },
  Muhadhoroh: {
    swept: ['feedback', 'topic', 'videoUrl'],
    retained: ['language', 'grade', 'status'],
    ignored: ['id', 'unitId', 'studentId', 'evaluatorId'],
  },
  MurojaahMistake: { swept: ['description'], retained: [], ignored: ['id', 'murojaahId'] },
  MurojaahRecord: {
    swept: ['improvementAreas', 'notes'],
    retained: [],
    ignored: ['id', 'studentId', 'enrollmentId', 'halaqohId', 'recordedById'],
  },
  Notification: {
    swept: ['data', 'link', 'message', 'title'],
    retained: ['dedupeKey'],
    ignored: ['id', 'userId', 'announcementId'],
  },
  P5Assessment: {
    swept: ['notes'],
    retained: [
      'beriman',
      'berkebinekaan',
      'bergotongroyong',
      'mandiri',
      'bernalarkritis',
      'kreatif',
      'overallGrade',
    ],
    ignored: ['id', 'projectId', 'studentId', 'assessedById'],
  },
  PAUDAssessmentEvidence: {
    swept: ['caption', 'fileName', 'fileUrl'],
    retained: ['fileType'],
    ignored: ['id', 'assessmentId'],
  },
  PAUDDevelopmentAssessment: {
    swept: ['narrativeText', 'recommendations', 'teacherNotes'],
    retained: ['semester'],
    ignored: ['id', 'studentId', 'unitId', 'academicYearId', 'indicatorId', 'assessedById'],
  },
  PAUDNarrativeReport: {
    swept: [
      'areasForDevelopment',
      'healthSummary',
      'narrativeBHS',
      'narrativeFM',
      'narrativeKOG',
      'narrativeNAM',
      'narrativeSE',
      'narrativeSNI',
      'overallStrengths',
      'parentRecommendations',
    ],
    retained: ['semester', 'tahfidzSummary', 'teacherSignature', 'principalSignature', 'status'],
    ignored: ['id', 'studentId', 'unitId', 'academicYearId', 'createdById'],
  },
  PAUDReportPhoto: { swept: ['caption', 'photoUrl'], retained: [], ignored: ['id', 'reportId'] },
  Patient: { swept: ['address', 'name', 'phone'], retained: [], ignored: ['id', 'userId'] },
  Payment: {
    swept: ['notes', 'proofUrl', 'rejectionReason'],
    retained: ['referenceNo'],
    ignored: ['id', 'invoiceId', 'tuVerifiedById', 'finalVerifiedById'],
  },
  Permit: {
    swept: ['destination', 'reason', 'rejectionNote'],
    retained: ['code'],
    ignored: ['id', 'studentId', 'approvedById'],
  },
  Portfolio: {
    swept: ['description', 'feedback', 'reflection', 'title'],
    retained: ['type', 'category'],
    ignored: ['id', 'studentId', 'academicYearId', 'subjectId', 'classId', 'reviewedBy'],
  },
  PortfolioComment: { swept: ['content'], retained: [], ignored: ['id', 'portfolioId', 'userId'] },
  PortfolioFile: {
    swept: ['fileName', 'fileUrl'],
    retained: ['fileType'],
    ignored: ['id', 'portfolioId'],
  },
  PracticumEvaluation: {
    swept: ['feedback'],
    retained: [],
    ignored: ['id', 'lessonPlanId', 'evaluatorId'],
  },
  PracticumLessonPlan: {
    swept: ['materials', 'method', 'objectives', 'reviewNotes', 'steps', 'subject', 'topic'],
    retained: [],
    ignored: ['id', 'studentId', 'academicYearId', 'reviewedById'],
  },
  Prescription: {
    swept: ['notes'],
    retained: ['status'],
    ignored: ['id', 'medicalRecordId', 'patientId', 'studentId', 'doctorId'],
  },
  PrescriptionItem: {
    swept: ['instructions'],
    retained: ['dosage'],
    ignored: ['id', 'prescriptionId', 'medicationId'],
  },
  RaporPesantren: {
    swept: [
      'akhlakData',
      'headTeacherNotes',
      'muhadatsahData',
      'muhadhorohData',
      'musyrifNotes',
      'notes',
      'principalNotes',
    ],
    retained: [
      'status',
      'tahfidzData',
      'takhosusData',
      'ibadahData',
      'kitabProgressData',
      'attendanceData',
      'academicData',
      'overallGrade',
    ],
    ignored: ['id', 'studentId', 'unitId', 'academicYearId'],
  },
  Registrant: {
    swept: [
      'address',
      'birthPlace',
      'email',
      'fullName',
      'name',
      'notes',
      'parentEmail',
      'parentName',
      'parentOccupation',
      'parentPhone',
      'phone',
      'previousSchool',
      'registrationFeeNote',
    ],
    retained: ['registrationNo', 'source', 'consentVersion', 'consentIp'],
    ignored: [
      'id',
      'admissionPeriodId',
      'waveId',
      'registrationFeeVerifiedById',
      'studentId',
      'campaignId',
    ],
  },
  RegistrantDocument: {
    swept: ['fileUrl', 'name', 'notes'],
    retained: ['type'],
    ignored: ['id', 'registrantId'],
  },
  ReportCard: {
    swept: ['principalNotes', 'teacherNotes'],
    retained: ['attendance', 'tahfidzSummary'],
    ignored: ['id', 'studentId', 'classId', 'academicYearId'],
  },
  ReportCardDetail: {
    swept: ['description'],
    retained: ['subjectName', 'letterGrade'],
    ignored: ['id', 'reportCardId'],
  },
  ResearchSubmission: {
    swept: ['abstract', 'content', 'feedback', 'title'],
    retained: ['status'],
    ignored: ['id', 'themeId', 'studentId', 'reviewedById'],
  },
  Reward: {
    swept: ['description'],
    retained: ['category'],
    ignored: ['id', 'studentId', 'givenById'],
  },
  RoomAssignment: { swept: ['notes'], retained: [], ignored: ['id', 'studentId', 'roomId'] },
  SanadRecord: {
    swept: ['notes'],
    retained: ['grade'],
    ignored: ['id', 'enrollmentId', 'teacherId'],
  },
  ScholarshipAssessment: {
    swept: ['notes', 'value'],
    retained: [],
    ignored: ['id', 'recipientId', 'criterionId'],
  },
  ScholarshipRecipient: {
    swept: ['notes'],
    retained: ['status'],
    ignored: ['id', 'scholarshipId', 'studentId', 'academicYearId', 'approvedById'],
  },
  SimaanExam: {
    swept: ['notes', 'recommendations'],
    retained: ['grade'],
    ignored: ['id', 'studentId', 'enrollmentId', 'halaqohId'],
  },
  SimaanExaminer: { swept: ['notes'], retained: [], ignored: ['id', 'simaanId', 'examinerId'] },
  SpecialDiet: {
    swept: ['allergies', 'medicalNotes'],
    retained: ['dietType'],
    ignored: ['id', 'studentId', 'approvedById'],
  },
  Student: {
    swept: [
      'address',
      'birthPlace',
      'fatherBirthPlace',
      'fatherName',
      'fatherNik',
      'fatherPhone',
      'guardianName',
      'guardianNik',
      'guardianPhone',
      'guardianRelation',
      'kipNumber',
      'livingWith',
      'motherBirthPlace',
      'motherName',
      'motherNik',
      'motherPhone',
      'nik',
      'nisn',
      'noAkta',
      'noKK',
      'parentEmail',
      'parentName',
      'parentPhone',
      'photoUrl',
      'postalCode',
      'rt',
      'rw',
      'specialNeeds',
    ],
    retained: ['nis', 'status', 'religion', 'nationality'],
    ignored: ['id', 'userId', 'unitId', 'provinceId', 'regencyId', 'districtId', 'villageId'],
  },
  StudentCardState: {
    swept: ['revokeReason'],
    retained: ['cardNumber'],
    ignored: ['id', 'studentId', 'generatedById'],
  },
  StudentDocument: {
    swept: ['description', 'documentNumber', 'fileUrl', 'rejectionReason', 'title'],
    retained: ['mimeType'],
    ignored: ['id', 'studentId', 'verifiedById', 'uploadedById'],
  },
  StudentNote: {
    swept: ['attachments', 'content', 'title'],
    retained: ['tags'],
    ignored: ['id', 'studentId', 'classId', 'academicYearId', 'createdById'],
  },
  StudentOrgLogbook: {
    swept: ['activity', 'notes', 'result'],
    retained: [],
    ignored: ['id', 'memberId'],
  },
  StudentPackage: {
    swept: ['content', 'deliveredTo', 'notes', 'photoUrl', 'senderName', 'senderPhone'],
    retained: ['expedition', 'storageLocation'],
    ignored: ['id', 'studentId', 'unitId', 'receivedById'],
  },
  StudentVisit: {
    swept: ['needs', 'notes', 'relationship', 'visitorName'],
    retained: [],
    ignored: ['id', 'studentId', 'unitId'],
  },
  TahfidzRecord: {
    swept: ['audioUrl', 'notes'],
    retained: ['surahName'],
    ignored: ['id', 'studentId', 'recordedById'],
  },
  TahfidzTarget: { swept: ['notes'], retained: [], ignored: ['id', 'studentId', 'academicYearId'] },
  TakhosusEnrollment: { swept: ['notes'], retained: [], ignored: ['id', 'studentId', 'halaqohId'] },
  User: {
    swept: [
      'email',
      'fcmToken',
      'name',
      'passwordHash',
      'phone',
      'resetTokenHash',
      'twoFactorRecoveryCodes',
      'twoFactorSecret',
      'twoFactorSecretPending',
    ],
    retained: [],
    ignored: ['id', 'unitId'],
  },
  UserIdentity: {
    swept: ['birthPlace', 'ktpFileName', 'ktpSha256', 'legalName', 'nik', 'verificationNote'],
    retained: [],
    ignored: ['id', 'userId', 'verifiedById'],
  },
  Violation: {
    swept: ['action', 'description'],
    retained: ['category'],
    ignored: ['id', 'studentId', 'reportedById'],
  },
  WalletTransaction: {
    swept: ['description'],
    retained: ['type', 'reference', 'referenceType'],
    ignored: ['id', 'walletId', 'createdById'],
  },
  // Model terjangkau yang tidak butuh tulisan: seluruh kolom teksnya kosakata
  // tetap, angka, atau kunci asing — dicatat supaya keputusannya terlihat dan
  // penjaga penutupan kunci asing di bawah punya jawaban untuk setiap model.
  AttendancePatternFlag: { swept: [], retained: [], ignored: ['id', 'studentId'] },
  ClassEnrollment: { swept: [], retained: ['status'], ignored: ['id', 'studentId', 'classId'] },
  ExamAttempt: { swept: [], retained: [], ignored: ['id', 'examId', 'studentId'] },
  ExamSecurityLog: { swept: ['details'], retained: ['type'], ignored: ['id', 'attemptId'] },
  IbadahLeaderboard: {
    swept: [],
    retained: ['periodType'],
    ignored: ['id', 'unitId', 'studentId'],
  },
  PermitAttachment: {
    swept: [],
    retained: ['mimeType', 'sha256'],
    ignored: ['id', 'permitId', 'uploadedById', 'firstViewedById'],
  },
  PracticumSchedule: {
    swept: [],
    retained: ['startTime', 'endTime', 'location'],
    ignored: ['id', 'lessonPlanId', 'targetClassId'],
  },
  ResearchReference: {
    swept: [],
    retained: ['bookTitle', 'author', 'volume', 'page', 'contentQuote'],
    ignored: ['id', 'submissionId'],
  },
  SantriWallet: { swept: [], retained: [], ignored: ['id', 'studentId'] },
  StudentOrgMember: { swept: [], retained: [], ignored: ['id', 'positionId', 'studentId'] },
  StudentParent: { swept: [], retained: ['relation'], ignored: ['id', 'studentId', 'parentId'] },
  StudentUnitEnrollment: {
    swept: [],
    retained: ['exitReason', 'gradeLevel'],
    ignored: ['id', 'studentId', 'unitId', 'academicYearId'],
  },
  StudentUnitIdentifier: { swept: [], retained: ['nis'], ignored: ['id', 'studentId', 'unitId'] },
};

type DmmfModel = {
  name: string;
  dbName?: string;
  fields: { name: string; dbName?: string; kind: string; type: string; isList: boolean }[];
};

const datamodel = (Prisma as unknown as { dmmf: { datamodel: { models: DmmfModel[] } } }).dmmf
  .datamodel;

/**
 * Model yang menaut subjek **hanya** lewat `userId`, akar `sweepUserText`.
 *
 * Kotak pesan, pengaduan, notifikasi, dan baris pasien tidak menyimpan
 * `studentId`; satu-satunya jalan dari subjek ke barisnya adalah akunnya.
 */
const USER_LINKED_ROOTS: { model: string; columns: string[] }[] = [
  { model: 'Message', columns: ['senderId', 'recipientId'] },
  { model: 'Complaint', columns: ['userId'] },
  { model: 'Notification', columns: ['userId'] },
  { model: 'Patient', columns: ['userId'] },
];

/**
 * Setiap model yang dapat dijangkau dari subjek lewat kunci asing, dihitung
 * dari `schema.prisma` — bukan dari daftar yang diuji.
 *
 * Arahnya ke **bawah**: mulai dari model yang menyimpan `studentId`/
 * `registrantId`, lalu setiap model yang menaruh kunci asing ke model yang
 * sudah terjangkau ikut masuk. Itulah himpunan yang harus disapu tangan,
 * karena baris induknya dianonimkan dan `onDelete: Cascade` tidak pernah
 * menyala. Ke arah atas (induk dari subjek, seperti `Class` atau `Unit`) tidak
 * ikut: barisnya milik banyak orang.
 *
 * `relationFromFields` tidak ada di DMMF versi ini, jadi relasinya dibaca dari
 * skema: `@relation(fields: […])` menandai sisi yang memegang kunci asing.
 */
function reachableFromSubject(): Set<string> {
  const schema = readFileSync(resolve(__dirname, '../../../../prisma/schema.prisma'), 'utf8');
  const parentOf = new Map<string, Set<string>>();
  for (const [, name, body] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const parents = new Set<string>();
    for (const rel of body.matchAll(/(\w+)\s+(\w+)\??\s+@relation\([^)]*fields:\s*\[/g)) {
      parents.add(rel[2]);
    }
    parentOf.set(name, parents);
  }
  // Akarnya adalah subjeknya sendiri plus setiap model yang menyimpan
  // `studentId`/`registrantId` — `Student` tidak menyimpan `studentId`, dan
  // justru dialah yang disapu pertama.
  const reached = new Set(
    datamodel.models
      .filter(
        (m) =>
          m.name === 'Student' ||
          m.name === 'Registrant' ||
          m.fields.some((f) => f.name === 'studentId' || f.name === 'registrantId')
      )
      .map((m) => m.name)
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const [child, parents] of parentOf) {
      if (reached.has(child)) continue;
      if ([...parents].some((parent) => reached.has(parent))) {
        reached.add(child);
        grew = true;
      }
    }
  }
  return reached;
}

/**
 * Kolom skalar yang menjadi kunci asing, per model, dibaca dari
 * `@relation(fields: […])`.
 *
 * Kunci asing tidak pernah memuat PII: ia hanya menunjuk baris lain, dan
 * nilainya sudah ditangani baris yang ditunjuk. Karena itu ia selalu masuk
 * `ignored` — bukan `retained` (yang berarti "nilai ini sengaja dibiarkan dan
 * punya alasan"), dan bukan `swept`. `Borrowing.processedBy` dan
 * `DutyRoster.substituteId` sempat tercatat sebagai `retained`; keduanya kunci
 * asing, dan salah keranjang berarti kolom berikutnya yang serupa akan
 * dianggap "sudah diputuskan".
 */
function foreignKeyColumns(): Record<string, Set<string>> {
  const schema = readFileSync(resolve(__dirname, '../../../../prisma/schema.prisma'), 'utf8');
  const result: Record<string, Set<string>> = {};
  for (const [, name, body] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const fks = new Set<string>();
    for (const rel of body.matchAll(/@relation\([^)]*fields:\s*\[([^\]]*)\]/g)) {
      for (const field of rel[1].matchAll(/(\w+)/g)) fks.add(field[1]);
    }
    if (fks.size) result[name] = fks;
  }
  return result;
}

/** Kolom skalar `String`/`Json` sebuah model — teks bebas yang perlu diputuskan. */
function stringColumns(model: string): string[] {
  const m = datamodel.models.find((x) => x.name === model);
  if (!m) throw new Error(`model ${model} tidak ada di skema`);
  return m.fields
    .filter((f) => f.kind === 'scalar' && (f.type === 'String' || f.type === 'Json'))
    .map((f) => f.name);
}

// Dua berkas: penyapuan teks bebas tinggal di `erasure-sweep.service.ts` (satu tempat,
// karena ia menyapu ~70 model), dan penjaga harus melihat keduanya — kalau
// hanya layanan utama yang dibaca, setiap kolom di berkas sapuan terbaca
// "ditandai disapu tetapi tidak ditulis".
const serviceSource = [
  readFileSync(resolve(__dirname, '../data-subject-requests.service.ts'), 'utf8'),
  readFileSync(resolve(__dirname, '../erasure-sweep.service.ts'), 'utf8'),
].join('\n');

describe('penjaga cakupan penyapuan ERASURE', () => {
  it('setiap kolom String/Json model yang ditulis ulang terklasifikasi tepat sekali', () => {
    const problems: string[] = [];

    for (const [model, buckets] of Object.entries(COVERAGE)) {
      const all = new Set([...buckets.swept, ...buckets.retained, ...buckets.ignored]);
      const columns = stringColumns(model);

      // Kolom baru pada skema yang belum diklasifikasikan.
      for (const col of columns) {
        if (!all.has(col)) problems.push(`${model}.${col} belum diklasifikasikan`);
      }
      // Klasifikasi yang menunjuk kolom yang sudah tidak ada.
      for (const col of all) {
        if (!columns.includes(col)) problems.push(`${model}.${col} tidak ada di skema lagi`);
      }
      // Sebuah kolom tidak boleh masuk dua keranjang.
      for (const col of columns) {
        const where = (['swept', 'retained', 'ignored'] as const).filter((k) =>
          buckets[k].includes(col)
        );
        if (where.length > 1) problems.push(`${model}.${col} ada di ${where.join(' + ')}`);
      }
    }

    expect(problems).toEqual([]);
  });

  it('setiap model yang terjangkau dari subjek ada di daftar', () => {
    // Penjaga di atas hanya memeriksa model yang **sudah** didaftarkan. Model
    // yang belum pernah didaftarkan — persis kelas cacat yang berulang di PR
    // #1140 (#1146) — lolos tanpa terlihat: `AttendanceFollowUp`, `Muhadroh`
    // dan sejenisnya menaut subjek lewat id induknya, dan karena baris induk
    // dianonimkan (bukan dihapus), `onDelete: Cascade` tidak pernah menyapunya.
    //
    // Jadi himpunan yang diperiksa di sini dihitung dari skema, bukan dari
    // daftar: mulai dari setiap model yang menyimpan `studentId`/`registrantId`,
    // lalu tutup ke bawah lewat setiap relasi yang menaruh kunci asing di sisi
    // anak. Setiap model dalam tutupan itu harus punya keputusan di `COVERAGE`.
    const closure = reachableFromSubject();
    const listed = new Set(Object.keys(COVERAGE));
    const missing = [...closure].filter((m) => !listed.has(m)).sort();

    // Penjaga yang tidak menemukan model apa pun akan hijau selamanya.
    expect(closure.size).toBeGreaterThan(70);
    expect(closure).toContain('Student');
    expect(closure).toContain('AttendanceFollowUp');
    expect(missing).toEqual([]);
  });

  it('akar yang hanya menaut lewat `userId` tetap benar-benar menaut `userId`', () => {
    // `sweepUserText` menyapu tabel yang menaut subjek lewat akunnya saja, dan
    // daftar akarnya ditulis tangan. Bila sebuah model kelak berhenti punya
    // `userId`, akar itu menjadi tidak berarti dan `sweepUserText` menyapu
    // tabel yang salah tanpa suara.
    const problems = USER_LINKED_ROOTS.filter(({ model, columns }) => {
      const m = datamodel.models.find((x) => x.name === model);
      if (!m) return true;
      return !columns.every((c) => m.fields.some((f) => f.kind === 'scalar' && f.name === c));
    }).map(({ model }) => model);
    expect(problems).toEqual([]);
  });

  it('kunci asing dicatat sebagai struktural, bukan disapu atau dipertahankan', () => {
    const fks = foreignKeyColumns();
    const problems: string[] = [];
    for (const [model, buckets] of Object.entries(COVERAGE)) {
      const modelFks = fks[model];
      if (!modelFks) continue;
      for (const col of [...buckets.swept, ...buckets.retained]) {
        if (modelFks.has(col)) problems.push(`${model}.${col} adalah kunci asing`);
      }
    }
    // Penjaga yang tidak menemukan kunci asing apa pun akan hijau selamanya.
    expect(Object.keys(fks).length).toBeGreaterThan(50);
    expect(problems).toEqual([]);
  });

  it('tidak ada model yang ditulis layanan tetapi luput dari daftar', () => {
    // Inti putaran-putaran sebelumnya bukan "kolom baru pada model yang sudah
    // terdaftar", melainkan "model yang belum masuk daftar sama sekali"
    // (`DataSubjectRequest` sempat luput). Tanpa asersi ini, model yang ditulis
    // `executeErasure` tetapi lupa didaftarkan tidak diperiksa oleh apa pun.
    const written = columnsWrittenByService(serviceSource);
    const known = new Set(Object.keys(COVERAGE).map((m) => m[0].toLowerCase() + m.slice(1)));
    const unlisted = Object.keys(written).filter((m) => !known.has(m));
    expect(unlisted).toEqual([]);
  });

  it('setiap kolom yang ditandai disapu benar-benar ditulis, dan yang dipertahankan tidak', () => {
    // Bukan pengganti pembacaan kode — hanya menahan daftar agar tidak
    // menyimpang dari layanan yang benar-benar menulisnya. Kolom dianggap
    // tertulis bila muncul sebagai kunci di dalam `data: { … }` sebuah
    // `tx.<model>.update`/`updateMany` (termasuk yang masuk lewat spread).
    //
    // Arah kedua sama pentingnya: kolom yang ditulis tetapi didaftarkan
    // `retained` menyembunyikan penyapuan dari pemeriksaan (`actions` sempat
    // begitu), dan `retained` adalah janji "tidak disentuh" yang harus benar.
    const written = columnsWrittenByService(serviceSource);
    const problems: string[] = [];
    for (const [model, buckets] of Object.entries(COVERAGE)) {
      const keys = written[model[0].toLowerCase() + model.slice(1)] ?? new Set<string>();
      for (const col of buckets.swept) {
        if (!keys.has(col)) problems.push(`${model}.${col} ditandai disapu tetapi tidak ditulis`);
      }
      for (const col of buckets.retained) {
        if (keys.has(col)) problems.push(`${model}.${col} ditandai dipertahankan tetapi ditulis`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('tidak ada updateMany yang mengosongkan kolom terikat CHECK', () => {
    // Unit test mem-mock Prisma, jadi CHECK basis data tidak pernah dievaluasi
    // — itulah yang meloloskan `rejectionReason: null` pada baris saudara
    // berstatus `REJECTED` sampai tinjauan menemukannya. `updateMany` menyentuh
    // baris yang statusnya tidak diketahui di titik tulis, sehingga
    // mengosongkan kolom terikat CHECK dapat melanggar batasan (23514) dan
    // membatalkan seluruh transaksi. `update` tidak diperiksa: ia menulis satu
    // baris yang statusnya ikut ditetapkan di blok yang sama.
    const constrained = checkConstrainedColumns();
    const problems: string[] = [];
    for (const { model, data } of updateManyDataBlocks(serviceSource)) {
      const columns = constrained[model];
      if (!columns) continue;
      for (const [col, value] of Object.entries(data)) {
        if (value === 'null' && columns.has(col)) {
          problems.push(`${model}.${col} dikosongkan lewat updateMany, tetapi terikat CHECK`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('kolom perilaku (bukan teks) yang menandai "berhenti memproses" ditulis di fungsi penghapusannya', () => {
    // Kelas cacat yang lolos seluruh penjaga di atas: `consentWithdrawnAt` dan
    // `ktpFileName` bukan kolom teks, sehingga `stringColumns()` tidak pernah
    // melihatnya — dan penghapusan yang meninggalkannya membuat subjek yang
    // sudah dianonimkan tetap diproses (prospek pemasaran) atau tetap terbaca
    // (foto KTP).
    //
    // **Diperiksa per fungsi, bukan per berkas.** `consentWithdrawnAt` juga
    // ditulis `withdrawConsent`, jadi penjaga yang memindai seluruh berkas
    // akan hijau meski `eraseRegistrant` melewatkannya — persis hijau palsu
    // yang pernah lolos pada bentuk spread.
    const required: { fn: string; model: string; columns: string[] }[] = [
      { fn: 'eraseRegistrant', model: 'registrant', columns: ['consentWithdrawnAt'] },
      { fn: 'eraseUserIdentity', model: 'userIdentity', columns: ['ktpFileName', 'ktpSha256'] },
    ];
    const problems: string[] = [];
    for (const { fn, model, columns } of required) {
      const body = functionSource(serviceSource, fn);
      if (!body) {
        problems.push(`${fn} tidak ditemukan di layanan`);
        continue;
      }
      const keys = columnsWrittenByService(body)[model] ?? new Set<string>();
      for (const col of columns) {
        if (!keys.has(col)) problems.push(`${fn} tidak menulis ${model}.${col}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('setiap jalur yang mengosongkan `User` juga menyapu `UserIdentity`-nya', () => {
    // Penjaga di atas memeriksa bahwa `eraseUserIdentity` **menulis** kolomnya —
    // bukan bahwa ia **dipanggil** dari setiap cabang subjek. Cacat putaran 13
    // lolos persis di celah itu: `eraseStudent` mengosongkan `User` (nama,
    // surel, `deletedAt`) lalu berhenti, meninggalkan `UserIdentity` dengan
    // nama sesuai KTP dan NIK 16 digit. `onDelete: Cascade` tidak menolong,
    // karena baris `User` diperbarui, bukan dihapus.
    //
    // Karena itu yang diperiksa di sini adalah **titik panggil**, satu tingkat
    // lebih halus daripada "per fungsi": setiap fungsi yang menulis
    // `deletedAt` pada `user` wajib memanggil `eraseUserIdentity`.
    const problems: string[] = [];
    const userClearing: string[] = [];
    for (const [, name] of serviceSource.matchAll(/async function (\w+)\(/g)) {
      const body = functionSource(serviceSource, name);
      if (!body) continue;
      if (!/tx\.user\.update\(/.test(body)) continue;
      if (!/deletedAt: now/.test(body)) continue;
      userClearing.push(name);
      if (!/eraseUserIdentity\(/.test(body)) {
        problems.push(`${name} mengosongkan User tanpa memanggil eraseUserIdentity`);
      }
    }
    // Penjaga yang tidak menemukan apa pun akan hijau selamanya. Kedua fungsi
    // ini WAJIB terbaca: `eraseStudent` (parameter `string`/`Date`) dan
    // `executeErasure` (parameter memuat literal tipe objek) — yang terakhir
    // itulah yang dulu terbaca sebagai `{ userId: string; name: string }` dan
    // membuat penjaga ini hijau tanpa memeriksa badan apa pun.
    expect(userClearing).toEqual(expect.arrayContaining(['eraseStudent', 'executeErasure']));
    expect(problems).toEqual([]);
  });

  it('`functionSource` melewati daftar parameter yang memuat literal tipe objek', () => {
    // Cacat yang tertangkap di atas: `indexOf('{')` berhenti di `{ userId:
    // string }` milik parameter, bukan di badan fungsi. Diuji terpisah supaya
    // kelas ini tertangkap untuk fungsi berikutnya, bukan hanya yang kebetulan
    // ada hari ini.
    const synthetic = `
      async function target(a: string, actor: { userId: string; name: string }) {
        await tx.user.update({ data: { deletedAt: now } });
        await eraseUserIdentity(tx, a);
      }
    `;
    const body = functionSource(synthetic, 'target');
    expect(body).toContain('tx.user.update(');
    expect(body).toContain('eraseUserIdentity(');
    expect(body).not.toBe('{ userId: string; name: string }');
  });

  it('penjaga CHECK membaca nilai yang masuk lewat spread', () => {
    // Bentuk cacat yang sebenarnya terjadi (putaran 12) bukan literal langsung
    // di blok `data`, melainkan `rejectionReason: null` di dalam objek `const`
    // yang kemudian di-spread. Tanpa uji ini, penjaga dapat hijau pada kode
    // yang justru melanggar CHECK — dan penjaga yang hijau palsu lebih
    // berbahaya daripada tidak ada penjaga.
    const synthetic = `
      const anonymised = { a: null, b: 'x' };
      await tx.dataSubjectRequest.updateMany({ where: {}, data: { ...anonymised } });
    `;
    const [block] = updateManyDataBlocks(synthetic);
    expect(block.data.a).toBe('null');
    expect(block.data.b).toBe("'x'");
  });
});

/**
 * Badan sebuah `async function NAME(…) { … }` pada sumber, atau `null`.
 *
 * Kurung kurawal **pertama** setelah nama fungsi bukanlah awal badan. Dua
 * bentuk membuat `indexOf('{')` berhenti di tempat yang salah:
 *
 * - daftar parameter dengan literal tipe objek —
 *   `executeErasure(…, actor: { userId: string; name: string })` — sehingga
 *   yang terbaca hanya `{ userId: … }`;
 * - anotasi tipe kembalian dengan literal objek —
 *   `): Promise<{ uploadFiles: string[]; identityFiles: string[] }> {`.
 *
 * Keduanya membuat penjaga hijau tanpa memeriksa badan sama sekali. Karena itu
 * daftar parameter dilewati lebih dulu, lalu anotasi tipe kembalian dilewati
 * sampai `{` yang berada di kedalaman nol.
 */
function functionSource(source: string, name: string): string | null {
  const re = new RegExp(`async function ${name}\\(`);
  const m = re.exec(source);
  if (!m) return null;
  const paramsOpen = source.indexOf('(', m.index);
  if (paramsOpen < 0) return null;
  const paramsClose = closingParen(source, paramsOpen);
  if (paramsClose < 0) return null;
  const open = bodyBrace(source, paramsClose + 1);
  if (open < 0) return null;
  return sliceBalanced(source, open);
}

/**
 * Indeks `{` pertama pada kedalaman nol sesudah `from` — melewati anotasi tipe
 * seperti `Promise<{ … }>`. Kurung `<>`, `()`, `[]`, dan `{}` dihitung sebagai
 * kedalaman, jadi literal objek di dalam tipe tidak dikira badan fungsi.
 */
function bodyBrace(source: string, from: number): number {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(source, i);
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i);
      if (i < 0) return -1;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) return i;
      depth++;
    } else if (ch === '}' || ch === '>' || ch === ')' || ch === ']') {
      depth--;
    } else if (ch === '<' || ch === '(' || ch === '[') {
      depth++;
    }
  }
  return -1;
}

/** Indeks `)` yang menutup `(` pada `open`, melewati string dan komentar. */
function closingParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(source, i);
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i);
      if (i < 0) return -1;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

/** Indeks penutup string yang dibuka pada `start`, atau akhir sumber. */
function skipString(source: string, start: number): number {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source[i] === quote) return i;
  }
  return source.length;
}

/** Kolom yang disebut `CHECK (…)` pada migrasi, per nama FIELD Prisma. */
function checkConstrainedColumns(): Record<string, Set<string>> {
  // SQL memakai nama kolom basis data (`rejection_reason`), sedangkan layanan
  // menulis nama field Prisma (`rejectionReason`). Tanpa pemetaan lewat DMMF,
  // penjaga ini tidak pernah cocok dan hijau secara palsu.
  const result: Record<string, Set<string>> = {};
  const dir = resolve(__dirname, '../../../../prisma/migrations');
  for (const migration of readdirSync(dir)) {
    const file = resolve(dir, migration, 'migration.sql');
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, 'utf8');
    for (const [, table, body] of sql.matchAll(/ALTER TABLE "(\w+)"([\s\S]*?);/g)) {
      if (!/CHECK\s*\(/i.test(body)) continue;
      const model = datamodel.models.find((m) => m.dbName === table);
      if (!model) continue;
      const delegate = model.name[0].toLowerCase() + model.name.slice(1);
      const columns = (result[delegate] ??= new Set<string>());
      for (const [, dbColumn] of body.matchAll(/"(\w+)"/g)) {
        const field = model.fields.find((f) => (f.dbName ?? f.name) === dbColumn);
        if (field) columns.add(field.name);
      }
    }
  }
  return result;
}

/** Blok `data: { … }` setiap `tx.<model>.updateMany`, dengan nilai literal. */
function updateManyDataBlocks(source: string): { model: string; data: Record<string, string> }[] {
  const code = source.replace(/\/\/[^\n]*/g, '');
  const constObjects = topLevelConstObjects(code);
  const blocks: { model: string; data: Record<string, string> }[] = [];
  for (const call of code.matchAll(/tx\.(\w+)\.updateMany\(\{/g)) {
    const body = sliceBalanced(code, call.index + call[0].length - 1);
    const dataAt = body.indexOf('data: {');
    if (dataAt < 0) continue;
    const data = literalValues(sliceBalanced(body, body.indexOf('{', dataAt)), constObjects);
    blocks.push({ model: call[1], data });
  }
  return blocks;
}

/** Nilai literal per kunci objek; kunci dari spread memakai nilai aslinya. */
function literalValues(
  obj: string,
  constObjects: Record<string, Record<string, string>>
): Record<string, string> {
  // Setiap kunci didaftarkan lebih dulu, termasuk yang nilainya bukan literal
  // (template literal, identifier) — kalau tidak, kolom seperti `detail`
  // hilang dari daftar "ditulis" dan penjaga cakupan merah palsu.
  const values: Record<string, string> = {};
  for (const name of topLevelSpreads(obj)) {
    Object.assign(values, constObjects[name] ?? {});
  }
  for (const key of topLevelKeys(obj)) values[key] ??= 'expr';
  for (const [, key, value] of obj.matchAll(/(\w+)\s*:\s*(null|'[^']*'|"[^"]*"|\d+)/g)) {
    values[key] = value;
  }
  return values;
}

/** Peta `tx.<model>.update(Many)({…})` -> himpunan kunci `data`. */
function columnsWrittenByService(source: string): Record<string, Set<string>> {
  // Komentar baris dibuang lebih dulu: sebuah `:` di dalamnya akan terbaca
  // sebagai pemisah kunci dan menempelkan komentar ke nama kolom berikutnya.
  const code = source.replace(/\/\/[^\n]*/g, '');
  const constObjects = topLevelConstObjects(code);
  const result: Record<string, Set<string>> = {};
  const callRe = /tx\.(\w+)\.(?:update|updateMany)\(\{/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(code))) {
    const open = match.index + match[0].length - 1;
    const body = sliceBalanced(code, open);
    const dataIdx = body.indexOf('data: {');
    if (dataIdx < 0) continue;
    const keys = objectKeys(sliceBalanced(body, body.indexOf('{', dataIdx)), constObjects);
    const model = match[1];
    result[model] ??= new Set<string>();
    for (const k of keys) result[model].add(k);
  }
  return result;
}

/** Nilai literal objek `const NAME = { … }` pada kedalaman teratas. */
function topLevelConstObjects(source: string): Record<string, Record<string, string>> {
  const map: Record<string, Record<string, string>> = {};
  const re = /const\s+(\w+)\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const open = m.index + m[0].length - 1;
    map[m[1]] = literalValues(sliceBalanced(source, open), {});
  }
  return map;
}

/** Kunci sebuah objek, memperluas `...identifier` dari `constObjects`. */
function objectKeys(obj: string, constObjects: Record<string, Record<string, string>>): string[] {
  const keys = topLevelKeys(obj);
  for (const name of topLevelSpreads(obj)) {
    keys.push(...Object.keys(constObjects[name] ?? {}));
  }
  return keys;
}

/** Identifier yang di-spread (`...name`) pada kedalaman teratas objek. */
function topLevelSpreads(obj: string): string[] {
  const inner = obj.slice(1, -1);
  const spreads: string[] = [];
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === "'" || c === '"') {
      const q = c;
      while (++i < inner.length && inner[i] !== q);
    } else if (c === '.' && depth === 0 && inner[i + 1] === '.' && inner[i + 2] === '.') {
      const m = /^\.\.\.(\w+)/.exec(inner.slice(i));
      if (m) spreads.push(m[1]);
    }
  }
  return spreads;
}

/** Isi `{…}` mulai dari indeks `open` (kurung penyeimbang). */
function sliceBalanced(s: string, open: number): string {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return s.slice(open, i + 1);
    }
  }
  throw new Error('kurung tidak seimbang');
}

/** Kunci objek pada kedalaman teratas, mengabaikan isi string/objek bersarang. */
function topLevelKeys(obj: string): string[] {
  const inner = obj.slice(1, -1);
  const keys: string[] = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === "'" || c === '"') {
      const q = c;
      while (++i < inner.length && inner[i] !== q);
    } else if (c === ':' && depth === 0) {
      const key = buf.trim();
      if (/^[A-Za-z_]\w*$/.test(key)) keys.push(key);
      buf = '';
    } else if (c === ',' && depth === 0) buf = '';
    else buf += c;
  }
  return keys;
}
