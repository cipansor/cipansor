import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

/** Model yang `executeErasure`/`eraseStudent`/`eraseRegistrant` tulis ulang. */
const COVERAGE: Record<string, Buckets> = {
  Student: {
    swept: [
      'address',
      'parentName',
      'parentPhone',
      'parentEmail',
      'birthPlace',
      'photoUrl',
      'nisn',
      'nik',
      'noKK',
      'noAkta',
      'fatherName',
      'fatherNik',
      'fatherBirthPlace',
      'fatherPhone',
      'motherName',
      'motherNik',
      'motherBirthPlace',
      'motherPhone',
      'guardianName',
      'guardianNik',
      'guardianRelation',
      'guardianPhone',
      'rt',
      'rw',
      'postalCode',
      'kipNumber',
      'specialNeeds',
      'livingWith',
    ],
    retained: ['nis', 'status', 'religion', 'nationality'],
    ignored: ['id', 'userId', 'unitId', 'provinceId', 'regencyId', 'districtId', 'villageId'],
  },
  Registrant: {
    swept: [
      'fullName',
      'name',
      'address',
      'phone',
      'email',
      'birthPlace',
      'previousSchool',
      'parentName',
      'parentPhone',
      'parentEmail',
      'parentOccupation',
      'notes',
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
    swept: ['name', 'notes', 'fileUrl'],
    retained: ['type'],
    ignored: ['id', 'registrantId'],
  },
  StudentDocument: {
    swept: ['title', 'description', 'documentNumber', 'rejectionReason', 'fileUrl'],
    retained: ['mimeType'],
    ignored: ['id', 'studentId', 'verifiedById', 'uploadedById'],
  },
  User: {
    swept: [
      'name',
      'email',
      'phone',
      'passwordHash',
      'resetTokenHash',
      'twoFactorSecret',
      'twoFactorSecretPending',
      'twoFactorRecoveryCodes',
      'fcmToken',
    ],
    retained: [],
    ignored: ['id', 'unitId'],
  },
  UserIdentity: {
    swept: ['legalName', 'nik', 'birthPlace', 'verificationNote'],
    retained: ['ktpFileName', 'ktpSha256'],
    ignored: ['id', 'userId', 'verifiedById'],
  },
  LegacyIdentifierAudit: {
    swept: ['value'],
    retained: ['field', 'reason', 'keptStudentId'],
    ignored: ['id', 'studentId'],
  },
  StudentNote: {
    swept: ['title', 'content'],
    retained: ['attachments', 'tags'],
    ignored: ['id', 'studentId', 'classId', 'academicYearId', 'createdById'],
  },
  MarketingInteraction: {
    swept: ['notes'],
    retained: ['type'],
    ignored: ['id', 'registrantId', 'recordedById'],
  },
  MedicalRecord: {
    swept: ['complaint', 'diagnosis', 'treatment', 'prescription', 'notes', 'referredTo'],
    retained: ['bloodPressure'],
    ignored: ['id', 'studentId', 'patientId', 'recordedById'],
  },
  SpecialDiet: {
    swept: ['medicalNotes', 'allergies'],
    retained: ['dietType'],
    ignored: ['id', 'studentId', 'approvedById'],
  },
  ImmunizationRecord: {
    swept: ['notes'],
    retained: ['vaccineName', 'vaccineCode', 'administeredAt', 'batchNumber', 'status'],
    ignored: ['id', 'studentId', 'unitId', 'recordedById'],
  },
  ClinicAppointment: {
    swept: ['complaint'],
    retained: ['status'],
    ignored: ['id', 'unitId', 'patientId', 'studentId', 'userId', 'processedById'],
  },
  MedicationUsageLog: {
    swept: ['reason'],
    retained: [],
    ignored: ['id', 'medicationId', 'studentId', 'givenById'],
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
  CounselingSession: {
    swept: ['title', 'description', 'summary', 'recommendations', 'psychologyData'],
    retained: ['location'],
    ignored: ['id', 'unitId', 'studentId', 'counselorId'],
  },
  CounselingNote: {
    swept: ['content'],
    retained: ['noteType'],
    ignored: ['id', 'sessionId', 'createdById'],
  },
  CounselingReferral: {
    swept: ['reason', 'outcome', 'referredTo', 'institution', 'contactInfo'],
    retained: [],
    ignored: ['id', 'sessionId', 'createdById'],
  },
  GrowthRecord: {
    swept: ['notes'],
    retained: ['nutritionStatus'],
    ignored: ['id', 'studentId', 'unitId', 'recordedById'],
  },
};

type DmmfModel = {
  name: string;
  fields: { name: string; kind: string; type: string; isList: boolean }[];
};

const datamodel = (Prisma as unknown as { dmmf: { datamodel: { models: DmmfModel[] } } }).dmmf
  .datamodel;

/** Kolom skalar `String`/`Json` sebuah model — teks bebas yang perlu diputuskan. */
function stringColumns(model: string): string[] {
  const m = datamodel.models.find((x) => x.name === model);
  if (!m) throw new Error(`model ${model} tidak ada di skema`);
  return m.fields
    .filter((f) => f.kind === 'scalar' && (f.type === 'String' || f.type === 'Json'))
    .map((f) => f.name);
}

const serviceSource = readFileSync(
  resolve(__dirname, '../data-subject-requests.service.ts'),
  'utf8'
);

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

  it('setiap kolom yang ditandai disapu benar-benar ditulis di layanan', () => {
    // Bukan pengganti pembacaan kode — hanya menahan daftar agar tidak
    // menyimpang dari layanan yang benar-benar menulisnya. Kolom dianggap
    // tertulis bila muncul sebagai kunci di dalam `data: { … }` sebuah
    // `tx.<model>.update`/`updateMany`.
    const written = columnsWrittenByService(serviceSource);
    const missing: string[] = [];
    for (const [model, buckets] of Object.entries(COVERAGE)) {
      const keys = written[model[0].toLowerCase() + model.slice(1)] ?? new Set<string>();
      for (const col of buckets.swept) {
        if (!keys.has(col)) missing.push(`${model}.${col}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

/** Peta `tx.<model>.update(Many)({…})` -> himpunan kunci `data`. */
function columnsWrittenByService(source: string): Record<string, Set<string>> {
  // Komentar baris dibuang lebih dulu: sebuah `:` di dalamnya akan terbaca
  // sebagai pemisah kunci dan menempelkan komentar ke nama kolom berikutnya.
  const code = source.replace(/\/\/[^\n]*/g, '');
  const result: Record<string, Set<string>> = {};
  const callRe = /tx\.(\w+)\.(?:update|updateMany)\(\{/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(code))) {
    const open = match.index + match[0].length - 1;
    const body = sliceBalanced(code, open);
    const dataIdx = body.indexOf('data: {');
    if (dataIdx < 0) continue;
    const keys = topLevelKeys(sliceBalanced(body, body.indexOf('{', dataIdx)));
    const model = match[1];
    result[model] ??= new Set<string>();
    for (const k of keys) result[model].add(k);
  }
  return result;
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
