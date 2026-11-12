#!/usr/bin/env python3
"""Periksa naskah laporan uji kerentanan Cipansor SEBELUM diserahkan.

Kenapa berkas ini ada: laporan uji kerentanan adalah bukti yang dibaca pengurus,
auditor, dan donor. Cacat yang paling sering lolos bukan pada prosa, melainkan
pada **struktur**: temuan `F-nn` yang kehilangan salah satu dari lima butirnya,
tabel Ringkasan yang tidak cocok dengan Register, skor CVSS yang ditulis berbeda
dari vektornya, atau tiga edisi bahasa yang menilai temuan yang sama secara
berbeda. Semua itu pemeriksaan mesin, bukan penilaian.

Laporan penuh disimpan DI LUAR repo selama repo publik (keputusan K37); jalankan
pemeriksa ini terhadap salinan itu, dan terhadap ringkasan netral yang di-commit.

Pemakaian:
    python check_report.py LAPORAN.md [--lang id] [--final]
    python check_report.py ID.md EN.md AR.md --parity      # paritas tiga bahasa
    python check_report.py docs/UJI-KERENTANAN.md --summary --final  # ringkasan publik
Opsi:
    --final    tanda [ISI]/TODO/TBD dihitung ERROR (laporan yang akan diserahkan)
    --parity   perlakukan berkas sebagai edisi bahasa; periksa himpunan ID,
               peringkat, dan status yang sama pada tingkat kanonik
    --summary  periksa sebagai ringkasan publik: lewati bagian wajib, tetapi
               tolak temuan berstatus terbuka/mitigasi/diterima (K37)
Kode keluar: 0 tidak ada ERROR · 1 ada ERROR · 2 salah pakai.

ERROR = pasti salah / melanggar aturan. WARN = curiga, periksa dengan mata.
Hanya pustaka standar Python.
"""
from __future__ import annotations

import argparse
import math
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
# Pindai sensitif memakai pola bersama skill dokumen bila tersedia; bila tidak,
# pemeriksa tetap jalan tanpa langkah itu (pemeriksa resmi repo tetap wajib).
_DOK = HERE.parent.parent / "dokumen-aplikasi-cipansor" / "scripts"
if _DOK.is_dir():
    sys.path.insert(0, str(_DOK))
try:
    import scan_sensitive  # type: ignore
except Exception:  # pragma: no cover - hanya bila skill dokumen tidak ada
    scan_sensitive = None


# --- bagian yang wajib (Ringkasan Eksekutif + Bagian 1–10 + lampiran) --------
REQUIRED_SECTIONS = [
    (r"ringkasan\s+eksekutif|executive\s+summary", "Ringkasan Eksekutif"),
    (r"pendahuluan|introduction", "1 Pendahuluan & Otorisasi"),
    (r"lingkup|scope", "2 Lingkup & Metodologi"),
    (r"arsitektur|architecture", "3 Arsitektur & Permukaan Serangan"),
    (r"ringkasan\s+temuan|summary\s+of\s+findings", "4 Ringkasan Temuan"),
    (r"register\s+temuan|register\s+of\s+findings", "5 Register Temuan"),
    (r"kontrol\s+yang\s+terverifikasi|verified\s+controls|kontrol\s+baik", "6 Kontrol yang Terverifikasi Baik"),
    (r"owasp", "7 Pemetaan OWASP"),
    (r"peta\s+jalan|roadmap", "8 Peta Jalan Perbaikan"),
    (r"uji\s+ulang|retest", "9 Rencana Uji Ulang"),
    (r"penanganan\s+bukti|evidence\s+handling", "10 Penanganan Bukti"),
    (r"lampiran|appendix", "Lampiran"),
]

# --- lima butir wajib tiap temuan (label dalam id/en/ar) ---------------------
FIELD_PATTERNS = {
    "peringkat": r"(?:peringkat|rank|severity|tingkat|الدرجة|التصنيف)",
    "kategori": r"(?:kategori|category|kategori\s+owasp|الفئة)",
    "sumber": r"(?:sumber|source|المصدر)",
    "status": r"(?:status|الحالة)",
    "rekomendasi": r"(?:rekomendasi|recommendation|التوصية)",
}

FINDING_RE = re.compile(r"^#{2,4}\s*(F-\d{2,3})\b", re.M)
# Vektor CVSS: hanya huruf/angka/`:`/`/`/`.` — jangan menelan tanda kurung penutup.
VECTOR_RE = re.compile(r"CVSS:3\.1/[A-Za-z0-9:/.]+")
# Baris tabel Bagian 4 (Ringkasan Temuan): | F-01 | Tinggi | A01 | Terbuka |
TABLE_ROW_RE = re.compile(r"^\s*\|\s*(F-\d{2,3})\s*\|(.+?)\|\s*$", re.M)
PLACEHOLDER_RE = re.compile(r"\[ISI\]|\bTODO\b|\bTBD\b|FIXME", re.I)
# Kata penyangkal sebelum status tertutup membaliknya jadi terbuka ("belum ditutup").
NEGATION_RE = r"(?:belum|tidak|bukan|not|no|لم|لا|غير)"

# --- tingkat kanonik (id/en/ar) dan status kanonik ---------------------------
RANK_LEVELS = [
    ("critical", ["critical", "kritis", "حرج"]),
    ("high", ["high", "tinggi", "عالٍ", "عالي"]),
    ("medium", ["medium", "sedang", "متوسط"]),
    ("low", ["low", "rendah", "منخفض"]),
    ("none", ["none", "tidak ada", "لا شيء"]),
]
STATUS_LEVELS = [
    ("open", ["open", "terbuka", "مفتوح"]),
    ("fixed", ["fixed", "ditutup", "selesai", "mُصلَح", "مصلح", "مُصلَح"]),
    ("mitigated", ["mitigated", "dimitigasi", "diredam", "مُخفَّف", "مخفف"]),
    ("accepted", ["accepted", "diterima", "مقبول"]),
]


def canonical(text: str, levels) -> str | None:
    t = (text or "").strip().lower()
    for name, words in levels:
        for w in words:
            if w.lower() in t:
                return name
    return None


def canonical_status(text: str) -> str | None:
    """Status kanonik; kata penyangkal membalik status tertutup jadi terbuka.

    `Status: Belum ditutup` berarti temuan **masih terbuka**, bukan selesai:
    kata `ditutup` saja akan salah membacanya sebagai `fixed` dan meloloskan
    temuan terbuka ke ringkasan publik (K37).
    """
    t = (text or "").strip().lower()
    for name, words in STATUS_LEVELS:
        for w in words:
            idx = t.find(w.lower())
            if idx == -1:
                continue
            if name != "open" and re.search(NEGATION_RE, t[max(0, idx - 12) : idx]):
                return "open"
            return name
    return None


def rating_band(score: float) -> str:
    if score == 0.0:
        return "none"
    if score < 4.0:
        return "low"
    if score < 7.0:
        return "medium"
    if score < 9.0:
        return "high"
    return "critical"


# --- CVSS v3.1 (hanya metrik dasar) ------------------------------------------
AV = {"N": 0.85, "A": 0.62, "L": 0.55, "P": 0.2}
AC = {"L": 0.77, "H": 0.44}
PR_U = {"N": 0.85, "L": 0.62, "H": 0.27}
PR_C = {"N": 0.85, "L": 0.68, "H": 0.5}
UI = {"N": 0.85, "R": 0.62}
CIA = {"H": 0.56, "L": 0.22, "N": 0.0}


def _roundup(x: float) -> float:
    """CVSS v3.1 §7.1 roundup: naikkan ke satu desimal, selalu ke atas."""
    int_input = round(x * 100000)
    if int_input % 10000 == 0:
        return int_input / 100000
    return (math.floor(int_input / 10000) + 1) / 10


def cvss_base(vector: str) -> float | None:
    """Hitung skor dasar CVSS v3.1 dari vektor `CVSS:3.1/AV:.../...`."""
    m = re.search(r"CVSS:3\.1/(\S+)", vector)
    if not m:
        return None
    parts = {}
    for kv in m.group(1).split("/"):
        if ":" in kv:
            k, v = kv.split(":", 1)
            parts[k.upper()] = v.upper()
    need = ["AV", "AC", "PR", "UI", "S", "C", "I", "A"]
    if any(k not in parts for k in need):
        return None
    try:
        scope_changed = parts["S"] == "C"
        pr = (PR_C if scope_changed else PR_U)[parts["PR"]]
        iss = 1 - ((1 - CIA[parts["C"]]) * (1 - CIA[parts["I"]]) * (1 - CIA[parts["A"]]))
        if scope_changed:
            impact = 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15
        else:
            impact = 6.42 * iss
        exploitability = 8.22 * AV[parts["AV"]] * AC[parts["AC"]] * pr * UI[parts["UI"]]
    except KeyError:
        return None
    if impact <= 0:
        return 0.0
    if scope_changed:
        return _roundup(min(1.08 * (impact + exploitability), 10.0))
    return _roundup(min(impact + exploitability, 10.0))


# --- pembacaan naskah --------------------------------------------------------
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$", re.M)


def _heading_body(text: str, pattern: str, max_level: int = 6) -> str | None:
    """Isi bagian pertama yang judulnya cocok `pattern`.

    Isi berjalan sampai judul berikutnya yang **setingkat atau lebih tinggi**
    dari judul bagian itu; subjudul di dalamnya tetap ikut. Kalau tidak, sebuah
    bagian yang seluruh isinya diletakkan di subbagian (mis. 2.5.1) akan
    terbaca kosong.
    """
    marks = list(HEADING_RE.finditer(text))
    for i, m in enumerate(marks):
        level = len(m.group(1))
        if level <= max_level and re.search(pattern, m.group(2), re.I):
            start = m.end()
            end = len(text)
            for nxt in marks[i + 1 :]:
                if len(nxt.group(1)) <= level:
                    end = nxt.start()
                    break
            return text[start:end]
    return None


def _strip_comments(text: str) -> str:
    return re.sub(r"<!--.*?-->", "", text, flags=re.S)


# Kode kategori OWASP Top 10 (`A01`) atau API Top 10 (`API1`).
OWASP_CODE_RE = re.compile(r"\b(API\d{1,2}|A\d{2})\b", re.I)


def _category_codes(text: str) -> set[str]:
    """Semua kode OWASP pada kategori (satu temuan bisa memetakan ke beberapa)."""
    return {m.group(1).upper() for m in OWASP_CODE_RE.finditer(text or "")}


def _norm_text(text: str) -> str:
    """Normalisasi untuk perbandingan: buang harakat, tanda baca jadi spasi.

    Langkah pertama adalah komposisi NFKC, lalu **membuang tanda kombinasi**
    (kategori Unicode `Mn`/`Mc`/`Me` — harakat Arab seperti fatah, kasrah,
    dhammah). Tanpa ini, `\\W` menganggap harakat sebagai bukan huruf dan
    menggantinya dengan spasi, sehingga `الحَقْن` terpecah menjadi `الح ق ن` dan
    tidak lagi sama dengan `الحقن`.

    Setelah harakat dibuang, `\\W` mode Unicode mempertahankan huruf dan angka
    dari aksara apa pun (termasuk Arab); hanya tanda baca dan spasi berlebih
    yang dirapikan. Kalau tidak, dua kategori Arab yang berbeda sama-sama
    menjadi string kosong dan dianggap cocok.
    """
    decomposed = unicodedata.normalize("NFKC", text or "").lower()
    without_marks = "".join(ch for ch in decomposed if not unicodedata.category(ch).startswith("M"))
    return re.sub(r"[\W_]+", " ", without_marks).strip()


def _categories_match(a: str, b: str) -> bool:
    """Cocok bila himpunan kode OWASP sama, atau (tanpa kode) teks ternormalisasi sama.

    Bila hanya satu sisi memuat kode dan sisi lain prosa, keduanya tak dapat
    dibandingkan dengan andal — jangan menuduh salah. Kontradiksi yang nyata
    (mis. `A01` vs `A02`, atau `A01, A03` vs `A01, A02`) tetap tertangkap.
    """
    ca, cb = _category_codes(a), _category_codes(b)
    if ca and cb:
        return ca == cb
    if ca or cb:
        return True
    return _norm_text(a) == _norm_text(b)


def summary_table(text: str) -> tuple[dict[str, list[str]], dict[str, list[str | None]]] | None:
    """Baris Bagian 4 (Ringkasan Temuan): ID -> [peringkat, kategori, status].

    Mengembalikan `(rows, statuses)`; `None` bila bagiannya tidak ada, supaya
    pemanggil dapat membedakan "tidak ada tabel" dari "tabel kosong".

    `rows[fid]` adalah baris **terakhir** untuk ID itu (pemeriksaan tak boleh
    dilewati oleh baris pertama), sedangkan `statuses[fid]` menyimpan status
    **setiap** baris ID itu secara berurutan — supaya satu baris "Terbuka" yang
    diikuti duplikat "Ditutup" tetap terlihat. Status `None` berarti kolom status
    tidak ada.
    """
    body = _heading_body(text, r"ringkasan\s+temuan|summary\s+of\s+findings", max_level=3)
    if body is None:
        return None
    rows: dict[str, list[str]] = {}
    statuses: dict[str, list[str | None]] = {}
    for m in TABLE_ROW_RE.finditer(body):
        fid = m.group(1)
        cells = [c.strip() for c in m.group(2).split("|")]
        rows[fid] = cells
        statuses.setdefault(fid, []).append(cells[2] if len(cells) >= 3 else None)
    return rows, statuses


def read(text: str, final: bool = False) -> dict:
    out: dict = {"errors": [], "warnings": [], "findings": {}}

    def err(msg):
        out["errors"].append(msg)

    def warn(msg):
        out["warnings"].append(msg)

    # bagian wajib
    headings = "\n".join(re.findall(r"^#{1,3}\s+.*$", text, re.M))
    for pat, name in REQUIRED_SECTIONS:
        if not re.search(pat, headings, re.I):
            err(f"bagian wajib hilang: {name}")

    # Bagian 2.5 — batas yang memengaruhi hasil wajib ada dan terisi
    sub25 = _heading_body(text, r"^\s*2\.5\b", max_level=4)
    if sub25 is None:
        err("bagian wajib hilang: 2.5 Batas yang memengaruhi hasil")
    else:
        # Baris judul subbagian bukan uraian: buang heading (dan komentar) dulu,
        # lalu periksa apakah benar-benar ada paragraf isi.
        content = re.sub(r"(?m)^#{1,6}\s+.*$", "", _strip_comments(sub25))
        if not content.strip():
            (err if final else warn)("bagian 2.5 ada tetapi kosong — tulis cakupan sampel, alat, dan perbedaan lingkungan")

    # temuan: pisah blok per `F-nn`
    blocks = list(FINDING_RE.finditer(text))
    if not blocks:
        warn("tidak ada temuan berlabel `F-nn` (laporan tanpa temuan?)")
    for i, b in enumerate(blocks):
        fid = b.group(1)
        if fid in out["findings"]:
            err(f"{fid}: ID temuan ganda — setiap temuan harus punya ID unik")
            continue
        start = b.end()
        end = blocks[i + 1].start() if i + 1 < len(blocks) else len(text)
        block = text[start:end]
        f: dict = {}
        for key, pat in FIELD_PATTERNS.items():
            m = re.search(rf"(?im)^\s*[-*]?\s*\*{{0,2}}{pat}\*{{0,2}}\s*:\s*(.+)$", block)
            if not m:
                err(f"{fid}: butir wajib hilang — {key}")
            else:
                f[key] = m.group(1).strip()
        # skor CVSS vs vektor
        vm = VECTOR_RE.search(block)
        written = f.get("peringkat", "")
        if vm:
            written = written.replace(vm.group(0), "")  # jangan baca "3.1" dari vektor
        sm = re.search(r"(\d{1,2}\.\d)", written)
        if vm:
            score = cvss_base(vm.group(0))
            if score is None:
                err(f"{fid}: vektor CVSS tidak dikenali — periksa metrik AV/AC/PR/UI/S/C/I/A")
            else:
                f["_cvss"] = score
                if sm and abs(float(sm.group(1)) - score) > 0.05:
                    err(f"{fid}: skor CVSS tertulis {sm.group(1)} ≠ vektor {score:.1f}")
                elif not sm:
                    (err if final else warn)(
                        f"{fid}: vektor CVSS ada tanpa skor tertulis — skor tidak terverifikasi"
                    )
                canon = canonical(f.get("peringkat", ""), RANK_LEVELS)
                if f.get("peringkat") and canon is None:
                    err(f"{fid}: peringkat '{f['peringkat']}' tidak dikenali (critical/high/medium/low/none)")
                elif canon and canon != rating_band(score):
                    err(f"{fid}: peringkat '{f['peringkat']}' ≠ pita skor {score:.1f} ({rating_band(score)})")
        else:
            (err if final else warn)(f"{fid}: tidak ada Vektor CVSS — skor tidak dapat diverifikasi mesin")
        # tingkat kanonik
        f["_rank"] = canonical(f.get("peringkat", ""), RANK_LEVELS)
        f["_status"] = canonical_status(f.get("status", ""))
        out["findings"][fid] = f

    # Bagian 4 (Ringkasan) harus cocok dengan Bagian 5 (Register)
    parsed = summary_table(text)
    table = parsed[0] if parsed else None
    if parsed:
        for fid, statuses in parsed[1].items():
            if len(statuses) > 1:
                err(f"ringkasan: {fid} muncul lebih dari sekali di tabel Bagian 4 — satu baris per temuan")
    if table is not None:
        for fid in sorted(set(table) - set(out["findings"])):
            err(f"ringkasan: {fid} ada di tabel Bagian 4 tetapi tidak ada di Register (Bagian 5)")
        for fid in sorted(set(out["findings"]) - set(table)):
            err(f"ringkasan: {fid} ada di Register (Bagian 5) tetapi tidak ada di tabel Bagian 4")
        for fid in sorted(set(table) & set(out["findings"])):
            cells = table[fid]
            f = out["findings"][fid]
            if len(cells) >= 1 and canonical(cells[0], RANK_LEVELS) != f.get("_rank"):
                err(f"ringkasan: {fid} peringkat '{cells[0]}' ≠ Register '{f.get('peringkat')}'")
            if len(cells) >= 2 and not _categories_match(cells[1], f.get("kategori", "")):
                err(f"ringkasan: {fid} kategori '{cells[1]}' ≠ Register '{f.get('kategori')}'")
            if len(cells) >= 3 and canonical_status(cells[2]) != f.get("_status"):
                err(f"ringkasan: {fid} status '{cells[2]}' ≠ Register '{f.get('status')}'")

    # placeholder pada laporan final
    if PLACEHOLDER_RE.search(text):
        out["warnings"].append("naskah masih memuat [ISI]/TODO/TBD")
        out["_placeholder"] = True
    return out


def parity(docs: dict[str, dict]) -> list[str]:
    """Himpunan ID + peringkat + status harus sama di seluruh edisi bahasa."""
    errors = []
    names = list(docs)
    base = names[0]
    ids = set(docs[base]["findings"])
    for other in names[1:]:
        oids = set(docs[other]["findings"])
        for missing in sorted(ids - oids):
            errors.append(f"paritas: {missing} ada di {base} tetapi tidak di {other}")
        for extra in sorted(oids - ids):
            errors.append(f"paritas: {extra} ada di {other} tetapi tidak di {base}")
        for fid in sorted(ids & oids):
            a = docs[base]["findings"][fid]
            b = docs[other]["findings"][fid]
            if a.get("_rank") != b.get("_rank"):
                errors.append(
                    f"paritas: {fid} peringkat berbeda — {base}='{a.get('peringkat')}' "
                    f"({a.get('_rank')}) vs {other}='{b.get('peringkat')}' ({b.get('_rank')})"
                )
            if a.get("_status") != b.get("_status"):
                errors.append(
                    f"paritas: {fid} status berbeda — {base}='{a.get('status')}' "
                    f"({a.get('_status')}) vs {other}='{b.get('status')}' ({b.get('_status')})"
                )
    return errors


def summary_errors(text: str) -> list[str]:
    """Ringkasan publik: TIDAK boleh memuat temuan yang masih terbuka.

    Menangkap dua bentuk: blok temuan `## F-nn` dengan status terbuka, dan
    baris tabel Bagian 4 yang mencantumkan temuan berstatus terbuka — keduanya
    dilarang selama repo publik (K37).
    """
    errs = []
    blocks = list(FINDING_RE.finditer(text))
    for i, b in enumerate(blocks):
        fid = b.group(1)
        start = b.end()
        end = blocks[i + 1].start() if i + 1 < len(blocks) else len(text)
        block = text[start:end]
        m = re.search(r"(?im)^\s*[-*]?\s*\**status\**\s*:\s*(.+)$", block)
        status = canonical_status(m.group(1)) if m else None
        if status in (None, "open", "mitigated", "accepted"):
            errs.append(
                f"{fid}: ringkasan publik memuat temuan berstatus "
                f"'{m.group(1).strip() if m else 'tidak disebut'}' — temuan terbuka "
                f"hanya boleh ada di laporan penuh di luar repo (K37)"
            )
    parsed = summary_table(text)
    if parsed:
        for fid, statuses in parsed[1].items():
            bad: list[str] = []
            for shown in statuses:
                status = canonical_status(shown) if shown is not None else None
                if status in (None, "open", "mitigated", "accepted"):
                    label = shown if shown is not None else "tidak disebut"
                    if label not in bad:
                        bad.append(label)
            for label in bad:
                errs.append(
                    f"{fid}: tabel Ringkasan publik mencantumkan temuan berstatus "
                    f"'{label}' — temuan terbuka hanya boleh ada di laporan penuh "
                    f"di luar repo (K37)"
                )
    return errs


def main() -> int:
    ap = argparse.ArgumentParser(description="Periksa naskah laporan uji kerentanan.")
    ap.add_argument("files", nargs="+", help="berkas laporan (satu atau lebih edisi bahasa)")
    ap.add_argument("--lang", default="id")
    ap.add_argument("--final", action="store_true", help="[ISI]/TODO/TBD dihitung ERROR")
    ap.add_argument("--parity", action="store_true", help="periksa paritas antar edisi bahasa")
    ap.add_argument(
        "--summary",
        action="store_true",
        help="periksa sebagai ringkasan publik: tanpa bagian wajib, "
        "tetapi menolak temuan berstatus terbuka/mitigasi/diterima",
    )
    args = ap.parse_args()

    # Mode ringkasan: yang di-commit hanya prosedur + ringkasan netral (K37).
    if args.summary:
        total_err = 0
        for path in args.files:
            p = Path(path)
            if not p.is_file():
                print(f"ERROR: {path} tidak ditemukan", file=sys.stderr)
                return 2
            text = p.read_text(encoding="utf-8", errors="replace")
            for e in summary_errors(text):
                print(f"ERROR  {path}  {e}")
                total_err += 1
            if args.final and PLACEHOLDER_RE.search(text):
                print(f"ERROR  {path}  naskah final masih memuat [ISI]/TODO/TBD")
                total_err += 1
            if scan_sensitive is not None:
                for n, key, why, snip in scan_sensitive.scan(p):
                    print(f"ERROR  {path}:{n}  [sensitif:{key}] {why}  ({snip})")
                    total_err += 1
        if total_err:
            print(f"\n{total_err} ERROR. Ringkasan publik harus bebas temuan terbuka.")
            return 1
        print("0 ERROR. Ringkasan publik bebas temuan terbuka dan pola sensitif.")
        return 0

    docs: dict[str, dict] = {}
    total_err = 0
    total_warn = 0
    for path in args.files:
        p = Path(path)
        if not p.is_file():
            print(f"ERROR: {path} tidak ditemukan", file=sys.stderr)
            return 2
        text = p.read_text(encoding="utf-8", errors="replace")
        res = read(text, final=args.final)
        docs[path] = res
        for e in res["errors"]:
            print(f"ERROR  {path}  {e}")
            total_err += 1
        for w in res["warnings"]:
            if args.final and "placeholder" in w.lower():
                continue
            print(f"WARN   {path}  {w}")
            total_warn += 1
        if args.final and res.get("_placeholder"):
            print(f"ERROR  {path}  naskah final masih memuat [ISI]/TODO/TBD")
            total_err += 1
        # pemindai sensitif (pola bersama skill dokumen)
        if scan_sensitive is not None:
            for n, key, why, snip in scan_sensitive.scan(p):
                print(f"ERROR  {path}:{n}  [sensitif:{key}] {why}  ({snip})")
                total_err += 1

    if args.parity and len(docs) > 1:
        for e in parity(docs):
            print(f"ERROR  paritas  {e}")
            total_err += 1

    if total_err:
        print(f"\n{total_err} ERROR, {total_warn} WARN. Perbaiki ERROR sebelum menyerahkan.")
        return 1
    print(f"0 ERROR, {total_warn} WARN. Struktur temuan, skor CVSS, dan paritas bersih. "
          f"Tetap baca Bagian 2.5 dan Ringkasan dengan mata.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
