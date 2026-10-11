#!/usr/bin/env python3
"""Generate a complete page gallery from a visual-QA sweep.

Every distinct App Router path captured by `apps/web/scripts/screenshot-all.ts`
becomes a compact WebP thumbnail under `docs/images/pages/`, grouped by its
top-level module. Output: `docs/_gallery.md` and the thumbnails, both gitignored: the gallery is
built locally when needed and never committed (decided 2026-10-10).

    python3 scripts/build-page-gallery.py
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from collections import defaultdict

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "apps", "web")
REPORT = os.path.join(WEB, ".qa-all", "report.json")
OUT_DIR = os.path.join(ROOT, "docs", "images", "pages")
FRAGMENT = os.path.join(ROOT, "docs", "_gallery.md")

THUMB_W = 560
QUALITY = 58

# Human labels for each top-level module, in gallery order.
GROUPS: list[tuple[str, str]] = [
    ("dashboard", "Dashboard"),
    ("login", "Masuk & Pemulihan Akun"),
    ("profile", "Profil Pengguna"),
    ("students", "Data Siswa"),
    ("classes", "Kelas"),
    ("academic-years", "Tahun Ajaran"),
    ("schedule", "Jadwal Pelajaran"),
    ("curriculum", "Kurikulum"),
    ("assessment", "Penilaian & Rapor"),
    ("attendance", "Absensi"),
    ("homeroom", "Wali Kelas"),
    ("certificates", "Sertifikat & Ijazah"),
    ("cbt", "CBT / Ujian Online"),
    ("tk", "PAUD / TK Qur'an"),
    ("portfolio", "Portofolio Siswa"),
    ("library", "Perpustakaan"),
    ("tahfidz", "Tahfidz"),
    ("takhosus", "Takhosus"),
    ("simaan", "Simaan / Tasmi'"),
    ("murojaah", "Murojaah"),
    ("kitab-progress", "Pembelajaran Kitab"),
    ("ibadah", "Ibadah Harian"),
    ("muhasabah", "Muhasabah"),
    ("muhadhoroh", "Muhadhoroh"),
    ("muhadatsah", "Muhadatsah"),
    ("dormitories", "Asrama"),
    ("musyrif", "Musyrif"),
    ("rapor-pesantren", "Rapor Pesantren"),
    ("violations", "Pelanggaran"),
    ("rewards", "Penghargaan"),
    ("permits", "Perizinan"),
    ("counseling", "Konseling"),
    ("health", "Kesehatan (UKS)"),
    ("wallet", "Tabungan Santri"),
    ("meals", "Makan / Catering"),
    ("laundry", "Laundry"),
    ("canteen", "Kantin"),
    ("inventory", "Inventaris & Aset"),
    ("facilities", "Fasilitas"),
    ("extracurricular", "Ekstrakurikuler"),
    ("notifications", "Notifikasi"),
    ("announcements", "Pengumuman & Berita"),
    ("e-office", "E-Office"),
    ("hr", "Kepegawaian (HR)"),
    ("duty-roster", "Jadwal Piket"),
    ("teacher", "Dashboard Guru"),
    ("staff", "Dashboard Staff"),
    ("payroll", "Payroll"),
    ("finance", "Keuangan"),
    ("procurement", "Pengadaan"),
    ("foundation", "Yayasan"),
    ("units", "Unit Pendidikan"),
    ("perencanaan", "Perencanaan"),
    ("kinerja", "Kinerja"),
    ("quality", "Penjaminan Mutu (SPMI)"),
    ("risk-management", "Manajemen Risiko"),
    ("research", "Penelitian & Pengembangan"),
    ("grc-dashboard", "GRC Dashboard"),
    ("analytics", "Analitik"),
    ("reports", "Laporan"),
    ("marketing", "Marketing"),
    ("spmb", "SPMB / PPDB"),
    ("admissions", "Admisi"),
    ("donation", "Donasi & Wakaf"),
    ("alumni", "Alumni"),
    ("student-org", "Organisasi Siswa"),
    ("parent", "Portal Wali Santri"),
    ("users", "Manajemen User"),
    ("settings", "Pengaturan"),
    ("reception", "Resepsionis"),
    ("project", "Proyek"),
    ("wilayah", "Wilayah"),
    ("daily-report", "Laporan Harian"),
    ("unit", "Situs Unit"),
    ("berita", "Berita (Publik)"),
    ("profil", "Profil Yayasan (Publik)"),
    ("program-unggulan", "Program Unggulan (Publik)"),
    ("wakaf-infaq", "Wakaf & Infaq (Publik)"),
    ("kontak", "Kontak (Publik)"),
    ("verifikasi", "Verifikasi (Publik)"),
    ("public", "Halaman Publik Lain"),
    ("unauthorized", "Tidak Berwenang"),
    ("reset-password", "Reset Password"),
]

LABEL = dict(GROUPS)
ORDER = {k: i for i, (k, _) in enumerate(GROUPS)}


def slug(path: str) -> str:
    # A few resolved routes carry a query string (e.g. /inventory/audits/:id
    # ?unitId=...&academicYearId=...). Those characters are illegal in a URL
    # path segment, so a file named after them renders as a broken image on
    # GitHub and fails scripts/check-doc-refs.py. Strip the query from the
    # name; if one was present, append a short digest of the full path so two
    # routes that share a pathname but differ only by query stay distinct.
    if path == "/":
        return "root"
    if "?" in path:
        base = path[1:].split("?", 1)[0].replace("/", "__")
        return f"{base}__q{hashlib.sha1(path.encode()).hexdigest()[:8]}"
    return path[1:].replace("/", "__")


def pretty(path: str, module: str) -> str:
    """Turn `/students/[uuid]` into `students → detail`."""
    parts = [p for p in path.split("/") if p and p != module]
    if not parts:
        return "(index)"
    pretty_parts = []
    for p in parts:
        if p in ("new",):
            pretty_parts.append("baru")
        elif p == "edit":
            pretty_parts.append("edit")
        elif p in ("create",):
            pretty_parts.append("buat")
        elif len(p) >= 32:
            pretty_parts.append(":id")
        else:
            pretty_parts.append(p)
    return " / ".join(pretty_parts)


def main() -> int:
    with open(REPORT) as f:
        report = json.load(f)

    # Deduplicate: keep the first successful capture per path.
    by_path: dict[str, dict] = {}
    for r in report:
        if not r.get("ok"):
            continue
        by_path.setdefault(r["path"], r)

    os.makedirs(OUT_DIR, exist_ok=True)
    buckets: dict[str, list[tuple[str, str]]] = defaultdict(list)
    written = 0
    for path in sorted(by_path):
        rec = by_path[path]
        shot = rec["screenshot"]
        shot = shot if os.path.isabs(shot) else os.path.join(WEB, shot)
        if not os.path.exists(shot):
            continue
        module = path.split("/")[1] if path != "/" else "dashboard"
        name = slug(path) + ".webp"
        out = os.path.join(OUT_DIR, name)
        im = Image.open(shot).convert("RGB")
        if im.width > THUMB_W:
            im = im.resize((THUMB_W, round(im.height * THUMB_W / im.width)), Image.LANCZOS)
        im.save(out, "WEBP", quality=QUALITY, method=6)
        buckets[module].append((path, name))
        written += 1

    lines = [
        "## Galeri Lengkap Halaman",
        "",
        f"Setiap halaman App Router (**{written}** rute) yang berhasil dirender pada "
        "sweep visual-QA terakhir. Semua tangkapan layar diverifikasi tidak "
        "kosong, tidak *error*, dan tidak *overflow* horizontal. Klik modul untuk "
        "membuka galerinya.",
        "",
    ]
    for module in sorted(buckets, key=lambda m: (ORDER.get(m, 999), m)):
        title = LABEL.get(module, module.replace("-", " ").title())
        entries = sorted(buckets[module])
        lines.append("<details>")
        lines.append(f"<summary><strong>{title}</strong> — {len(entries)} halaman</summary>")
        lines.append("")
        lines.append("| Halaman | Rute |")
        lines.append("| --- | --- |")
        for path, name in entries:
            lines.append(
                f"| <img src=\"docs/images/pages/{name}\" width=\"420\" alt=\"{path}\"> "
                f"| `{path}` |"
            )
        lines.append("")
        lines.append("</details>")
        lines.append("")

    with open(FRAGMENT, "w") as f:
        f.write("\n".join(lines))
    modules = len(buckets)
    print(f"wrote {written} thumbnails across {modules} modules -> {FRAGMENT}")

    return 0


if __name__ == "__main__":
    sys.exit(main())