#!/usr/bin/env python3
"""Uji regresi untuk `check_report.py` (gerbang laporan uji kerentanan).

Kenapa berkas ini ada: `check_report.py` adalah gerbang yang memutuskan apakah
laporan uji kerentanan boleh diserahkan ke pengurus/auditor/donor. Cacat yang ia
tutup — temuan kehilangan butir, skor CVSS tidak cocok dengan vektornya, tabel
Ringkasan melenceng dari Register, tiga edisi bahasa menilai temuan yang sama
secara berbeda — tidak terlihat dari kode keluar. Tiap jalur di sini punya uji.

Jalankan:
    python .claude/skills/uji-kerentanan-cipansor/scripts/test_check_report.py
"""
from __future__ import annotations

import importlib
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

cr = importlib.import_module("check_report")


REPORT = """# Laporan Uji Kerentanan

## Ringkasan Eksekutif

Sistem diuji.

# 1. Pendahuluan & Otorisasi
# 2. Lingkup & Metodologi

## 2.5 Batas yang memengaruhi hasil

Sampel 30 dari 300 rute; pemindai otomatis ZAP tidak dijalankan; lingkungan uji
lokal + data seed, berbeda dari produksi.

# 3. Arsitektur & Permukaan Serangan
# 4. Ringkasan Temuan

| ID | Peringkat | Kategori OWASP | Status |
|---|---|---|---|
| F-01 | Tinggi | A01 | Terbuka |

# 5. Register Temuan
# 6. Kontrol yang Terverifikasi Baik
# 7. Pemetaan OWASP Top 10
# 8. Peta Jalan Perbaikan
# 9. Rencana Uji Ulang
# 10. Penanganan Bukti
# Lampiran

## F-01 Judul

- Peringkat: Tinggi (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N = 7.5)
- Kategori: A01
- Sumber: Diuji langsung
- Status: Terbuka
- Rekomendasi: perbaiki
"""


class CvssTest(unittest.TestCase):
    def test_known_vector(self):
        # AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N = 7.5 (skor contoh CVSS v3.1)
        self.assertEqual(
            cr.cvss_base("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N"), 7.5
        )

    def test_zero_impact_is_zero(self):
        self.assertEqual(
            cr.cvss_base("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N"), 0.0
        )

    def test_scope_changed_raises(self):
        # S:C menaikkan skor; vektor ini lazim 9.8 bila CIA:H
        self.assertEqual(
            cr.cvss_base("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H"), 10.0
        )

    def test_missing_metric_is_none(self):
        self.assertIsNone(cr.cvss_base("CVSS:3.1/AV:N/AC:L"))

    def test_roundup_keeps_one_decimal(self):
        self.assertEqual(cr._roundup(0.0), 0.0)
        self.assertEqual(cr._roundup(1.0), 1.0)


class BandTest(unittest.TestCase):
    def test_bands(self):
        self.assertEqual(cr.rating_band(0.0), "none")
        self.assertEqual(cr.rating_band(3.9), "low")
        self.assertEqual(cr.rating_band(4.0), "medium")
        self.assertEqual(cr.rating_band(6.9), "medium")
        self.assertEqual(cr.rating_band(7.0), "high")
        self.assertEqual(cr.rating_band(9.0), "critical")


class CanonicalTest(unittest.TestCase):
    def test_rank_across_languages(self):
        for text in ("Tinggi", "High", "عالٍ"):
            self.assertEqual(cr.canonical(text, cr.RANK_LEVELS), "high")

    def test_status_across_languages(self):
        for text in ("Terbuka", "Open", "مفتوح"):
            self.assertEqual(cr.canonical(text, cr.STATUS_LEVELS), "open")

    def test_negated_closed_status_is_open(self):
        # "Belum ditutup" = masih terbuka; kata "ditutup" saja menyesatkan.
        for text in ("Belum ditutup", "Tidak ditutup", "not fixed", "Not Fixed", "belum selesai"):
            self.assertEqual(cr.canonical_status(text), "open", text)

    def test_plain_closed_status_stays_closed(self):
        for text in ("Ditutup", "Fixed", "Selesai", "dimitigasi", "diterima"):
            self.assertEqual(cr.canonical_status(text), cr.canonical(text, cr.STATUS_LEVELS), text)


class ReadTest(unittest.TestCase):
    def test_complete_report_has_no_errors(self):
        res = cr.read(REPORT)
        self.assertEqual(res["errors"], [], res["errors"])
        self.assertIn("F-01", res["findings"])

    def test_missing_field_is_error(self):
        broken = REPORT.replace("- Rekomendasi: perbaiki\n", "")
        res = cr.read(broken)
        self.assertTrue(any("rekomendasi" in e for e in res["errors"]))

    def test_missing_section_is_error(self):
        broken = REPORT.replace("# 9. Rencana Uji Ulang\n", "")
        res = cr.read(broken)
        self.assertTrue(any("Uji Ulang" in e for e in res["errors"]))

    def test_wrong_score_is_error(self):
        broken = REPORT.replace("= 7.5)", "= 3.1)")
        res = cr.read(broken)
        self.assertTrue(any("≠ vektor" in e for e in res["errors"]), res["errors"])

    def test_score_without_vector_warns(self):
        broken = REPORT.replace(" (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N = 7.5)", "")
        res = cr.read(broken)
        self.assertTrue(any("tidak ada Vektor CVSS" in w for w in res["warnings"]))

    def test_rank_mismatch_is_error(self):
        # skor 7.5 = high, tapi ditulis Rendah
        broken = REPORT.replace("Peringkat: Tinggi", "Peringkat: Rendah")
        res = cr.read(broken)
        self.assertTrue(any("≠ pita skor" in e for e in res["errors"]), res["errors"])

    def test_missing_subsection_2_5_is_error(self):
        broken = REPORT.replace(
            "## 2.5 Batas yang memengaruhi hasil\n\n"
            "Sampel 30 dari 300 rute; pemindai otomatis ZAP tidak dijalankan; lingkungan uji\n"
            "lokal + data seed, berbeda dari produksi.\n\n",
            "",
        )
        res = cr.read(broken)
        self.assertTrue(any("2.5" in e for e in res["errors"]), res["errors"])

    def test_empty_subsection_2_5_is_error_when_final(self):
        broken = REPORT.replace(
            "Sampel 30 dari 300 rute; pemindai otomatis ZAP tidak dijalankan; lingkungan uji\n"
            "lokal + data seed, berbeda dari produksi.",
            "",
        )
        self.assertFalse(any("2.5" in e for e in cr.read(broken)["errors"]))
        self.assertTrue(any("2.5" in e for e in cr.read(broken, final=True)["errors"]))

    def test_duplicate_finding_id_is_error(self):
        dup = REPORT.replace(
            "## F-01 Judul\n\n- Peringkat: Tinggi",
            "## F-01 Judul lain\n\n- Peringkat: Tinggi"
            " (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N = 7.5)\n"
            "- Kategori: A01\n- Sumber: Diuji langsung\n- Status: Terbuka\n"
            "- Rekomendasi: x\n\n## F-01 Judul\n\n- Peringkat: Tinggi",
        )
        res = cr.read(dup)
        self.assertTrue(any("ganda" in e for e in res["errors"]), res["errors"])

    def test_summary_table_missing_row_is_error(self):
        broken = REPORT.replace("| F-01 | Tinggi | A01 | Terbuka |\n", "")
        res = cr.read(broken)
        self.assertTrue(any("tidak ada di tabel Bagian 4" in e for e in res["errors"]), res["errors"])

    def test_summary_table_extra_row_is_error(self):
        broken = REPORT.replace(
            "| F-01 | Tinggi | A01 | Terbuka |",
            "| F-01 | Tinggi | A01 | Terbuka |\n| F-02 | Rendah | A02 | Terbuka |",
        )
        res = cr.read(broken)
        self.assertTrue(
            any("tidak ada di Register" in e for e in res["errors"]), res["errors"]
        )

    def test_summary_table_rank_mismatch_is_error(self):
        broken = REPORT.replace("| F-01 | Tinggi |", "| F-01 | Rendah |")
        res = cr.read(broken)
        self.assertTrue(
            any("peringkat" in e and "Register" in e for e in res["errors"]), res["errors"]
        )

    def test_final_requires_written_score(self):
        no_score = REPORT.replace(
            " (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N = 7.5)",
            " (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N)",
        )
        # belum final: cukup WARN; final: ERROR
        self.assertFalse(any("tanpa skor" in e for e in cr.read(no_score)["errors"]))
        self.assertTrue(any("tanpa skor" in e for e in cr.read(no_score, final=True)["errors"]))

    def test_final_requires_vector(self):
        no_vec = REPORT.replace(
            " (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N = 7.5)", ""
        )
        self.assertFalse(any("Vektor CVSS" in e for e in cr.read(no_vec)["errors"]))
        self.assertTrue(any("Vektor CVSS" in e for e in cr.read(no_vec, final=True)["errors"]))

    def test_unknown_rank_is_error(self):
        # "Sedang" cocok medium; pakai kata yang tak ada di daftar peringkat.
        broken = REPORT.replace("Peringkat: Tinggi", "Peringkat: Urgent")
        res = cr.read(broken)
        self.assertTrue(any("tidak dikenali" in e for e in res["errors"]), res["errors"])

    def test_summary_table_category_mismatch_is_error(self):
        # Register F-01 kategori A01; tabel menulis A02.
        broken = REPORT.replace("| F-01 | Tinggi | A01 |", "| F-01 | Tinggi | A02 |")
        res = cr.read(broken)
        self.assertTrue(
            any("kategori" in e and "Register" in e for e in res["errors"]), res["errors"]
        )

    def test_summary_table_category_same_code_different_prose_passes(self):
        # Kode OWASP sama walau teks kategorinya beda (Register A01, tabel "A01 Broken Access Control").
        ok = REPORT.replace("| F-01 | Tinggi | A01 |", "| F-01 | Tinggi | A01 Broken Access Control |")
        res = cr.read(ok)
        self.assertEqual([e for e in res["errors"] if "kategori" in e], [], res["errors"])

    def test_summary_table_category_multiple_codes_mismatch_is_error(self):
        # Kode pertama sama (A01) tetapi kode kedua berbeda (A03 vs A02).
        broken = REPORT.replace("- Kategori: A01\n", "- Kategori: A01, A02\n")
        broken = broken.replace("| F-01 | Tinggi | A01 |", "| F-01 | Tinggi | A01, A03 |")
        res = cr.read(broken)
        self.assertTrue(
            any("kategori" in e and "Register" in e for e in res["errors"]), res["errors"]
        )

    def test_summary_table_arabic_category_mismatch_is_error(self):
        # Dua kategori Arab yang berbeda (tanpa kode OWASP) harus dibedakan,
        # bukan sama-sama menjadi string kosong.
        broken = REPORT.replace("- Kategori: A01\n", "- Kategori: الحقن\n")
        broken = broken.replace("| F-01 | Tinggi | A01 |", "| F-01 | Tinggi | التحكم بالوصول |")
        res = cr.read(broken)
        self.assertTrue(
            any("kategori" in e and "Register" in e for e in res["errors"]), res["errors"]
        )

    def test_summary_table_arabic_category_with_harakat_matches(self):
        # Kategori Arab yang sama, satu sisi memakai harakat: tanda kombinasi
        # dibuang dulu, jadi keduanya tetap dianggap sama (bukan salah ditolak).
        ok = REPORT.replace("- Kategori: A01\n", "- Kategori: الحقن\n")
        ok = ok.replace("| F-01 | Tinggi | A01 |", "| F-01 | Tinggi | الحَقْن |")
        res = cr.read(ok)
        self.assertEqual([e for e in res["errors"] if "kategori" in e], [], res["errors"])

    def test_orphan_summary_row_without_register_is_error(self):
        # Register kosong (tak ada blok F-nn) tetapi tabel Bagian 4 punya F-01.
        broken = REPORT.replace(
            "## F-01 Judul\n\n"
            "- Peringkat: Tinggi (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N = 7.5)\n"
            "- Kategori: A01\n- Sumber: Diuji langsung\n- Status: Terbuka\n"
            "- Rekomendasi: perbaiki\n",
            "",
        )
        res = cr.read(broken, final=True)
        self.assertTrue(
            any("F-01" in e and "tidak ada di Register" in e for e in res["errors"]),
            res["errors"],
        )

    def test_summary_table_heading_level_three_is_compared(self):
        # Bagian 4 sebagai `###` — pemeriksaan bagian wajib menerimanya, jadi
        # perbandingan baris vs Register pun harus jalan.
        lvl3 = REPORT.replace("# 4. Ringkasan Temuan", "### 4. Ringkasan Temuan")
        lvl3 = lvl3.replace("| F-01 | Tinggi | A01 | Terbuka |\n", "")
        res = cr.read(lvl3, final=True)
        self.assertTrue(
            any("F-01" in e and "tidak ada di tabel Bagian 4" in e for e in res["errors"]),
            res["errors"],
        )

    def test_duplicate_summary_row_is_error(self):
        broken = REPORT.replace(
            "| F-01 | Tinggi | A01 | Terbuka |",
            "| F-01 | Tinggi | A01 | Ditutup |\n| F-01 | Tinggi | A01 | Terbuka |",
        )
        res = cr.read(broken)
        self.assertTrue(any("lebih dari sekali" in e for e in res["errors"]), res["errors"])

    def test_subsection_2_5_filled_through_subheading_is_not_empty(self):
        # Batasnya ditulis di subbagian 2.5.1, bukan paragraf langsung.
        filled = REPORT.replace(
            "## 2.5 Batas yang memengaruhi hasil\n\n"
            "Sampel 30 dari 300 rute; pemindai otomatis ZAP tidak dijalankan; lingkungan uji\n"
            "lokal + data seed, berbeda dari produksi.\n",
            "## 2.5 Batas yang memengaruhi hasil\n\n### 2.5.1 Cakupan\n\nSampel 30 dari 300 rute.\n",
        )
        res = cr.read(filled, final=True)
        self.assertEqual([e for e in res["errors"] if "2.5" in e], [], res["errors"])

    def test_subsection_2_5_with_only_a_bare_subheading_is_empty(self):
        # Subjudul tanpa uraian bukan isi: baris judul tak boleh membuatnya lulus.
        bare = REPORT.replace(
            "## 2.5 Batas yang memengaruhi hasil\n\n"
            "Sampel 30 dari 300 rute; pemindai otomatis ZAP tidak dijalankan; lingkungan uji\n"
            "lokal + data seed, berbeda dari produksi.\n",
            "## 2.5 Batas yang memengaruhi hasil\n\n### 2.5.1 Cakupan\n\n<!-- belum diisi -->\n",
        )
        res = cr.read(bare, final=True)
        self.assertTrue(any("2.5" in e for e in res["errors"]), res["errors"])


class ParityTest(unittest.TestCase):
    def _doc(self, rank: str, status: str):
        text = REPORT.replace("Peringkat: Tinggi", f"Peringkat: {rank}")
        text = text.replace("Status: Terbuka", f"Status: {status}")
        return cr.read(text)

    def test_same_ids_ranks_status_pass(self):
        docs = {"id.md": self._doc("Tinggi", "Terbuka"),
                "en.md": self._doc("High", "Open"),
                "ar.md": self._doc("عالٍ", "مفتوح")}
        self.assertEqual(cr.parity(docs), [])

    def test_missing_id_fails(self):
        id_doc = self._doc("Tinggi", "Terbuka")
        en_doc = cr.read(REPORT.replace("## F-01 Judul", "## F-02 Judul"))
        errs = cr.parity({"id.md": id_doc, "en.md": en_doc})
        self.assertTrue(any("F-01" in e and "tidak di" in e for e in errs), errs)

    def test_rank_differs_fails(self):
        docs = {"id.md": self._doc("Tinggi", "Terbuka"),
                "en.md": self._doc("Rendah", "Open")}
        errs = cr.parity(docs)
        self.assertTrue(any("peringkat berbeda" in e for e in errs), errs)

    def test_status_differs_fails(self):
        docs = {"id.md": self._doc("Tinggi", "Terbuka"),
                "en.md": self._doc("High", "Fixed")}
        errs = cr.parity(docs)
        self.assertTrue(any("status berbeda" in e for e in errs), errs)


class SummaryTest(unittest.TestCase):
    def test_clean_summary_passes(self):
        self.assertEqual(cr.summary_errors("# Prosedur\n\nTidak ada temuan di sini.\n"), [])

    def test_open_finding_is_rejected(self):
        text = "# Ringkasan\n\n## F-01 contoh\n- Status: Terbuka\n"
        errs = cr.summary_errors(text)
        self.assertTrue(any("F-01" in e for e in errs), errs)

    def test_closed_finding_is_allowed(self):
        text = "# Ringkasan\n\n## F-01 contoh\n- Status: Ditutup\n"
        self.assertEqual(cr.summary_errors(text), [])

    def test_belum_ditutup_is_rejected(self):
        # "Belum ditutup" harus diperlakukan sebagai masih terbuka.
        text = "# Ringkasan\n\n## F-01 contoh\n- Status: Belum ditutup\n"
        self.assertTrue(any("F-01" in e for e in cr.summary_errors(text)))

    def test_open_row_in_summary_table_is_rejected(self):
        text = (
            "# Ringkasan\n\n## 4. Ringkasan Temuan\n\n"
            "| ID | Peringkat | Kategori OWASP | Status |\n|---|---|---|---|\n"
            "| F-01 | Tinggi | A01 | Terbuka |\n"
        )
        self.assertTrue(any("F-01" in e for e in cr.summary_errors(text)))

    def test_closed_row_in_summary_table_is_allowed(self):
        text = (
            "# Ringkasan\n\n## 4. Ringkasan Temuan\n\n"
            "| ID | Peringkat | Kategori OWASP | Status |\n|---|---|---|---|\n"
            "| F-01 | Tinggi | A01 | Ditutup |\n"
        )
        self.assertEqual(cr.summary_errors(text), [])

    def test_row_without_status_column_is_rejected(self):
        # Baris tanpa kolom status tak boleh dilewati: ID/peringkat/kategori-nya
        # akan terbit tanpa kesalahan meski temuan terbuka.
        text = (
            "# Ringkasan\n\n## 4. Ringkasan Temuan\n\n"
            "| ID | Peringkat | Kategori OWASP |\n|---|---|---|\n"
            "| F-01 | Tinggi | A01 |\n"
        )
        self.assertTrue(any("F-01" in e for e in cr.summary_errors(text)))

    def test_duplicate_row_closed_then_open_is_rejected(self):
        # Baris pertama "Ditutup", kedua "Terbuka": baris terbuka tak boleh
        # disembunyikan oleh baris pertama.
        text = (
            "# Ringkasan\n\n## 4. Ringkasan Temuan\n\n"
            "| ID | Peringkat | Kategori OWASP | Status |\n|---|---|---|---|\n"
            "| F-01 | Tinggi | A01 | Ditutup |\n"
            "| F-01 | Tinggi | A01 | Terbuka |\n"
        )
        self.assertTrue(any("F-01" in e for e in cr.summary_errors(text)))

    def test_duplicate_row_open_then_closed_is_rejected(self):
        # Urutan sebaliknya: baris "Terbuka" lebih dulu, duplikat "Ditutup"
        # belakangan. Temuan terbuka tetap harus ditolak.
        text = (
            "# Ringkasan\n\n## 4. Ringkasan Temuan\n\n"
            "| ID | Peringkat | Kategori OWASP | Status |\n|---|---|---|---|\n"
            "| F-01 | Tinggi | A01 | Terbuka |\n"
            "| F-01 | Tinggi | A01 | Ditutup |\n"
        )
        self.assertTrue(any("F-01" in e for e in cr.summary_errors(text)))

    def test_heading_level_three_summary_table_is_checked(self):
        text = (
            "# Ringkasan\n\n### 4. Ringkasan Temuan\n\n"
            "| ID | Peringkat | Kategori OWASP | Status |\n|---|---|---|---|\n"
            "| F-01 | Tinggi | A01 | Terbuka |\n"
        )
        self.assertTrue(any("F-01" in e for e in cr.summary_errors(text)))

    def test_summary_mode_exit(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "S.md"
            p.write_text("# Ringkasan\n\n## F-01 contoh\n- Status: Terbuka\n", encoding="utf-8")
            sys.argv = ["check_report.py", str(p), "--summary"]
            self.assertEqual(cr.main(), 1)


class MainExitTest(unittest.TestCase):
    def test_clean_report_exits_zero(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "L.md"
            p.write_text(REPORT, encoding="utf-8")
            sys.argv = ["check_report.py", str(p)]
            self.assertEqual(cr.main(), 0)

    def test_broken_report_exits_one(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "L.md"
            p.write_text(REPORT.replace("- Status: Terbuka\n", ""), encoding="utf-8")
            sys.argv = ["check_report.py", str(p)]
            self.assertEqual(cr.main(), 1)

    def test_parity_across_files(self):
        with tempfile.TemporaryDirectory() as d:
            a = Path(d) / "id.md"
            b = Path(d) / "en.md"
            a.write_text(REPORT, encoding="utf-8")
            b.write_text(REPORT.replace("Peringkat: Tinggi", "Peringkat: Rendah"),
                         encoding="utf-8")
            sys.argv = ["check_report.py", str(a), str(b), "--parity"]
            self.assertEqual(cr.main(), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
