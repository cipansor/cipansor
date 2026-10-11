#!/usr/bin/env python3
"""Periksa apakah lingkungan bisa membangun dokumen — SEBELUM menulis satu kalimat pun.

Kenapa: percobaan pertama skill ini menerbitkan .docx/.pdf dengan semua tabel rusak karena
lingkungannya tidak lengkap (LibreOffice tanpa komponen Writer memuat berkas dengan galat
"source file could not be loaded"), dan tak ada yang memeriksa. Skrip ini mencetak apa yang ada,
apa yang kurang, dan perintah untuk memasangnya.

Pemakaian: python check_env.py [--md-only]
  --md-only  cukup Markdown (tanpa .docx/.pdf): hanya python3 yang diperlukan.
Kode keluar: 0 semua yang diperlukan ada · 1 ada yang kurang.
"""
from __future__ import annotations

import glob
import importlib
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

MD_ONLY = "--md-only" in sys.argv
rows: list[tuple[str, bool, str, str]] = []  # (nama, ok, keterangan, perintah pasang)


def add(name: str, ok: bool, note: str = "", fix: str = "") -> None:
    rows.append((name, ok, note, fix))


def chrome() -> str | None:
    env = os.environ.get("PUPPETEER_EXECUTABLE_PATH")
    if env and Path(env).exists():
        return env
    for pat in ("/opt/pw-browsers/chromium-*/chrome-linux/chrome",
                "/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell"):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    for n in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        if shutil.which(n):
            return shutil.which(n)
    return None


def has_module(name: str) -> bool:
    try:
        importlib.import_module(name)
        return True
    except Exception:  # noqa: BLE001
        return False


def main() -> int:
    add("python3 >= 3.9", sys.version_info >= (3, 9), sys.version.split()[0])
    if not MD_ONLY:
        add("python-docx", has_module("docx"), "", "pip install python-docx lxml")
        add("pymupdf (periksa PDF)", has_module("pymupdf") or has_module("fitz"),
            "opsional tetapi sangat disarankan", "pip install pymupdf")
        add("pandoc", bool(shutil.which("pandoc")), "", "apt-get install -y pandoc")
        mmdc = shutil.which("mmdc")
        add("mmdc (mermaid-cli)", bool(mmdc), "", "npm install -g @mermaid-js/mermaid-cli")
        c = chrome()
        add("Chromium untuk mmdc", bool(c), c or "", "apt-get install -y chromium  (atau set PUPPETEER_EXECUTABLE_PATH)")
        soffice = shutil.which("soffice") or shutil.which("libreoffice")
        add("LibreOffice (soffice)", bool(soffice), "", "apt-get install -y libreoffice-writer")
        if soffice:
            # soffice ada belum berarti bisa memuat dokumen: tanpa komponen Writer semua konversi gagal.
            # LD_LIBRARY_PATH dibuang — sebuah direktori multiarch yang diekspor pemanggil membuat
            # soffice.bin gagal memuat libreglo.so (lihat soffice_env di build_docs.py).
            prof = tempfile.mkdtemp(prefix="lo-probe-")
            probe = Path(prof) / "x.txt"
            probe.write_text("probe", encoding="utf-8")
            try:
                r = subprocess.run(
                    [soffice, "--headless", "--norestore", f"-env:UserInstallation=file://{prof}/p",
                     "--convert-to", "pdf", "--outdir", prof, str(probe)],
                    capture_output=True, text=True, timeout=180,
                    env={k: v for k, v in os.environ.items() if k != "LD_LIBRARY_PATH"}
                    | {"SAL_USE_VCLPLUGIN": "svp", "HOME": prof})
                ok = (Path(prof) / "x.pdf").exists()
                add("LibreOffice Writer dapat memuat dokumen", ok,
                    "" if ok else (r.stderr or r.stdout).strip().splitlines()[-1][:120],
                    "apt-get update && apt-get install -y libreoffice-writer   (GAGAL memuat = komponen Writer belum terpasang)")
            except Exception as e:  # noqa: BLE001
                add("LibreOffice Writer dapat memuat dokumen", False, str(e)[:120], "apt-get install -y libreoffice-writer")
            finally:
                shutil.rmtree(prof, ignore_errors=True)
            uno_ok = False
            # pyuno.so sits beside soffice.bin and is not on the default loader
            # path; update_toc.py re-execs with that directory added, so probe
            # the same way rather than a bare `import uno` that always fails.
            prog = Path(soffice).resolve().parent if soffice else None
            for py in dict.fromkeys([sys.executable, "/usr/bin/python3"]):
                if not Path(py).exists():
                    continue
                env = {k: v for k, v in os.environ.items() if k != "LD_LIBRARY_PATH"}
                if prog:
                    env["LD_LIBRARY_PATH"] = str(prog)
                if subprocess.run([py, "-c", "import uno"], capture_output=True, env=env).returncode == 0:
                    uno_ok = True
                    break
            add("modul uno (mengisi daftar isi)", uno_ok,
                "tanpa ini daftar isi terisi saat dibuka di Word (F9)", "apt-get install -y python3-uno")
        fonts = subprocess.run(["fc-list"], capture_output=True, text=True).stdout if shutil.which("fc-list") else ""
        add("Font Carlito/Calibri (tanpa ini PDF memakai font serif cadangan)",
            "arlito" in fonts or "alibri" in fonts, "", "apt-get install -y fonts-crosextra-carlito")

    width = max(len(r[0]) for r in rows)
    bad = 0
    optional = {"pymupdf (periksa PDF)", "modul uno (mengisi daftar isi)"}
    for name, ok, note, fix in rows:
        soft = name in optional or name.startswith("Font")
        mark = "OK  " if ok else ("PERLU" if not soft else "saran")
        print(f"{mark:6} {name:<{width}}  {note}")
        if not ok:
            print(f"       pasang: {fix}")
            bad += 0 if soft else 1
    print("\nSiap membangun." if not bad else f"\n{bad} kebutuhan wajib belum ada — pasang dulu, atau minta pengguna memilih --md-only.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
