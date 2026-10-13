#!/usr/bin/env python3
"""Kumpulkan fakta terukur dari repo Cipansor untuk dokumen teknis & panduan.

Kenapa skrip ini ada: AGENTS.md repo menegaskan bahwa angka (jumlah modul, model,
peran) *bergeser* dan tidak boleh ditulis dari ingatan. Skrip ini membaca kode
pada commit yang sedang diperiksa dan mencetak angka + tanggalnya, sehingga
dokumen bisa berkata "diukur pada commit abc1234, 2026-09-28".

Hanya pustaka standar Python. Tidak pernah membaca NILAI variabel lingkungan —
hanya nama kuncinya (repo bisa publik; lihat kualitas-dan-keamanan.md).

Pemakaian:
    python collect_facts.py /path/ke/cipansor [--out DIR]

Keluaran: DIR/facts.json dan DIR/facts.md (default DIR = ./facts-out)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

SKIP_DIRS = {"node_modules", ".git", ".next", "dist", "build", "coverage", ".turbo"}


def read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def walk(root: Path, pattern: str):
    """rglob yang melewati folder berat."""
    for p in root.rglob(pattern):
        if not SKIP_DIRS.intersection(p.parts):
            yield p


def load_json(p: Path) -> dict:
    try:
        return json.loads(read(p) or "{}")
    except json.JSONDecodeError:
        return {}


def git_info(repo: Path) -> dict:
    def run(*args: str) -> str:
        try:
            return subprocess.run(
                ["git", "-C", str(repo), *args],
                capture_output=True, text=True, timeout=20,
            ).stdout.strip()
        except Exception:
            return ""

    return {
        "commit": run("rev-parse", "--short", "HEAD"),
        "commit_date": run("log", "-1", "--format=%cs"),
        "commit_subject": run("log", "-1", "--format=%s"),
        "branch": run("rev-parse", "--abbrev-ref", "HEAD"),
    }


def stack(repo: Path) -> dict:
    wanted = [
        "next", "react", "react-dom", "express", "prisma", "@prisma/client",
        "zod", "socket.io", "ioredis", "jsonwebtoken", "typescript", "vitest",
        "@playwright/test", "tailwindcss", "@tanstack/react-query", "zustand",
        "axios", "node-cron", "swagger-jsdoc", "swagger-ui-express", "helmet",
        "multer", "otplib", "pino", "winston", "pdf-lib", "@sentry/node",
        "@sentry/nextjs",
    ]
    out: dict[str, dict[str, str]] = {}
    for ws in ("apps/api", "apps/web", "packages/shared"):
        pj = load_json(repo / ws / "package.json")
        deps = {**pj.get("dependencies", {}), **pj.get("devDependencies", {})}
        found = {k: deps[k] for k in wanted if k in deps}
        if found:
            out[ws] = found
    root = load_json(repo / "package.json")
    return {
        "package_manager": root.get("packageManager", ""),
        "engines": root.get("engines", {}),
        "by_workspace": out,
    }


def prisma(repo: Path) -> dict:
    schema = repo / "apps/api/prisma/schema.prisma"
    text = read(schema)
    models = re.findall(r"^model\s+(\w+)\s*\{", text, re.M)
    enums = re.findall(r"^enum\s+(\w+)\s*\{", text, re.M)
    role_codes: list[str] = []
    m = re.search(r"^enum\s+RoleCode\s*\{(.*?)^\}", text, re.M | re.S)
    if m:
        for line in m.group(1).splitlines():
            line = line.split("//")[0].strip()
            if re.fullmatch(r"[A-Z0-9_]+", line):
                role_codes.append(line)
    return {
        "schema_path": "apps/api/prisma/schema.prisma" if text else None,
        "lines": text.count("\n") + 1 if text else 0,
        "model_count": len(models),
        "enum_count": len(enums),
        "models": models,
        "role_code_count": len(role_codes),
        "role_codes": role_codes,
        "migrations_dir_exists": (repo / "apps/api/prisma/migrations").is_dir(),
    }


HANDLER_RE = re.compile(r"^\s*router\.(get|post|put|patch|delete)\(", re.M)
# Argumen pertama bisa jatuh di baris berikutnya (router.post(\n  '/x', ...)), maka \s* melintasi baris.
ROUTE_RE = re.compile(r"\brouter\.(get|post|put|patch|delete)\(\s*(['\"`])([^'\"`]+)\2")


def route_index(repo: Path) -> list[dict]:
    """Semua rute yang benar-benar didaftarkan: [{method, path, module}], path lengkap dengan /api.

    Dipakai check_docs.py untuk membuktikan bahwa alamat yang disebut dokumen ada di kode.
    Perkiraan: rute di sub-router yang di-mount di dalam modul tidak ikut terhitung.
    """
    facts = api_modules(repo)
    out: list[dict] = []
    for m in facts["modules"]:
        d = repo / "apps/api/src/modules" / m["name"]
        text = "".join(read(r) for r in sorted(d.glob("*.routes.ts")))
        for mount in m["mount"]:
            for r in ROUTE_RE.finditer(text):
                sub = r.group(3)
                path = mount if sub in ("/", "") else mount.rstrip("/") + "/" + sub.lstrip("/")
                out.append({"method": r.group(1).upper(), "path": path, "module": m["name"]})
    return out


def api_modules(repo: Path) -> dict:
    mod_root = repo / "apps/api/src/modules"
    app_ts = read(repo / "apps/api/src/app.ts")

    # import name -> module dir
    imp: dict[str, str] = {}
    for m in re.finditer(
        r"import\s+(?:\{([^}]*)\}|(\w+))\s+from\s+['\"][^'\"]*modules/([\w-]+)[^'\"]*['\"]",
        app_ts,
    ):
        names = m.group(1) or m.group(2) or ""
        for n in re.split(r"[,\s]+", names):
            n = n.split(" as ")[-1].strip()
            if n:
                imp[n] = m.group(3)

    mounts: dict[str, list[str]] = {}
    for m in re.finditer(r"apiRouter\.use\(\s*['\"]([^'\"]+)['\"]\s*,\s*(?:[\w.]+\s*,\s*)*(\w+)\s*\)", app_ts):
        path, ident = m.group(1), m.group(2)
        if ident in imp:
            mounts.setdefault(imp[ident], []).append("/api" + path)

    modules = []
    if mod_root.is_dir():
        for d in sorted(p for p in mod_root.iterdir() if p.is_dir()):
            routes = list(d.glob("*.routes.ts"))
            rtext = "".join(read(r) for r in routes)
            names = {p.name for p in d.iterdir() if p.is_file()}
            suffix = lambda s: any(n.endswith(s) for n in names)  # noqa: E731
            controller_text = "".join(read(c) for c in d.glob("*.controller.ts"))
            layering_violation = bool(
                re.search(r"\bprisma\.\w+", rtext) or re.search(r"\bprisma\.\w+", controller_text)
            )
            modules.append(
                {
                    "name": d.name,
                    "mount": mounts.get(d.name, []),
                    "handlers": len(HANDLER_RE.findall(rtext)),
                    "has_swagger": "@swagger" in rtext,
                    "has_routes": suffix(".routes.ts"),
                    "has_controller": suffix(".controller.ts"),
                    "has_service": suffix(".service.ts"),
                    "has_schema": suffix(".schema.ts"),
                    "has_index": (d / "index.ts").is_file(),
                    "has_tests_dir": (d / "tests").is_dir(),
                    "prisma_in_route_or_controller": layering_violation,
                }
            )
    total_handlers = sum(m["handlers"] for m in modules)
    return {
        "module_count": len(modules),
        "handler_count_approx": total_handlers,
        "swagger_annotated_modules": sum(1 for m in modules if m["has_swagger"]),
        # Dua ukuran yang BERBEDA — jangan dicampur. Empat berkas = routes+controller+service+schema.
        # Lima bagian = keempatnya + index.ts (definisi yang dipakai known-issues.md: "22 of 93",
        # diukur 2026-09-25). Dokumen yang menyebut "tata letak lengkap" harus menyebut yang mana.
        "four_file_modules": sum(
            1 for m in modules
            if m["has_routes"] and m["has_controller"] and m["has_service"] and m["has_schema"]
        ),
        "five_part_modules": sum(
            1 for m in modules
            if m["has_routes"] and m["has_controller"] and m["has_service"] and m["has_schema"]
            and m["has_index"]
        ),
        "full_layout_modules": sum(  # nama lama, sama dengan four_file_modules
            1 for m in modules
            if m["has_routes"] and m["has_controller"] and m["has_service"] and m["has_schema"]
        ),
        "prisma_in_route_or_controller_modules": sum(
            1 for m in modules if m["prisma_in_route_or_controller"]
        ),
        # Modul tanpa berkas *.routes.ts adalah pustaka internal (mis. scholarship: hanya
        # scoring.service) — bukan modul yang lupa di-mount. Bedakan agar dokumen tidak keliru.
        "unmounted_modules_with_routes": [
            m["name"] for m in modules if m["has_routes"] and not m["mount"]
        ],
        "service_only_modules": [m["name"] for m in modules if not m["has_routes"]],
        "modules": modules,
    }


def jobs(repo: Path) -> dict:
    """Berkas *.job.ts BUKAN sama dengan pekerjaan terjadwal: satu berkas bisa dipanggil dari
    service (mis. asset-depreciation) dan satu berkas bisa dijadwalkan beberapa kali
    (dashboard-snapshot). Hitung keduanya, dan pisahkan."""
    jd = repo / "apps/api/src/jobs"
    files = sorted(p.name for p in jd.glob("*.job.ts")) if jd.is_dir() else []
    sched = read(jd / "scheduler.ts") if jd.is_dir() else ""
    crons = re.findall(r"cron\.schedule\(\s*['\"`]([^'\"`]+)['\"`]", sched)
    imported = set(re.findall(r"from\s+['\"]\./([\w-]+\.job)['\"]", sched))
    scheduled = sorted(f for f in files if f[:-3] in imported)
    unscheduled = sorted(f for f in files if f[:-3] not in imported)
    return {
        "job_files": files,
        "count": len(files),  # jumlah BERKAS, bukan jumlah pekerjaan terjadwal
        "cron_entries": len(crons),
        "scheduled_job_files": scheduled,
        "job_files_not_scheduled": unscheduled,  # dipanggil dari tempat lain; jangan disebut "terjadwal"
        "cron_expressions_in_scheduler": crons,
    }


def env_keys(repo: Path) -> dict:
    """Nama kunci saja, dikelompokkan menurut awalan (CHATBOT_, JWT_, ...). Tidak pernah nilainya.

    Komentar pemisah di .env.example tidak dipakai untuk mengelompokkan: satu komentar
    hanya membuka sebuah bagian, tidak menutupnya, sehingga kunci sesudahnya salah masuk grup.
    """
    text = read(repo / ".env.example")
    keys = []
    for line in text.splitlines():
        k = re.match(r"^#?\s*([A-Z][A-Z0-9_]+)=", line)
        if k and k.group(1) not in keys:
            keys.append(k.group(1))
    by_prefix: dict[str, list[str]] = {}
    for k in keys:
        by_prefix.setdefault(k.split("_")[0], []).append(k)
    groups = [{"group": pre, "keys": ks} for pre, ks in by_prefix.items() if len(ks) >= 2]
    rest = [k for pre, ks in by_prefix.items() if len(ks) < 2 for k in ks]
    groups.sort(key=lambda g: -len(g["keys"]))
    if rest:
        groups.append({"group": "LAINNYA", "keys": rest})
    return {"total_keys": len(keys), "groups": groups}


def web(repo: Path) -> dict:
    app = repo / "apps/web/src/app"
    top = sorted(p.name for p in app.iterdir() if p.is_dir()) if app.is_dir() else []
    pages = [p for p in walk(app, "page.tsx")] if app.is_dir() else []
    hooks = repo / "apps/web/src/hooks"
    return {
        "top_level_route_dirs": top,
        "page_count": len(pages),
        "hook_files": len(list(hooks.glob("*.ts*"))) if hooks.is_dir() else 0,
        "has_role_menus_script": (repo / "apps/web/scripts/role-menus.ts").is_file(),
        "has_screenshot_script": (repo / "apps/web/scripts/screenshot-roles.ts").is_file(),
        "navigation_file": "apps/web/src/config/navigation.ts"
        if (repo / "apps/web/src/config/navigation.ts").is_file() else None,
    }


def tests(repo: Path) -> dict:
    def count(base: str, *pats: str) -> int:
        b = repo / base
        if not b.is_dir():
            return 0
        seen = set()
        for pat in pats:
            for p in walk(b, pat):
                seen.add(p)
        return len(seen)

    return {
        "api_unit_test_files": count("apps/api", "*.test.ts"),
        "web_unit_test_files": count("apps/web/src", "*.test.ts", "*.test.tsx"),
        "web_e2e_spec_files": count("apps/web/e2e", "*.spec.ts"),
    }


def infra(repo: Path) -> dict:
    wf = repo / ".github/workflows"
    workflows = sorted(p.name for p in wf.glob("*.y*ml")) if wf.is_dir() else []
    compose = read(repo / "docker-compose.yml")
    services: list[str] = []
    m = re.search(r"^services:\s*\n(.*?)(?=^\S|\Z)", compose, re.M | re.S)
    if m:
        services = re.findall(r"^  ([\w-]+):\s*$", m.group(1), re.M)
    dockerfiles = sorted(
        str(p.relative_to(repo)) for p in walk(repo, "Dockerfile*") if p.is_file()
    )
    return {
        "workflows": workflows,
        "compose_services": services,
        "dockerfiles": dockerfiles,
        "deploy_dirs": sorted(p.name for p in (repo / "deploy").iterdir())
        if (repo / "deploy").is_dir() else [],
    }


def docs_and_memory(repo: Path) -> dict:
    docs = sorted(p.name for p in (repo / "docs").glob("*.md")) if (repo / "docs").is_dir() else []
    skills = sorted(p.parent.name for p in walk(repo / ".claude/skills", "SKILL.md")) \
        if (repo / ".claude/skills").is_dir() else []
    decisions = sorted(
        p.stem for p in (repo / ".claude/memory/decisions").glob("*.md")
    ) if (repo / ".claude/memory/decisions").is_dir() else []
    dec_summaries = []
    ddir = repo / ".claude/memory/decisions"
    if ddir.is_dir():
        for f in sorted(ddir.glob("*.md")):
            txt = read(f)
            # Ringkasan = blockquote pertama; bisa membentang beberapa baris — gabungkan semuanya,
            # jangan berhenti di baris pertama (itu yang membuat ringkasan terpotong di tengah kalimat).
            bq = re.search(r"(?:^>.*(?:\n|$))+", txt, re.M)
            summary = " ".join(l.lstrip("> ").strip() for l in bq.group(0).splitlines()) if bq else ""
            dec_summaries.append({"file": f.name, "summary": summary.strip()})
    ki = read(repo / ".claude/memory/known-issues.md")
    ki_sections = re.findall(r"^##\s+(.+)$", ki, re.M)
    shots = repo / "docs/images"
    return {
        "docs_md": docs,
        "repo_skills": skills,
        "decisions": decisions,
        "decision_summaries": dec_summaries,
        "known_issues_sections": ki_sections,
        "known_issues_file": ".claude/memory/known-issues.md" if ki else None,
        "screenshot_count_in_docs_images": len(list(shots.glob("*.png"))) if shots.is_dir() else 0,
        "license_first_line": (read(repo / "LICENSE").strip().splitlines() or [""])[0],
    }


def collect(repo: Path) -> dict:
    return {
        "generated_at": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "repo_path": str(repo),
        "git": git_info(repo),
        "stack": stack(repo),
        "prisma": prisma(repo),
        "api": api_modules(repo),
        "jobs": jobs(repo),
        "env": env_keys(repo),
        "web": web(repo),
        "tests": tests(repo),
        "infra": infra(repo),
        "docs": docs_and_memory(repo),
    }


def to_markdown(f: dict) -> str:
    g, p, a, w, t, i, d = f["git"], f["prisma"], f["api"], f["web"], f["tests"], f["infra"], f["docs"]
    L: list[str] = []
    L.append(f"# Fakta terukur — Cipansor\n")
    L.append(
        f"Diukur pada commit `{g['commit'] or '?'}` ({g['commit_date'] or '?'}), "
        f"cabang `{g['branch'] or '?'}`; skrip dijalankan {f['generated_at']}.\n"
    )
    L.append("Angka di bawah adalah hasil hitung, bukan ingatan. Kutip dengan menyebut commit/tanggal ini.\n")
    L.append("## Ringkasan angka\n")
    L.append("| Hal | Nilai |\n|---|---|")
    L.append(f"| Modul API | {a['module_count']} |")
    L.append(f"| Handler rute API (perkiraan, `router.get/post/put/patch/delete`) | ≈{a['handler_count_approx']} |")
    L.append(f"| Modul dengan anotasi Swagger | {a['swagger_annotated_modules']} dari {a['module_count']} |")
    L.append(f"| Modul dengan empat berkas (routes+controller+service+schema) | {a['four_file_modules']} |")
    L.append(f"| Modul dengan lima bagian (empat berkas + index.ts) — ukuran known-issues.md | {a['five_part_modules']} |")
    L.append(f"| Modul yang memanggil Prisma dari route/controller | {a['prisma_in_route_or_controller_modules']} |")
    L.append(f"| Model Prisma / enum | {p['model_count']} / {p['enum_count']} |")
    L.append(f"| Baris `schema.prisma` | {p['lines']} |")
    L.append(f"| Kode peran (`RoleCode`) | {p['role_code_count']} |")
    L.append(f"| Berkas *.job.ts | {f['jobs']['count']} |")
    L.append(f"| Entri cron di scheduler.ts | {f['jobs']['cron_entries']} |")
    L.append(f"| Berkas job yang dijadwalkan scheduler.ts | {len(f['jobs']['scheduled_job_files'])} |")
    L.append(f"| Kunci variabel lingkungan di `.env.example` | {f['env']['total_keys']} |")
    L.append(f"| Halaman web (`page.tsx`) | {w['page_count']} |")
    L.append(f"| Hook data web | {w['hook_files']} |")
    L.append(f"| Berkas uji unit API / web | {t['api_unit_test_files']} / {t['web_unit_test_files']} |")
    L.append(f"| Berkas spesifikasi e2e (Playwright) | {t['web_e2e_spec_files']} |")
    L.append(f"| Tangkapan layar di `docs/images` | {d['screenshot_count_in_docs_images']} |")
    L.append("")
    L.append("## Stack (versi dari package.json)\n")
    L.append(f"Package manager: `{f['stack']['package_manager']}`\n")
    for ws, deps in f["stack"]["by_workspace"].items():
        L.append(f"**{ws}**: " + ", ".join(f"`{k}` {v}" for k, v in deps.items()) + "\n")
    L.append("## Modul API\n")
    L.append("| Modul | Mount | Handler | Swagger | Layering |\n|---|---|---|---|---|")
    for m in a["modules"]:
        mount = ", ".join(m["mount"]) or "**tidak ter-mount**"
        lay = "⚠ Prisma di route/controller" if m["prisma_in_route_or_controller"] else "ok"
        L.append(f"| {m['name']} | {mount} | {m['handlers']} | {'ya' if m['has_swagger'] else '-'} | {lay} |")
    L.append("")
    if a["unmounted_modules_with_routes"]:
        L.append("**Perhatian — punya routes tetapi tidak ter-mount di app.ts:** "
                 + ", ".join(f"`{x}`" for x in a["unmounted_modules_with_routes"]) + "\n")
    if a["service_only_modules"]:
        L.append("Modul tanpa routes (pustaka internal, bukan endpoint): "
                 + ", ".join(f"`{x}`" for x in a["service_only_modules"]) + "\n")
    L.append("## Job terjadwal\n")
    L.append("Dijadwalkan oleh `scheduler.ts`: " + (", ".join(f"`{x}`" for x in f["jobs"]["scheduled_job_files"]) or "(tidak ada)"))
    if f["jobs"]["job_files_not_scheduled"]:
        L.append("\n**Ada berkas job yang TIDAK dijadwalkan** (dipanggil dari tempat lain; jangan disebut terjadwal): "
                 + ", ".join(f"`{x}`" for x in f["jobs"]["job_files_not_scheduled"]))
    L.append("\n## Variabel lingkungan (nama saja)\n")
    for grp in f["env"]["groups"]:
        L.append(f"- **{grp['group']}**: " + ", ".join(f"`{k}`" for k in grp["keys"]))
    L.append("\n## Rute web tingkat atas\n")
    L.append(", ".join(f"`/{x}`" for x in w["top_level_route_dirs"]))
    L.append("\n## Infrastruktur\n")
    L.append(f"- Workflow CI/CD: {', '.join(i['workflows']) or '-'}")
    L.append(f"- Layanan docker-compose: {', '.join(i['compose_services']) or '-'}")
    L.append(f"- Dockerfile: {', '.join(i['dockerfiles']) or '-'}")
    L.append("\n## Dokumen & catatan yang sudah ada di repo\n")
    L.append(f"- `docs/`: {', '.join(d['docs_md']) or '-'}")
    L.append(f"- Skill repo (`.claude/skills`): {', '.join(d['repo_skills']) or '-'}")
    L.append(f"- Keputusan tercatat: {len(d['decisions'])} berkas di `.claude/memory/decisions/` (ringkasan di bawah)")
    L.append(f"- Bagian `known-issues.md`: {'; '.join(d['known_issues_sections']) or '-'}")
    L.append(f"- Lisensi: {d['license_first_line'] or '-'}")
    L.append("\n## Keputusan tercatat (ringkasan satu kalimat dari tiap berkas)\n")
    L.append("Bahan bab *Keputusan Arsitektur*. Kutip dan tautkan; jangan mengarang ulang alasannya.\n")
    for x in d["decision_summaries"]:
        L.append(f"- `{x['file']}` — {x['summary'] or '(tanpa ringkasan)'}")
    L.append("\n## Kode peran\n")
    L.append(", ".join(f"`{r}`" for r in p["role_codes"]) or "(tidak terbaca)")
    L.append("")
    return "\n".join(L)



def compare(old: dict, new: dict) -> str:
    """Bandingkan dua hasil pengukuran — bahan mode PEMBARUAN dokumen."""
    def g(d, *path, default=None):
        for k in path:
            if not isinstance(d, dict) or k not in d:
                return default
            d = d[k]
        return d

    rows = [
        ("Modul API", ("api", "module_count")),
        ("Handler rute API (perkiraan)", ("api", "handler_count_approx")),
        ("Modul beranotasi Swagger", ("api", "swagger_annotated_modules")),
        ("Modul dengan Prisma di route/controller", ("api", "prisma_in_route_or_controller_modules")),
        ("Model Prisma", ("prisma", "model_count")),
        ("Enum Prisma", ("prisma", "enum_count")),
        ("Kode peran", ("prisma", "role_code_count")),
        ("Berkas *.job.ts", ("jobs", "count")),
        ("Entri cron", ("jobs", "cron_entries")),
        ("Kunci variabel lingkungan", ("env", "total_keys")),
        ("Halaman web", ("web", "page_count")),
        ("Berkas uji unit API", ("tests", "api_unit_test_files")),
        ("Berkas uji unit web", ("tests", "web_unit_test_files")),
        ("Berkas e2e", ("tests", "web_e2e_spec_files")),
        ("Tangkapan layar di docs/images", ("docs", "screenshot_count_in_docs_images")),
    ]
    o_c, n_c = g(old, "git", "commit"), g(new, "git", "commit")
    o_d, n_d = g(old, "git", "commit_date"), g(new, "git", "commit_date")
    L = [f"# Perubahan sejak pengukuran lama\n",
         f"Lama: commit `{o_c}` ({o_d}) → Baru: commit `{n_c}` ({n_d})\n",
         "| Hal | Lama | Baru | Selisih |", "|---|---|---|---|"]
    changed = 0
    for label, path in rows:
        a, b = g(old, *path), g(new, *path)
        if a is None or b is None:
            continue
        if a != b:
            changed += 1
            L.append(f"| {label} | {a} | {b} | {b - a:+d} |")
    if not changed:
        L.append("| (tidak ada perubahan angka) | | | |")

    def names(d, *path, key="name"):
        items = g(d, *path, default=[]) or []
        return {(i[key] if isinstance(i, dict) else i) for i in items}

    for label, path, key in (
        ("Modul API", ("api", "modules"), "name"),
        ("Keputusan tercatat", ("docs", "decisions"), None),
        ("Dokumen di docs/", ("docs", "docs_md"), None),
        ("Skill repo", ("docs", "repo_skills"), None),
        ("Job terjadwal", ("jobs", "scheduled_job_files"), None),
        ("Kode peran", ("prisma", "role_codes"), None),
    ):
        a = names(old, *path, key=key) if key else names(old, *path)
        b = names(new, *path, key=key) if key else names(new, *path)
        add, rem = sorted(b - a), sorted(a - b)
        if add or rem:
            L.append("")
            L.append(f"**{label}**")
            if add:
                L.append("- baru: " + ", ".join(f"`{x}`" for x in add))
            if rem:
                L.append("- hilang: " + ", ".join(f"`{x}`" for x in rem))
    L.append("")
    L.append("Bagian dokumen yang menyebut hal-hal di atas perlu ditinjau ulang; selebihnya tidak perlu disentuh.")
    return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("repo", help="Path ke akar repo Cipansor")
    ap.add_argument("--out", default="facts-out", help="Folder keluaran (default: facts-out)")
    ap.add_argument("--compare", metavar="FACTS_LAMA.json",
                    help="Bandingkan dengan pengukuran lama; tulis perubahan.md (untuk memperbarui dokumen)")
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    if not (repo / "apps/api").is_dir() or not (repo / "apps/web").is_dir():
        print(f"ERROR: {repo} tidak tampak seperti repo Cipansor (apps/api dan apps/web tidak ada).", file=sys.stderr)
        return 2

    facts = collect(repo)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "facts.json").write_text(json.dumps(facts, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "facts.md").write_text(to_markdown(facts), encoding="utf-8")
    if args.compare:
        try:
            old = json.loads(Path(args.compare).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print(f"ERROR: tak bisa membaca {args.compare}: {e}", file=sys.stderr)
            return 2
        (out / "perubahan.md").write_text(compare(old, facts), encoding="utf-8")
        print(f"OK  perubahan.md -> {out}/")
    print(f"OK  facts.json + facts.md -> {out}/")
    print(
        f"    commit {facts['git']['commit']} | {facts['api']['module_count']} modul API | "
        f"{facts['prisma']['model_count']} model | {facts['prisma']['role_code_count']} kode peran | "
        f"{facts['web']['page_count']} halaman web"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
