import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';

/**
 * Penjaga nama kolom pada setiap `select`/`include` modul ini.
 *
 * `PrismaClientValidationError` hanya muncul saat kueri **dijalankan**; ia tidak
 * terlihat oleh `tsc` maupun oleh uji yang memalsukan `@/lib/prisma`. TS 6.0.2
 * (yang dipin repo ini) tidak melaporkan properti berlebih pada posisi generik
 * bersarang seperti `StudentSelect`, jadi `select: { documents: … }` pada
 * `Student` lolos Build dan Build:strict lalu gagal di runtime — dan karena
 * `buildSubjectDataExport` berjalan di dalam `$transaction`, kegagalan itu
 * me-rollback seluruh penyelesaian permintaan `ACCESS`.
 *
 * Uji ini menutup kelasnya, bukan satu kemunculannya: setiap nama field di
 * dalam `select`/`include` dicocokkan dengan DMMF skema yang terpasang, lalu
 * turun ke relasi bersarangnya.
 */

interface DmmfField {
  name: string;
  kind: 'scalar' | 'object' | 'enum' | 'unsupported';
  type: string;
}
interface DmmfModel {
  name: string;
  fields: DmmfField[];
}

const datamodel = (Prisma as unknown as { dmmf: { datamodel: { models: DmmfModel[] } } }).dmmf
  .datamodel;

const modelsByName = new Map(datamodel.models.map((m) => [m.name, m]));

/**
 * Nama properti klien Prisma (`tx.studentDocument`) ke model DMMF
 * (`StudentDocument`). Tanpa pemetaan ini setiap pemanggilan akan dilewati
 * diam-diam dan penjaga hijau karena tidak memeriksa apa pun.
 */
const modelsByClientKey = new Map(
  datamodel.models.map((m) => [m.name[0].toLowerCase() + m.name.slice(1), m])
);

function clientModel(key: string): DmmfModel | undefined {
  return modelsByClientKey.get(key);
}

function modelOf(name: string): DmmfModel {
  const model = modelsByName.get(name);
  if (!model) throw new Error(`model ${name} tidak ada di skema`);
  return model;
}

function fieldOf(model: DmmfModel, field: string): DmmfField | undefined {
  return model.fields.find((f) => f.name === field);
}

interface CallSite {
  model: string;
  method: string;
  args: string;
}

function callSites(source: string): CallSite[] {
  const sites: CallSite[] = [];
  const pattern =
    /\b(?:tx|prisma)\.([a-zA-Z]\w*)\.(findUnique|findFirst|findMany|count|update|updateMany|delete|deleteMany|create|upsert|aggregate|groupBy)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source))) {
    const open = source.indexOf('(', m.index + m[0].length - 1);
    const args = sliceBalanced(source, open);
    if (args !== null) sites.push({ model: m[1], method: m[2], args });
  }
  return sites;
}

/** Teks di dalam pasangan kurung/kurawal yang seimbang, mulai dari `open`. */
function sliceBalanced(s: string, open: number): string | null {
  const openCh = s[open];
  const closeCh = openCh === '{' ? '}' : ')';
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(s, i) - 1;
      continue;
    }
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return s.slice(open + 1, i);
    }
  }
  return null;
}

function skipString(s: string, start: number): number {
  const quote = s[start];
  let i = start + 1;
  while (i < s.length) {
    if (s[i] === '\\') {
      i += 2;
      continue;
    }
    if (s[i] === quote) return i + 1;
    i += 1;
  }
  return s.length;
}

/**
 * Blok `select`/`include` pada **kedalaman nol** teks yang diberikan. Blok
 * bersarang tidak diambil di sini — ia ditelusuri lewat relasinya sendiri,
 * sehingga tidak pernah dicocokkan dengan model yang salah.
 */
function selectBlocks(rawText: string): { key: string; body: string }[] {
  // Argumen sebuah pemanggilan berbentuk `{ … }`; kurung luarnya dibuang dulu
  // supaya `select` berada di kedalaman nol dan bukan di dalam objek argumen.
  const trimmed = rawText.trim();
  const text =
    trimmed.startsWith('{') && sliceBalanced(trimmed, 0) === trimmed.slice(1, -1)
      ? trimmed.slice(1, -1)
      : rawText;
  const out: { key: string; body: string }[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(text, i) - 1;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      depth -= 1;
      continue;
    }
    if (depth !== 0 || (i > 0 && /[\w$]/.test(text[i - 1]))) continue;
    const m = /^(select|include)\s*:\s*\{/.exec(text.slice(i));
    if (!m) continue;
    const open = text.indexOf('{', i + m[0].length - 1);
    const body = sliceBalanced(text, open);
    if (body !== null) {
      out.push({ key: m[1], body });
      i = open + body.length + 1;
    }
  }
  return out;
}

/** Kunci tingkat atas sebuah objek literal (bukan kunci bersarang). */
function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(body, i) - 1;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    else if (depth === 0 && (i === 0 || /[,\s{]/.test(body[i - 1]))) {
      const km = /^([a-zA-Z_]\w*)\s*:/.exec(body.slice(i));
      if (km) {
        keys.push(km[1]);
        i += km[0].length - 1;
      }
    }
  }
  return keys;
}

/** Nilai objek milik sebuah kunci tingkat atas, bila ada. */
function topLevelValue(body: string, key: string): string | null {
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(body, i) - 1;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    else if (depth === 0 && (i === 0 || /[,\s{]/.test(body[i - 1]))) {
      const km = new RegExp(`^${key}\\s*:\\s*\\{`).exec(body.slice(i));
      if (km) {
        const open = body.indexOf('{', i + km[0].length - 1);
        return sliceBalanced(body, open);
      }
      const other = /^([a-zA-Z_]\w*)\s*:/.exec(body.slice(i));
      if (other) i += other[0].length - 1;
    }
  }
  return null;
}

function problemsIn(body: string, model: DmmfModel, where: string): string[] {
  const problems: string[] = [];
  for (const key of topLevelKeys(body)) {
    if (key.startsWith('_')) continue; // agregat `_count`/`_sum`, bukan field
    const field = fieldOf(model, key);
    if (!field) {
      problems.push(
        `${where}: \`${key}\` bukan field ${model.name} (mirip: ${closest(model, key)})`
      );
      continue;
    }
    // Relasi yang dipilih lebih dalam: `studentDocuments: { select: … }`.
    if (field.kind === 'object') {
      const inner = topLevelValue(body, key);
      const target = modelsByName.get(field.type);
      if (inner === null || !target) continue;
      for (const block of selectBlocks(inner)) {
        problems.push(...problemsIn(block.body, target, `${where} → ${target.name} ${block.key}`));
      }
    }
  }
  return problems;
}

function closest(model: DmmfModel, key: string): string {
  return model.fields
    .map((f) => ({ name: f.name, score: similarity(f.name, key) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.name)
    .join(', ');
}

function similarity(a: string, b: string): number {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  const setA = new Set(a.toLowerCase());
  const shared = [...new Set(b.toLowerCase())].filter((ch) => setA.has(ch)).length;
  return prefix * 10 + shared;
}

/**
 * Buang komentar sebelum mem-parse. Teks prosa di dalam `select` (misalnya
 * "// Nomor identitas: …") berbentuk `kata:` dan akan terbaca sebagai field
 * palsu, sehingga penjaga melaporkan cacat yang tidak ada.
 */
function stripComments(source: string): string {
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = skipString(source, i);
      out += source.slice(i, end);
      i = end - 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end - 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}

const serviceSource = stripComments(
  readFileSync(resolve(__dirname, '..', 'data-subject-requests.service.ts'), 'utf8')
);

describe('penjaga nama kolom select/include modul data-subject-requests', () => {
  it('setiap field di dalam select/include ada pada model yang bersangkutan', () => {
    const problems: string[] = [];

    const resolved: string[] = [];
    for (const site of callSites(serviceSource)) {
      const model = clientModel(site.model);
      if (!model) continue; // `$transaction` dan sejenisnya bukan model
      resolved.push(model.name);

      for (const block of selectBlocks(site.args)) {
        problems.push(
          ...problemsIn(block.body, model, `${model.name}.${site.method} ${block.key}`)
        );
      }
    }

    expect(problems).toEqual([]);
    // Penjaga harus benar-benar memeriksa kueri, bukan melewatinya semua.
    expect(resolved.length).toBeGreaterThan(20);
    expect(new Set(resolved)).toContain('Student');
    expect(new Set(resolved)).toContain('Registrant');
  });

  it('penjaga menemukan field yang tidak ada (bukan hijau karena tidak membaca apa pun)', () => {
    // Tanpa uji ini, regex yang berhenti cocok akan membuat penjaga hijau.
    expect(callSites(serviceSource).length).toBeGreaterThan(20);

    const student = modelOf('Student');
    // `body` adalah isi objek select, tanpa kurung kurawal luarnya.
    expect(problemsIn(' documents: { select: { type: true } } ', student, 'sintetis')).toEqual([
      expect.stringContaining('`documents` bukan field Student'),
    ]);
    expect(problemsIn(' studentDocuments: true, nik: true ', student, 'sintetis')).toEqual([]);
  });

  it('menemukan field salah pada relasi bersarang', () => {
    const student = modelOf('Student');
    const problems = problemsIn(
      ' studentDocuments: { where: { deletedAt: null }, select: { type: true, title: true } } ',
      student,
      'Student'
    );
    // `type` milik `RegistrantDocument`; `StudentDocument` memakai `documentType`.
    expect(problems).toEqual([
      expect.stringContaining(
        'Student → StudentDocument select: `type` bukan field StudentDocument'
      ),
    ]);
  });
});
