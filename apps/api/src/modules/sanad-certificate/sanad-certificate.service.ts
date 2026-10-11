import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import type {
  ListSanadQuery,
  CreateSanadInput,
  UpdateSanadInput,
  GenerateCertificateInput,
  VerifyCertificateInput,
  BulkCreateSanadInput,
  SanadGrade,
} from './sanad-certificate.schema';
import {
  GRADE_LABELS,
  MIN_BULK_CREATE_RECORDS,
  MAX_BULK_CREATE_RECORDS,
} from './sanad-certificate.schema';
import { certificateVerificationUrl } from '@/utils/verification-url';
import { escapeHtml } from '@/utils/html';
import { Errors } from '@/middleware/error';
import { unitDocumentName } from '@cipansor/shared';

const JUZ_NAMES: Record<number, string> = {
  1: 'Juz Amma',
  30: 'Juz 30',
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateCertificateNumber(): string {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `SANAD-${year}${month}-${random}`;
}

function generateVerificationCode(): string {
  return crypto.randomBytes(6).toString('hex').toUpperCase();
}

function getJuzName(juz: number): string {
  return JUZ_NAMES[juz] || `Juz ${juz}`;
}

// ============================================
// LIST SANAD RECORDS
// ============================================

export async function findAllSanadRecords(
  query: ListSanadQuery,
  context: { role: string; unitId?: string | null; userId: string }
) {
  const { page, limit, studentId, teacherId, halaqohId, juz, grade, hasCertificate, search } =
    query;
  const skip = (page - 1) * limit;

  const where: Prisma.SanadRecordWhereInput = {
    ...(teacherId && { teacherId }),
    ...(juz && { juz }),
    ...(grade && { grade }),
    ...(studentId && {
      enrollment: { studentId },
    }),
    ...(halaqohId && {
      enrollment: { halaqohId },
    }),
    ...(search && {
      OR: [
        { enrollment: { student: { user: { name: { contains: search, mode: 'insensitive' } } } } },
        { teacher: { name: { contains: search, mode: 'insensitive' } } },
      ],
    }),
    // Filter by unit if not super admin
    ...(context.unitId && {
      enrollment: {
        student: { unitId: context.unitId },
      },
    }),
  };

  const [records, total] = await Promise.all([
    prisma.sanadRecord.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ certifiedAt: 'desc' }, { juz: 'asc' }],
      include: {
        enrollment: {
          include: {
            student: {
              select: {
                id: true,
                nis: true,
                photoUrl: true,
                user: { select: { name: true } },
              },
            },
            halaqoh: { select: { id: true, name: true } },
          },
        },
        teacher: { select: { id: true, name: true } },
      },
    }),
    prisma.sanadRecord.count({ where }),
  ]);

  return {
    records,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ============================================
// GET SANAD BY ID
// ============================================

export async function findSanadById(id: string) {
  const record = await prisma.sanadRecord.findUnique({
    where: { id },
    include: {
      enrollment: {
        include: {
          student: {
            select: {
              id: true,
              nis: true,
              nisn: true,
              photoUrl: true,
              birthDate: true,
              birthPlace: true,
              user: { select: { name: true } },
              unit: { select: { id: true, name: true, officialName: true, type: true } },
            },
          },
          halaqoh: { select: { id: true, name: true } },
        },
      },
      teacher: { select: { id: true, name: true, email: true } },
    },
  });

  if (!record) {
    throw new Error('Sanad record not found');
  }

  return record;
}

// ============================================
// CREATE SANAD RECORD
// ============================================

export async function createSanadRecord(input: CreateSanadInput, _context: { userId: string }) {
  // Validate enrollment exists
  const enrollment = await prisma.takhosusEnrollment.findUnique({
    where: { id: input.enrollmentId },
    select: { id: true, studentId: true },
  });

  if (!enrollment) {
    throw new Error('Enrollment not found');
  }

  // Validate teacher exists
  const teacher = await prisma.user.findUnique({
    where: { id: input.teacherId },
    select: { id: true, role: true },
  });

  if (!teacher) {
    throw new Error('Teacher not found');
  }

  // Check for duplicate (same enrollment + juz)
  const existing = await prisma.sanadRecord.findUnique({
    where: {
      enrollmentId_juz: {
        enrollmentId: input.enrollmentId,
        juz: input.juz,
      },
    },
  });

  if (existing) {
    throw new Error(`Sanad for Juz ${input.juz} already exists for this student`);
  }

  return prisma.sanadRecord.create({
    data: {
      enrollmentId: input.enrollmentId,
      teacherId: input.teacherId,
      juz: input.juz,
      surahStart: input.surahStart,
      surahEnd: input.surahEnd,
      grade: input.grade,
      certifiedAt: input.certifiedAt ? new Date(input.certifiedAt) : new Date(),
      notes: input.notes,
    },
    include: {
      enrollment: {
        include: {
          student: {
            select: {
              id: true,
              nis: true,
              user: { select: { name: true } },
            },
          },
        },
      },
      teacher: { select: { id: true, name: true } },
    },
  });
}

// ============================================
// UPDATE SANAD RECORD
// ============================================

export async function updateSanadRecord(
  id: string,
  input: UpdateSanadInput,
  _context: { userId: string }
) {
  const record = await prisma.sanadRecord.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!record) {
    throw new Error('Sanad record not found');
  }

  return prisma.sanadRecord.update({
    where: { id },
    data: {
      ...input,
      updatedAt: new Date(),
    },
    include: {
      enrollment: {
        include: {
          student: {
            select: {
              id: true,
              nis: true,
              user: { select: { name: true } },
            },
          },
        },
      },
      teacher: { select: { id: true, name: true } },
    },
  });
}

// ============================================
// DELETE SANAD RECORD
// ============================================

export async function deleteSanadRecord(id: string) {
  const record = await prisma.sanadRecord.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!record) {
    throw new Error('Sanad record not found');
  }

  return prisma.sanadRecord.delete({ where: { id } });
}

// ============================================
// BULK CREATE SANAD RECORDS
// ============================================

export async function bulkCreateSanadRecords(
  input: BulkCreateSanadInput,
  context: { userId: string }
) {
  const results = {
    success: 0,
    failed: 0,
    errors: [] as { index: number; error: string }[],
  };

  if (!Array.isArray(input.records)) {
    throw Errors.badRequest('Invalid records payload');
  }

  if (input.records.length < MIN_BULK_CREATE_RECORDS) {
    throw Errors.badRequest(`At least ${MIN_BULK_CREATE_RECORDS} record is required`);
  }

  if (input.records.length > MAX_BULK_CREATE_RECORDS) {
    throw Errors.badRequest(
      `Cannot create more than ${MAX_BULK_CREATE_RECORDS} records in one request`
    );
  }

  const records = input.records;

  for (let i = 0; i < records.length; i++) {
    try {
      await createSanadRecord(records[i], context);
      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        index: i,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}

// ============================================
// GET STUDENT SANAD SUMMARY
// ============================================

export async function getStudentSanadSummary(studentId: string) {
  const enrollment = await prisma.takhosusEnrollment.findFirst({
    where: { studentId },
    select: { id: true },
  });

  if (!enrollment) {
    return {
      studentId,
      totalJuz: 0,
      records: [],
      completedJuz: [],
      pendingJuz: Array.from({ length: 30 }, (_, i) => i + 1),
    };
  }

  const records = await prisma.sanadRecord.findMany({
    where: { enrollmentId: enrollment.id },
    orderBy: { juz: 'asc' },
    include: {
      teacher: { select: { id: true, name: true } },
    },
  });

  const completedJuz = records.map((r) => r.juz);
  const allJuz = Array.from({ length: 30 }, (_, i) => i + 1);
  const pendingJuz = allJuz.filter((j) => !completedJuz.includes(j));

  return {
    studentId,
    totalJuz: completedJuz.length,
    records,
    completedJuz,
    pendingJuz,
    progress: Math.round((completedJuz.length / 30) * 100),
  };
}

// ============================================
// GENERATE CERTIFICATE
// ============================================

export async function generateCertificate(
  input: GenerateCertificateInput,
  context: { userId: string }
) {
  const sanad = await findSanadById(input.sanadId);

  // Persist the certificate so `verifyCertificate` can honestly attest it
  // later. One certificate per (student, juz): regenerating reuses the
  // existing number/verification code instead of minting a new identity for
  // the same attainment.
  const title = `Sertifikat Sanad ${getJuzName(sanad.juz)} (Juz ${sanad.juz})`;
  let certificate = await prisma.digitalCertificate.findFirst({
    where: {
      studentId: sanad.enrollment.student.id,
      certificateType: 'SANAD',
      title,
    },
  });

  if (!certificate) {
    // Minted before the create so the stored verificationUrl can carry it. The
    // URL used to be the bare page with no `?code=`, which made every
    // certificate's "verify" link identical and left the scanner to retype the
    // number by hand off the paper.
    const newCertificateNumber = generateCertificateNumber();
    certificate = await prisma.digitalCertificate.create({
      data: {
        studentId: sanad.enrollment.student.id,
        certificateType: 'SANAD',
        title,
        description: `Pengesahan hafalan Juz ${sanad.juz} oleh ${sanad.teacher.name}`,
        certificateNumber: newCertificateNumber,
        qrCode: generateVerificationCode(),
        verificationUrl: certificateVerificationUrl(newCertificateNumber),
        grade: GRADE_LABELS[sanad.grade as SanadGrade] || sanad.grade || undefined,
        issueDate: sanad.certifiedAt,
        signatoryName: input.signedBy || sanad.teacher.name,
        signatoryTitle: input.signedByTitle || 'Guru Tahfidz',
        // The juz and teacher printed on the sanad. Stored so the public
        // download reproduces the issued document instead of the generic
        // certificate, which knows only the holder's name and grade.
        metadata: {
          juz: sanad.juz,
          juzName: getJuzName(sanad.juz),
          teacherName: sanad.teacher.name,
        },
        // Explicit, never the column default. The certificate's printed
        // verification URL points at the public page, so a row left private
        // failed its own verification ("Sertifikat tidak ditemukan") the moment
        // it was issued. `generateCertificateSchema` defaults this to `true`;
        // an issuer minting an internal record passes `false` and nothing
        // discloses it publicly.
        isPublic: input.isPublic ?? true,
        createdById: context.userId,
      },
    });
  }

  const certificateNumber = certificate.certificateNumber;
  const verificationCode = certificate.qrCode;

  // The "Mengetahui" signatory printed is the one stored when the certificate
  // was minted — what the public verify page attests — not whatever a later
  // request's ?signedBy= says, or two prints of one certificate could name two
  // different signatories. Minted without one, the stored value is the teacher,
  // who already signs the first box, so the second stays blank as before.
  const countersigned =
    !!certificate.signatoryName && certificate.signatoryName !== sanad.teacher.name;

  // Generate certificate data
  const certificateData = {
    certificateNumber,
    verificationCode,
    sanadId: sanad.id,
    studentName: sanad.enrollment.student.user?.name || 'Unknown',
    studentNis: sanad.enrollment.student.nis,
    juz: sanad.juz,
    juzName: getJuzName(sanad.juz),
    grade: sanad.grade as SanadGrade,
    gradeLabel: GRADE_LABELS[sanad.grade as SanadGrade] || sanad.grade,
    teacherName: sanad.teacher.name,
    certifiedAt: sanad.certifiedAt,
    unitName: sanad.enrollment.student.unit
      ? unitDocumentName(sanad.enrollment.student.unit)
      : 'Pesantren',
    halaqohName: sanad.enrollment.halaqoh?.name,
    signedBy: countersigned ? (certificate.signatoryName ?? undefined) : undefined,
    signedByTitle: countersigned ? (certificate.signatoryTitle ?? undefined) : undefined,
    templateType: input.templateType,
    includeQRCode: input.includeQRCode,
    generatedAt: new Date(),
  };

  return certificateData;
}

// ============================================
// GENERATE CERTIFICATE HTML
// ============================================

export function generateCertificateHtml(
  certificateData: Awaited<ReturnType<typeof generateCertificate>>
): string {
  const certDate = new Date(certificateData.certifiedAt).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sertifikat Sanad - ${escapeHtml(certificateData.studentName)}</title>
  <style>
    @page { size: A4 landscape; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Times New Roman', Times, serif;
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .certificate {
      width: 297mm;
      min-height: 210mm;
      background: white;
      border: 8px solid #1a5f2a;
      border-radius: 10px;
      padding: 30px 40px;
      position: relative;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
    .border-inner {
      border: 2px solid #d4af37;
      border-radius: 5px;
      padding: 25px;
      height: 100%;
    }
    .header {
      text-align: center;
      margin-bottom: 20px;
    }
    .header h1 {
      font-size: 28pt;
      color: #1a5f2a;
      margin-bottom: 5px;
      text-transform: uppercase;
      letter-spacing: 3px;
    }
    .header h2 {
      font-size: 16pt;
      color: #d4af37;
      font-weight: normal;
    }
    .bismillah {
      text-align: center;
      font-size: 24pt;
      color: #1a5f2a;
      margin: 15px 0;
      font-family: 'Traditional Arabic', serif;
    }
    .content {
      text-align: center;
      margin: 20px 0;
    }
    .content p {
      font-size: 14pt;
      margin: 10px 0;
      line-height: 1.6;
    }
    .student-name {
      font-size: 24pt;
      font-weight: bold;
      color: #1a5f2a;
      margin: 15px 0;
      border-bottom: 2px solid #d4af37;
      padding-bottom: 5px;
      display: inline-block;
    }
    .juz-info {
      font-size: 18pt;
      color: #333;
      margin: 15px 0;
    }
    .grade {
      font-size: 16pt;
      font-weight: bold;
      color: #d4af37;
      margin: 10px 0;
    }
    .details {
      display: flex;
      justify-content: space-around;
      margin: 25px 0;
      text-align: left;
    }
    .detail-item {
      font-size: 11pt;
    }
    .detail-item strong {
      color: #1a5f2a;
    }
    .signatures {
      display: flex;
      justify-content: space-between;
      margin-top: 30px;
      padding: 0 50px;
    }
    .signature-box {
      text-align: center;
      width: 200px;
    }
    .signature-line {
      border-bottom: 1px solid #333;
      height: 50px;
      margin-bottom: 5px;
    }
    .signature-name {
      font-weight: bold;
      font-size: 12pt;
    }
    .signature-title {
      font-size: 10pt;
      color: #666;
    }
    .footer {
      position: absolute;
      bottom: 40px;
      left: 0;
      right: 0;
      text-align: center;
      font-size: 9pt;
      color: #666;
    }
    .cert-number {
      font-family: monospace;
      background: #f0f0f0;
      padding: 3px 8px;
      border-radius: 3px;
    }
    .qr-code {
      position: absolute;
      bottom: 80px;
      right: 60px;
      width: 80px;
      height: 80px;
      border: 1px solid #ddd;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8pt;
      color: #999;
    }
    @media print {
      body { padding: 0; background: white; }
      .certificate { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="certificate">
    <div class="border-inner">
      <div class="header">
        <h1>Sertifikat Sanad</h1>
        <h2>${escapeHtml(certificateData.unitName)}</h2>
      </div>

      <div class="bismillah">بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ</div>

      <div class="content">
        <p>Dengan ini menyatakan bahwa:</p>
        <div class="student-name">${escapeHtml(certificateData.studentName)}</div>
        <p>NIS: ${escapeHtml(certificateData.studentNis)}</p>
        
        <p style="margin-top: 20px;">Telah menyelesaikan hafalan Al-Qur'an</p>
        <div class="juz-info">${escapeHtml(certificateData.juzName)} (Juz ${certificateData.juz})</div>
        
        <p>dengan predikat:</p>
        <div class="grade">${escapeHtml(certificateData.gradeLabel)}</div>

        <div class="details">
          <div class="detail-item">
            <strong>Halaqoh:</strong> ${escapeHtml(certificateData.halaqohName || '-')}
          </div>
          <div class="detail-item">
            <strong>Program:</strong> Tahfidz Al-Qur'an
          </div>
          <div class="detail-item">
            <strong>Pengajar:</strong> ${escapeHtml(certificateData.teacherName)}
          </div>
          <div class="detail-item">
            <strong>Tanggal:</strong> ${certDate}
          </div>
        </div>
      </div>

      <div class="signatures">
        <div class="signature-box">
          <p style="font-size: 10pt;">Pengajar/Mushohih</p>
          <div class="signature-line"></div>
          <p class="signature-name">${escapeHtml(certificateData.teacherName)}</p>
          <p class="signature-title">Guru Tahfidz</p>
        </div>
        <div class="signature-box">
          <p style="font-size: 10pt;">Mengetahui</p>
          <div class="signature-line"></div>
          <p class="signature-name">${escapeHtml(certificateData.signedBy || '____________________')}</p>
          <p class="signature-title">${escapeHtml(certificateData.signedByTitle || 'Kepala Madrasah')}</p>
        </div>
      </div>

      ${
        certificateData.includeQRCode
          ? `
      <div class="qr-code">
        [QR Code]<br>
        Verifikasi
      </div>
      `
          : ''
      }

      <div class="footer">
        <p>No. Sertifikat: <span class="cert-number">${escapeHtml(certificateData.certificateNumber)}</span></p>
        <p>Kode Verifikasi: ${escapeHtml(certificateData.verificationCode)}</p>
        <p>Sertifikat ini dapat diverifikasi di: ${escapeHtml(certificateVerificationUrl(certificateData.certificateNumber))}</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

// ============================================
// VERIFY CERTIFICATE
// ============================================

/**
 * Verify a certificate against the persisted `DigitalCertificate` records.
 * A certificate is valid only if its number exists in the database, was
 * marked `isPublic` by its issuer, and — when a verification code is
 * supplied — the code matches. This endpoint is public, so the returned
 * projection is limited to what is printed on the certificate itself, never
 * internal IDs or contact data.
 *
 * The `isPublic` predicate is not optional here. Only a certificate its
 * issuer chose to publish may be read without a session; without it, anyone
 * holding (or guessing) a *private* certificate's number — a tahfidz syahadah
 * minted for internal records, say — received the holder's name, unit and
 * grade from this route. A private certificate now answers `valid: false`,
 * exactly as an unknown number does, so this route cannot be used to confirm
 * that a private certificate exists. This mirrors `certificates.service.ts`'s
 * `verifyCertificate` (CWE-862).
 */
export async function verifyCertificate(input: VerifyCertificateInput) {
  const { certificateNumber, verificationCode } = input;

  const certificate = await prisma.digitalCertificate.findFirst({
    where: { certificateNumber, isPublic: true },
    include: {
      student: {
        select: {
          user: { select: { name: true } },
          unit: { select: { name: true, officialName: true } },
        },
      },
    },
  });

  if (!certificate) {
    return {
      valid: false,
      message: 'Sertifikat tidak ditemukan. Periksa kembali nomor sertifikat.',
    };
  }

  if (verificationCode && certificate.qrCode !== verificationCode.toUpperCase()) {
    return {
      valid: false,
      message: 'Kode verifikasi tidak cocok dengan sertifikat ini.',
    };
  }

  return {
    valid: true,
    message: 'Sertifikat valid dan terdaftar di sistem Cipansor',
    data: {
      certificateNumber: certificate.certificateNumber,
      certificateType: certificate.certificateType,
      title: certificate.title,
      studentName: certificate.student.user?.name ?? null,
      grade: certificate.grade,
      issueDate: certificate.issueDate,
      unitName: certificate.student.unit ? unitDocumentName(certificate.student.unit) : null,
      signatoryName: certificate.signatoryName,
      signatoryTitle: certificate.signatoryTitle,
    },
  };
}

// ============================================
// SANAD TREE (Silsilah / Isnad)
// ============================================

export interface SanadTreeNode {
  id: string;
  name: string;
  role: 'TEACHER' | 'STUDENT';
  /** Distinct juz certified under the parent teacher (student nodes only). */
  juzCount?: number;
  /** Year of the most recent certification under the parent teacher. */
  certifiedYear?: number;
  children: SanadTreeNode[];
}

/**
 * Build the transmission tree (silsilah) from certification records:
 * teacher → certified students, chained when a certified student later
 * certifies others. Single query + in-memory adjacency map.
 */
export async function getSanadTree(): Promise<SanadTreeNode[]> {
  const records = await prisma.sanadRecord.findMany({
    select: {
      juz: true,
      certifiedAt: true,
      teacher: { select: { id: true, name: true } },
      enrollment: {
        select: {
          student: {
            select: { user: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });

  // Aggregate edges per (teacher, student) pair
  interface Edge {
    juz: Set<number>;
    lastCertifiedAt: Date;
  }
  const names = new Map<string, string>();
  const edges = new Map<string, Map<string, Edge>>(); // teacherId -> studentId -> Edge
  const studentIds = new Set<string>();

  for (const record of records) {
    const teacher = record.teacher;
    const student = record.enrollment.student.user;
    names.set(teacher.id, teacher.name);
    names.set(student.id, student.name);
    studentIds.add(student.id);

    let byStudent = edges.get(teacher.id);
    if (!byStudent) {
      byStudent = new Map();
      edges.set(teacher.id, byStudent);
    }
    const edge = byStudent.get(student.id);
    if (edge) {
      edge.juz.add(record.juz);
      if (record.certifiedAt > edge.lastCertifiedAt) edge.lastCertifiedAt = record.certifiedAt;
    } else {
      byStudent.set(student.id, {
        juz: new Set([record.juz]),
        lastCertifiedAt: record.certifiedAt,
      });
    }
  }

  const buildNode = (userId: string, visited: Set<string>, edge?: Edge): SanadTreeNode => {
    const childEdges = edges.get(userId);
    const children: SanadTreeNode[] = [];
    if (childEdges && !visited.has(userId)) {
      const nextVisited = new Set(visited).add(userId);
      for (const [studentId, studentEdge] of childEdges) {
        if (nextVisited.has(studentId)) continue; // cycle guard
        children.push(buildNode(studentId, nextVisited, studentEdge));
      }
      children.sort((a, b) => a.name.localeCompare(b.name));
    }
    return {
      id: userId,
      name: names.get(userId) ?? 'Unknown',
      role: edges.has(userId) ? 'TEACHER' : 'STUDENT',
      ...(edge
        ? {
            juzCount: edge.juz.size,
            certifiedYear: edge.lastCertifiedAt.getFullYear(),
          }
        : {}),
      children,
    };
  };

  // Roots: teachers who were never certified as students themselves
  const roots = [...edges.keys()]
    .filter((teacherId) => !studentIds.has(teacherId))
    .map((teacherId) => buildNode(teacherId, new Set()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return roots;
}

// ============================================
// EXPORT SERVICE
// ============================================

export const SanadCertificateService = {
  findAllSanadRecords,
  findSanadById,
  createSanadRecord,
  updateSanadRecord,
  deleteSanadRecord,
  bulkCreateSanadRecords,
  getStudentSanadSummary,
  getSanadTree,
  generateCertificate,
  generateCertificateHtml,
  verifyCertificate,
};
