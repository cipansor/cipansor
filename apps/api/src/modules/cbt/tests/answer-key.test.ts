import { describe, it, expect } from 'vitest';
import {
  canonicalAnswer,
  isAnswerCorrect,
  normalizeAnswerKeyForStorage,
  optionIdentifiers,
} from '../answer-key';

/**
 * The contract these tests pin is the one the old grader lacked. It compared
 * `JSON.stringify(answerKey) === JSON.stringify(studentAnswer)` against a client
 * that always submits strings, so a true/false question whose key was stored as
 * the JSON boolean `true` was wrong for every student — silently, and (since CBT
 * results sync to the gradebook) on their academic record.
 */
describe('kontrak kunci jawaban', () => {
  describe('benar-salah: kunci boolean dan jawaban string adalah hal yang sama', () => {
    it.each([
      ['boolean true vs string "true"', true, 'true'],
      ['boolean false vs string "false"', false, 'false'],
      ['string "true" vs string "true"', 'true', 'true'],
      ['label Indonesia: "Benar" vs "true"', 'Benar', 'true'],
      ['angka 1 vs "true"', 1, 'true'],
      ['angka 0 vs "false"', 0, 'false'],
      ['spasi dan huruf besar: " TRUE " vs "true"', ' TRUE ', 'true'],
    ])('%s → benar', (_label, key, given) => {
      expect(isAnswerCorrect('TRUE_FALSE', key, given)).toBe(true);
    });

    it.each([
      ['boolean true vs "false"', true, 'false'],
      ['boolean false vs "true"', false, 'true'],
      ['kunci ada, jawaban kosong', true, null],
      ['jawaban tak terbaca', true, 'mungkin'],
    ])('%s → salah', (_label, key, given) => {
      expect(isAnswerCorrect('TRUE_FALSE', key, given)).toBe(false);
    });
  });

  describe('pilihan ganda: id opsi, dibungkus objek atau tidak', () => {
    it('id polos cocok dengan id polos', () => {
      expect(isAnswerCorrect('MULTIPLE_CHOICE', 'opt-A', 'opt-A')).toBe(true);
    });

    it('kunci terbungkus { id } cocok dengan jawaban id polos', () => {
      // Divergensi yang dulu: analisis distraktor membuka bungkus ini,
      // penilainya tidak, jadi keduanya bisa berselisih soal opsi mana yang
      // dipilih siswa.
      expect(isAnswerCorrect('MULTIPLE_CHOICE', { id: 'opt-A' }, 'opt-A')).toBe(true);
      expect(isAnswerCorrect('MULTIPLE_CHOICE', 'opt-A', { optionId: 'opt-A' })).toBe(true);
    });

    it('opsi lain tetap salah', () => {
      expect(isAnswerCorrect('MULTIPLE_CHOICE', 'opt-A', 'opt-B')).toBe(false);
    });

    it('kunci yang tidak terbaca tidak pernah membuat jawaban benar', () => {
      expect(isAnswerCorrect('MULTIPLE_CHOICE', null, null)).toBe(false);
      expect(isAnswerCorrect('MULTIPLE_CHOICE', {}, {})).toBe(false);
      expect(isAnswerCorrect('MULTIPLE_CHOICE', '', '')).toBe(false);
    });
  });

  it('esai tidak pernah dinilai mesin', () => {
    expect(canonicalAnswer('ESSAY', 'apa pun')).toBeNull();
    expect(isAnswerCorrect('ESSAY', 'apa pun', 'apa pun')).toBe(false);
  });

  describe('validasi saat simpan menolak kunci yang mustahil cocok', () => {
    it('menormalkan kunci benar-salah ke bentuk kanonik', () => {
      expect(normalizeAnswerKeyForStorage('TRUE_FALSE', true, null)).toBe('true');
      expect(normalizeAnswerKeyForStorage('TRUE_FALSE', 'Salah', null)).toBe('false');
    });

    it('menolak kunci benar-salah yang bukan benar/salah', () => {
      expect(() => normalizeAnswerKeyForStorage('TRUE_FALSE', 'kadang', null)).toThrowError(
        /benar atau salah/i
      );
    });

    it('menolak kunci pilihan ganda yang tidak ada di antara opsinya', () => {
      const options = [{ id: 'opt-A' }, { id: 'opt-B' }];
      expect(() => normalizeAnswerKeyForStorage('MULTIPLE_CHOICE', 'opt-Z', options)).toThrowError(
        /tidak ada di antara opsi/i
      );
    });

    it('menerima kunci pilihan ganda yang ada di antara opsinya', () => {
      const options = [{ id: 'opt-A' }, { id: 'opt-B' }];
      expect(normalizeAnswerKeyForStorage('MULTIPLE_CHOICE', { id: 'opt-B' }, options)).toBe(
        'opt-B'
      );
    });

    it('menolak dua opsi dengan id yang sama', () => {
      const options = [{ id: 'A' }, { id: 'B' }, { id: 'D' }, { id: 'D' }];
      expect(() => normalizeAnswerKeyForStorage('MULTIPLE_CHOICE', 'D', options)).toThrowError(
        /lebih dari sekali/i
      );
      // A draft without a key is still refused: the row would be ungradeable.
      expect(() => normalizeAnswerKeyForStorage('MULTIPLE_CHOICE', null, options)).toThrowError(
        /lebih dari sekali/i
      );
    });

    it('soal boleh disimpan sebagai draf tanpa kunci', () => {
      expect(normalizeAnswerKeyForStorage('MULTIPLE_CHOICE', null, [])).toBeNull();
      expect(normalizeAnswerKeyForStorage('ESSAY', 'apa pun', null)).toBeNull();
    });

    it('opsi berupa string polos juga punya identitas', () => {
      expect(optionIdentifiers(['A', 'B'])).toEqual(['A', 'B']);
      expect(optionIdentifiers([{ id: 'opt-A', text: 'Jakarta' }])).toEqual(['opt-A']);
      expect(optionIdentifiers(null)).toEqual([]);
    });
  });
});
