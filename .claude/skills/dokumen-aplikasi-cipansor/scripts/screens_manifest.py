#!/usr/bin/env python3
"""Dari hasil tangkapan (`screenshot-flow.ts`) ke gambar yang MASUK dokumen.

Kebijakan (keputusan pengguna 2026-09-29, `decisions/dokumentasi-bergambar.md`):
hanya gambar yang TERSEMAT di manual/dokumen yang masuk git; atlas layar lengkap dan tangkapan mentah
tidak di-commit. Skrip ini menegakkannya secara mekanis.

Subperintah
  select      salin (dan kecilkan) hanya gambar yang dirujuk naskah, ke folder screens/ di samping naskah;
              menolak gambar dari langkah yang gagal; menulis screens/manifest.json
  storyboard  buat rangka bagian "Alur proses" dari flow-report.json (satu tahap per langkah)
  atlas-md    buat Markdown atlas (satu gambar per halaman menu satu akun) untuk dibangun jadi .docx/.pdf
              — artefak hasil bangun, TIDAK di-commit

Pemakaian
  python screens_manifest.py select --md docs/PANDUAN-PENGGUNA-GURU.md \\
        --capture .capture [--max-width 1280]
  python screens_manifest.py storyboard --report .capture/absensi-harian/flow-report.json --out naskah/alur-absensi.md
  python screens_manifest.py atlas-md --capture .capture --account sdit.walikelas --out .capture/atlas-sdit-walikelas.md

Rujukan gambar di naskah: `![Gambar 1. …](screens/<alur>/<langkah>.png){width=14cm}` — jalur relatif terhadap
naskah; `<alur>/<langkah>.png` harus ada di <capture>. Atlas: `screens/atlas/<akun>/<halaman>.png`.
Pillow (pip install pillow) dipakai untuk mengecilkan; tanpa Pillow gambar disalin apa adanya dengan peringatan.
Kode keluar: 0 baik · 1 ada masalah · 2 salah pakai.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

IMG_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")


def png_size(path: Path) -> tuple[int, int] | None:
    try:
        head = path.read_bytes()[:24]
        if head[:8] != b"\x89PNG\r\n\x1a\n":
            return None
        return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
    except OSError:
        return None


def shrink(src: Path, dst: Path, max_width: int) -> str:
    """Kecilkan lebar dan kurangi warna (tangkapan layar tahan PNG 256 warna). Kembalikan catatan."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        from PIL import Image  # type: ignore
    except Exception:  # noqa: BLE001
        shutil.copyfile(src, dst)
        return "disalin apa adanya (Pillow tidak ada: pip install pillow)"
    im = Image.open(src)
    if im.width > max_width:
        h = round(im.height * max_width / im.width)
        im = im.resize((max_width, h), Image.LANCZOS)
    q = im.convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=256)
    q.save(dst, optimize=True)
    return f"{src.stat().st_size // 1024} KB → {dst.stat().st_size // 1024} KB"


def load_reports(capture: Path) -> tuple[dict[str, dict], dict[str, dict]]:
    """(langkah_ok[flow/id.png] , halaman_ok[atlas/akun/x.png]) dari laporan tangkapan."""
    steps: dict[str, dict] = {}
    for rp in capture.glob("*/flow-report.json"):
        rep = json.loads(rp.read_text(encoding="utf-8"))
        for st in rep["steps"]:
            if st.get("file"):
                steps[st["file"].replace("\\", "/")] = {**st, "flow": rep["flow"]}
    pages: dict[str, dict] = {}
    ap = capture / "atlas" / "atlas-report.json"
    if ap.is_file():
        for pg in json.loads(ap.read_text(encoding="utf-8")):
            if pg.get("file"):
                pages[pg["file"].replace("\\", "/")] = pg
    return steps, pages


def cmd_select(a: argparse.Namespace) -> int:
    md = Path(a.md)
    capture = Path(a.capture)
    if not md.is_file() or not capture.is_dir():
        print("ERROR: --md atau --capture tidak ditemukan", file=sys.stderr)
        return 2
    steps, pages = load_reports(capture)
    text = md.read_text(encoding="utf-8")
    seen: set[str] = set()
    refs = []
    for alt, p in IMG_RE.findall(text):
        if p.startswith("screens/") and p not in seen:
            seen.add(p)
            refs.append((alt, p))
    if not refs:
        print("Naskah tidak merujuk gambar di screens/ — tidak ada yang disalin.")
        return 0
    out_manifest: list[dict] = []
    bad = 0
    used_steps: set[str] = set()
    for alt, rel in refs:
        key = rel[len("screens/"):]  # <alur>/<langkah>.png  atau  atlas/<akun>/<halaman>.png
        src = capture / key
        if not src.is_file():
            print(f"ERROR  {rel}: tidak ada di {capture} — jalankan tangkapan dulu atau perbaiki jalurnya")
            bad += 1
            continue
        info = steps.get(key) or pages.get(key)
        if info is None:
            print(f"ERROR  {rel}: tidak ada di laporan tangkapan (flow-report.json / atlas-report.json)")
            bad += 1
            continue
        if not info.get("ok", False):
            print(f"ERROR  {rel}: langkah/halaman itu GAGAL saat ditangkap — {'; '.join(info.get('problems', []))[:160]}")
            bad += 1
            continue
        dst = md.parent / rel
        note = shrink(src, dst, a.max_width)
        used_steps.add(key)
        dims = png_size(dst)
        out_manifest.append({
            "path": rel, "source": key, "flow": info.get("flow", "atlas"),
            "step": info.get("id", info.get("href", "")), "caption": info.get("caption", info.get("title", "")),
            "url": info.get("url", ""),
            "bytes": dst.stat().st_size, "width": dims[0] if dims else None,
        })
        print(f"OK     {rel}  ({note})")
    unused = sorted(k for k in steps if k not in used_steps)
    if unused:
        print(f"\nCatatan: {len(unused)} tangkapan alur tidak dirujuk naskah dan TIDAK disalin (mis. {unused[0]}).")
    # Dua gambar dari HALAMAN yang sama biasanya salah satu kartu menunjuk langkah yang keliru —
    # gejalanya "Papan Peringkat" dan "Kelola Target" sama-sama menampilkan /ibadah.
    by_url: dict[str, list[str]] = {}
    for e in out_manifest:
        u = (steps.get(e["source"]) or pages.get(e["source"]) or {}).get("url", "")
        if u:
            by_url.setdefault(u, []).append(e["path"])
    for url, paths in sorted(by_url.items()):
        if len(paths) > 1:
            print(f"PERINGATAN: {len(paths)} gambar diambil dari halaman yang sama ({url}): {', '.join(paths)} — "
                  "periksa apakah salah satunya butuh halaman lain (mis. /ibadah/leaderboard vs /ibadah/targets).")
    mp = md.parent / "screens" / "manifest.json"
    mp.parent.mkdir(parents=True, exist_ok=True)
    # gabungkan dengan manifes lama supaya beberapa naskah berbagi satu screens/
    old = json.loads(mp.read_text(encoding="utf-8")) if mp.is_file() else []
    keep = [e for e in old if e["path"] not in {m["path"] for m in out_manifest}]
    referenced = set()
    for other in md.parent.glob("*.md"):
        for _, p in IMG_RE.findall(other.read_text(encoding="utf-8")):
            if p.startswith("screens/"):
                referenced.add(p)
    stale = sorted(e["path"] for e in keep if e["path"] not in referenced)
    if a.prune and stale:
        keep = [e for e in keep if e["path"] not in set(stale)]
    mp.write_text(json.dumps(keep + out_manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    total = sum(m["bytes"] for m in out_manifest) // 1024
    print(f"\n{len(out_manifest)} gambar disalin ({total} KB). Manifes: {mp}")
    if stale:
        hint = "dibuang (--prune)" if a.prune else "tetap ada — jalankan ulang dengan --prune bila tidak ada naskah yang memakainya"
        print(f"Catatan: {len(stale)} entri manifes tidak lagi dirujuk naskah mana pun dan {hint} "
              f"(mis. {stale[0]}).")
    if total > a.budget_kb:
        print(f"PERINGATAN: {total} KB melebihi anggaran {a.budget_kb} KB untuk satu naskah — kurangi gambar (satu per layar penentu).")
    return 1 if bad else 0


def cmd_storyboard(a: argparse.Namespace) -> int:
    rep = json.loads(Path(a.report).read_text(encoding="utf-8"))
    if not rep.get("ok"):
        print("ERROR: alur ini gagal ditangkap; perbaiki alurnya dulu.", file=sys.stderr)
        return 1
    L = [f"## Alur proses: {rep.get('title') or rep['flow']}", "",
         "<!-- alur: %s -->" % rep["flow"], "",
         "**Siapa terlibat.** [ISI: peran yang muncul pada alur ini, dalam urutan giliran mereka]", "",
         "**Hasil akhir.** [ISI: keadaan akhir, dalam label layar]", ""]
    n = 0
    for st in rep["steps"]:
        if not st.get("file"):
            continue
        n += 1
        cap = st.get("caption") or st["id"]
        L += [f"### Tahap {n} — {cap.rstrip('.')}", "",
              f"**Siapa.** [ISI: peran pada tahap ini]", "",
              f"![Gambar {n}. {cap}](screens/{st['file']}){{width=14cm}}", "",
              f"*Gambar {n}. {cap}*", "",
              f"**Yang terjadi.** [ISI: satu–dua kalimat, memakai teks layar: {', '.join(st.get('see', [])) or '—'}]", "",
              f"**Giliran berikutnya.** [ISI: siapa melakukan apa sesudah ini, atau \"selesai\"]", ""]
    Path(a.out).write_text("\n".join(L), encoding="utf-8")
    print(f"OK  {a.out}: {n} tahap. Ganti semua [ISI]; jangan mengubah jalur gambar.")
    return 0


def cmd_atlas_md(a: argparse.Namespace) -> int:
    capture = Path(a.capture)
    rp = capture / "atlas" / "atlas-report.json"
    if not rp.is_file():
        print(f"ERROR: {rp} tidak ada — jalankan `screenshot-flow.ts atlas …` dulu", file=sys.stderr)
        return 2
    rows = [r for r in json.loads(rp.read_text(encoding="utf-8")) if r.get("account") == a.account and r.get("file")]
    if not rows:
        print(f"ERROR: tidak ada halaman untuk akun '{a.account}' di laporan", file=sys.stderr)
        return 2
    L = ["# Atlas Layar", "",
         f"Satu tangkapan tiap halaman pada menu akun demo `{a.account}` (peran `{rows[0]['role']}`), dari aplikasi yang "
         "berjalan dengan data contoh. Dibuat otomatis; jangan disunting tangan.", ""]
    group = None
    n = 0
    for r in rows:
        if r["group"] != group:
            group = r["group"]
            L += [f"# {group}", ""]
        n += 1
        flag = "" if r["ok"] else f" — **bermasalah saat ditangkap:** {'; '.join(r['problems'])[:120]}"
        L += [f"## {r['title']}", "", f"Alamat: `{r['href']}`{flag}", "",
              f"![Gambar {n}. {r['title']}]({(capture / r['file']).as_posix()}){{width=15cm}}", "",
              f"*Gambar {n}. {r['title']}*", ""]
    Path(a.out).write_text("\n".join(L), encoding="utf-8")
    print(f"OK  {a.out}: {n} halaman. Bangun dengan build_docs.py (--resource-path {capture}); jangan di-commit.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("select")
    s.add_argument("--md", required=True)
    s.add_argument("--capture", required=True)
    s.add_argument("--max-width", type=int, default=1280)
    s.add_argument("--budget-kb", type=int, default=2500)
    s.add_argument("--prune", action="store_true",
                   help="buang entri manifes yang tidak lagi dirujuk naskah mana pun (mis. setelah gambar diganti)")
    s.set_defaults(fn=cmd_select)
    b = sub.add_parser("storyboard")
    b.add_argument("--report", required=True)
    b.add_argument("--out", required=True)
    b.set_defaults(fn=cmd_storyboard)
    t = sub.add_parser("atlas-md")
    t.add_argument("--capture", required=True)
    t.add_argument("--account", required=True, help="bagian lokal e-mail, mis. sdit.walikelas")
    t.add_argument("--out", required=True)
    t.set_defaults(fn=cmd_atlas_md)
    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
