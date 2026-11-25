import { describe, it, expect, vi } from 'vitest';
import { parseAndVerifyDocument, tesseractReadText } from '../document-ocr.service';

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

    it('leaves the birth place unread when the KK date is unreadable', async () => {
      // The child's date is garbled; without a locatable date the place must not
      // swallow the broken date and the next column (a false place mismatch).
      const garbled = KK_TEXT.replace('CIAMIS         01-10-2023', 'CIAMIS         O1-IO-2O23');
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
        { enabled: true, readText: readerFor(garbled) }
      );

      expect(result.extractedData.birthPlace).toBeUndefined();
      expect(result.validation.birthPlaceMatch).toBeUndefined();
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

    it('compares a KTP against the parent whose name it carries', async () => {
      const result = await parseAndVerifyDocument(
        {
          imageBase64: PNG_URI,
          documentType: 'ktp',
          userInputData: {
            fullName: 'Budi Santoso',
            fullNameCandidates: ['Budi Santoso', 'Siti Aminah'],
          },
        },
        { enabled: true, readText: readerFor(KTP_TEXT.replace('AHMAD FAUZI', 'SITI AMINAH')) }
      );

      expect(result.validation.fullNameMatch).toBe(true);
      expect(result.validation.notes.some((n) => n.includes('Nama pada dokumen'))).toBe(false);
    });

    it('does not borrow a member NIK when the KK head is unreadable', async () => {
      const noHead = KK_TEXT.replace('No. KK : 3201234567890001\n', '');
      const result = await parseAndVerifyDocument(
        { imageBase64: PNG_URI, documentType: 'kk', userInputData: { fullName: 'Ahmad Fauzi' } },
        { enabled: true, readText: readerFor(noHead) }
      );

      expect(result.extractedData.familyCardNumber).toBeUndefined();
    });

    it('matches the full name, not the first token, when two members share it', async () => {
      const twoAhmads = `KARTU KELUARGA
No. KK : 3201234567890001
1    AHMAD HIDAYAT   3201230101800002   LAKI-LAKI   CIAMIS   01-01-1980
2    AHMAD FAUZI     3201230110230001   LAKI-LAKI   CIAMIS   01-10-2023`;
      const result = await parseAndVerifyDocument(
        { imageBase64: PNG_URI, documentType: 'kk', userInputData: { fullName: 'Ahmad Fauzi' } },
        { enabled: true, readText: readerFor(twoAhmads) }
      );

      expect(result.extractedData.nationalId).toBe('3201230110230001');
      expect(result.extractedData.fullName).toBe('AHMAD FAUZI');
    });

    it('reads the child row when a column follows the birth date', async () => {
      const withReligion = `KARTU KELUARGA
No. KK : 3201234567890001
3    AHMAD FAUZI     3201230110230001   LAKI-LAKI   CIAMIS   01-10-2023   ISLAM`;
      const result = await parseAndVerifyDocument(
        {
          imageBase64: PNG_URI,
          documentType: 'kk',
          userInputData: { fullName: 'Ahmad Fauzi', birthDate: '2023-10-02' },
        },
        { enabled: true, readText: readerFor(withReligion) }
      );

      expect(result.extractedData.nationalId).toBe('3201230110230001');
      expect(result.extractedData.birthDate).toBe('01-10-2023');
      expect(result.validation.birthDateMatch).toBe(false);
    });

    it('normalises a NIK that OCR grouped with spaces', async () => {
      const grouped = `KARTU KELUARGA
No. KK : 3201234567890001
3    AHMAD FAUZI     3201 2301 1023 0001   LAKI-LAKI   CIAMIS   01-10-2023`;
      const result = await parseAndVerifyDocument(
        {
          imageBase64: PNG_URI,
          documentType: 'kk',
          userInputData: {
            fullName: 'Ahmad Fauzi',
            nationalId: '3201230110230001',
          },
        },
        { enabled: true, readText: readerFor(grouped) }
      );

      expect(result.extractedData.nationalId).toBe('3201230110230001');
      expect(result.validation.nationalIdMatch).toBe(true);
    });

    it('keeps an abbreviated birth place whole (KAB. CIAMIS)', async () => {
      const akta = AKTA_TEXT.replace('Tempat Lahir : CIAMIS', 'Tempat Lahir : KAB. CIAMIS');
      const result = await parseAndVerifyDocument(
        {
          imageBase64: PNG_URI,
          documentType: 'akta',
          userInputData: { fullName: 'Ahmad Fauzi', birthPlace: 'KAB. CIAMIS' },
        },
        { enabled: true, readText: readerFor(akta) }
      );

      expect(result.extractedData.birthPlace).toBe('KAB CIAMIS');
      expect(result.validation.birthPlaceMatch).toBe(true);
    });

    it('survives a corrupt image with the real worker and keeps serving', async () => {
      const corrupt = Buffer.concat([PNG.subarray(0, 8), Buffer.from('not an image')]);
      const corruptUri = `data:image/png;base64,${corrupt.toString('base64')}`;
      const first = await parseAndVerifyDocument(
        { imageBase64: corruptUri, documentType: 'ktp' },
        { enabled: true }
      );
      expect(first.validation.status).toBe('WARNING');
      expect(first.validation.notes.some((n) => n.includes('gagal'))).toBe(true);

      // A valid image must reach the engine (not fall back to manual), which
      // only happens if the failed scan gave its slot back.
      const second = await parseAndVerifyDocument(
        { imageBase64: PNG_URI, documentType: 'ktp' },
        { enabled: true }
      );
      expect(second.validation.notes.some((n) => n.includes('dibaca mesin'))).toBe(true);
      expect(second.validation.notes.some((n) => n.includes('gagal'))).toBe(false);
    }, 30000);
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

  describe('OCR worker lifecycle', () => {
    it('releases the slot when the model fails to load', async () => {
      let calls = 0;
      const fakeWorker = {
        recognize: async () => ({ data: { text: 'ok' } }),
        terminate: async () => {},
      };
      const factory = (options: { errorHandler: (err: unknown) => void }) => {
        calls += 1;
        if (calls === 1) {
          // Tesseract reports a failed `loadLanguage` through the callback and
          // leaves `createWorker` pending; the slot must still come back.
          options.errorHandler(new Error('loadLanguage failed'));
          return new Promise<never>(() => {});
        }
        return Promise.resolve(fakeWorker);
      };

      await expect(tesseractReadText(PNG, factory)).rejects.toThrow();
      await expect(tesseractReadText(PNG, factory)).resolves.toBe('ok');
    });

    it('releases the slot when recognition hangs', async () => {
      vi.useFakeTimers();
      let calls = 0;
      const factory = () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            recognize: () => new Promise<never>(() => {}),
            terminate: async () => {},
          });
        }
        return Promise.resolve({
          recognize: async () => ({ data: { text: 'ok' } }),
          terminate: async () => {},
        });
      };

      const first = tesseractReadText(PNG, factory);
      const assertion = expect(first).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(30_000 + 1);
      await assertion;
      vi.useRealTimers();

      await expect(tesseractReadText(PNG, factory)).resolves.toBe('ok');
    });
  });
});
