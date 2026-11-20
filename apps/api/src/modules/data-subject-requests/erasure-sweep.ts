import { Prisma } from '@prisma/client';

/**
 * Penyapuan teks bebas pada tabel yang menaut subjek, di luar kolom identitas
 * dan kategori khusus (yang disapu `data-subject-requests.service.ts`).
 *
 * `ERASURE` **menganonimkan** baris `Student`/`Registrant`/`User`, bukan
 * menghapusnya (Pasal 43–44: catatan akademik dan keuangan wajib retensi).
 * Karena barisnya tetap ada, `onDelete: Cascade` pada kunci asingnya tidak
 * pernah menyala — sehingga setiap tabel yang menyimpan prosa tentang subjek
 * harus disapu eksplisit. Daftar di bawah adalah keputusan lengkap untuk
 * seluruh `String`/`Json` pada model yang menaut subjek; penjaganya
 * `tests/erasure-coverage.guard.test.ts`.
 *
 * **Tiga keranjang, dan artinya.**
 *
 * - **Disapu** — teks bebas yang menyebut orangnya (nama, keluhan, alasan,
 *   catatan, umpan balik, judul karya). Ditimpa `marker`.
 * - **Dipertahankan** — nilai operasional/akademik yang tidak menyebut orang:
 *   status, tipe, kategori, predikat, nilai angka, NIS, nomor dokumen. Barisnya
 *   dan angkanya memang wajib retensi; yang hilang hanya keterhubungannya
 *   dengan orang, dan itu sudah dikerjakan kolom identitas.
 * - **Berkas** — URL unggahan yang isinya milik subjek (foto, rekaman, lampiran,
 *   bukti transfer). Penunjuknya dikosongkan **dan** jalurnya dikembalikan ke
 *   pemanggil supaya berkasnya dihapus setelah transaksi dikukuhkan; lihat
 *   `deleteStoredFiles` di layanan.
 */

/** Apa yang disapu dari satu kelompok tabel. */
export type SweepOutcome = {
  /** Kelompok yang benar-benar disapu, untuk `erased` pada rekaman tindakan. */
  erased: string[];
  /** Baris/nilai yang sengaja dipertahankan, beserta alasannya. */
  retained: string[];
  /** URL unggahan yang harus dihapus setelah commit. */
  files: string[];
  /** Selalu kosong di sini: berkas identitas ditangani `eraseUserIdentity`. */
  identityFiles: string[];
};

const empty = (): SweepOutcome => ({ erased: [], retained: [], files: [], identityFiles: [] });

/** Nama properti JSON yang isinya prosa tentang subjek. */
type JsonKeys = ReadonlySet<string>;

/**
 * Ganti nilai string pada properti tertentu, rekursif ke seluruh isi JSON.
 *
 * Dipakai untuk kolom `Json` yang menyimpan cuplikan laporan (rapor, laporan
 * PAUD): angkanya dipertahankan sebagai arsip akademik, sedangkan deskripsi dan
 * umpan balik di dalamnya — yang menyalin teks dari tabel lain — ikut disapu.
 * Tanpa ini, menyapu `Violation.description` saja meninggalkan salinannya di
 * `RaporPesantren.akhlakData`.
 */
function redactJsonKeys(value: unknown, keys: JsonKeys, marker: string): unknown {
  if (Array.isArray(value)) return value.map((item) => redactJsonKeys(item, keys, marker));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] =
        keys.has(key) && typeof inner === 'string' ? marker : redactJsonKeys(inner, keys, marker);
    }
    return out;
  }
  return value;
}

/** URL di dalam kolom `Json` berbentuk larik (mis. `attachments`). */
function urlsInJson(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/**
 * Sapu teks bebas pada tabel yang menyimpan `studentId`.
 *
 * Dipanggil dari `eraseStudent`, sehingga berlaku untuk ketiga jalur subjek
 * (`STUDENT`, `REGISTRANT` yang sudah menjadi santri, dan `GUARDIAN` yang
 * akunnya menaut baris santri).
 */
export async function sweepStudentText(
  tx: Prisma.TransactionClient,
  studentId: string,
  marker: string
): Promise<SweepOutcome> {
  const outcome = empty();

  // ── Perilaku, tata tertib, dan izin ────────────────────────────────────────
  // Catatan perilaku dan pelanggaran menyebut kejadian yang melibatkan anak dan
  // tindakan yang dijatuhkan padanya; `category` hanya kosakata tetap.
  await tx.behaviorRecord.updateMany({
    where: { studentId },
    data: { description: marker, actionTaken: marker },
  });
  await tx.violation.updateMany({
    where: { studentId },
    data: { description: marker, action: marker },
  });
  await tx.reward.updateMany({
    where: { studentId },
    data: { description: marker },
  });
  await tx.studentVisit.updateMany({
    where: { studentId },
    data: { visitorName: marker, relationship: marker, needs: marker, notes: marker },
  });
  // `Permit.code` dipertahankan: kode pendek untuk memindai izin yang sudah
  // dicetak, tidak menyebut orang. `reason`/`destination`/`rejectionNote`
  // adalah prosa yang menyebut tujuan dan alasan pribadi.
  await tx.permit.updateMany({
    where: { studentId },
    data: { reason: marker, destination: marker, rejectionNote: marker },
  });
  // Surat keterangan dokter pada izin adalah data kesehatan anak dan disimpan
  // di baris basis data, bukan di `/uploads`; `content` bertipe `Bytes` sehingga
  // tidak terlihat oleh penjaga kolom teks. Barisnya tetap ada sebagai bukti
  // bahwa lampiran pernah ada (SHA-256, siapa yang membuka lebih dulu).
  const permits = await tx.permit.findMany({ where: { studentId }, select: { id: true } });
  if (permits.length) {
    await tx.permitAttachment.updateMany({
      where: { permitId: { in: permits.map((row) => row.id) }, erasedAt: null },
      data: { content: null, erasedAt: new Date() },
    });
  }
  await tx.dutyRoster.updateMany({ where: { studentId }, data: { notes: marker } });
  await tx.roomAssignment.updateMany({ where: { studentId }, data: { notes: marker } });

  // ── Presensi dan kegiatan harian ───────────────────────────────────────────
  await tx.attendance.updateMany({ where: { studentId }, data: { notes: marker } });
  await tx.mealAttendance.updateMany({ where: { studentId }, data: { notes: marker } });
  await tx.dailyIbadahRecord.updateMany({ where: { studentId }, data: { notes: marker } });
  await tx.dailyMuhasabah.updateMany({
    where: { studentId },
    data: { gratitude: marker, improvement: marker, notes: marker },
  });
  // Tindak lanjut presensi menaut lewat `attendanceId`; isinya adalah hasil
  // menghubungi keluarga ("ibu dihubungi, anak demam").
  const attendances = await tx.attendance.findMany({
    where: { studentId },
    select: { id: true },
  });
  if (attendances.length) {
    await tx.attendanceFollowUp.updateMany({
      where: { attendanceId: { in: attendances.map((row) => row.id) } },
      data: { note: marker },
    });
  }

  // ── Nilai dan rapor ────────────────────────────────────────────────────────
  // Angka, predikat, dan peringkat dipertahankan (arsip akademik); catatan guru
  // dan wali kelas disapu.
  await tx.grade.updateMany({ where: { studentId }, data: { notes: marker } });
  const reportCards = await tx.reportCard.findMany({
    where: { studentId },
    select: { id: true },
  });
  await tx.reportCard.updateMany({
    where: { studentId },
    data: { teacherNotes: marker, principalNotes: marker },
  });
  if (reportCards.length) {
    await tx.reportCardDetail.updateMany({
      where: { reportCardId: { in: reportCards.map((row) => row.id) } },
      data: { description: marker },
    });
  }
  await tx.raporPesantren.updateMany({
    where: { studentId },
    data: {
      notes: marker,
      headTeacherNotes: marker,
      musyrifNotes: marker,
      principalNotes: marker,
    },
  });
  // Cuplikan JSON rapor menyalin prosa dari tabel lain (`akhlakData` memuat
  // deskripsi pelanggaran dan penghargaan; muhadhoroh/muhadatsah memuat tema dan
  // umpan balik). Angkanya tetap; hanya teks yang menyebut anak yang diganti.
  const raporRows = await tx.raporPesantren.findMany({
    where: { studentId },
    select: {
      id: true,
      akhlakData: true,
      muhadhorohData: true,
      muhadatsahData: true,
    },
  });
  for (const row of raporRows) {
    const akhlak = redactJsonKeys(row.akhlakData, new Set(['description']), marker);
    const muhadhoroh = redactJsonKeys(row.muhadhorohData, new Set(['feedback', 'theme']), marker);
    const muhadatsah = redactJsonKeys(row.muhadatsahData, new Set(['feedback', 'topic']), marker);
    // Ketiga kolom ditulis sekaligus, termasuk yang tidak berubah: menulis
    // kembali nilai yang sama tidak mengubah apa pun, dan penjaga cakupan
    // membaca kolom dari kunci literal `data` — bentuk bertahap akan
    // menyembunyikan kolom yang justru disapu.
    await tx.raporPesantren.update({
      where: { id: row.id },
      data: {
        akhlakData: akhlak as Prisma.InputJsonValue,
        muhadhorohData: muhadhoroh as Prisma.InputJsonValue,
        muhadatsahData: muhadatsah as Prisma.InputJsonValue,
      },
    });
  }
  await tx.p5Assessment.updateMany({ where: { studentId }, data: { notes: marker } });
  const merdekaResults = await tx.merdekaAssessmentResult.findMany({
    where: { studentId },
    select: { attachments: true },
  });
  for (const row of merdekaResults) outcome.files.push(...urlsInJson(row.attachments));
  await tx.merdekaAssessmentResult.updateMany({
    where: { studentId },
    data: { feedback: marker, attachments: Prisma.DbNull },
  });

  // ── Laporan harian dan PAUD ────────────────────────────────────────────────
  // Laporan harian memuat kondisi anak, kegiatan, dan catatan guru — semuanya
  // prosa. `notifiedVia` (kanal pemberitahuan) dipertahankan sebagai jejak
  // operasional.
  await tx.dailyStudentReport.updateMany({
    where: { studentId },
    data: {
      healthStatus: marker,
      toiletNotes: marker,
      tahfidzActivity: marker,
      activitiesSummary: marker,
      achievements: marker,
      behaviorNotes: marker,
      teacherNotes: marker,
      homeActivity: marker,
      pickedUpBy: marker,
    },
  });
  const dailyReports = await tx.dailyStudentReport.findMany({
    where: { studentId },
    select: { id: true },
  });
  if (dailyReports.length) {
    const reportIds = dailyReports.map((row) => row.id);
    const photos = await tx.dailyReportPhoto.findMany({
      where: { reportId: { in: reportIds } },
      select: { photoUrl: true },
    });
    for (const photo of photos) if (photo.photoUrl) outcome.files.push(photo.photoUrl);
    await tx.dailyReportPhoto.updateMany({
      where: { reportId: { in: reportIds } },
      data: { photoUrl: '', caption: marker },
    });
    await tx.dailyHomework.updateMany({
      where: { reportId: { in: reportIds } },
      data: { subjectName: marker, description: marker },
    });
  }
  await tx.pAUDDevelopmentAssessment.updateMany({
    where: { studentId },
    data: { narrativeText: marker, teacherNotes: marker, recommendations: marker },
  });
  const paudAssessments = await tx.pAUDDevelopmentAssessment.findMany({
    where: { studentId },
    select: { id: true },
  });
  if (paudAssessments.length) {
    const assessmentIds = paudAssessments.map((row) => row.id);
    const evidence = await tx.pAUDAssessmentEvidence.findMany({
      where: { assessmentId: { in: assessmentIds } },
      select: { fileUrl: true },
    });
    for (const file of evidence) if (file.fileUrl) outcome.files.push(file.fileUrl);
    await tx.pAUDAssessmentEvidence.updateMany({
      where: { assessmentId: { in: assessmentIds } },
      data: { fileUrl: '', fileName: marker, caption: marker },
    });
  }
  await tx.pAUDNarrativeReport.updateMany({
    where: { studentId },
    data: {
      narrativeNAM: marker,
      narrativeFM: marker,
      narrativeKOG: marker,
      narrativeBHS: marker,
      narrativeSE: marker,
      narrativeSNI: marker,
      overallStrengths: marker,
      areasForDevelopment: marker,
      parentRecommendations: marker,
    },
  });
  const paudReports = await tx.pAUDNarrativeReport.findMany({
    where: { studentId },
    select: { id: true, healthSummary: true },
  });
  for (const report of paudReports) {
    const photos = await tx.pAUDReportPhoto.findMany({
      where: { reportId: report.id },
      select: { photoUrl: true },
    });
    for (const photo of photos) if (photo.photoUrl) outcome.files.push(photo.photoUrl);
    await tx.pAUDReportPhoto.updateMany({
      where: { reportId: report.id },
      data: { photoUrl: '', caption: marker },
    });
    // `healthSummary` memuat catatan pertumbuhan anak — kategori khusus, jadi
    // catatannya ikut disapu; angkanya (berat, tinggi) tetap sebagai arsip.
    if (report.healthSummary !== null) {
      const next = redactJsonKeys(report.healthSummary, new Set(['notes']), marker);
      await tx.pAUDNarrativeReport.update({
        where: { id: report.id },
        data: { healthSummary: next as Prisma.InputJsonValue },
      });
    }
  }

  // ── Hafalan dan ibadah ─────────────────────────────────────────────────────
  // Nama surah/juz adalah rujukan kurikulum; catatan dan area perbaikan adalah
  // prosa tentang anak. Rekaman bacaan adalah berkas miliknya.
  const tahfidzRecords = await tx.tahfidzRecord.findMany({
    where: { studentId },
    select: { audioUrl: true },
  });
  for (const record of tahfidzRecords) if (record.audioUrl) outcome.files.push(record.audioUrl);
  await tx.tahfidzRecord.updateMany({
    where: { studentId },
    data: { notes: marker, audioUrl: null },
  });
  await tx.tahfidzTarget.updateMany({ where: { studentId }, data: { notes: marker } });
  await tx.hafidzStudent.updateMany({ where: { studentId }, data: { notes: marker } });
  await tx.murojaahRecord.updateMany({
    where: { studentId },
    data: { notes: marker, improvementAreas: marker },
  });
  const murojaah = await tx.murojaahRecord.findMany({
    where: { studentId },
    select: { id: true },
  });
  if (murojaah.length) {
    await tx.murojaahMistake.updateMany({
      where: { murojaahId: { in: murojaah.map((row) => row.id) } },
      data: { description: marker },
    });
  }
  await tx.simaanExam.updateMany({
    where: { studentId },
    data: { notes: marker, recommendations: marker },
  });
  const simaan = await tx.simaanExam.findMany({ where: { studentId }, select: { id: true } });
  if (simaan.length) {
    await tx.simaanExaminer.updateMany({
      where: { simaanId: { in: simaan.map((row) => row.id) } },
      data: { notes: marker },
    });
  }
  await tx.muhadhoroh.updateMany({
    where: { studentId },
    data: { topic: marker, feedback: marker },
  });
  await tx.muhadatsah.updateMany({
    where: { studentId },
    data: { topic: marker, feedback: marker },
  });
  // Rekaman video/audio pidato dan muhadatsah adalah berkas milik subjek.
  const recordings = await Promise.all([
    tx.muhadhoroh.findMany({ where: { studentId }, select: { videoUrl: true } }),
    tx.muhadatsah.findMany({ where: { studentId }, select: { recordingUrl: true } }),
  ]);
  for (const record of recordings[0]) if (record.videoUrl) outcome.files.push(record.videoUrl);
  for (const record of recordings[1])
    if (record.recordingUrl) outcome.files.push(record.recordingUrl);
  await tx.muhadhoroh.updateMany({ where: { studentId }, data: { videoUrl: null } });
  await tx.muhadatsah.updateMany({ where: { studentId }, data: { recordingUrl: null } });
  await tx.kitabProgress.updateMany({ where: { studentId }, data: { notes: marker } });
  await tx.kitabStudentProgress.updateMany({ where: { studentId }, data: { notes: marker } });
  await tx.kitabProgressRecord.updateMany({
    where: { studentId },
    data: { topic: marker, notes: marker, teacherFeedback: marker },
  });
  await tx.takhosusEnrollment.updateMany({ where: { studentId }, data: { notes: marker } });
  const takhosus = await tx.takhosusEnrollment.findMany({
    where: { studentId },
    select: { id: true },
  });
  if (takhosus.length) {
    await tx.sanadRecord.updateMany({
      where: { enrollmentId: { in: takhosus.map((row) => row.id) } },
      data: { notes: marker },
    });
  }

  // ── Tugas, penelitian, praktikum ───────────────────────────────────────────
  const submissions = await tx.assignmentSubmission.findMany({
    where: { studentId },
    select: { id: true, attachments: true },
  });
  for (const submission of submissions) outcome.files.push(...urlsInJson(submission.attachments));
  await tx.assignmentSubmission.updateMany({
    where: { studentId },
    data: { content: marker, feedback: marker, attachments: Prisma.DbNull },
  });
  // Jawaban ujian adalah tulisan subjek sendiri; skornya dipertahankan.
  const attempts = await tx.examAttempt.findMany({
    where: { studentId },
    select: { id: true },
  });
  if (attempts.length) {
    const attemptIds = attempts.map((row) => row.id);
    await tx.examAnswer.updateMany({
      where: { attemptId: { in: attemptIds } },
      data: { answer: Prisma.DbNull },
    });
    // Log pengawasan ujian mencatat perilaku anak (berpindah tab, lama
    // meninggalkan layar); jenis kejadiannya dipertahankan sebagai arsip
    // integritas ujian, muatan terstrukturnya dikosongkan.
    await tx.examSecurityLog.updateMany({
      where: { attemptId: { in: attemptIds } },
      data: { details: Prisma.DbNull },
    });
  }
  await tx.researchSubmission.updateMany({
    where: { studentId },
    data: { title: marker, abstract: marker, content: marker, feedback: marker },
  });
  await tx.practicumLessonPlan.updateMany({
    where: { studentId },
    data: {
      subject: marker,
      topic: marker,
      method: marker,
      materials: marker,
      objectives: marker,
      reviewNotes: marker,
    },
  });
  // `steps` menyimpan tahapan mengajar yang ditulis mahasiswa sendiri
  // (`[{ name, content }]`); nama tahapnya struktur, isinya prosa.
  const lessonPlans = await tx.practicumLessonPlan.findMany({
    where: { studentId },
    select: { id: true, steps: true },
  });
  for (const plan of lessonPlans) {
    const steps = redactJsonKeys(plan.steps, new Set(['content']), marker);
    if (JSON.stringify(steps) === JSON.stringify(plan.steps)) continue;
    await tx.practicumLessonPlan.update({
      where: { id: plan.id },
      data: { steps: steps as Prisma.InputJsonValue },
    });
  }
  if (lessonPlans.length) {
    await tx.practicumEvaluation.updateMany({
      where: { lessonPlanId: { in: lessonPlans.map((row) => row.id) } },
      data: { feedback: marker },
    });
  }

  // ── Portofolio, ekstrakurikuler, organisasi, beasiswa ──────────────────────
  const portfolios = await tx.portfolio.findMany({
    where: { studentId },
    select: { id: true },
  });
  await tx.portfolio.updateMany({
    where: { studentId },
    data: { title: marker, description: marker, reflection: marker, feedback: marker },
  });
  if (portfolios.length) {
    const portfolioIds = portfolios.map((row) => row.id);
    const files = await tx.portfolioFile.findMany({
      where: { portfolioId: { in: portfolioIds } },
      select: { fileUrl: true },
    });
    for (const file of files) if (file.fileUrl) outcome.files.push(file.fileUrl);
    await tx.portfolioFile.updateMany({
      where: { portfolioId: { in: portfolioIds } },
      data: { fileName: marker, fileUrl: '' },
    });
    await tx.portfolioComment.updateMany({
      where: { portfolioId: { in: portfolioIds } },
      data: { content: marker },
    });
  }
  await tx.extracurricularEnrollment.updateMany({
    where: { studentId },
    data: { notes: marker },
  });
  await tx.extracurricularAttendance.updateMany({
    where: { studentId },
    data: { notes: marker },
  });
  const achievements = await tx.extracurricularAchievement.findMany({
    where: { studentId },
    select: { certificateUrl: true, photoUrl: true },
  });
  for (const row of achievements) {
    if (row.certificateUrl) outcome.files.push(row.certificateUrl);
    if (row.photoUrl) outcome.files.push(row.photoUrl);
  }
  await tx.extracurricularAchievement.updateMany({
    where: { studentId },
    data: {
      title: marker,
      description: marker,
      certificateUrl: null,
      photoUrl: null,
    },
  });
  const orgMembers = await tx.studentOrgMember.findMany({
    where: { studentId },
    select: { id: true },
  });
  if (orgMembers.length) {
    await tx.studentOrgLogbook.updateMany({
      where: { memberId: { in: orgMembers.map((row) => row.id) } },
      data: { activity: marker, result: marker, notes: marker },
    });
  }
  const scholarships = await tx.scholarshipRecipient.findMany({
    where: { studentId },
    select: { id: true },
  });
  await tx.scholarshipRecipient.updateMany({ where: { studentId }, data: { notes: marker } });
  if (scholarships.length) {
    // `value` mencatat kondisi aktual kriteria ("penghasilan ayah Rp …"),
    // yaitu data ekonomi keluarga — bukan angka akademik.
    await tx.scholarshipAssessment.updateMany({
      where: { recipientId: { in: scholarships.map((row) => row.id) } },
      data: { value: marker, notes: marker },
    });
  }

  // ── Keuangan, perpustakaan, unit bisnis ────────────────────────────────────
  // Baris dan nominalnya dipertahankan (wajib retensi); catatan bebas, nama
  // pemesan, dan nomor referensi bank disapu.
  await tx.invoice.updateMany({ where: { studentId }, data: { notes: marker } });
  const invoices = await tx.invoice.findMany({ where: { studentId }, select: { id: true } });
  if (invoices.length) {
    const invoiceIds = invoices.map((row) => row.id);
    const payments = await tx.payment.findMany({
      where: { invoiceId: { in: invoiceIds } },
      select: { proofUrl: true },
    });
    for (const payment of payments) if (payment.proofUrl) outcome.files.push(payment.proofUrl);
    await tx.payment.updateMany({
      where: { invoiceId: { in: invoiceIds } },
      data: { proofUrl: null, rejectionReason: marker, notes: marker },
    });
  }
  await tx.borrowing.updateMany({ where: { studentId }, data: { notes: marker } });
  await tx.canteenTransaction.updateMany({
    where: { studentId },
    data: { customerName: marker, notes: marker },
  });
  const canteen = await tx.canteenTransaction.findMany({
    where: { studentId },
    select: { id: true },
  });
  if (canteen.length) {
    await tx.canteenTransactionItem.updateMany({
      where: { transactionId: { in: canteen.map((row) => row.id) } },
      data: { notes: marker },
    });
  }
  await tx.laundryTransaction.updateMany({ where: { studentId }, data: { notes: marker } });
  const laundry = await tx.laundryTransaction.findMany({
    where: { studentId },
    select: { id: true },
  });
  if (laundry.length) {
    const laundryIds = laundry.map((row) => row.id);
    await tx.laundryItem.updateMany({
      where: { transactionId: { in: laundryIds } },
      data: { notes: marker },
    });
    await tx.laundryStatusLog.updateMany({
      where: { transactionId: { in: laundryIds } },
      data: { notes: marker },
    });
  }
  const wallets = await tx.santriWallet.findMany({
    where: { studentId },
    select: { id: true },
  });
  if (wallets.length) {
    await tx.walletTransaction.updateMany({
      where: { walletId: { in: wallets.map((row) => row.id) } },
      data: { description: marker },
    });
  }

  // ── Riwayat unit, kartu, kursus ────────────────────────────────────────────
  // `exitReason` terikat CHECK (`student_unit_enrollments_exit_reason_check`):
  // penanda akan melanggar batasan itu dan membatalkan seluruh transaksi, jadi
  // nilainya dipertahankan apa adanya — ia kosakata tetap, bukan prosa.
  await tx.studentCardState.updateMany({
    where: { studentId },
    data: { revokeReason: marker },
  });
  const enrollments = await tx.courseEnrollment.findMany({
    where: { studentId },
    select: { id: true },
  });
  await tx.courseEnrollment.updateMany({
    where: { studentId },
    data: { externalName: marker, externalEmail: marker, externalPhone: marker },
  });
  if (enrollments.length) {
    const certificates = await tx.courseCertificate.findMany({
      where: { enrollmentId: { in: enrollments.map((row) => row.id) } },
      select: { fileUrl: true },
    });
    for (const row of certificates) if (row.fileUrl) outcome.files.push(row.fileUrl);
    await tx.courseCertificate.updateMany({
      where: { enrollmentId: { in: enrollments.map((row) => row.id) } },
      data: { fileUrl: null },
    });
  }

  // ── Arsip, sertifikat, kedatangan tamu ─────────────────────────────────────
  await tx.studentPackage.updateMany({
    where: { studentId },
    data: {
      senderName: marker,
      senderPhone: marker,
      content: marker,
      deliveredTo: marker,
      notes: marker,
    },
  });
  const packages = await tx.studentPackage.findMany({
    where: { studentId },
    select: { photoUrl: true },
  });
  for (const row of packages) if (row.photoUrl) outcome.files.push(row.photoUrl);
  await tx.studentPackage.updateMany({ where: { studentId }, data: { photoUrl: null } });

  // Sertifikat adalah arsip akademik: nomor, QR, dan berkas PDF-nya
  // dipertahankan. Yang disapu adalah judul/deskripsi yang menyebut nama anak
  // dan `metadata` render (nama, sanad) — dan sertifikatnya ditutup dari
  // verifikasi publik supaya penanda tidak tampil di `/verify/:code`.
  const certificates = await tx.digitalCertificate.findMany({
    where: { studentId },
    select: { pdfUrl: true, thumbnailUrl: true },
  });
  for (const row of certificates) {
    if (row.pdfUrl) outcome.files.push(row.pdfUrl);
    if (row.thumbnailUrl) outcome.files.push(row.thumbnailUrl);
  }
  await tx.digitalCertificate.updateMany({
    where: { studentId },
    data: {
      title: marker,
      description: marker,
      metadata: Prisma.DbNull,
      pdfUrl: null,
      thumbnailUrl: null,
      isPublic: false,
    },
  });

  // ── Alumni ─────────────────────────────────────────────────────────────────
  // Baris alumni memegang salinan identitas yang sama dengan `Student`, dan
  // menaut lewat `studentId` yang opsional — jadi ia harus disapu sendiri.
  const alumni = await tx.alumni.findMany({ where: { studentId }, select: { id: true } });
  await tx.alumni.updateMany({
    where: { studentId },
    data: {
      name: marker,
      birthPlace: marker,
      email: marker,
      phone: marker,
      address: marker,
      city: marker,
      province: marker,
      country: marker,
      notes: marker,
      photo: null,
    },
  });
  const alumniRows = await tx.alumni.findMany({ where: { studentId }, select: { photo: true } });
  for (const row of alumniRows) if (row.photo) outcome.files.push(row.photo);
  if (alumni.length) {
    const alumniIds = alumni.map((row) => row.id);
    await tx.alumniCareer.updateMany({
      where: { alumniId: { in: alumniIds } },
      data: {
        company: marker,
        position: marker,
        industry: marker,
        location: marker,
        description: marker,
      },
    });
    await tx.alumniEducation.updateMany({
      where: { alumniId: { in: alumniIds } },
      data: {
        institution: marker,
        degree: marker,
        field: marker,
        location: marker,
        achievements: marker,
        admissionPath: marker,
        scholarshipName: marker,
      },
    });
    await tx.alumniDonation.updateMany({
      where: { alumniId: { in: alumniIds } },
      data: { description: marker, purpose: marker, notes: marker },
    });
    await tx.alumniEventAttendee.updateMany({
      where: { alumniId: { in: alumniIds } },
      data: { notes: marker },
    });
  }

  // ── Pengumuman: hanya baris yang ditujukan kepada subjek seorang diri ──────
  // `Announcement.content` milik pengumuman kelompok (yayasan, unit, kelas,
  // atau daftar santri mukim) bukan tentang subjek: menyapunya akan menghapus
  // pesan bagi santri lain. Yang disapu hanya pengumuman yang seluruh
  // penerimanya subjek itu sendiri — `scope='BOARDERS'` dengan `studentIds`
  // berisi tepat satu id.
  const personal = await tx.announcement.findMany({
    where: { scope: 'BOARDERS', studentIds: { equals: [studentId] } },
    select: { attachmentUrl: true },
  });
  for (const row of personal) if (row.attachmentUrl) outcome.files.push(row.attachmentUrl);
  await tx.announcement.updateMany({
    where: { scope: 'BOARDERS', studentIds: { equals: [studentId] } },
    data: { title: marker, content: marker, attachmentUrl: null },
  });

  outcome.erased.push(
    'catatan perilaku dan pelanggaran',
    'catatan kunjungan tamu',
    'alasan izin',
    'catatan presensi dan kegiatan harian',
    'catatan nilai dan rapor',
    'catatan laporan harian',
    'catatan perkembangan PAUD',
    'catatan hafalan dan ibadah',
    'catatan tugas, penelitian, dan praktikum',
    'portofolio dan umpan baliknya',
    'catatan ekstrakurikuler, organisasi, dan beasiswa',
    'catatan keuangan dan unit bisnis',
    'catatan paket dan kartu santri',
    'judul dan deskripsi sertifikat',
    'identitas alumni dan riwayatnya',
    'pengumuman pribadi'
  );
  outcome.retained.push(
    'nilai dan predikat',
    'status dan jenis (kosakata tetap)',
    'NIS dan nomor dokumen',
    'nomor sertifikat dan kode verifikasinya (arsip akademik)',
    'nomor referensi transaksi (tanpa pemilik)',
    'alasan keluar unit (terikat CHECK, kosakata tetap)',
    'kode izin (pemindaian izin tercetak)'
  );
  return outcome;
}

/**
 * Sapu teks bebas pada tabel yang menaut subjek lewat `userId`.
 *
 * Dipanggil dari `executeErasure` setelah `eraseUserIdentity`, untuk subjek
 * yang mewakili dirinya sendiri (`GUARDIAN`) — termasuk orang tua/wali yang
 * tidak menaut baris santri mana pun. Kotak pesan, pengaduan, notifikasi, dan
 * baris pasien (`Patient`) menyimpan prosa yang menyebut orangnya dan tidak
 * ikut tersapu oleh `eraseStudent`.
 */
export async function sweepUserText(
  tx: Prisma.TransactionClient,
  userId: string,
  marker: string
): Promise<SweepOutcome> {
  const outcome = empty();

  // Pesan adalah percakapan dua arah: yang disapu adalah pesan yang dikirim
  // ATAU diterima subjek, karena keduanya menyebut dirinya.
  await tx.message.updateMany({
    where: { OR: [{ senderId: userId }, { recipientId: userId }] },
    data: { subject: marker, content: marker },
  });
  const complaints = await tx.complaint.findMany({
    where: { userId },
    select: { id: true, attachments: true },
  });
  for (const row of complaints) outcome.files.push(...urlsInJson(row.attachments));
  await tx.complaint.updateMany({
    where: { userId },
    data: {
      subject: marker,
      description: marker,
      location: marker,
      resolution: marker,
      attachments: Prisma.DbNull,
    },
  });
  if (complaints.length) {
    await tx.complaintComment.updateMany({
      where: { complaintId: { in: complaints.map((row) => row.id) } },
      data: { content: marker },
    });
  }
  await tx.notification.updateMany({
    where: { userId },
    data: { title: marker, message: marker, data: Prisma.DbNull, link: null },
  });
  // `Patient` adalah baris identitas pasien yang menaut `User`; nama, telepon,
  // dan alamatnya salinan dari subjek.
  await tx.patient.updateMany({
    where: { userId },
    data: { name: marker, phone: null, address: marker },
  });

  outcome.erased.push('isi pesan', 'isi pengaduan', 'notifikasi', 'identitas pasien');
  return outcome;
}
