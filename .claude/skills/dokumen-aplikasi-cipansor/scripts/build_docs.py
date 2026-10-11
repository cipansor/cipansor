#!/usr/bin/env python3
"""Bangun dokumen akhir dari SATU sumber Markdown.

    .md  -> .docx  (sampul berlogo, daftar isi terisi, tabel berpita, diagram jadi gambar,
                    header/footer bernomor halaman)      -- untuk dicetak/dikirim ke donor, auditor, pengurus
    .md  -> .md    (disalin apa adanya; blok ```mermaid tetap, GitHub merendernya sendiri)
                                                         -- untuk docs/ di repo (dokumen hidup)

Kenapa satu sumber: dua salinan (md dan docx) yang ditulis terpisah pasti bergeser.
Penulis hanya menyunting Markdown; format lain diturunkan.

Pemakaian:
    python build_docs.py sumber.md --out keluaran/ --format docx \\
        --title "Dokumen Teknis Aplikasi" --subtitle "Sistem Informasi Cipansor" \\
        --version 1.0 --status Draf --commit 6db6cb7 --logo apps/web/public/logo.png

Diagram: tulis blok ```mermaid; baris pertama boleh `%% caption: Judul gambar`.
Perender diagram butuh `mmdc` + Chromium (dideteksi otomatis). Bila tak ada, blok tetap
sebagai kode dan skrip memberi peringatan — dokumen tetap terbit.
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent

MERMAID_RE = re.compile(r"```mermaid[ \t]*\n(.*?)\n```", re.S)

MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli",
             "Agustus", "September", "Oktober", "November", "Desember"]


def tanggal_id(d: date) -> str:
    return f"{d.day} {MONTHS_ID[d.month - 1]} {d.year}"


# --------------------------------------------------------------------------- diagram

def find_chrome() -> str | None:
    env = os.environ.get("PUPPETEER_EXECUTABLE_PATH")
    if env and Path(env).exists():
        return env
    for pat in ("/opt/pw-browsers/chromium-*/chrome-linux/chrome",
                "/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell"):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        w = shutil.which(name)
        if w:
            return w
    return None


def png_size(path: Path) -> tuple[int, int] | None:
    """Lebar x tinggi PNG dari kepala berkas (tanpa Pillow — dulu diam-diam dilewati bila Pillow tak ada)."""
    try:
        head = path.read_bytes()[:24]
        if head[:8] != b"\x89PNG\r\n\x1a\n":
            return None
        return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
    except OSError:
        return None


def render_mermaid(md: str, outdir: Path) -> tuple[str, int, int]:
    """Ganti blok mermaid dengan gambar PNG. Kembalikan (md_baru, berhasil, gagal)."""
    blocks = list(MERMAID_RE.finditer(md))
    if not blocks:
        return md, 0, 0
    mmdc = shutil.which("mmdc")
    chrome = find_chrome()
    if not mmdc or not chrome:
        print("PERINGATAN: mmdc/Chromium tidak ditemukan — diagram tetap sebagai kode di .docx. "
              "Pasang @mermaid-js/mermaid-cli dan Chromium, atau set PUPPETEER_EXECUTABLE_PATH.",
              file=sys.stderr)
        return md, 0, len(blocks)

    diag_dir = outdir / "diagrams"
    diag_dir.mkdir(parents=True, exist_ok=True)
    pp = diag_dir / "puppeteer.json"
    pp.write_text(json.dumps({"args": ["--no-sandbox", "--disable-setuid-sandbox"]}))
    env = {**os.environ, "PUPPETEER_EXECUTABLE_PATH": chrome}

    ok = bad = 0
    out: list[str] = []
    last = 0
    for m in blocks:
        src = m.group(1)
        cap = re.match(r"\s*%%\s*caption:\s*(.+)", src)
        caption = cap.group(1).strip() if cap else "Diagram"
        h = hashlib.sha1(src.encode()).hexdigest()[:8]
        mmd, png = diag_dir / f"d-{h}.mmd", diag_dir / f"d-{h}.png"
        mmd.write_text(src, encoding="utf-8")
        r = subprocess.run(
            [mmdc, "-i", str(mmd), "-o", str(png), "-p", str(pp), "-b", "white", "-s", "2", "--size", "1200"],
            env=env, capture_output=True, text=True, timeout=180,
        )
        out.append(md[last:m.start()])
        if r.returncode == 0 and png.exists():
            ok += 1
            attr = ""
            dims = png_size(png)
            if dims:
                ratio = dims[1] / dims[0]
                if ratio > 1.15:  # diagram tinggi: batasi supaya muat satu halaman
                    attr = "{width=%.1fcm}" % max(6.0, min(16.0, 19.0 / ratio))
            # Gambar dan keterangannya HARUS paragraf terpisah (baris kosong di antaranya). Bila hanya
            # satu baris baru, keduanya satu paragraf dan keterangan terbelah di sekitar gambar tinggi.
            out.append(f"\n\n![{caption}]({png}){attr}\n\n")
            # Pembaca commonmark_x membuang keterangan gambar (alt) sehingga gaya
            # "Image Caption" tak pernah terpakai. Tulis keterangan eksplisit bila ada.
            if cap:
                out.append(f"*Gambar: {caption}*\n\n")
        else:
            bad += 1
            print(f"PERINGATAN: diagram '{caption}' gagal dirender:\n{r.stderr.strip()[:400]}", file=sys.stderr)
            out.append(m.group(0))
        last = m.end()
    out.append(md[last:])
    return "".join(out), ok, bad


# --------------------------------------------------------------------------- referensi gaya

def make_reference(path: Path, accent: str) -> None:
    from docx import Document
    from docx.enum.text import WD_LINE_SPACING
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt, RGBColor

    with open(path, "wb") as f:
        subprocess.run(["pandoc", "--print-default-data-file", "reference.docx"], stdout=f, check=True)
    d = Document(str(path))

    s = d.sections[0]  # A4, margin sesuai kebiasaan dokumen resmi Indonesia
    s.page_width, s.page_height = Cm(21.0), Cm(29.7)
    s.left_margin = s.right_margin = Cm(2.5)
    s.top_margin, s.bottom_margin = Cm(2.4), Cm(2.2)

    def st(name):
        # Cari tanpa peduli huruf besar/kecil. d.styles["Heading 1"] mencari nama internal
        # "heading 1" dan GAGAL pada berkas referensi pandoc ("Heading 1") — tanpa error
        # yang terlihat, judul bab diam-diam tetap bergaya bawaan.
        want = name.lower()
        for sty in d.styles:
            if sty.name.lower() == want:
                return sty
        return None

    def font(style, name="Calibri", size=None, bold=None, italic=None, color=None):
        if style is None:
            return
        f = style.font
        f.name = name
        rpr = style.element.get_or_add_rPr()
        rf = rpr.find(qn("w:rFonts"))
        if rf is None:
            rf = OxmlElement("w:rFonts")
            rpr.append(rf)
        for a in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
            rf.set(qn(a), name)
        for a in ("w:asciiTheme", "w:hAnsiTheme", "w:cstheme", "w:eastAsiaTheme"):
            if rf.get(qn(a)) is not None:
                del rf.attrib[qn(a)]
        if size:
            f.size = Pt(size)
        if bold is not None:
            f.bold = bold
        if italic is not None:
            f.italic = italic
        if color:
            f.color.rgb = RGBColor.from_string(color)
            c = style.element.get_or_add_rPr().find(qn("w:color"))
            if c is not None:  # warna tema menimpa nilai rgb bila dibiarkan
                for a in ("w:themeColor", "w:themeShade", "w:themeTint"):
                    if c.get(qn(a)) is not None:
                        del c.attrib[qn(a)]

    def para(style, before=None, after=None, line=None, keep_next=None):
        if style is None:
            return
        pf = style.paragraph_format
        if before is not None:
            pf.space_before = Pt(before)
        if after is not None:
            pf.space_after = Pt(after)
        if line:
            pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
            pf.line_spacing = line
        if keep_next is not None:
            pf.keep_with_next = keep_next

    for n in ("Normal", "Body Text", "First Paragraph", "Compact"):
        font(st(n), size=11, color="222222")
    for n in ("Body Text", "First Paragraph"):
        para(st(n), before=0, after=7, line=1.15)
    para(st("Compact"), before=1, after=1)

    sizes = {1: 18, 2: 14, 3: 12, 4: 11}
    for lvl, sz in sizes.items():
        h = st(f"Heading {lvl}")
        font(h, size=sz, bold=True, color=accent)
        para(h, before={1: 20, 2: 14, 3: 10, 4: 8}[lvl], after={1: 8, 2: 6, 3: 4, 4: 3}[lvl], keep_next=True)
    font(st("Title"), size=28, bold=True, color=accent)
    font(st("Subtitle"), size=15, color="555555")
    font(st("TOC Heading"), size=18, bold=True, color=accent)

    for n in ("Verbatim Char", "Source Code"):
        font(st(n), name="Consolas", size=9, color="333333")
    sc = st("Source Code")
    if sc is not None:
        ppr = sc.element.get_or_add_pPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), "F3F4F6")
        ppr.append(shd)
        para(sc, before=4, after=6)

    bt = st("Block Text")  # dipakai untuk kotak Catatan/Peringatan (blockquote)
    if bt is not None:
        font(bt, size=10.5, color="1F3D2F")
        ppr = bt.element.get_or_add_pPr()
        bdr = OxmlElement("w:pBdr")
        left = OxmlElement("w:left")
        for k, v in (("val", "single"), ("sz", "24"), ("space", "8"), ("color", accent)):
            left.set(qn(f"w:{k}"), v)
        bdr.append(left)
        ppr.append(bdr)
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), "EEF6F1")
        ppr.append(shd)
        bt.paragraph_format.left_indent = Cm(0.5)
        bt.paragraph_format.right_indent = Cm(0.3)
        para(bt, before=4, after=8)

    for n in ("Image Caption", "Table Caption"):
        font(st(n), size=9.5, italic=True, color="555555")
    para(st("Image Caption"), before=2, after=10)
    para(st("Table Caption"), before=8, after=3, keep_next=True)
    font(st("Hyperlink"), color=accent)
    d.save(str(path))


# --------------------------------------------------------------------------- pasca-proses

def _field(paragraph, instr: str, size=None, color=None):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Pt, RGBColor

    def run_with(child):
        r = paragraph.add_run()
        if size:
            r.font.size = Pt(size)
        if color:
            r.font.color.rgb = RGBColor.from_string(color)
        r._r.append(child)

    b = OxmlElement("w:fldChar"); b.set(qn("w:fldCharType"), "begin"); run_with(b)
    t = OxmlElement("w:instrText"); t.set(qn("xml:space"), "preserve"); t.text = f" {instr} "; run_with(t)
    s = OxmlElement("w:fldChar"); s.set(qn("w:fldCharType"), "separate"); run_with(s)
    r = paragraph.add_run("1")
    if size:
        r.font.size = Pt(size)
    if color:
        r.font.color.rgb = RGBColor.from_string(color)
    e = OxmlElement("w:fldChar"); e.set(qn("w:fldCharType"), "end"); run_with(e)


def _border_bottom(paragraph, color="BBBBBB", sz="6"):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    ppr = paragraph._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    b = OxmlElement("w:bottom")
    for k, v in (("val", "single"), ("sz", sz), ("space", "4"), ("color", color)):
        b.set(qn(f"w:{k}"), v)
    bdr.append(b)
    ppr.append(bdr)



def autofit_table(tbl, total_cm: float = 16.0) -> None:
    """Lebar kolom menurut isi. Pandoc membagi rata kolom tabel pipa yang barisnya pendek,
    sehingga kolom berteks panjang menumpuk sedangkan kolom angka lebar tak berguna."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm

    n = len(tbl.columns)
    if n == 0:
        return
    longest = [0] * n
    for row in tbl.rows:
        for i, c in enumerate(row.cells[:n]):
            longest[i] = max(longest[i], min(len(c.text.strip()), 70))
    weights = [max(l, 8) ** 0.8 for l in longest]
    min_cm = 1.9
    widths = [max(min_cm, total_cm * w / sum(weights)) for w in weights]
    scale = total_cm / sum(widths)
    widths = [w * scale for w in widths]

    tbl.autofit = False
    pr = tbl._tbl.tblPr
    for old in pr.findall(qn("w:tblLayout")):
        pr.remove(old)
    lay = OxmlElement("w:tblLayout")
    lay.set(qn("w:type"), "fixed")
    pr.append(lay)
    for old in pr.findall(qn("w:tblW")):
        pr.remove(old)
    tw = OxmlElement("w:tblW")
    tw.set(qn("w:w"), str(int(total_cm / 2.54 * 1440)))
    tw.set(qn("w:type"), "dxa")
    pr.append(tw)
    for i, w in enumerate(widths):
        tbl.columns[i].width = Cm(w)
        for row in tbl.rows:
            row.cells[i].width = Cm(w)


def postprocess(docx_path: Path, a: argparse.Namespace) -> None:
    from docx import Document
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
    from docx.oxml import OxmlElement, parse_xml
    from docx.oxml.ns import qn, nsdecls
    from docx.shared import Cm, Pt, RGBColor

    accent = a.accent
    doc = Document(str(docx_path))
    body = doc.element.body
    anchor = body[0]

    def before_anchor(el):
        anchor.addprevious(el)

    def new_par(text="", size=11, bold=False, color="222222", align=None, space_after=6, caps=False):
        p = doc.add_paragraph()
        if text:
            r = p.add_run(text)
            r.font.size = Pt(size)
            r.font.bold = bold
            r.font.color.rgb = RGBColor.from_string(color)
            r.font.all_caps = caps
        if align is not None:
            p.alignment = align
        p.paragraph_format.space_after = Pt(space_after)
        p.paragraph_format.space_before = Pt(0)
        before_anchor(p._p)
        return p

    # ---- sampul
    new_par(space_after=40)
    if a.logo and Path(a.logo).is_file():
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run().add_picture(a.logo, width=Cm(3.4))
        p.paragraph_format.space_after = Pt(14)
        before_anchor(p._p)
    new_par(a.org.upper(), size=12, bold=True, color=accent, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=60)
    new_par(a.title, size=30, bold=True, color=accent, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=8)
    if a.subtitle:
        new_par(a.subtitle, size=16, color="555555", align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10)
    rule = new_par(space_after=36)
    _border_bottom(rule, color=accent, sz="12")

    meta = [("Versi", a.version), ("Tanggal", a.date_text), ("Status", a.status)]
    if a.commit:
        meta.append(("Basis kode", f"commit {a.commit}"))
    if a.author:
        meta.append(("Disusun oleh", a.author))
    meta.append(("Klasifikasi", a.classification))
    t = doc.add_table(rows=len(meta), cols=2)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    t.columns[0].width, t.columns[1].width = Cm(3.6), Cm(9.4)
    for i, (k, v) in enumerate(meta):
        c0, c1 = t.rows[i].cells
        c0.width, c1.width = Cm(3.6), Cm(9.4)
        for c, txt, bold, col in ((c0, k, True, "666666"), (c1, v, False, "222222")):
            p = c.paragraphs[0]
            r = p.add_run(txt)
            r.font.size, r.font.bold = Pt(11), bold
            r.font.color.rgb = RGBColor.from_string(col)
            p.paragraph_format.space_after = Pt(3)
    tp = t._tbl.tblPr
    tp.append(parse_xml(f'<w:tblBorders {nsdecls("w")}><w:top w:val="nil"/><w:left w:val="nil"/>'
                        f'<w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>'))
    before_anchor(t._tbl)
    pb = doc.add_paragraph(); pb.add_run().add_break(WD_BREAK.PAGE); before_anchor(pb._p)

    # ---- daftar isi (bidang; diisi update_toc.py)
    try:
        h = doc.add_paragraph("Daftar Isi", style="TOC Heading")
    except KeyError:
        h = doc.add_paragraph()
        hr = h.add_run("Daftar Isi")
        hr.font.size, hr.font.bold = Pt(18), True
        hr.font.color.rgb = RGBColor.from_string(accent)
    before_anchor(h._p)
    tocp = doc.add_paragraph()
    for typ, txt in (("begin", None), ("instr", ' TOC \\o "1-3" \\h \\z \\u '), ("separate", None), ("text", "Daftar isi dibuat otomatis — klik kanan > Perbarui bidang."), ("end", None)):
        r = tocp.add_run()
        if typ == "instr":
            it = OxmlElement("w:instrText"); it.set(qn("xml:space"), "preserve"); it.text = txt; r._r.append(it)
        elif typ == "text":
            r.text = txt
        else:
            fc = OxmlElement("w:fldChar"); fc.set(qn("w:fldCharType"), typ)
            if typ == "begin":
                fc.set(qn("w:dirty"), "true")
            r._r.append(fc)
    before_anchor(tocp._p)
    pb2 = doc.add_paragraph(); pb2.add_run().add_break(WD_BREAK.PAGE); before_anchor(pb2._p)

    # ---- tabel: garis tipis, kepala berwarna, baris kepala berulang antar halaman
    for tbl in doc.tables[1:]:  # [0] = tabel metadata sampul
        tblPr = tbl._tbl.tblPr
        for old in tblPr.findall(qn("w:tblBorders")):
            tblPr.remove(old)
        tblPr.append(parse_xml(
            f'<w:tblBorders {nsdecls("w")}>' + "".join(
                f'<w:{s} w:val="single" w:sz="4" w:space="0" w:color="C9CED3"/>'
                for s in ("top", "left", "bottom", "right", "insideH", "insideV")) + "</w:tblBorders>"))
        tblPr.append(parse_xml(
            f'<w:tblCellMar {nsdecls("w")}><w:top w:w="50" w:type="dxa"/><w:left w:w="90" w:type="dxa"/>'
            f'<w:bottom w:w="50" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar>'))
        autofit_table(tbl)
        for ri, row in enumerate(tbl.rows):
            if ri < 2:  # kepala + baris pertama selalu se-halaman: kepala tak boleh terdampar sendirian
                for cell in row.cells:
                    for par in cell.paragraphs:
                        par.paragraph_format.keep_with_next = True
            trPr = row._tr.get_or_add_trPr()
            cant = OxmlElement("w:cantSplit"); trPr.append(cant)
            if ri == 0:
                th = OxmlElement("w:tblHeader"); trPr.append(th)
            for cell in row.cells:
                if ri == 0:
                    tcPr = cell._tc.get_or_add_tcPr()
                    tcPr.append(parse_xml(f'<w:shd {nsdecls("w")} w:val="clear" w:color="auto" w:fill="{accent}"/>'))
                elif ri % 2 == 0:
                    tcPr = cell._tc.get_or_add_tcPr()
                    tcPr.append(parse_xml(f'<w:shd {nsdecls("w")} w:val="clear" w:color="auto" w:fill="F5F7F6"/>'))
                for p in cell.paragraphs:
                    for r in p.runs:
                        r.font.size = Pt(9.5)
                        if ri == 0:
                            r.font.bold = True
                            r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    # ---- header/footer (sampul tanpa header/footer)
    sec = doc.sections[0]
    sec.different_first_page_header_footer = True
    hp = sec.header.paragraphs[0]
    hp.text = ""
    r = hp.add_run(f"{a.title} — {a.subtitle}" if a.subtitle else a.title)
    r.font.size, r.font.color.rgb = Pt(8.5), RGBColor(0x77, 0x77, 0x77)
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    _border_bottom(hp)
    fp = sec.footer.paragraphs[0]
    fp.text = ""
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rr = fp.add_run(f"{a.org} · v{a.version} · Halaman ")
    rr.font.size, rr.font.color.rgb = Pt(8.5), RGBColor(0x77, 0x77, 0x77)
    _field(fp, "PAGE", size=8.5, color="777777")
    rr = fp.add_run(" dari ")
    rr.font.size, rr.font.color.rgb = Pt(8.5), RGBColor(0x77, 0x77, 0x77)
    _field(fp, "NUMPAGES", size=8.5, color="777777")

    doc.core_properties.title = f"{a.title} — {a.subtitle}" if a.subtitle else a.title
    doc.core_properties.author = a.author or a.org
    doc.core_properties.language = "id-ID"
    doc.save(str(docx_path))


def count_md_tables(md: str) -> int:
    body = re.sub(r"```.*?```", "", md, flags=re.S)
    return len(re.findall(r"^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$", body, flags=re.M))


def verify_docx(docx_path: Path, md: str, expect_images: int) -> list[str]:
    """Kembalikan daftar masalah. Kosong = struktur .docx sesuai sumber.

    Ini menangkap kerusakan yang TIDAK terlihat dari kode keluar: pernah terjadi tabel terbit kosong
    (kepala hijau tanpa teks, isi sel tercecer sebagai paragraf, judul bab masuk ke sel) karena
    langkah pengisian daftar isi lewat LibreOffice, dan semua pemeriksaan lain tetap hijau.
    """
    from docx import Document
    problems: list[str] = []
    d = Document(str(docx_path))
    tables = d.tables[1:]  # [0] = tabel metadata sampul
    want = count_md_tables(md)
    if len(tables) != want:
        problems.append(f"jumlah tabel: sumber {want}, .docx {len(tables)}")
    for i, t in enumerate(tables, 1):
        if not any(c.text.strip() for r in t.rows for c in r.cells):
            problems.append(f"tabel {i} kosong seluruhnya")
        elif any(not c.text.strip() for c in t.rows[0].cells):
            problems.append(f"tabel {i}: kepala tabel memuat sel kosong")
        if any(p.style is not None and p.style.name.startswith("Heading")
               for r in t.rows for c in r.cells for p in c.paragraphs):
            problems.append(f"tabel {i} memuat judul bab di dalam sel (struktur tergeser)")
    if len(d.inline_shapes) < expect_images:
        problems.append(f"gambar: diharapkan {expect_images}, .docx memuat {len(d.inline_shapes)}")
    w = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"
    if "Daftar Isi" not in "".join(t.text or "" for t in d.element.body.iter(w)):
        problems.append("tidak ada 'Daftar Isi'")
    return problems


def verify_pdf(pdf_path: Path, md: str) -> list[str]:
    """Pemeriksaan mekanis PDF (tanpa mata): setiap tabel sumber ada di PDF dengan kepala terbaca, dan
    tidak ada halaman kosong. Perlu PyMuPDF (pip install pymupdf); bila tak ada, kembalikan peringatan."""
    try:
        import pymupdf  # type: ignore
    except Exception:  # noqa: BLE001
        try:
            import fitz as pymupdf  # type: ignore
        except Exception:  # noqa: BLE001
            return ["PDF tidak diperiksa: pasang PyMuPDF (pip install pymupdf) agar tabel dan halaman diperiksa mesin"]
    problems: list[str] = []
    doc = pymupdf.open(str(pdf_path))
    text_pages = [p.get_text() for p in doc]
    for i, t in enumerate(text_pages, 1):
        if len(t.strip()) < 40 and i > 1:
            problems.append(f"halaman {i} nyaris kosong")
    whole = "\n".join(text_pages)
    body = re.sub(r"```.*?```", "", md, flags=re.S)
    for m in re.finditer(r"^\s*\|(.+)\|\s*\n\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$", body, flags=re.M):
        first = re.sub(r"[*`_]", "", m.group(1).split("|")[0]).strip()
        if first and first not in whole:
            problems.append(f"kepala tabel '{first}' tidak terbaca di PDF (tabel rusak?)")
    return problems


def soffice_env(home: str) -> dict:
    """Environment for a headless soffice run.

    `LD_LIBRARY_PATH` is dropped: soffice.bin resolves its own libraries through
    the wrapper's `$ORIGIN` RUNPATH, and a caller that exports a system multiarch
    directory (e.g. `/usr/lib/x86_64-linux-gnu`, as this runtime does) makes the
    loader pick a library that `libreglo.so` then cannot resolve — soffice exits
    with "libreglo.so: cannot open shared object file" and every PDF silently
    falls back to "PDF tidak dibuat". The bundled libraries are self-sufficient.
    """
    env = {k: v for k, v in os.environ.items() if k != "LD_LIBRARY_PATH"}
    env["SAL_USE_VCLPLUGIN"] = "svp"
    env["HOME"] = home
    return env


def make_pdf(docx_path: Path) -> Path | None:
    """PDF lewat LibreOffice dengan profil sementara. Kembalikan jalur PDF atau None."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        print("PERINGATAN: soffice tidak ada — PDF tidak dibuat", file=sys.stderr)
        return None
    prof = tempfile.mkdtemp(prefix="lo-pdf-")
    env = soffice_env(prof)
    try:
        r = subprocess.run([soffice, "--headless", "--norestore", f"-env:UserInstallation=file://{prof}",
                            "--convert-to", "pdf", "--outdir", str(docx_path.parent), str(docx_path)],
                           env=env, capture_output=True, text=True, timeout=300)
    finally:
        shutil.rmtree(prof, ignore_errors=True)
    pdf = docx_path.with_suffix(".pdf")
    if r.returncode != 0 or not pdf.exists():
        print(f"PERINGATAN: PDF gagal dibuat: {(r.stderr or r.stdout).strip()[:300]}\n"
              "  Bila galatnya 'source file could not be loaded': paket libreoffice-writer belum terpasang.",
              file=sys.stderr)
        return None
    return pdf


def set_update_fields(docx_path: Path) -> None:
    """Cadangan bila LibreOffice tak bisa mengisi daftar isi: minta Word memperbaruinya saat dibuka."""
    from docx import Document
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    doc = Document(str(docx_path))
    el = OxmlElement("w:updateFields")
    el.set(qn("w:val"), "true")
    doc.settings.element.append(el)
    doc.save(str(docx_path))


# --------------------------------------------------------------------------- utama

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="Berkas Markdown sumber")
    ap.add_argument("--out", default="out", help="Folder keluaran")
    ap.add_argument("--format", choices=["docx", "md", "both"], default="docx")
    ap.add_argument("--name", help="Nama berkas keluaran tanpa ekstensi (default: nama sumber)")
    ap.add_argument("--title", required=True)
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--version", default="1.0")
    ap.add_argument("--status", default="Draf")
    ap.add_argument("--author", default="")
    ap.add_argument("--commit", default="")
    ap.add_argument("--org", default="Yayasan Pesantren Cipansor")
    ap.add_argument("--classification", default="Internal — Yayasan Pesantren Cipansor")
    ap.add_argument("--logo", default="")
    ap.add_argument("--accent", default="0B5D3B", help="Warna aksen heksadesimal tanpa #")
    ap.add_argument("--resource-path", default="", help="Folder untuk mencari gambar/tangkapan layar")
    ap.add_argument("--no-toc-update", action="store_true")
    ap.add_argument("--pdf", action="store_true", help="buat juga PDF (LibreOffice) dari .docx")
    a = ap.parse_args()
    a.date_text = tanggal_id(date.today())

    src = Path(a.source).resolve()
    if not src.is_file():
        print(f"ERROR: {src} tidak ada", file=sys.stderr)
        return 2
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    name = a.name or src.stem
    md = src.read_text(encoding="utf-8")

    # Penanda yang tertinggal dari templat = dokumen belum selesai. Peringatkan keras, jangan gagalkan
    # (penulis mungkin sengaja menyerahkan draf), tetapi jangan biarkan lolos diam-diam.
    left = re.findall(r"\[ISI[^\]]*\]|\bTODO\b|\bTBD\b|\bLOREM\b", md)
    if left:
        print(f"PERINGATAN: {len(left)} penanda isian masih tersisa di sumber, mis. {left[0]!r}. "
              f"Dokumen ini belum layak diserahkan sebagai final.", file=sys.stderr)

    if a.format in ("md", "both"):
        if src != (out / f"{name}.md").resolve():  # sumber sudah di folder keluaran → tak perlu disalin
            shutil.copyfile(src, out / f"{name}.md")
        print(f"OK  {out / (name + '.md')}")

    if a.format in ("docx", "both"):
        if not shutil.which("pandoc"):
            print("ERROR: pandoc tidak ditemukan", file=sys.stderr)
            return 2
        md2, ok, bad = render_mermaid(md, out)
        if ok or bad:
            print(f"    diagram: {ok} dirender, {bad} gagal")
        if bad:
            print(f"GAGAL: {bad} diagram tidak dapat dirender (lihat PERINGATAN di atas). Dokumen tidak dibangun: "
                  "diagram yang gagal terbit sebagai blok kode. Perbaiki sintaks Mermaid di sumber "
                  "(kata kunci seperti Class harus diberi tanda kutip; id simpul unik).", file=sys.stderr)
            return 1
        with tempfile.TemporaryDirectory() as td:
            tdp = Path(td)
            ref = tdp / "ref.docx"
            make_reference(ref, a.accent)
            tmp_md = tdp / "in.md"
            tmp_md.write_text(md2, encoding="utf-8")
            target = out / f"{name}.docx"
            rp = os.pathsep.join(p for p in (a.resource_path, str(src.parent), str(out)) if p)
            cmd = ["pandoc", str(tmp_md), "-f", "commonmark_x-smart", "-o", str(target),
                   f"--reference-doc={ref}", f"--resource-path={rp}"]
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0:
                print(f"ERROR pandoc:\n{r.stderr}", file=sys.stderr)
                return 1
            if r.stderr.strip():
                print("    pandoc:", r.stderr.strip()[:600])
        postprocess(target, a)
        n_shots = len(re.findall(r"(?m)^!\[[^\]]*\]\([^)\s]+\)", re.sub(r"```.*?```", "", md, flags=re.S)))
        problems = verify_docx(target, md, ok + n_shots)
        if problems:
            print("GAGAL: .docx tidak sesuai sumber SEBELUM daftar isi diisi:\n  - " + "\n  - ".join(problems),
                  file=sys.stderr)
            return 1
        if not a.no_toc_update:
            backup = target.with_suffix(".docx.bak")
            shutil.copyfile(target, backup)
            # update_toc.py butuh modul 'uno' milik LibreOffice; python di venv sering tak punya.
            done = False
            for py in dict.fromkeys([sys.executable, "/usr/bin/python3"]):
                if not Path(py).exists():
                    continue
                rc = subprocess.run([py, str(HERE / "update_toc.py"), str(target)], capture_output=True, text=True)
                if rc.returncode == 0:
                    print("    " + rc.stdout.strip())
                    done = True
                    break
            if done:
                after = verify_docx(target, md, ok + n_shots)
                if after:
                    shutil.copyfile(backup, target)
                    set_update_fields(target)
                    print("PERINGATAN: pengisian daftar isi lewat LibreOffice MERUSAK .docx, hasilnya dibuang:\n  - "
                          + "\n  - ".join(after)
                          + "\n  Dipakai cadangan sebelum pengisian; daftar isi terisi saat dibuka di Word (F9).",
                          file=sys.stderr)
            else:
                set_update_fields(target)
                print("    daftar isi: LibreOffice/uno tidak tersedia; Word akan menawarkan pembaruan saat dibuka")
            backup.unlink(missing_ok=True)
        print(f"OK  {target}")
        if a.pdf:
            pdf = make_pdf(target)
            if pdf:
                print(f"OK  {pdf}")
                for prob in verify_pdf(pdf, md):
                    print(f"PERINGATAN PDF: {prob}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
