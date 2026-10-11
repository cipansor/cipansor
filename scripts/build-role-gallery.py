#!/usr/bin/env python3
"""Generate a per-role gallery from the role visual-QA sweep.

Each of the 66 demo accounts gets a section showing the pages its menu actually
opens, as captured by `apps/web/scripts/screenshot-roles.ts`. Output:
`docs/_roles-gallery.md`.

    python3 scripts/build-role-gallery.py
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "apps", "web")
REPORT = os.path.join(WEB, ".qa-screens", "report.json")
OUT_DIR = os.path.join(ROOT, "docs", "images", "roles")
FRAGMENT = os.path.join(ROOT, "docs", "_roles-gallery.md")

THUMB_W = 480
QUALITY = 56
MAX_PER_ROLE = 60


def slug(role: str) -> str:
    return role


def main() -> int:
    with open(REPORT) as f:
        report = json.load(f)

    by_role: dict[str, list[dict]] = defaultdict(list)
    seen: set[tuple[str, str]] = set()
    for r in report:
        if not r.get("ok"):
            continue
        key = (r["role"], r["path"])
        if key in seen:
            continue
        seen.add(key)
        by_role[r["role"]].append(r)

    os.makedirs(OUT_DIR, exist_ok=True)
    total = 0
    lines = [
        "## Galeri Per Peran",
        "",
        "Setiap dari **66 akun demo** (`RoleCode`) beserta halaman yang benar-benar "
        "dibuka oleh menunya, ditangkap dengan sesi login peran tersebut. Halaman "
        "yang sengaja hanya menampilkan pesan RBAC tidak dihitung sebagai kegagalan.",
        "",
    ]
    for role in sorted(by_role):
        entries = sorted(by_role[role], key=lambda x: x["path"])[:MAX_PER_ROLE]
        # Prefer the role's dashboard/index first.
        entries.sort(key=lambda x: (len(x["path"]), x["path"]))
        lines.append("<details>")
        lines.append(f"<summary><code>{role}</code> — {len(entries)} halaman</summary>")
        lines.append("")
        lines.append("| Halaman | Rute |")
        lines.append("| --- | --- |")
        for rec in entries:
            shot = rec["screenshot"]
            shot = shot if os.path.isabs(shot) else os.path.join(WEB, shot)
            if not os.path.exists(shot):
                continue
            name = f"{slug(role)}__{rec['path'][1:].replace('/', '__') or 'root'}.webp"
            out = os.path.join(OUT_DIR, name)
            im = Image.open(shot).convert("RGB")
            if im.width > THUMB_W:
                im = im.resize((THUMB_W, round(im.height * THUMB_W / im.width)), Image.LANCZOS)
            im.save(out, "WEBP", quality=QUALITY, method=6)
            lines.append(
                f"| <img src=\"docs/images/roles/{name}\" width=\"360\" alt=\"{role} {rec['path']}\"> "
                f"| `{rec['path']}` |"
            )
            total += 1
        lines.append("")
        lines.append("</details>")
        lines.append("")

    with open(FRAGMENT, "w") as f:
        f.write("\n".join(lines))
    print(f"wrote {total} role thumbnails for {len(by_role)} roles -> {FRAGMENT}")

    return 0


if __name__ == "__main__":
    sys.exit(main())