import { describe, it, expect, vi } from 'vitest';
import { parseAndVerifyDocument } from '../document-ocr.service';

// A real 1x1 PNG binary buffer (magic bytes 0x89 0x50 0x4E 0x47 ...). Its
// content is irrelevant to these tests: the OCR engine is injected, so the
// comparison logic is exercised without a WASM run.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const PNG_URI = `data:image/png;base64,${PNG.toString('base64')}`;
const PDF_URI = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n%âãÏÓ\n').toString('base64')}`;

const KTP_TEXT = `PROVINSI JAWA BARAT
KABUPATEN CIAMIS
NIK            : 3201230110230001
Nama           : AHMAD FAUZI
Tempat/Tgl Lahir : CIAMIS, 01-10-2023
Jenis Kelamin  : LAKI-LAKI
CATATAN RAHASIA SENTINEL`;

const KK_TEXT = `KARTU KELUARGA
No. KK : 3201234567890001
Nama Kepala Keluarga : BUDI SANTOSO
Alamat : KP SUKAMAJU RT 02 RW 05
No   Nama            NIK                Jenis Kelamin   Tempat Lahir   Tgl Lahir
1    BUDI SANTOSO    3201230101800001   LAKI-LAKI       CIAMIS         01-01-1980
2    SITI AMINAH     3201234102820001   PEREMPUAN       BANDUNG        02-02-1982
3    AHMAD FAUZI     3201230110230001   LAKI-LAKI       CIAMIS         01-10-2023
CATATAN RAHASIA SENTINEL`;

const AKTA_TEXT = `KUTIPAN AKTA KELAHIRAN
Nama : AHMAD FAUZI
Tempat Lahir : CIAMIS
Tanggal Lahir : 01-10-2023
Jenis Kelamin : LAKI-LAKI
Nama Ayah : BUDI SANTOSO
Nama Ibu : SITI AMINAH
CATATAN RAHASIA SENTINEL`;

const readerFor = (text: string) => vi.fn(async () => text);

describe('Document Verification Service', () => {
  describe('OCR off (default) — honest manual-verification contract', () => {
    it('flags a real binary PNG for manual verification without extracting text', async () => {
      const result = await parseAndVerifyDocument({
        imageBase64: PNG_URI,
        documentType: 'ktp',
        userInputData: { fullName: 'Budi Santoso', nationalId: '3201234567890001' },
      });

      expect(result.success).toBe(true);
      expect(result.validation.status).toBe('WARNING');
      expect(result.extractedData.nationalId).toBeUndefined();
      expect(result.validation.notes.some((n) => n.includes('verifikasi manual'))).toBe(true);
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('does not call the OCR reader when the gate is off', async () => {
      const readText = readerFor(KTP_TEXT);
      await parseAndVerifyDocument(
        { imageBase64: PNG_URI, documentType: 'ktp' },
        { enabled: false, readText }
      );
      expect(readText).not.toHaveBeenCalled();
    });
  });

  describe('OCR on — field extraction and comparison', () => {
    it('matches a KTP against the applicant input and never returns a pass', async () => {
      const result = await parseAndVerifyDocument(
        {
          imageBase64: PNG_URI,
          documentType: 'ktp',
          userInputData: {
            fullName: 'Ahmad Fauzi',
            nationalId: '3201230110230001',
            birthPlace: 'Ciamis',
            birthDate: '2023-10-01',
          },
        },
        { enabled: true, readText: readerFor(KTP_TEXT) }
      );

      expect(result.validation.status).toBe('WARNING');
      expect(result.validation.nationalIdMatch).toBe(true);
      expect(result.validation.fullNameMatch).toBe(true);
      expect(result.validation.birthPlaceMatch).toBe(true);
      // The form sends YYYY-MM-DD, the document says DD-MM-YYYY.
      expect(result.validation.birthDateMatch).toBe(true);
      expect(result.validation.matchScore).toBe(100);
      expect(result.extractedData.nationalId).toBe('3201230110230001');
      expect(result.extractedData.fullName).toBe('AHMAD FAUZI');
    });

    it('reports a MISMATCH when the NIK on the document differs', async () => {
      const result = await parseAndVerifyDocument(
        {
          imageBase64: PNG_URI,
          documentType: 'ktp',
          userInputData: { nationalId: '3201230110239999' },
        },
        { enabled: true, readText: readerFor(KTP_TEXT) }
      );

      expect(result.validation.status).toBe('MISMATCH');
      expect(result.validation.nationalIdMatch).toBe(false);
      expect(result.validation.notes.some((n) => n.includes('NIK pada dokumen'))).toBe(true);
    });

    it('reads the child row of a KK (KK number, child NIK, name, place, date)', async () => {
      const result = await parseAndVerifyDocument(
        {
          imageBase64: PNG_URI,
          documentType: 'kk',
          userInputData: {
            fullName: 'Ahmad Fauzi',
            nationalId: '3201230110230001',
            familyCardNumber: '3201234567890001',
            birthPlace: 'Ciamis',
            birthDate: '2023-10-01',
          },
        },
        { enabled: true, readText: readerFor(KK_TEXT) }
      );

      expect(result.validation.status).toBe('WARNING');
      expect(result.validation.familyCardMatch).toBe(true);
      expect(result.validation.nationalIdMatch).toBe(true);
      expect(result.validation.fullNameMatch).toBe(true);
      expect(result.validation.birthPlaceMatch).toBe(true);
      expect(result.validation.birthDateMatch).toBe(true);
      expect(result.extractedData.familyCardNumber).toBe('3201234567890001');
      expect(result.extractedData.nationalId).toBe('3201230110230001');
    });

    it('reads an akta (name, place, date) and flags a wrong name', async () => {
      const result = await parseAndVerifyDocument(
        {
          imageBase64: PNG_URI,
          documentType: 'akta',
          userInputData: {
            fullName: 'Budi Santoso',
            birthPlace: 'Ciamis',
            birthDate: '2023-10-01',
          },
        },
        { enabled: true, readText: readerFor(AKTA_TEXT) }
      );

      expect(result.validation.status).toBe('MISMATCH');
      expect(result.validation.fullNameMatch).toBe(false);
      expect(result.validation.birthPlaceMatch).toBe(true);
      expect(result.validation.birthDateMatch).toBe(true);
      expect(result.validation.notes.some((n) => n.includes('Nama pada dokumen'))).toBe(true);
    });

    it('never stores the raw OCR text in the result', async () => {
      const result = await parseAndVerifyDocument(
        { imageBase64: PNG_URI, documentType: 'ktp' },
        { enabled: true, readText: readerFor(KTP_TEXT) }
      );

      expect(JSON.stringify(result)).not.toContain('CATATAN RAHASIA SENTINEL');
      expect(result.validation.status).toBe('WARNING');
    });

    it('falls back to manual verification when the engine throws', async () => {
      const result = await parseAndVerifyDocument(
        { imageBase64: PNG_URI, documentType: 'ktp' },
        {
          enabled: true,
          readText: async () => {
            throw new Error('worker crashed');
          },
        }
      );

      expect(result.validation.status).toBe('WARNING');
      expect(result.validation.notes.some((n) => n.includes('gagal'))).toBe(true);
    });
  });

  describe('documents the engine does not read', () => {
    it('leaves a PDF to manual verification even when OCR is on', async () => {
      const readText = readerFor(KTP_TEXT);
      const result = await parseAndVerifyDocument(
        { imageBase64: PDF_URI, documentType: 'ktp' },
        { enabled: true, readText }
      );

      expect(readText).not.toHaveBeenCalled();
      expect(result.validation.status).toBe('WARNING');
      expect(result.validation.notes.some((n) => n.includes('PDF'))).toBe(true);
    });

    it('does not read a photo (foto) — it carries no identity fields', async () => {
      const readText = readerFor(KTP_TEXT);
      await parseAndVerifyDocument(
        { imageBase64: PNG_URI, documentType: 'foto' },
        { enabled: true, readText }
      );
      expect(readText).not.toHaveBeenCalled();
    });
  });
});
