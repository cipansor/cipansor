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
PLACEHOLDER_RE = re.compile(r"\[ISI\]|\bTODO\b|\bTBD\b|FIXME", re.I)

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
def read(text: str) -> dict:
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

    # temuan: pisah blok per `F-nn`
    blocks = list(FINDING_RE.finditer(text))
    if not blocks:
        warn("tidak ada temuan berlabel `F-nn` (laporan tanpa temuan?)")
    for i, b in enumerate(blocks):
        fid = b.group(1)
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
        vm = re.search(r"CVSS:3\.1/\S+", block)
        written = f.get("peringkat", "")
        if vm:
            written = written.replace(vm.group(0), "")  # jangan baca "3.1" dari vektor
        sm = re.search(r"(\d{1,2}\.\d)", written)
        if vm:
            score = cvss_base(vm.group(0))
            if score is not None:
                f["_cvss"] = score
                if sm and abs(float(sm.group(1)) - score) > 0.05:
                    err(f"{fid}: skor CVSS tertulis {sm.group(1)} ≠ vektor {score:.1f}")
                band = rating_band(score)
                if f.get("peringkat"):
                    canon = canonical(f["peringkat"], RANK_LEVELS)
                    if canon and canon != band:
                        err(f"{fid}: peringkat '{f['peringkat']}' ≠ pita skor {score:.1f} ({band})")
        else:
            warn(f"{fid}: tidak ada Vektor CVSS — skor tidak dapat diverifikasi mesin")
        # tingkat kanonik
        f["_rank"] = canonical(f.get("peringkat", ""), RANK_LEVELS)
        f["_status"] = canonical(f.get("status", ""), STATUS_LEVELS)
        out["findings"][fid] = f

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
    """Ringkasan publik: TIDAK boleh memuat temuan yang masih terbuka."""
    errs = []
    blocks = list(FINDING_RE.finditer(text))
    for i, b in enumerate(blocks):
        fid = b.group(1)
        start = b.end()
        end = blocks[i + 1].start() if i + 1 < len(blocks) else len(text)
        block = text[start:end]
        m = re.search(r"(?im)^\s*[-*]?\s*\**status\**\s*:\s*(.+)$", block)
        status = canonical(m.group(1), STATUS_LEVELS) if m else None
        if status in (None, "open", "mitigated", "accepted"):
            errs.append(
                f"{fid}: ringkasan publik memuat temuan berstatus "
                f"'{m.group(1).strip() if m else 'tidak disebut'}' — temuan terbuka "
                f"hanya boleh ada di laporan penuh di luar repo (K37)"
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
        res = read(text)
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
