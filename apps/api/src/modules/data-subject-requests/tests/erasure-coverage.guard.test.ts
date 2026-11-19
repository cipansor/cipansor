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
    // `registrationNo`/`source`/`consentVersion` = riwayat kepatuhan SPMB.
    // `consentIp` dipertahankan sebagai bukti sahnya persetujuan (Pasal 21):
    // IP asal persetujuan adalah bagian dari catatan itu, bukan turunan angka
    // operasional. Klasifikasi ini disengaja — jangan disapu tanpa keputusan
    // ulang, karena bukti persetujuan yang hilang tidak dapat dipulihkan.
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
    // `ktpFileName`/`ktpSha256` disapu **bersyarat**: bila subjeknya belum
    // pernah menerima kunci tanda tangan, berkasnya dibuang sekarang; bila
    // kunci sudah terbit, berkasnya bukti registrasi penandatangan yang wajib
    // disimpan sampai `ktpRetainUntil` dan dilaporkan di `outcome.retained`
    // saat penghapusan berjalan. Karena itu `retained: []` di bawah berarti
    // "tidak ada kolom yang selalu dipertahankan" — bukan "berkas KTP selalu
    // dibuang". Penjaga hanya melihat kolomnya ada di badan fungsi, jadi
    // syarat itu tidak dapat ia periksa; yang menutupnya adalah uji layanan
    // untuk kedua cabang (`data-subject-requests.service.test.ts`).
    swept: ['legalName', 'nik', 'birthPlace', 'verificationNote', 'ktpFileName', 'ktpSha256'],
    retained: [],
    ignored: ['id', 'userId', 'verifiedById'],
  },
  LegacyIdentifierAudit: {
    swept: ['value'],
    retained: ['field', 'reason', 'keptStudentId'],
    ignored: ['id', 'studentId'],
  },
  StudentNote: {
    swept: ['title', 'content'],
    // `attachments` adalah larik URL berkas; saat ini tak ada jalur tulis yang
    // mengisinya, jadi laten. Bila kelak diisi, berkasnya harus ikut dihapus —
    // bukan sekadar kehilangan rujukannya. Catat di sini sampai ada penulisnya.
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
  DataSubjectRequest: {
    swept: [
      'subjectLabel',
      'requesterName',
      'requesterContact',
      'requesterRelation',
      'detail',
      'rejectionReason',
      // Ditulis ulang: catatan tindakan diganti salinan yang sudah disapu
      // (peristiwa status dan waktunya tetap). Tidak boleh masuk `retained`
      // justru karena `retained` berarti "tidak ditulis sama sekali".
      'actions',
    ],
    retained: [],
    ignored: [
      'id',
      'requestNo',
      'subjectStudentId',
      'subjectRegistrantId',
      'subjectUserId',
      'requesterUserId',
      'handledById',
      'verificationCodeHash',
    ],
  },
};

type DmmfModel = {
  name: string;
  dbName?: string;
  fields: { name: string; dbName?: string; kind: string; type: string; isList: boolean }[];
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
    // Penjaga yang tidak menemukan apa pun akan hijau selamanya — pastikan
    // fungsinya memang ada, dan bahwa yang memanggil dari luar ikut tercatat.
    expect(userClearing).toContain('eraseStudent');
    expect(problems).toEqual([]);
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

/** Badan sebuah `async function NAME(…) { … }` pada sumber, atau `null`. */
function functionSource(source: string, name: string): string | null {
  const re = new RegExp(`async function ${name}\\(`);
  const m = re.exec(source);
  if (!m) return null;
  const open = source.indexOf('{', m.index);
  if (open < 0) return null;
  return sliceBalanced(source, open);
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
