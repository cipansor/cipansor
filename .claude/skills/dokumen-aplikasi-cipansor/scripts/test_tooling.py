#!/usr/bin/env python3
"""Uji regresi untuk perkakas dokumen (Devin review: "Document tooling lacks regression coverage").

Kenapa berkas ini ada: `build_docs.py` dan `check_docs.py` adalah gerbang yang memutuskan
apakah naskah boleh diserahkan, dan keduanya menutup kesalahan yang tidak terlihat dari kode
keluar — tabel yang terbit kosong, halaman nyaris kosong, angka yang tidak cocok dengan
`facts.json`, rute yang tidak terdaftar. Sebelum ini tak satu pun dari jalur itu punya uji,
jadi perubahan pada perkakas bisa melumpuhkan gerbang tanpa ada yang menangkapnya.

Uji di sini memakai berkas contoh kecil dan `monkeypatch` untuk Prisma/router palsu, sehingga
tidak perlu repo penuh maupun LibreOffice. Jalankan:

    python -m unittest discover -s .claude/skills/dokumen-aplikasi-cipansor/scripts -p 'test_*.py'

atau langsung:

    python .claude/skills/dokumen-aplikasi-cipansor/scripts/test_tooling.py
"""
from __future__ import annotations

import contextlib
import importlib
import importlib.util
import sys
import types
import unittest
from pathlib import Path


def _has(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


@contextlib.contextmanager
def _only_modules(**modules):
    """Make only the named modules importable, as if the others were absent.

    `verify_pdf` imports `pymupdf` with a `fitz` fallback; simulating the two
    layouts needs the import to fail for the blocked name, which a
    `sys.modules` entry alone does not do.
    """
    import builtins

    real = builtins.__import__
    saved = {name: sys.modules.get(name) for name in modules}
    for name, module in modules.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module

    def fake_import(name, *args, **kwargs):
        if name in modules and modules[name] is None:
            raise ImportError(f"simulated: {name} is not installed")
        return real(name, *args, **kwargs)

    builtins.__import__ = fake_import
    try:
        yield
    finally:
        builtins.__import__ = real
        for name, value in saved.items():
            if value is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = value


def _fake_pdf_module(pages: list[str]):
    """A stand-in PyMuPDF exposing only what `verify_pdf` reads."""
    module = types.ModuleType("fitz")

    class _Page:
        def __init__(self, text: str):
            self._text = text

        def get_text(self) -> str:
            return self._text

    class _Doc:
        def __init__(self, texts: list[str]):
            self._pages = [_Page(t) for t in texts]

        def __iter__(self):
            return iter(self._pages)

    module.open = lambda _path: _Doc(pages)
    return module


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

check_docs = importlib.import_module("check_docs")
build_docs = importlib.import_module("build_docs")
collect_facts = importlib.import_module("collect_facts")


class NormRouteTest(unittest.TestCase):
    def test_parameters_collapse_to_one_shape(self):
        self.assertEqual(check_docs.norm_route("/students/:id"), "/api/students/:p")
        self.assertEqual(check_docs.norm_route("/students/{id}"), "/api/students/:p")
        self.assertEqual(check_docs.norm_route("/students/[id]"), "/api/students/:p")

    def test_trailing_slash_and_query_are_stripped(self):
        self.assertEqual(check_docs.norm_route("/students/"), "/api/students")
        self.assertEqual(check_docs.norm_route("/students?page=1"), "/api/students")

    def test_punctuation_after_a_path_is_dropped(self):
        # A route cited at the end of a sentence must not fail on the period.
        self.assertEqual(check_docs.norm_route("/students/:id."), "/api/students/:p")

    def test_api_prefix_is_not_doubled(self):
        self.assertEqual(check_docs.norm_route("/api/v1/students"), "/api/v1/students")


class SplitRowTest(unittest.TestCase):
    def test_cells_split_on_pipes(self):
        self.assertEqual(check_docs.split_row("| a | b | c |"), ["a", "b", "c"])

    def test_a_pipe_inside_backticks_does_not_split(self):
        self.assertEqual(check_docs.split_row("| `a|b` | c |"), ["`a|b`", "c"])


class CountMdTablesTest(unittest.TestCase):
    def test_counts_each_separator_row_once(self):
        md = "| a | b |\n|---|---|\n| 1 | 2 |\n\n| c |\n|---|\n| 3 |\n"
        self.assertEqual(build_docs.count_md_tables(md), 2)

    def test_ignores_tables_inside_code_fences(self):
        md = "```\n| a | b |\n|---|---|\n```\n\n| c |\n|---|\n| 3 |\n"
        self.assertEqual(build_docs.count_md_tables(md), 1)

    def test_zero_when_there_are_no_tables(self):
        self.assertEqual(build_docs.count_md_tables("just prose\n"), 0)


class CheckRoutesTest(unittest.TestCase):
    """The route gate is what keeps a document from citing an API that does not exist."""

    def _run(self, line: str, routes: list[tuple[str, str]]):
        r = check_docs.Report()
        idx = [{"method": m, "path": p, "module": "x"} for m, p in routes]
        orig = collect_facts.route_index
        collect_facts.route_index = lambda repo: idx  # type: ignore[assignment]
        try:
            check_docs.check_routes(line, [line], Path("."), r)
        finally:
            collect_facts.route_index = orig  # type: ignore[assignment]
        return r

    def test_a_registered_route_passes(self):
        r = self._run("GET /api/students", [("GET", "/api/students")])
        self.assertEqual([i for i in r.items if i[0] == "ERROR"], [])

    def test_an_unregistered_route_is_an_error(self):
        r = self._run("GET /api/students", [("GET", "/api/teachers")])
        errors = [i for i in r.items if i[0] == "ERROR"]
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0][2], "rute-tak-ada")

    def test_a_wrong_method_is_an_error_and_says_so(self):
        r = self._run("DELETE /api/students", [("GET", "/api/students")])
        errors = [i for i in r.items if i[0] == "ERROR"]
        self.assertEqual(len(errors), 1)
        self.assertIn("metode lain", errors[0][3])

    def test_parameters_match_across_notations(self):
        r = self._run("GET /api/students/{id}", [("GET", "/api/students/:id")])
        self.assertEqual([i for i in r.items if i[0] == "ERROR"], [])


class CheckNumbersTest(unittest.TestCase):
    """The number gate compares prose against facts.json, but a revision-history
    row records the number as it was at that commit — it must not be rewritten."""

    FACTS = {
        "api": {"module_count": 94, "handler_count_approx": 1412,
                "four_file_modules": 67, "five_part_modules": 25},
        "prisma": {"model_count": 289, "enum_count": 157, "role_code_count": 53},
        "web": {"page_count": 435},
        "jobs": {"cron_entries": 15, "scheduled_job_files": ["a.job.ts"], "count": 1,
                 "job_files_not_scheduled": []},
        "env": {"total_keys": 40},
    }

    def _run(self, line: str):
        r = check_docs.Report()
        check_docs.check_numbers([line], self.FACTS, r)
        return [i for i in r.items if i[0] == "ERROR"]

    def test_a_stale_current_number_is_an_error(self):
        errors = self._run("Aplikasi punya 93 modul API.")
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0][2], "angka-salah")

    def test_a_correct_number_passes(self):
        self.assertEqual(self._run("Aplikasi punya 94 modul API."), [])

    def test_layout_figures_are_checked_against_facts(self):
        # #771: "67 dari 94" passed unchecked once the tree passed 93 modules.
        self.assertEqual(self._run("**67 dari 94 modul memiliki empat berkas inti**"), [])
        self.assertEqual(len(self._run("**68 dari 94 modul memiliki empat berkas inti**")), 1)
        self.assertEqual(len(self._run("hanya 25 dari 95 modul lengkap lima bagian")), 1)
        self.assertEqual(self._run("hanya 25 dari 94 modul lengkap lima bagian"), [])

    def test_schedule_figures_are_checked_against_facts(self):
        # #771: "16 entri jadwal atas 14 berkas pekerjaan" never matched
        # "N pekerjaan terjadwal", so it went stale unseen.
        self.assertEqual(len(self._run("16 entri jadwal atas 1 berkas pekerjaan")), 1)
        self.assertEqual(len(self._run("15 entri jadwal atas 3 berkas pekerjaan")), 1)
        self.assertEqual(self._run("15 entri jadwal atas 1 berkas pekerjaan"), [])

    def test_a_layout_figure_without_its_definition_warns_whatever_the_total(self):
        r = check_docs.Report()
        check_docs.check_numbers(["Sebanyak 30 dari 95 modul sudah rapi."], self.FACTS, r)
        self.assertTrue(any(i[0] == "WARN" and i[2] == "ukuran-tata-letak" for i in r.items))

    def test_a_revision_history_row_is_exempt(self):
        # History: "~1.413 hulu rute API (dari ~1.412)" was true at that commit.
        self.assertEqual(self._run("| 0.7 | 30 September 2026 | ~1.413 hulu rute API | Agen |"), [])


class QuotedMessageTest(unittest.TestCase):
    """A quoted screen message must exist in the web/API source (#779: a guide
    quoted "… orang" where the code interpolates the count, and the old
    case-sensitive rule let the sentence-initial "Muncul pesan" slip past)."""

    WEB = 'toast.success(`Pengumuman terbit — masuk ke lonceng ${n} orang`);'

    def test_a_quote_that_matches_the_source_passes(self):
        line = '   *Muncul pesan "Pengumuman terbit — masuk ke lonceng" diikuti jumlah penerima.*'
        self.assertEqual(check_docs.quoted_message_errors([line], self.WEB, ""), [])

    def test_a_capitalised_muncul_pesan_is_checked(self):
        # The gap the old lowercase-only pattern left open.
        line = '   *Muncul pesan "Pesan yang tidak ada di kode".*'
        self.assertEqual(check_docs.quoted_message_errors([line], self.WEB, ""),
                         [(1, "Pesan yang tidak ada di kode")])

    def test_a_lowercase_muncul_pesan_is_checked(self):
        line = '   *muncul pesan "Pesan yang tidak ada di kode".*'
        self.assertEqual(check_docs.quoted_message_errors([line], self.WEB, ""),
                         [(1, "Pesan yang tidak ada di kode")])

    def test_a_quote_found_only_in_the_api_passes(self):
        line = '   *Muncul pesan "Pesan dari API".*'
        self.assertEqual(check_docs.quoted_message_errors([line], "", '"Pesan dari API"'), [])


class PartialCardMarkerTest(unittest.TestCase):
    """A card whose *steps* were revised from code keeps its screenshot but must
    carry a per-step ⚠ (#779 review): only a whole-card marker clashes with the
    image, so `kartu-bergambar-masih-t2` must fire on the card-level form alone."""

    def test_card_level_warning_detects_blockquote_and_bare_marker(self):
        self.assertTrue(check_docs.card_level_warning(["> ⚠ Belum dicoba di aplikasi berjalan"], 1, 1))
        self.assertTrue(check_docs.card_level_warning(["⚠ Belum dicoba di aplikasi berjalan"], 1, 1))

    def test_card_level_warning_ignores_a_step_marker(self):
        lines = ["3. Klik **Terbitkan**.",
                 "   > ⚠ Belum dicoba di aplikasi berjalan — langkah ini dari kode."]
        self.assertFalse(check_docs.card_level_warning(lines, 1, 2))

    @staticmethod
    def _png(path: Path) -> None:
        head = (b"\x89PNG\r\n\x1a\n" + (13).to_bytes(4, "big") + b"IHDR"
                + (1024).to_bytes(4, "big") + (600).to_bytes(4, "big"))
        path.write_bytes(head + b"\x00" * 64)

    def _run(self, marker_line: str) -> list[tuple]:
        import json, tempfile
        with tempfile.TemporaryDirectory() as d:
            md = Path(d)
            (md / "screens").mkdir()
            self._png(md / "screens" / "x.png")
            (md / "screens" / "manifest.json").write_text(
                json.dumps([{"path": "screens/x.png", "url": "/x"}]), encoding="utf-8")
            text = ("## Mencatat sesuatu\n\n**Langkah.**\n\n"
                    "1. Buka halaman.\n2. Klik **Simpan**.\n" + marker_line + "\n\n"
                    "![Gambar 1. Halaman contoh yang cukup panjang.](screens/x.png){width=14cm}\n\n"
                    "*Gambar 1. Halaman contoh.*\n")
            r = check_docs.Report()
            check_docs.check_images(text, text.split("\n"), md, "pengguna", r)
            return [i for i in r.items if i[2] == "kartu-bergambar-masih-t2"]

    def test_a_step_level_marker_keeps_the_screenshot(self):
        self.assertEqual(self._run("   > ⚠ Belum dicoba di aplikasi berjalan — langkah ini dari kode."), [])

    def test_a_card_level_marker_on_an_illustrated_card_is_reported(self):
        found = self._run("> ⚠ Belum dicoba di aplikasi berjalan")
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][0], "WARN")


@unittest.skipUnless(_has("docx"), "python-docx not installed (optional: pip install python-docx lxml)")
class VerifyDocxTest(unittest.TestCase):
    """A .docx whose structure drifted from the Markdown must be reported, not passed."""

    @staticmethod
    def _docx(tmp: Path, *, tables: int, with_heading_in_cell: bool = False, toc: bool = True):
        from docx import Document

        d = Document()
        d.add_table(rows=1, cols=2)  # [0] is the cover metadata table, skipped
        for _ in range(tables):
            t = d.add_table(rows=2, cols=2)
            t.cell(0, 0).text = "Kepala"
            t.cell(0, 1).text = "Nilai"
            t.cell(1, 0).text = "isi"
            t.cell(1, 1).text = "isi"
            if with_heading_in_cell:
                t.cell(1, 0).paragraphs[0].style = d.styles["Heading 1"]
        if toc:
            d.add_paragraph("Daftar Isi")
        out = tmp / "doc.docx"
        d.save(str(out))
        return out

    def test_matching_structure_has_no_problems(self):
        import tempfile

        with tempfile.TemporaryDirectory() as td:
            p = self._docx(Path(td), tables=1)
            self.assertEqual(build_docs.verify_docx(p, "| a | b |\n|---|---|\n| 1 | 2 |\n", 0), [])

    def test_missing_table_is_reported(self):
        import tempfile

        with tempfile.TemporaryDirectory() as td:
            p = self._docx(Path(td), tables=1)
            problems = build_docs.verify_docx(p, "| a | b |\n|---|---|\n| 1 | 2 |\n\n| c | d |\n|---|---|\n| 3 | 4 |\n", 0)
            self.assertTrue(any("jumlah tabel" in x for x in problems), problems)

    def test_heading_inside_a_cell_is_reported(self):
        import tempfile

        with tempfile.TemporaryDirectory() as td:
            p = self._docx(Path(td), tables=1, with_heading_in_cell=True)
            problems = build_docs.verify_docx(p, "| a | b |\n|---|---|\n| 1 | 2 |\n", 0)
            self.assertTrue(any("judul bab" in x for x in problems), problems)

    def test_missing_daftar_isi_is_reported(self):
        import tempfile

        with tempfile.TemporaryDirectory() as td:
            p = self._docx(Path(td), tables=1, toc=False)
            problems = build_docs.verify_docx(p, "| a | b |\n|---|---|\n| 1 | 2 |\n", 0)
            self.assertTrue(any("Daftar Isi" in x for x in problems), problems)


@unittest.skipUnless(_has("pymupdf") or _has("fitz"), "pymupdf not installed (optional: pip install pymupdf)")
class VerifyPdfTest(unittest.TestCase):
    """The PDF gate must notice a near-empty page and a table whose header did not render."""

    @staticmethod
    def _pdf(tmp: Path, pages: list[str]):
        # The module is `pymupdf` or its legacy alias `fitz`; build with
        # whichever is installed, as build_docs.verify_pdf does.
        try:
            import pymupdf  # type: ignore
        except ImportError:
            import fitz as pymupdf  # type: ignore

        doc = pymupdf.open()
        for text in pages:
            page = doc.new_page()
            page.insert_text((72, 72), text)
        out = tmp / "doc.pdf"
        doc.save(str(out))
        doc.close()
        return out

    def test_a_table_header_missing_from_the_pdf_is_reported(self):
        import tempfile

        with tempfile.TemporaryDirectory() as td:
            p = self._pdf(Path(td), ["Halaman dengan teks yang cukup panjang untuk diperiksa mesin dokumen ini."])
            md = "| Modul | Jumlah |\n|---|---|\n| api | 3 |\n"
            problems = build_docs.verify_pdf(p, md)
            self.assertTrue(any("Modul" in x for x in problems), problems)

    def test_a_present_header_passes(self):
        import tempfile

        with tempfile.TemporaryDirectory() as td:
            p = self._pdf(Path(td), ["Modul Jumlah api 3 — teks yang cukup panjang untuk diperiksa mesin."])
            md = "| Modul | Jumlah |\n|---|---|\n| api | 3 |\n"
            self.assertEqual(build_docs.verify_pdf(p, md), [])


class VerifyPdfFallbackTest(unittest.TestCase):
    """`verify_pdf` must accept the `fitz` alias, not only `pymupdf`.

    Runs without any PDF library: it injects a stand-in module and exercises the
    real `build_docs.verify_pdf`, so the fallback is covered even on the CI
    runner, where the PDF cases above are skipped.
    """

    _MD = "| Modul | Jumlah |\n|---|---|\n| api | 3 |\n"

    def test_uses_the_pymupdf_name_when_present(self):
        fake = _fake_pdf_module(["Modul Jumlah api 3 — teks yang cukup panjang untuk diperiksa mesin."])
        with _only_modules(pymupdf=fake, fitz=None):
            self.assertEqual(build_docs.verify_pdf("x.pdf", self._MD), [])

    def test_falls_back_to_the_fitz_alias(self):
        # Only `fitz` present (older PyMuPDF): `import pymupdf` must fail and the
        # fallback must take over — the regression the review flagged.
        fake = _fake_pdf_module(["Modul Jumlah api 3 — teks yang cukup panjang untuk diperiksa mesin."])
        with _only_modules(pymupdf=None, fitz=fake):
            self.assertEqual(build_docs.verify_pdf("x.pdf", self._MD), [])

    def test_reports_when_no_pdf_library_is_installed(self):
        with _only_modules(pymupdf=None, fitz=None):
            problems = build_docs.verify_pdf("x.pdf", self._MD)
        self.assertTrue(any("PyMuPDF" in p for p in problems), problems)

    def test_a_missing_table_header_is_reported_through_the_alias(self):
        fake = _fake_pdf_module(["Halaman dengan teks yang cukup panjang untuk diperiksa mesin dokumen ini."])
        with _only_modules(pymupdf=None, fitz=fake):
            problems = build_docs.verify_pdf("x.pdf", self._MD)
        self.assertTrue(any("Modul" in p for p in problems), problems)


if __name__ == "__main__":
    unittest.main(verbosity=2)
