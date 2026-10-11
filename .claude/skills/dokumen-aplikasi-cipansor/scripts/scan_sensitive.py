#!/usr/bin/env python3
"""Periksa dokumen hasil (md/txt/html/docx) dari data sensitif sebelum diserahkan.

Kenapa: AGENTS.md repo Cipansor mendefinisikan "sensitif" = apa yang bisa dipakai
penyerang — kredensial, kunci, token, connection string, nama & id sumber daya
cloud, alamat IP, jalur host, kelemahan produksi yang masih terbuka, detail insiden,
data pribadi. Repo publik sampai rilis dan git menyimpan segalanya, dan dokumen
teknis/panduan sering dikirim ke donor, auditor, atau vendor.

Ini penyaring mekanis (seperti .github/scripts/check-sensitive.py di repo). Ia
tidak menggantikan penilaian: kelemahan produksi yang masih terbuka tidak bisa
dideteksi regex — baca bagian Risiko dengan mata.

Pemakaian:
    python scan_sensitive.py FILE_ATAU_FOLDER [...]
Kode keluar: 0 bersih, 1 ada temuan, 2 salah pakai.
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

TEXT_EXT = {".md", ".txt", ".html", ".htm", ".json", ".yml", ".yaml", ".mermaid", ".csv"}

PLACEHOLDER = re.compile(r"(<[^>]+>|\.\.\.|…|xxx+|changeme|contoh|example|placeholder|\*{3,}|your[-_ ]|isi[-_ ])", re.I)

RULES: list[tuple[str, re.Pattern[str], str]] = [
    ("kunci-privat", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "kunci privat"),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*"), "token JWT"),
    ("connection-string", re.compile(r"\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://[^\s/@:]*:[^\s@]+@"), "connection string berisi kata sandi"),
    ("cloud-host", re.compile(r"\b[\w-]+\.(?:azurewebsites\.net|scm\.azurewebsites\.net|vault\.azure\.net|database\.azure\.com|blob\.core\.windows\.net|redis\.cache\.windows\.net|azurecr\.io)\b", re.I), "nama host sumber daya cloud"),
    ("ip", re.compile(r"\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)(?:\d{1,3}\.){3}\d{1,3}\b"), "alamat IP"),
    ("jalur-host", re.compile(r"(?:/home/[a-z][\w-]*/|/Users/[A-Za-z][\w-]*/|C:\\Users\\)"), "jalur folder di mesin"),
    ("kata-sandi-demo", re.compile(r"Cipansor123"), "kata sandi akun demo"),
    ("nik", re.compile(r"(?<!\d)\d{16}(?!\d)"), "16 digit (mirip NIK/NISN/no. rekening) — data pribadi?"),
    ("telepon-id", re.compile(r"(?<!\d)(?:\+62|62|0)8\d{8,11}(?!\d)"), "nomor telepon Indonesia — data pribadi?"),
]

ASSIGN = re.compile(
    r"\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY|HMAC)[A-Z0-9_]*)\s*[=:]\s*[\"']?([^\s\"'`]{6,})"
)


def text_of(path: Path) -> str:
    if path.suffix.lower() == ".docx":
        try:
            with zipfile.ZipFile(path) as z:
                parts = [n for n in z.namelist() if n.startswith("word/") and n.endswith(".xml")]
                xml = "\n".join(z.read(n).decode("utf-8", "replace") for n in parts)
        except zipfile.BadZipFile:
            return ""
        xml = re.sub(r"</w:p>", "\n", xml)
        return re.sub(r"<[^>]+>", "", xml)
    return path.read_text(encoding="utf-8", errors="replace")


def mask(s: str) -> str:
    s = s.strip()
    return s if len(s) <= 6 else s[:3] + "…" + s[-2:]


def scan(path: Path) -> list[tuple[int, str, str, str]]:
    hits = []
    for n, line in enumerate(text_of(path).splitlines(), 1):
        for key, rx, why in RULES:
            for m in rx.finditer(line):
                if key == "ip" and re.search(r"\b\d{1,3}(?:\.\d{1,3}){3}\.\d", line):
                    continue  # kemungkinan nomor versi/bagian, mis. 1.2.3.4.5
                hits.append((n, key, why, mask(m.group(0))))
        for m in ASSIGN.finditer(line):
            if not PLACEHOLDER.search(m.group(2)):
                hits.append((n, "kunci-rahasia", f"nilai untuk {m.group(1)}", mask(m.group(2))))
    return hits


def targets(args: list[str]):
    for a in args:
        p = Path(a)
        if p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file() and (f.suffix.lower() in TEXT_EXT or f.suffix.lower() == ".docx"):
                    yield f
        elif p.is_file():
            yield p
        else:
            print(f"ERROR: {a} tidak ditemukan", file=sys.stderr)
            sys.exit(2)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    total = 0
    scanned = 0
    for f in targets(sys.argv[1:]):
        scanned += 1
        for n, key, why, snip in scan(f):
            total += 1
            print(f"{f}:{n}: [{key}] {why}  ({snip})")
    if total:
        print(f"\n{total} temuan di {scanned} berkas. Hapus atau ganti dengan penjelasan umum "
              f"(mis. \"nilai rahasia disimpan di Azure Key Vault\" tanpa nama vault), lalu jalankan ulang.")
        return 1
    print(f"Bersih: {scanned} berkas diperiksa, tidak ada pola sensitif mekanis. "
          f"Tetap baca bagian Risiko & Utang Teknis dengan mata (kelemahan produksi yang masih terbuka).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
