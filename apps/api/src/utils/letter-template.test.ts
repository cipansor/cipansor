import { describe, it, expect } from 'vitest';
import {
  LETTERHEAD,
  LetterNature,
  LetterType,
  letterTemplateFor,
  natureMarking,
  remainingPlaceholders,
  renderTemplateDraft,
} from '@cipansor/shared';

describe('konsep awal surat', () => {
  it('setiap jenis naskah punya kerangka', () => {
    for (const type of Object.values(LetterType)) {
      const t = letterTemplateFor(type);
      expect(t, type).toBeTruthy();
      // Isi selalu ada; judul boleh kosong (surat dinas biasa tidak berjudul).
      expect(t.body.length, `${type} tidak punya isi awal`).toBeGreaterThan(0);
    }
  });

  it('mengikuti bentuk surat asli untuk Surat Keterangan', () => {
    const t = letterTemplateFor(LetterType.SURAT_KETERANGAN);
    expect(t.title).toBe('SURAT KETERANGAN');
    expect(t.opening).toBe('Yang bertanda tangan di bawah ini:');
    expect(t.transition).toBe('Dengan ini menerangkan dengan sebenarnya bahwa:');
    expect(t.closing).toMatch(/Demikian surat keterangan ini dibuat/);
  });

  it('kop surat memakai data resmi yayasan', () => {
    expect(LETTERHEAD.organisation).toBe('YAYASAN PESANTREN CIPANSOR');
    expect(LETTERHEAD.website).toBe('www.cipansor.or.id');
    expect(LETTERHEAD.legalBasis).toMatch(/AKTA NOTARIS NO\. 01/);
  });

  // Stamping "BIASA" on an ordinary letter dilutes the stamp on one that is
  // genuinely restricted, which is the whole point of the marking.
  it('hanya menandai naskah yang memang dibatasi', () => {
    expect(natureMarking(LetterNature.PUBLIC)).toBeNull();
    expect(natureMarking(LetterNature.LIMITED)).toBe('TERBATAS');
    expect(natureMarking(LetterNature.CONFIDENTIAL)).toBe('RAHASIA');
    expect(natureMarking(LetterNature.STRICTLY_CONFIDENTIAL)).toBe('SANGAT RAHASIA');
  });

  /**
   * Penandaan sifat dicetak oleh naskahnya sendiri dari kolom `nature`, bukan
   * disisipkan ke dalam konsep isi. Konsep yang ikut membawanya membuat surat
   * Rahasia tercetak dengan tulisan "RAHASIA" dua kali — sekali di pojok kanan
   * atas dan sekali di badan surat — dan penanda di badan surat itu hilang
   * begitu penyusun menyunting isinya.
   */
  it('tidak menyisipkan penandaan sifat ke dalam konsep isi', () => {
    for (const nature of [
      LetterNature.PUBLIC,
      LetterNature.LIMITED,
      LetterNature.CONFIDENTIAL,
      LetterNature.STRICTLY_CONFIDENTIAL,
    ]) {
      const draft = renderTemplateDraft(LetterType.SURAT_KETERANGAN, nature);
      expect(draft).not.toMatch(/TERBATAS|RAHASIA|SANGAT RAHASIA/);
    }
  });

  /**
   * Susunan keputusan bukan selera tata letak: diktum adalah kesimpulan dari
   * konsideran, jadi MEMUTUSKAN harus berada SESUDAH Menimbang dan Mengingat
   * dan SEBELUM Menetapkan. Kerangka lama mencetaknya sebagai kalimat
   * peralihan, yaitu paling atas — keputusan yang memutuskan lebih dulu baru
   * menimbang.
   */
  it('surat keputusan menyusun konsideran sebelum diktum', () => {
    const draft = renderTemplateDraft(LetterType.SURAT_KEPUTUSAN, LetterNature.PUBLIC);
    const at = (re: RegExp) => draft.search(re);

    expect(at(/Menimbang/)).toBeGreaterThanOrEqual(0);
    expect(at(/Menimbang/)).toBeLessThan(at(/Mengingat/));
    expect(at(/Mengingat/)).toBeLessThan(at(/MEMUTUSKAN/));
    expect(at(/MEMUTUSKAN/)).toBeLessThan(at(/Menetapkan/));
    expect(at(/Menetapkan/)).toBeLessThan(at(/KESATU/));

    // Ia pernah tercetak dua kali: sekali dari `transition`, sekali lagi dari
    // badan naskahnya sendiri.
    expect(draft.match(/MEMUTUSKAN/g)).toHaveLength(1);
    // Dasar hukum yayasan yang selalu berlaku, agar tidak terlupa.
    expect(draft).toMatch(/Undang-Undang Nomor 16 Tahun 2001/);
  });

  /**
   * MEMUTUSKAN harus menjadi alinea tersendiri, karena naskahlah yang
   * mencetaknya di tengah dan ia mengenalinya dari alinea yang isinya persis
   * kata itu. Menempelkannya ke baris lain membuatnya kembali rata kiri.
   */
  it('menempatkan MEMUTUSKAN sebagai alinea tersendiri', () => {
    const draft = renderTemplateDraft(LetterType.SURAT_KEPUTUSAN, LetterNature.PUBLIC);
    const paragraphs = draft.split(/\n\s*\n/).map((p) => p.trim());
    expect(paragraphs).toContain('MEMUTUSKAN:');
  });

  /**
   * Keputusan tidak memuat blok "Yang bertanda tangan di bawah ini" dengan
   * Nama/Jabatan/Alamat: pejabat yang menetapkan sudah disebut pada kepala dan
   * kaki naskah. Kerangka lama meminjam kerangka surat keterangan.
   */
  it('surat keputusan tidak memakai blok penanda tangan surat keterangan', () => {
    const t = letterTemplateFor(LetterType.SURAT_KEPUTUSAN);
    expect(t.signerFields).toHaveLength(0);
    expect(t.decree).toBe(true);
    expect(t.addressed).toBe(false);
    expect(t.title).toMatch(/^SURAT KEPUTUSAN KETUA YAYASAN/);

    const draft = renderTemplateDraft(LetterType.SURAT_KEPUTUSAN, LetterNature.PUBLIC);
    expect(draft).not.toMatch(/Yang bertanda tangan di bawah ini/);
  });

  /**
   * Judul di tengah dan alamat tujuan adalah dua hal berbeda. Nota dinas,
   * undangan dan edaran punya keduanya; naskah pernah menyimpulkan yang kedua
   * dari yang pertama, sehingga ketiganya tercetak tanpa tujuan sama sekali.
   */
  it('menandai naskah mana yang ditujukan kepada seseorang', () => {
    const addressed = [
      LetterType.SURAT_DINAS,
      LetterType.NOTA_DINAS,
      LetterType.SURAT_UNDANGAN,
      LetterType.SURAT_EDARAN,
    ];
    const declaratory = [
      LetterType.SURAT_KETERANGAN,
      LetterType.SURAT_TUGAS,
      LetterType.SURAT_KEPUTUSAN,
      LetterType.BERITA_ACARA,
      LetterType.PENGUMUMAN,
    ];

    for (const type of addressed) {
      expect(letterTemplateFor(type).addressed, type).toBe(true);
    }
    for (const type of declaratory) {
      expect(letterTemplateFor(type).addressed, type).toBe(false);
    }

    // Undangan berjudul di tengah DAN ditujukan kepada seseorang — pasangan
    // yang dulu mustahil karena keduanya diturunkan dari satu tanda.
    const undangan = letterTemplateFor(LetterType.SURAT_UNDANGAN);
    expect(undangan.title.length).toBeGreaterThan(0);
    expect(undangan.addressed).toBe(true);
  });

  it('surat tugas meminta uraian tugas, waktu, dan tempat', () => {
    const draft = renderTemplateDraft(LetterType.SURAT_TUGAS, LetterNature.PUBLIC);
    expect(draft).toMatch(/URAIAN TUGAS/);
    expect(draft).toMatch(/TEMPAT/);
  });

  // The drafter must be able to see what is still unfilled before submitting;
  // a letter that goes up the ladder with "[NAMA]" in it wastes everyone's
  // turn and comes straight back down as a revision.
  it('melaporkan placeholder yang belum diisi', () => {
    const draft = renderTemplateDraft(LetterType.SURAT_KETERANGAN, LetterNature.PUBLIC);
    const left = remainingPlaceholders(draft);
    expect(left.length).toBeGreaterThan(0);

    const filled = 'Sudah lengkap tanpa isian tersisa.';
    expect(remainingPlaceholders(filled)).toEqual([]);
  });

  /**
   * Sebagian petunjuk placeholder ditulis sebagai kalimat berhuruf kecil
   * ("[URAIAN KETERANGAN, mis. ...]"). Pencari lama hanya menerima huruf
   * kapital, sehingga konsep yang masih memuat petunjuk itu dilaporkan
   * lengkap dan naik ke atasan dengan kurung siku yang belum diisi.
   */
  it('melaporkan setiap placeholder bersiku di konsep setiap jenis surat', () => {
    for (const type of Object.values(LetterType)) {
      for (const nature of Object.values(LetterNature)) {
        const draft = renderTemplateDraft(type, nature);
        const reported = remainingPlaceholders(draft);
        // The oracle does not reuse the pattern under test: take every
        // reported placeholder out of the draft, and no bracket may be left.
        const rest = reported.reduce((text, p) => text.split(p).join(''), draft);
        expect(rest, `${type} / ${nature}`).not.toMatch(/[[\]]/);
        for (const p of reported) expect(draft).toContain(p);
      }
    }
  });

  it('mengenali petunjuk berupa prosa, termasuk elipsis dan tanda kurung', () => {
    expect(remainingPlaceholders('Mohon isi [URAIAN KETERANGAN, mis. peran …].')).toEqual([
      '[URAIAN KETERANGAN, mis. peran …]',
    ]);
    expect(
      remainingPlaceholders(
        'Hadir pada [HARI, TANGGAL] membawa [KETERANGAN TAMBAHAN, mis. agenda ringkas (bila ada) ...].'
      )
    ).toEqual(['[HARI, TANGGAL]', '[KETERANGAN TAMBAHAN, mis. agenda ringkas (bila ada) ...]']);
    // A placeholder left twice is one thing to fill.
    expect(remainingPlaceholders('[NAMA] dan [NAMA]')).toEqual(['[NAMA]']);
    // A letter with nothing left to fill reports nothing.
    expect(remainingPlaceholders('Surat lengkap, tanpa petunjuk tersisa.')).toEqual([]);
  });

  it('tetap linier pada deretan kurung siku pembuka (CodeQL js/polynomial-redos)', () => {
    // A body that admits `[` backtracks quadratically here: seconds, not
    // milliseconds, on 50k characters.
    const started = performance.now();
    expect(remainingPlaceholders('['.repeat(50_000) + 'x')).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('konsep tidak menyisakan baris kosong di awal/akhir', () => {
    for (const type of Object.values(LetterType)) {
      const draft = renderTemplateDraft(type, LetterNature.PUBLIC);
      expect(draft, type).toBe(draft.trim());
    }
  });
});
