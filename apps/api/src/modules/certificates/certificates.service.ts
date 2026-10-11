import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { certificateVerificationUrl } from '../../utils/verification-url';
import { assertStudentInScope, studentScope } from '../../utils/student-scope';
import { STUDENT_SUMMARY_SELECT, toStudentSummary } from '../../utils/student-summary';
import { generateCertificatePdfBuffer } from '../../utils/generate-certificate-pdf';
import { Errors } from '../../middleware/error';
import type {
  CreateCertificateDto,
  QueryCertificateDto,
  UpdateCertificateDto,
} from './certificates.schema';

/**
 * Who is asking, as the verified token carries it. Certificate reads and writes
 * are scoped by the santri a certificate belongs to — `studentScope` already
 * encodes one rule for every role (a santri sees their own, a wali their
 * children, staff their unit, the yayasan board and cross-unit staff every
 * unit). See `utils/student-scope.ts`.
 */
export interface CertificateActor {
  sub: string;
  roleCode?: string | null;
  unitId?: string | null;
}

/**
 * The santri a certificate names, as far as the certificate shows them
 * (`STUDENT_SUMMARY_SELECT`; never `include` on `student`).
 */
const studentInclude = {
  student: { select: STUDENT_SUMMARY_SELECT },
  createdBy: { select: { id: true, name: true } },
} as const;

type CertificateRow = Prisma.DigitalCertificateGetPayload<{ include: typeof studentInclude }>;

/**
 * The row in the shape `@cipansor/shared` promises (`DigitalCertificate`):
 * `student.name` and `student.class` at the top, as the pages read them. The
 * raw row nests both (`user.name`, `enrollments[0].class`), which left the
 * name on the verification page blank.
 */
function toCertificateDto(row: CertificateRow) {
  const { student, ...certificate } = row;
  return { ...certificate, student: toStudentSummary(student) };
}

/**
 * What the session-free verification answers: that the certificate exists and
 * what it says — who, what, when, signed by whom. Nothing that identifies the
 * holder beyond the name, unit and class printed on it: no ids, no NIS, no
 * photo, no QR blob or download count.
 */
const publicCertificateSelect = {
  certificateNumber: true,
  certificateType: true,
  title: true,
  description: true,
  grade: true,
  rank: true,
  issueDate: true,
  signatoryName: true,
  signatoryTitle: true,
  isPublic: true,
  student: {
    select: {
      user: { select: { name: true } },
      unit: { select: { name: true } },
      enrollments: {
        where: { status: 'active' },
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        select: { class: { select: { name: true } } },
      },
    },
  },
} as const;

/**
 * The DigitalCertificate table has no generated QR; verification is keyed by
 * number. The blob itself must still be unguessable — it is printed on every
 * certificate — so it comes from the CSPRNG, not `Math.random`.
 */
function qrCode() {
  return crypto.randomUUID();
}

function certificateNumber(type: string) {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  // The number is the public verification key, so a guessable four-digit
  // sequence would let anyone enumerate other students' certificates.
  const seq = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `${type.slice(0, 3).toUpperCase()}/${month}/${year}/${seq}`;
}

export async function createCertificate(
  data: CreateCertificateDto,
  createdById: string,
  actor: CertificateActor
) {
  // A certificate is written to a santri, so the writer must be able to reach
  // that santri — a teacher cannot issue a certificate for another unit's
  // santri by naming their id.
  await assertStudentInScope(data.studentId, actor);

  const number = certificateNumber(data.certificateType);
  const created = await prisma.digitalCertificate.create({
    data: {
      studentId: data.studentId,
      certificateType: data.certificateType,
      title: data.title,
      description: data.description,
      certificateNumber: number,
      qrCode: qrCode(),
      verificationUrl: certificateVerificationUrl(number),
      grade: data.grade,
      rank: data.rank,
      issueDate: new Date(data.issueDate),
      signatoryName: data.signatoryName,
      signatoryTitle: data.signatoryTitle,
      signatureUrl: data.signatureUrl,
      isPublic: data.isPublic,
      createdById,
    },
    include: studentInclude,
  });
  return toCertificateDto(created);
}

export async function getCertificates(query: QueryCertificateDto, actor: CertificateActor) {
  const { studentId, certificateType, search, page, limit } = query;
  const scope = studentScope(actor);
  const where = {
    // Row-level scope: only certificates for santri this account may see.
    student: scope,
    ...(studentId && { studentId }),
    ...(certificateType && { certificateType }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' as const } },
        { certificateNumber: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
  };

  const [data, total] = await Promise.all([
    prisma.digitalCertificate.findMany({
      where,
      include: studentInclude,
      orderBy: { issueDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.digitalCertificate.count({ where }),
  ]);

  return {
    data: data.map(toCertificateDto),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** The row, only when the caller may reach the santri it names. */
function findCertificateInScope(id: string, actor: CertificateActor) {
  return prisma.digitalCertificate.findFirst({
    where: { AND: [{ id }, { student: studentScope(actor) }] },
    include: studentInclude,
  });
}

export async function getCertificateById(id: string, actor: CertificateActor) {
  const row = await findCertificateInScope(id, actor);
  return row ? toCertificateDto(row) : null;
}

export async function updateCertificate(
  id: string,
  data: UpdateCertificateDto,
  actor: CertificateActor
) {
  // 404 (not 403) for a certificate outside the caller's reach, so an id
  // guessed from another unit says nothing about that unit.
  const existing = await findCertificateInScope(id, actor);
  if (!existing) throw Errors.notFound('Certificate');

  const updated = await prisma.digitalCertificate.update({
    where: { id },
    data: {
      ...data,
      ...(data.issueDate && { issueDate: new Date(data.issueDate) }),
    },
    include: studentInclude,
  });
  return toCertificateDto(updated);
}

export async function deleteCertificate(id: string, actor: CertificateActor) {
  const existing = await findCertificateInScope(id, actor);
  if (!existing) throw Errors.notFound('Certificate');
  return prisma.digitalCertificate.delete({ where: { id } });
}

export async function getStudentCertificates(studentId: string, actor: CertificateActor) {
  await assertStudentInScope(studentId, actor);

  const where = { studentId, student: studentScope(actor) };
  const [data, total] = await Promise.all([
    prisma.digitalCertificate.findMany({
      where,
      include: studentInclude,
      orderBy: { issueDate: 'desc' },
    }),
    prisma.digitalCertificate.count({ where }),
  ]);
  return {
    data: data.map(toCertificateDto),
    meta: { page: 1, limit: total, total, totalPages: 1 },
  };
}

/**
 * Public verification: the code is the certificate number, not the QR blob.
 *
 * Only a certificate its issuer marked `isPublic` may be read here — the route
 * is reachable with no session, so anyone holding a number would otherwise
 * receive the holder's name, unit, class and grades. A private certificate
 * answers `valid: false`, exactly as an unknown number does, so the endpoint
 * cannot be used to confirm that a private certificate exists.
 */
export async function verifyCertificate(code: string) {
  const row = await prisma.digitalCertificate.findFirst({
    where: { certificateNumber: code, isPublic: true },
    select: publicCertificateSelect,
  });
  if (!row) return { valid: false, certificate: null };
  const { student, ...certificate } = row;
  return {
    valid: true,
    certificate: {
      ...certificate,
      student: {
        name: student.user.name,
        unit: student.unit,
        class: student.enrollments[0]?.class,
      },
    },
  };
}

export async function incrementDownloadCount(id: string) {
  return prisma.digitalCertificate.update({
    where: { id },
    data: { downloadCount: { increment: 1 } },
  });
}

/**
 * Render the certificate to a PDF and return its bytes.
 *
 * The bytes are produced from the row, never accepted from the client. Nothing
 * is written to disk: a certificate's PDF carries the holder's name, unit,
 * class and grades, so a file under `public/uploads` — served to *any* signed-in
 * token, including a santri's or a parent's — would hand every certificate to
 * every account that can guess a filename. Serving the bytes only from the
 * scoped download route keeps the row's scope the single authority on who may
 * read it.
 *
 * `pdfUrl` therefore stays `null`: it is a URL into the public uploads
 * directory, and a non-null value tells the web pages to link straight to that
 * directory, past the scope check. The download route is the only reader.
 */
export async function renderCertificatePdf(id: string, actor: CertificateActor) {
  const certificate = await findCertificateInScope(id, actor);
  if (!certificate) throw Errors.notFound('Certificate');

  const buffer = await generateCertificatePdfBuffer(certificate);
  return { certificate, buffer };
}

/**
 * Render a *public* certificate's PDF from its printed verification number.
 *
 * The authenticated download route cannot serve a visitor who has only a
 * certificate number: it is keyed by row id and scoped to the caller, so a
 * recipient holding a printed certificate has no way to obtain the file — the
 * gap that had the verification page link to an unrelated verification form
 * instead. This is the public half of that flow, and it is deliberately narrow:
 * the lookup is `isPublic: true`, exactly like `verifyCertificate`, so a
 * private certificate stays unreachable here even with its number. The bytes
 * come from the same renderer, and the download count is not incremented (there
 * is no authenticated actor to attribute it to, and this route is unthrottled
 * per row).
 */
export async function renderPublicCertificatePdf(code: string) {
  // `findFirst`, not `findUnique`: the `isPublic` predicate is part of the
  // identity here, and a private row must never be loaded into memory.
  const certificate = await prisma.digitalCertificate.findFirst({
    where: { certificateNumber: code, isPublic: true },
    include: studentInclude,
  });
  if (!certificate) throw Errors.notFound('Certificate');

  const buffer = await generateCertificatePdfBuffer(certificate);
  return { certificate, buffer };
}
