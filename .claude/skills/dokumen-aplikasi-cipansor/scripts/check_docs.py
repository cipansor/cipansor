#!/usr/bin/env python3
"""Periksa naskah Markdown dokumen aplikasi Cipansor terhadap KODE yang sebenarnya.

Kenapa skrip ini ada: model yang menyusun dokumen bisa menulis kalimat yang terdengar benar
dan tidak cocok dengan kode — alamat API yang tak pernah ada, angka dari catatan lama,
nama tombol yang bukan nama di layar, tabel yang rusak. Aturan dalam bentuk prosa tidak
menangkap itu; pemeriksaan mesin menangkapnya. Jalankan setelah TIAP bab selesai ditulis,
bukan hanya di akhir.

Pemakaian:
    python check_docs.py naskah.md --kind teknis   --repo /path/cipansor [--facts facts.json]
    python check_docs.py naskah.md --kind pengguna --repo /path/cipansor [--facts facts.json]
Opsi:
    --final    tanda [ISI]/TODO/TBD dihitung ERROR (dokumen yang akan diserahkan sebagai final)
Kode keluar: 0 tidak ada ERROR · 1 ada ERROR · 2 salah pakai.

ERROR  = pasti salah / melanggar aturan; perbaiki sebelum lanjut.
WARN   = curiga; periksa dengan mata, perbaiki atau pastikan memang disengaja.
Hanya pustaka standar Python.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import collect_facts  # noqa: E402
import scan_sensitive  # noqa: E402

ARC42 = [  # (pola judul, nama) — urutan ini wajib
    (r"pendahuluan", "1 Pendahuluan dan Tujuan"),
    (r"batasan", "2 Batasan"),
    (r"konteks", "3 Konteks dan Lingkup"),
    (r"strategi", "4 Strategi Solusi"),
    (r"blok bangunan", "5 Blok Bangunan"),
    (r"runtime", "6 Runtime"),
    (r"penempatan", "7 Penempatan"),
    (r"lintas", "8 Konsep Lintas-Bidang"),
    (r"keputusan", "9 Keputusan Arsitektur"),
    (r"kualitas|mutu", "10 Persyaratan Kualitas"),
    (r"risiko", "11 Risiko dan Utang Teknis"),
    (r"glosarium", "12 Glosarium"),
]
CARD_LABELS = ["Tujuan", "Siapa", "Jalur menu", "Langkah", "Bila tidak berhasil", "Ketersediaan"]
RISK_WORDS = re.compile(
    r"\b(NIK|kata sandi|password|token|bypass|celah|injeksi|injection|XSS|IDOR|CSRF bypass|"
    r"tanpa autentikasi|belum ditambal|terbuka di produksi)\b", re.I)
TRACE_OUT = ""
EN_STOP = re.compile(r"\b(the|and|of|is|are|with|which|does not|not)\b")


class Report:
    def __init__(self) -> None:
        self.items: list[tuple[str, int, str, str]] = []

    def add(self, level: str, line: int, code: str, msg: str) -> None:
        self.items.append((level, line, code, msg))

    def print(self) -> int:
        errs = 0
        for level, line, code, msg in sorted(self.items, key=lambda x: (x[1], x[2])):
            errs += level == "ERROR"
            where = f"L{line}" if line else "—"
            print(f"{level:5} {where:>6}  [{code}]  {msg}")
        warns = sum(1 for i in self.items if i[0] == "WARN")
        print(f"\n{errs} ERROR, {warns} WARN.")
        if errs:
            print("Perbaiki semua ERROR di sumber Markdown, lalu jalankan ulang perintah yang sama.")
        return 1 if errs else 0


# --------------------------------------------------------------------------- pembantu

def split_row(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    cells, cur, tick = [], "", False
    for ch in s:
        if ch == "`":
            tick = not tick
        if ch == "|" and not tick:
            cells.append(cur.strip())
            cur = ""
        else:
            cur += ch
    cells.append(cur.strip())
    return cells


def find_tables(lines: list[str]) -> list[dict]:
    """Tabel pipa: {start, header, rows:[(lineno, cells)]}. Lewati isi blok kode."""
    tables, i, fence = [], 0, False
    while i < len(lines):
        if lines[i].lstrip().startswith("```"):
            fence = not fence
        if not fence and lines[i].lstrip().startswith("|") and i + 1 < len(lines) \
                and re.match(r"^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$", lines[i + 1]):
            hdr = split_row(lines[i])
            rows, j = [], i + 2
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                rows.append((j + 1, split_row(lines[j])))
                j += 1
            tables.append({"start": i + 1, "header": hdr, "rows": rows})
            i = j
            continue
        i += 1
    return tables


def mermaid_blocks(text: str) -> list[tuple[int, str]]:
    out = []
    for m in re.finditer(r"```mermaid[ \t]*\n(.*?)\n```", text, re.S):
        out.append((text.count("\n", 0, m.start()) + 2, m.group(1)))
    return out


def section_ranges(lines: list[str]) -> list[tuple[str, int, int]]:
    """(judul H1/H2, baris awal, baris akhir) — untuk menyempitkan pemeriksaan ke satu bab."""
    heads = [(i + 1, re.match(r"^(#{1,2})\s+(.*)", l)) for i, l in enumerate(lines)]
    heads = [(n, m.group(2).strip()) for n, m in heads if m]
    out = []
    for k, (n, t) in enumerate(heads):
        end = heads[k + 1][0] - 1 if k + 1 < len(heads) else len(lines)
        out.append((t, n, end))
    return out


def norm_route(p: str) -> str:
    p = p.split("?")[0].rstrip(".,;:)")
    p = re.sub(r":\w+|\{\w+\}|\[\w+\]", ":p", p)
    p = p.rstrip("/") or "/"
    return p if p.startswith("/api") else "/api" + p


def web_pages(repo: Path) -> list[re.Pattern[str]]:
    root = repo / "apps/web/src/app"
    pats = []
    for f in root.rglob("page.tsx"):
        rel = f.parent.relative_to(root).as_posix()
        rel = re.sub(r"\([^/]+\)/?", "", rel)  # grup rute (x) tidak masuk URL
        parts = [("[^/]+" if re.fullmatch(r"\[.*\]", s) else re.escape(s)) for s in rel.split("/") if s]
        pats.append(re.compile("^/" + "/".join(parts) + "$"))
    return pats


def web_source_text(repo: Path) -> str:
    chunks = []
    for ext in ("*.ts", "*.tsx"):
        for f in (repo / "apps/web/src").rglob(ext):
            if "node_modules" in f.parts or f.name.endswith(".test.ts") or f.name.endswith(".test.tsx"):
                continue
            try:
                chunks.append(f.read_text(encoding="utf-8", errors="ignore"))
            except OSError:
                pass
    return "\n".join(chunks)


_WEB_FILES: list[tuple[str, str]] = []


def label_hits(repo: Path, label: str, limit: int = 3) -> list[str]:
    """berkas:baris tempat teks itu muncul di apps/web/src (untuk jejak sumber)."""
    if not _WEB_FILES:
        for ext in ("*.ts", "*.tsx"):
            for f in (repo / "apps/web/src").rglob(ext):
                if "node_modules" in f.parts or ".test." in f.name:
                    continue
                try:
                    _WEB_FILES.append((f.relative_to(repo).as_posix(), f.read_text(encoding="utf-8", errors="ignore")))
                except OSError:
                    pass
    # Cocokkan sebagai teks UTUH: literal string ("Label", 'Label', `Label`) atau teks JSX (>Label< atau
    # sebaris sendiri). Substring bebas terlalu longgar: 'Keluar' cocok dengan puluhan tempat lain.
    # Label kolom wajib di layar memuat penanda " *" (mis. "Ayat Awal *"); terima akhiran itu.
    # `[ \t]*` after the quote/angle bracket: a label often sits after an icon in
    # JSX (`<Plus ... /> Buat Perjanjian Kinerja`), where the old pattern saw the
    # `/` before it and reported a real screen label as missing.
    rx = re.compile(
        r"(?:[\"'`>][ \t]*\n?[ \t]*|^[ \t]*)" + re.escape(label) + r"\s*\*?(?:[\"'`<]|[ \t]*$)", re.M
    )
    out = []
    for name, body in _WEB_FILES:
        m = rx.search(body)
        if m:
            out.append(f"{name}:{body[: m.start()].count(chr(10)) + 1}")
            if len(out) >= limit:
                break
    return out


def api_source_text(repo: Path) -> str:
    chunks = []
    for f in (repo / "apps/api/src").rglob("*.ts"):
        if f.name.endswith(".test.ts"):
            continue
        try:
            chunks.append(f.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            pass
    return "\n".join(chunks)


# --------------------------------------------------------------------------- pemeriksaan umum

def check_common(text: str, lines: list[str], r: Report, final: bool) -> None:
    for n, l in enumerate(lines, 1):
        if re.search(r"\[ISI[^\]]*\]|\bTODO\b|\bTBD\b", l):
            r.add("ERROR" if final else "WARN", n, "isian-tersisa", "penanda [ISI]/TODO/TBD masih ada")
        if "\\`" in l:
            r.add("ERROR", n, "backtick-lolos",
                  "tanda ` yang di-escape (\\`) — tulis `/jalur` biasa, bukan `\\`/jalur\\``")
        if re.search(r"(?<![A-Za-z])(\w{3,}) \1(?![A-Za-z])", l) and not l.lstrip().startswith(("|", "```")):
            m = re.search(r"(?<![A-Za-z])(\w{3,}) \1(?![A-Za-z])", l)
            r.add("WARN", n, "kata-ganda", f"kata berulang: '{m.group(0)}'")

    tables = find_tables(lines)
    for t in tables:
        w = len(t["header"])
        if any(not h for h in t["header"]):
            r.add("ERROR", t["start"], "tabel-kepala-kosong", "kepala tabel memuat sel kosong")
        seen: dict[str, int] = {}
        for ln, cells in t["rows"]:
            if len(cells) != w:
                r.add("ERROR", ln, "tabel-kolom", f"{len(cells)} kolom, kepala {w} kolom")
            key = "|".join(cells)
            if key in seen:
                r.add("ERROR", ln, "tabel-baris-ganda", f"baris sama persis dengan baris L{seen[key]}")
            seen[key] = ln
    # blok mermaid
    for start, src in mermaid_blocks(text):
        if not re.match(r"\s*%%\s*caption:\s*\S", src):
            r.add("ERROR", start, "diagram-keterangan", "baris pertama blok mermaid harus '%% caption: …'")
        if re.search(r"^\s*(flowchart|graph)\b", src, re.M):
            subs = set(re.findall(r"^\s*subgraph\s+(\w+)", src, re.M))
            nodes = set(re.findall(r"^\s*(\w+)\s*[\[\(\{>]", src, re.M))
            for dup in sorted(subs & nodes):
                r.add("ERROR", start, "diagram-id-ganda",
                      f"'{dup}' dipakai sebagai id subgraph DAN id simpul — salah satunya hilang saat dirender")
        if "sequenceDiagram" in src:
            for ln_off, l in enumerate(src.split("\n")):
                if re.match(r"^\s*(Note|\w+\s*-{1,2}>{1,2}[+-]?\s*\w+\s*:)", l) and ";" in l.split(":", 1)[-1]:
                    r.add("ERROR", start + ln_off, "diagram-titik-koma",
                          "titik koma di teks sequenceDiagram memecah pernyataan — pakai koma")
    # data sensitif mekanis
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "naskah.md"
        tmp.write_text(text, encoding="utf-8")
        for n, key, why, snip in scan_sensitive.scan(tmp):
            r.add("ERROR", n, f"sensitif-{key}", f"{why} ({snip})")


def check_routes(text: str, lines: list[str], repo: Path, r: Report) -> None:
    idx = collect_facts.route_index(repo)
    known = {(x["method"], norm_route(x["path"])) for x in idx}
    known_paths = {p for _, p in known}
    rx = re.compile(r"\b(GET|POST|PUT|PATCH|DELETE)\s+(/[A-Za-z0-9_\-./:{}\[\]?=&]+)")
    for n, l in enumerate(lines, 1):
        for m in rx.finditer(l):
            method, path = m.group(1), norm_route(m.group(2))
            if (method, path) in known:
                continue
            hint = " (alamat ini ada tetapi dengan metode lain)" if path in known_paths else ""
            near = sorted({p for _, p in known if p.rsplit("/", 1)[0] == path.rsplit("/", 1)[0]})[:4]
            extra = f"; yang ada di sekitarnya: {', '.join(near)}" if near else ""
            r.add("ERROR", n, "rute-tak-ada",
                  f"{method} {m.group(2)} tidak terdaftar di router API{hint}{extra}. "
                  f"Buka berkas *.routes.ts modulnya dan salin alamat yang sebenarnya.")


def check_numbers(lines: list[str], facts: dict, r: Report) -> None:
    a, p, w, j, e = facts["api"], facts["prisma"], facts["web"], facts["jobs"], facts["env"]
    want = [
        (r"(\d[\d.]*)\s+modul API", a["module_count"], "modul API"),
        (r"(\d[\d.]*)\s+model(?:\s+data)?\b", p.get("model_count"), "model Prisma"),
        (r"(\d[\d.]*)\s+enum\b", p.get("enum_count"), "enum"),
        (r"(\d[\d.]*)\s+kode peran", p.get("role_code_count"), "kode peran"),
        (r"(\d[\d.]*)\s+halaman web", w.get("page_count"), "halaman web"),
        (r"(\d[\d.]*)\s+kunci", e.get("total_keys"), "kunci variabel lingkungan"),
        (r"(\d[\d.]*)\s+hulu rute", a.get("handler_count_approx"), "hulu rute API"),
    ]
    sched_ok = {j["cron_entries"], len(j["scheduled_job_files"])}
    for n, l in enumerate(lines, 1):
        # A revision-history row records the number as it was at that commit
        # ("~1.413 hulu rute API (dari ~1.412)"); it is history, not a claim
        # about the current tree, so the number gate must not rewrite it.
        if re.match(r"^\s*\|\s*\d+\.\d+\s*\|", l):
            continue
        for rx, val, label in want:
            for m in re.finditer(rx, l):
                got = int(m.group(1).replace(".", ""))
                if val is not None and got != val:
                    r.add("ERROR", n, "angka-salah", f"'{m.group(0)}' — facts.json mengukur {val} {label}")
        for m in re.finditer(r"(?<![\d.])(\d+)\s+(?:pekerjaan|job)\s+terjadwal", l, re.I):
            if l.startswith("#"):
                continue
            if int(m.group(1)) not in sched_ok:
                r.add("ERROR", n, "angka-salah",
                      f"'{m.group(0)}' — scheduler.ts punya {j['cron_entries']} entri cron atas "
                      f"{len(j['scheduled_job_files'])} berkas job (berkas *.job.ts: {j['count']}, "
                      f"yang tak dijadwalkan: {', '.join(j['job_files_not_scheduled']) or '-'})")
        ctx = " ".join(lines[max(0, n - 3): n + 2])
        if re.search(r"\b\d+\s+dari\s+93\b|\b\d+\s+of\s+93\b|tata letak lengkap", l) \
                and not re.search(r"lima bagian|empat berkas", ctx):
            r.add("WARN", n, "ukuran-tata-letak",
                  f"sebut definisinya: {a['four_file_modules']} modul punya empat berkas, "
                  f"{a['five_part_modules']} punya lima bagian (dengan index.ts; ukuran known-issues.md)")


# --------------------------------------------------------------------------- dokumen teknis

def check_teknis(text: str, lines: list[str], repo: Path, facts: dict, r: Report) -> None:
    secs = section_ranges(lines)
    titles = [(t.lower(), a, b) for t, a, b in secs]

    # kerangka arc42: 12 bab, urutan benar
    last = 0
    pos: dict[str, tuple[int, int]] = {}
    for pat, name in ARC42:
        hit = next(((a, b) for t, a, b in titles if re.match(r"^\d+\.?\s", t) and re.search(pat, t) and a > last), None)
        if not hit:
            r.add("ERROR", 0, "arc42-bab-hilang", f"bab '{name}' tidak ditemukan (atau urutannya salah)")
        else:
            pos[name] = hit
            last = hit[0]
    if not any("ringkasan eksekutif" in t for t, _, _ in titles):
        r.add("ERROR", 0, "ringkasan-eksekutif", "tidak ada bab 'Ringkasan Eksekutif'")
    for letter in "ABCDE":
        if not any(re.match(rf"^lampiran {letter.lower()}\b", t) for t, _, _ in titles):
            r.add("ERROR", 0, "lampiran-hilang", f"Lampiran {letter} tidak ada")

    # C4: tiga tingkat, tiap diagram berlabel
    caps = [(ln, (re.match(r"\s*%%\s*caption:\s*(.+)", s) or [None, ""])[1], s) for ln, s in mermaid_blocks(text)]
    for lvl, word in (("C4-1", "konteks"), ("C4-2", "kontainer"), ("C4-3", "komponen")):
        hit = [c for c in caps if c[1].startswith(lvl)]
        if not hit:
            r.add("ERROR", 0, "c4-hilang",
                  f"tidak ada diagram bertanda '{lvl}' ({word}) — mulai keterangan dengan '{lvl}: …'")
        for ln, cap, src in hit:
            if "-->" in src:
                unl = [l for l in src.split("\n") if re.search(r"-->(?!\|)|---(?!\|)", l) and "|" not in l
                       and not l.strip().startswith(("%%", "subgraph"))]
                if unl:
                    r.add("WARN", ln, "c4-panah-tanpa-label",
                          f"{len(unl)} panah tanpa label pada diagram {lvl} — C4 mewajibkan tiap hubungan diberi label")

    # berkas job yang tidak dijadwalkan tak boleh muncul sebagai pekerjaan terjadwal
    for f in facts["jobs"]["job_files_not_scheduled"]:
        stem = f[:-3]
        for n, l in enumerate(lines, 1):
            if stem in l:
                r.add("WARN", n, "job-tak-terjadwal",
                      f"{stem} tidak dijadwalkan scheduler.ts (dipanggil dari tempat lain) — jangan tulis sebagai pekerjaan terjadwal")

    # rute, angka
    check_routes(text, lines, repo, r)
    check_numbers(lines, facts, r)

    # ERD: nama entitas harus model Prisma yang nyata
    schema = (repo / "apps/api/prisma/schema.prisma").read_text(encoding="utf-8", errors="ignore")
    models = {m.lower(): m for m in re.findall(r"^model\s+(\w+)\s*\{", schema, re.M)}
    for ln, src in mermaid_blocks(text):
        if "erDiagram" in src:
            ents = set(re.findall(r"^\s*\"?(\w+)\"?\s+[|}o][|o]--", src, re.M)) | set(re.findall(r"--[|o][{|]\s*\"?(\w+)\"?\s*:", src, re.M))
            for ent in sorted(ents):
                if ent.replace("_", "").lower() not in models:
                    cand = [v for k, v in models.items() if ent.split("_")[0].lower() in k][:5]
                    r.add("ERROR", ln, "erd-model-fiktif",
                          f"entitas '{ent}' bukan model di schema.prisma; kandidat: {', '.join(cand) or '-'}. "
                          f"Baca schema.prisma dan pakai nama modelnya.")

    # Bab 9: tepat satu baris per berkas keputusan
    dec_files = sorted(p.name for p in (repo / ".claude/memory/decisions").glob("*.md"))
    if "9 Keputusan Arsitektur" in pos:
        a, b = pos["9 Keputusan Arsitektur"]
        count: dict[str, int] = {f: 0 for f in dec_files}
        for f in dec_files:
            count[f] = len(re.findall(re.escape(f), "\n".join(lines[a - 1:b])))
        for f, c in count.items():
            if c == 0:
                r.add("ERROR", a, "keputusan-hilang", f"{f} tidak muncul di bab 9")
            elif c > 1:
                r.add("ERROR", a, "keputusan-ganda", f"{f} muncul {c} kali di bab 9 — satu berkas, satu baris")
        t9 = [t for t in find_tables(lines) if a <= t["start"] <= b]
        for t in t9:
            for ln, cells in t["rows"]:
                if cells and len(cells) >= 2:
                    words = len(cells[1].split())
                    if words > 40:
                        r.add("WARN", ln, "ringkasan-panjang", f"ringkasan {words} kata; tulis ulang ≤ 30 kata")

    # Bab 10: skenario terukur
    if "10 Persyaratan Kualitas" in pos:
        a, b = pos["10 Persyaratan Kualitas"]
        t10 = [t for t in find_tables(lines) if a <= t["start"] <= b]
        hdr = " ".join(t10[0]["header"]).lower() if t10 else ""
        if not t10 or not all(k in hdr for k in ("ukuran", "bukti", "status")):
            r.add("ERROR", a, "mutu-skenario",
                  "tabel bab 10 harus berkolom: Mutu | Skenario (pemicu → respons) | Ukuran/ambang | Bukti | Status. "
                  "Skenario tanpa ukuran bukan skenario — itu keinginan.")
        for t in t10[:1]:
            for ln, cells in t["rows"]:
                if len(cells) >= 3 and not re.search(r"\d", cells[2]) and "belum" not in " ".join(cells).lower():
                    r.add("WARN", ln, "mutu-tanpa-angka", "kolom ukuran tanpa angka/ambang dan tanpa 'belum ditetapkan'")

    # Bab 11: topik peka + apa yang belum ada di produksi
    if "11 Risiko dan Utang Teknis" in pos:
        a, b = pos["11 Risiko dan Utang Teknis"]
        for n in range(a, b + 1):
            l = lines[n - 1]
            m = RISK_WORDS.search(l)
            if m and not l.lstrip().startswith(">"):
                r.add("WARN", n, "risiko-topik-peka",
                      f"'{m.group(0)}' di bab risiko — apakah ini kelemahan yang MASIH terbuka di produksi? "
                      f"Bila ya atau tak yakin: hapus baris ini dan laporkan ke pengguna (aturan kepekaan).")
            if re.search(r"\d[\d.,]*\s+(rute|bucket|res\.json|POST|tabel)", l) and re.search(r"produksi|akses|izin|otoris", l, re.I):
                r.add("WARN", n, "risiko-rinci",
                      "angka rinci tentang kontrol akses/otorisasi — cukup tulis kategori dan tingkat dampak")
    for n, l in enumerate(lines, 1):
        if re.search(r"produksi.{0,60}(belum (memuat|menerima|dirilis|dijalankan)|tertinggal|menyusul)", l, re.I) \
                or re.search(r"(belum|tidak).{0,40}(di produksi)", l, re.I):
            r.add("WARN", n, "produksi-tertinggal",
                  "menyebut apa yang belum ada di produksi. progress.md sengaja tidak mencatat perbaikan mana yang "
                  "belum di produksi (itu daftar celah). Tulis status per KEMAMPUAN, bukan per perbaikan atau nomor PR.")

    # Bab 5.3: setiap modul disebut (kalau tidak, ranah itu tampak lebih kecil daripada kenyataan)
    for t, a, b in secs:
        pass
    sec53 = re.search(r"##\s+5\.3.*?(?=\n#{1,2}\s)", text, re.S)
    if sec53:
        missing = [m["name"] for m in facts["api"]["modules"] if f"`{m['name']}`" not in sec53.group(0)]
        if missing:
            r.add("WARN", text[: sec53.start()].count("\n") + 1, "modul-tak-tercantum",
                  f"{len(missing)} modul tak disebut di tabel ranah 5.3: {', '.join(missing[:12])}")

    # Lampiran A: jumlah baris = jumlah modul, dan tiap baris cocok dengan kode
    for t, a, b in secs:
        if re.match(r"^lampiran a\b", t.lower()):
            ts = [x for x in find_tables(lines) if a <= x["start"] <= b]
            if ts:
                rows = len(ts[0]["rows"])
                if rows != facts["api"]["module_count"]:
                    r.add("ERROR", a, "lampiran-a-jumlah",
                          f"{rows} baris, facts.json memuat {facts['api']['module_count']} modul")
                by_name = {m["name"]: m for m in facts["api"]["modules"]}
                for lineno, cells in ts[0]["rows"]:
                    if len(cells) < 3:
                        continue
                    name = cells[0].strip("` ")
                    mod = by_name.get(name)
                    if not mod:
                        r.add("ERROR", lineno, "lampiran-a-modul",
                              f"modul '{name}' tidak ada di facts.json (modul tak dikenal / salah nama)")
                        continue
                    # handler: angka di dokumen harus sama dengan hitungan kode
                    try:
                        got = int(cells[2].strip())
                    except ValueError:
                        continue
                    if got != mod["handlers"]:
                        r.add("ERROR", lineno, "lampiran-a-handler",
                              f"modul '{name}': {got} handler, kode memuat {mod['handlers']} "
                              f"(hitung router.get/post/put/patch/delete di *.routes.ts)")
                    # mount: alamat yang dicetak harus alamat yang dipasang di app.ts
                    doc_mount = cells[1].strip()
                    real = ", ".join(mod["mount"]) if mod["mount"] else "tidak ter-mount"
                    if doc_mount.replace("`", "") != real:
                        r.add("ERROR", lineno, "lampiran-a-mount",
                              f"modul '{name}': mount '{doc_mount}', app.ts memasang '{real}'")
                    # layering: kolom Prisma harus mencerminkan kode
                    doc_lay = cells[4].strip() if len(cells) > 4 else ""
                    is_bad = doc_lay.lower().startswith("prisma")
                    if is_bad != mod["prisma_in_route_or_controller"]:
                        want = "Prisma di route/controller" if mod["prisma_in_route_or_controller"] else "ok"
                        r.add("ERROR", lineno, "lampiran-a-layering",
                              f"modul '{name}': layering '{doc_lay}', kode menandai '{want}'")

    # jumlah bahasa / kalimat janggal
    for n, l in enumerate(lines, 1):
        if re.search(r"tiga bahasa \([^)]*,[^)]*,[^)]*,[^)]*\)", l):
            r.add("WARN", n, "hitungan-daftar", "'tiga bahasa' diikuti empat butir — periksa daftarnya")
        if not l.lstrip().startswith(("|", "```", "#", "-", "*", ">")) and len(EN_STOP.findall(l)) >= 3:
            r.add("WARN", n, "bahasa-inggris", "kalimat berbahasa Inggris di dokumen berbahasa Indonesia")


# --------------------------------------------------------------------------- panduan pengguna

def check_pengguna(text: str, lines: list[str], repo: Path, facts: dict, r: Report) -> None:
    web = web_source_text(repo)
    api = api_source_text(repo)
    pages = web_pages(repo)
    secs = section_ranges(lines)
    t2 = bool(re.search(r"\bT2\b", text[:3000]))
    in_rev = False

    for n, l in enumerate(lines, 1):
        if re.match(r"^#\s+Riwayat Revisi", l):
            in_rev = True
        elif re.match(r"^#\s+", l):
            in_rev = False
        if in_rev:
            continue
        if re.search(r"#\d{2,4}\b", l):
            r.add("ERROR", n, "nomor-pr", "nomor PR/isu tidak berarti bagi pembaca — hapus")
        if re.search(r"\(\s*[A-Z][A-Z_]{3,}\s*\)", l) or re.search(r"\b(PENDING|APPROVED|REJECTED|COMPLETED|CANCELLED)\b", l):
            r.add("ERROR", n, "nama-enum",
                  "nama enum basis data di teks untuk pengguna — pakai label yang tampil di layar")
        if re.search(r"\b(403|404|500)\b", l) and not l.lstrip().startswith("|"):
            r.add("WARN", n, "kode-http", "kode HTTP bukan bahasa pengguna — pakai pesan yang tampil di layar")
        if re.search(r"`main`|\bcabang\b|\bcommit\b|\bstaging\b", l) and not re.search(r"Riwayat|versi aplikasi", l, re.I) \
                and not l.startswith("> ⚠"):
            r.add("WARN", n, "istilah-pengembang",
                  "istilah pengembang (main/cabang/commit/staging) di teks pengguna — tulis "
                  "'sudah tersedia di aplikasi' / 'belum tersedia di aplikasi yang Anda pakai'")
        # Jalur gambar (`screens/…/data-siswa.png`) memuat "siswa" tanpa salah:
        # itu nama berkas tangkapan, bukan prosa. Buang dulu sebelum memeriksa.
        prose = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", l)
        if re.search(r"\bsiswa\b|\bmurid\b", prose, re.I) and "**" not in l and '"' not in l and not l.lstrip().startswith("|"):
            r.add("WARN", n, "istilah-santri",
                  "'siswa/murid' di prosa — keputusan yayasan: santri (kecuali mengutip label layar)")

    # jalur menu: URL harus halaman web nyata; tiap label harus ada di kode
    trace: list[tuple[int, str, list[str]]] = []
    generic = {"avatar", "header", "menu kiri", "ikon lonceng", "lonceng"}
    for n, l in enumerate(lines, 1):
        if l.startswith("**Jalur menu.**"):
            for u in re.findall(r"`(/[A-Za-z0-9_\-/\[\]]*)`", re.sub(r"`[^`]*\[\][^`]*`", "", l)):
                if u != "/" and not any(p.match(u) for p in pages):
                    r.add("ERROR", n, "halaman-tak-ada", f"{u} bukan halaman di apps/web/src/app")
            rest = re.sub(r"\(\s*`[^`]*`\s*\)", "", l.replace("**Jalur menu.**", ""))  # (`/jalur`) → dibuang
            first = re.split(r"\.\s|\s—\s", re.sub(r"`[^`]*`", "", rest).strip())[0]
            for lab in [x.strip(" .*") for x in first.split("→") if x.strip(" .*")]:
                if lab.lower() in generic or len(lab) < 4:
                    continue
                hits = label_hits(repo, lab)
                trace.append((n, lab, hits))
                if not hits:
                    r.add("ERROR", n, "label-menu", f"'{lab}' tidak ditemukan di apps/web/src — cocokkan dengan role-menus.ts")
    # tombol dan kolom tebal di langkah
    for n, l in enumerate(lines, 1):
        if re.match(r"^\s*\d+\.\s", l):
            for b in re.findall(r"\*\*([^*]+)\*\*", l):
                for part in [x.strip() for x in b.split("→")]:
                    if len(part) < 3 or part.lower() in generic:
                        continue
                    hits = label_hits(repo, part)
                    trace.append((n, part, hits))
                    if not hits:
                        r.add("ERROR", n, "label-layar",
                              f"**{part}** tidak ditemukan di apps/web/src — nama tombol/kolom harus persis seperti di layar")
    if TRACE_OUT:
        rows = ["# Jejak sumber label", "", "Tiap label tebal/menu di panduan dan tempat ia muncul di kode web. "
                "Periksa bahwa berkas itu memang layar yang dimaksud (label yang sama bisa muncul di layar lain).", "",
                "| Baris naskah | Label | Ditemukan di |", "|---|---|---|"]
        for n, lab, hits in trace:
            rows.append(f"| {n} | {lab} | {', '.join(f'`{h}`' for h in hits) or '**TIDAK ADA**'} |")
        Path(TRACE_OUT).write_text("\n".join(rows) + "\n", encoding="utf-8")
    # pesan yang dikutip
    for t in find_tables(lines):
        if t["header"] and t["header"][0].lower().startswith("yang terlihat"):
            for ln, cells in t["rows"]:
                for q in re.findall(r"[\"“]([^\"”]{6,})[\"”]", cells[0] if cells else ""):
                    q = q.strip(" .…")
                    if q not in web and q not in api:
                        r.add("ERROR", ln, "pesan-karangan",
                              f"pesan \"{q}\" tidak ada di kode web maupun API — salin dari toast/Alert/ApiError, jangan mengarang")
    for n, l in enumerate(lines, 1):
        for q in re.findall(r"muncul pesan\s+\"([^\"]+)\"|Pesan\s+\"([^\"]+)\"", l):
            q = (q[0] or q[1]).strip(" .")
            if q and q not in web and q not in api:
                r.add("ERROR", n, "pesan-karangan", f"pesan \"{q}\" tidak ada di kode")

    # kelengkapan kartu tugas
    for k, (title, a, b) in enumerate(secs):
        body = "\n".join(lines[a - 1:b])
        if "**Langkah.**" in body and title:
            for lab in CARD_LABELS:
                if f"**{lab}" not in body:
                    r.add("ERROR", a, "kartu-tak-lengkap", f"kartu '{title}' tidak memiliki bagian **{lab}.**")
            if not re.search(r"\*\*Hasil", body):
                r.add("ERROR", a, "kartu-tak-lengkap", f"kartu '{title}' tidak memiliki **Hasilnya, …**")
            if t2 and "⚠" not in body:
                r.add("ERROR", a, "kartu-t2-tanpa-tanda", f"dokumen bertingkat T2 tetapi kartu '{title}' tanpa ⚠")
            steps = re.findall(r"^\s*\d+\.\s.*$", body, re.M)
            if len(steps) < 2:
                r.add("WARN", a, "kartu-langkah-sedikit", f"kartu '{title}' hanya {len(steps)} langkah bernomor")
            for s in steps:
                if len(re.findall(r"\b(lalu|kemudian|setelah itu|dan klik)\b", s)) >= 2:
                    r.add("WARN", a, "satu-tindakan", f"lebih dari satu tindakan dalam satu langkah: '{s.strip()[:70]}…'")



# --------------------------------------------------------------------------- gambar dan alur proses

IMG_RE = re.compile(r"^!\[([^\]]*)\]\(([^)\s]+)\)(\{[^}]*\})?\s*$")


def png_dims(path: Path) -> tuple[int, int] | None:
    try:
        head = path.read_bytes()[:24]
        if head[:8] != b"\x89PNG\r\n\x1a\n":
            return None
        return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
    except OSError:
        return None


def check_images(text: str, lines: list[str], md_dir: Path, kind: str, r: Report) -> None:
    """Gambar: ada, beralt, berketerangan, ringan, berasal dari tangkapan yang lolos. Kartu T1 bergambar.
    Bagian `<!-- alur: … -->` (storyboard): tiap tahap punya gambar, siapa, yang terjadi, giliran berikutnya."""
    manifest: dict[str, dict] = {}
    mp = md_dir / "screens" / "manifest.json"
    if mp.is_file():
        manifest = {e["path"]: e for e in json.loads(mp.read_text(encoding="utf-8"))}
    fence = False
    imgs_by_line: dict[int, str] = {}
    for n, l in enumerate(lines, 1):
        if l.lstrip().startswith("```"):
            fence = not fence
        if fence:
            continue
        m = IMG_RE.match(l.strip())
        if not m:
            continue
        alt, rel = m.group(1), m.group(2)
        imgs_by_line[n] = rel
        f = md_dir / rel
        if not f.is_file():
            r.add("ERROR", n, "gambar-tak-ada", f"{rel} tidak ada (jalur relatif terhadap naskah). Tangkap dulu, lalu "
                  "`screens_manifest.py select`")
            continue
        if len(alt.strip()) < 12:
            r.add("ERROR", n, "gambar-tanpa-alt", "teks alternatif kosong/terlalu pendek — tulis 'Gambar N. apa yang tampak'")
        nxt = next((x for x in lines[n:n + 3] if x.strip()), "")
        if not re.match(r"^\*Gambar \d+", nxt.strip()):
            r.add("ERROR", n, "gambar-tanpa-keterangan",
                  "baris berikutnya harus keterangan miring '*Gambar N. …*' (alt tidak dicetak di .docx)")
        kb = f.stat().st_size // 1024
        if kb > 1024:
            r.add("ERROR", n, "gambar-terlalu-besar", f"{rel}: {kb} KB — jalankan screens_manifest.py select (mengecilkan)")
        elif kb > 400:
            r.add("WARN", n, "gambar-berat", f"{rel}: {kb} KB")
        d = png_dims(f)
        if d and d[0] > 1600:
            r.add("WARN", n, "gambar-lebar", f"{rel}: lebar {d[0]} px (maksimum wajar 1280)")
        if rel.startswith("screens/") and manifest and rel not in manifest:
            r.add("ERROR", n, "gambar-bukan-hasil-capture",
                  f"{rel} tidak ada di screens/manifest.json — gambar harus berasal dari tangkapan yang lolos (select)")
        if rel.startswith("screens/") and not manifest:
            r.add("ERROR", n, "manifes-tak-ada", "screens/manifest.json tidak ada — jalankan screens_manifest.py select")

    # Dua gambar dari halaman yang sama biasanya salah satu kartu menunjuk halaman keliru
    # ("Papan Peringkat" dan "Kelola Target" sama-sama /ibadah). Sumber: `url` di manifes.
    by_url: dict[str, list[int]] = {}
    for ln, rel in imgs_by_line.items():
        e = manifest.get(rel)
        if e and e.get("url"):
            by_url.setdefault(e["url"], []).append(ln)
    for url, lns in sorted(by_url.items()):
        if len(lns) > 1:
            r.add("WARN", lns[0], "gambar-halaman-kembar",
                  f"{len(lns)} gambar diambil dari halaman yang sama ({url}) — periksa apakah salah satunya "
                  "butuh halaman lain, lalu arahkan langkah alurnya dan tangkap ulang")

    if kind != "pengguna":
        return
    secs = section_ranges(lines)
    # Kartu tugas T1 (tanpa ⚠) wajib bergambar; kartu ⚠ yang sudah bergambar hasil tangkapan patut dinaikkan ke T1
    for title, a, b in secs:
        body_lines = range(a, b + 1)
        body = "\n".join(lines[a - 1:b])
        if "**Langkah.**" in body:
            has_warn = "⚠" in body
            n_imgs = sum(1 for i in body_lines if i in imgs_by_line)
            if not has_warn and n_imgs == 0:
                r.add("ERROR", a, "kartu-t1-tanpa-gambar",
                      f"kartu '{title}' tanpa ⚠ (T1) harus memuat tangkapan layar hasil aplikasi berjalan")
            if has_warn and n_imgs:
                r.add("WARN", a, "kartu-bergambar-masih-t2",
                      f"kartu '{title}' bergambar hasil tangkapan tetapi masih ⚠ — cabut ⚠ bila langkahnya sudah dijalankan (T1)")
            if n_imgs > 4:
                r.add("WARN", a, "kartu-terlalu-banyak-gambar",
                      f"kartu '{title}': {n_imgs} gambar — satu per layar penentu; pecah kartunya")
    # Storyboard proses bisnis
    for i, l in enumerate(lines, 1):
        m = re.match(r"^<!--\s*alur:\s*([\w-]+)\s*-->", l)
        if not m:
            continue
        end = next((j for j in range(i, len(lines)) if re.match(r"^#{1,2}\s", lines[j])), len(lines))
        block = "\n".join(lines[i:end])
        stages = re.split(r"(?m)^###\s+", block)[1:]
        if len(stages) < 2:
            r.add("ERROR", i, "alur-tahap-kurang", f"alur '{m.group(1)}' hanya {len(stages)} tahap (### Tahap N — …); minimal 2")
        for k, st in enumerate(stages, 1):
            head = st.split("\n", 1)[0]
            for lab in ("Siapa", "Yang terjadi", "Giliran berikutnya"):
                if f"**{lab}" not in st:
                    r.add("ERROR", i, "alur-tahap-tak-lengkap", f"alur '{m.group(1)}', tahap {k} ('{head[:40]}'): tidak ada **{lab}.**")
            if not re.search(r"(?m)^!\[", st):
                r.add("ERROR", i, "alur-tahap-tanpa-gambar", f"alur '{m.group(1)}', tahap {k} ('{head[:40]}'): tanpa tangkapan layar")

# --------------------------------------------------------------------------- utama

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source")
    ap.add_argument("--kind", required=True, choices=["teknis", "pengguna"])
    ap.add_argument("--repo", required=True, help="folder repo cipansor (untuk mencocokkan rute, label, model)")
    ap.add_argument("--facts", help="facts.json; bila tak diberikan, diukur ulang dari --repo")
    ap.add_argument("--final", action="store_true")
    ap.add_argument("--trace", help="tulis jejak sumber label (panduan pengguna) ke berkas .md ini")
    a = ap.parse_args()
    global TRACE_OUT
    TRACE_OUT = a.trace or ""

    src, repo = Path(a.source), Path(a.repo).resolve()
    if not src.is_file() or not (repo / "apps/api/src").is_dir():
        print("ERROR: naskah atau repo tidak ditemukan", file=sys.stderr)
        return 2
    text = src.read_text(encoding="utf-8")
    lines = text.split("\n")
    facts = json.loads(Path(a.facts).read_text(encoding="utf-8")) if a.facts else collect_facts.collect(repo)
    if "four_file_modules" not in facts["api"] or "cron_entries" not in facts["jobs"]:
        print("ERROR: facts.json dibuat oleh collect_facts.py versi lama — ukur ulang", file=sys.stderr)
        return 2

    r = Report()
    check_common(text, lines, r, a.final)
    check_images(text, lines, src.parent, a.kind, r)
    if a.kind == "teknis":
        check_teknis(text, lines, repo, facts, r)
    else:
        check_numbers(lines, facts, r)
        check_pengguna(text, lines, repo, facts, r)
    return r.print()


if __name__ == "__main__":
    sys.exit(main())
