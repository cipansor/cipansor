#!/usr/bin/env python3
"""Fail if any README/docs markdown references an image that is not on disk.

A dangling image renders as a broken icon in the GitHub README, which is exactly
the "does not display" defect this repo's gallery is meant to avoid.

Image paths in Markdown resolve relative to the referring document, not to the
repository root: a guide at `docs/PANDUAN.md` writing `screens/x.png` means
`docs/screens/x.png`. Resolving from the root instead made every guide image
look missing while the files sat right where the guide pointed (the finding at
`docs/README.md:R82-85`). Both bases are tried, so a legacy root-relative link
in `README.md` still resolves.

    python3 scripts/check-doc-refs.py
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = ["README.md"]
for name in os.listdir(os.path.join(ROOT, "docs")):
    if name.endswith(".md"):
        DOCS.append(os.path.join("docs", name))

IMG_RX = re.compile(r'(?:!\[[^\]]*\]\(([^)\s]+)|<img[^>]+src="([^"]+)")')
EXTERNAL = ("http://", "https://", "data:")

# Directories whose committed images are tracked for the orphan scan. Both the
# hand-curated `docs/images/` gallery and the captured `docs/screens/` flow
# shots are scanned; adding a third means adding it here.
IMAGE_DIRS = [os.path.join("docs", "images"), os.path.join("docs", "screens")]
# Built locally by the gallery scripts and gitignored, so never an orphan here.
GENERATED_DIRS = [os.path.join("docs", "images", "pages"), os.path.join("docs", "images", "roles")]
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")


def resolve(doc: str, target: str) -> str | None:
    """The repo-relative path `target` points at from `doc`, or None.

    Markdown resolves a relative image path against the directory of the file
    that contains it; a leading `/` resolves against the repo root.
    """
    target = target.split("?")[0].split("#")[0]
    if target.startswith("/"):
        candidates = [os.path.join(ROOT, target.lstrip("/"))]
    else:
        candidates = [
            os.path.join(ROOT, os.path.dirname(doc), target),
            os.path.join(ROOT, target),
        ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return os.path.normpath(os.path.relpath(candidate, ROOT))
    return None


def main() -> int:
    referenced: set[str] = set()
    missing: list[tuple[str, str]] = []
    for doc in DOCS:
        path = os.path.join(ROOT, doc)
        if not os.path.exists(path):
            continue
        text = open(path, encoding="utf-8").read()
        for m in IMG_RX.finditer(text):
            target = m.group(1) or m.group(2)
            if not target or target.startswith(EXTERNAL):
                continue
            resolved = resolve(doc, target)
            if resolved is None:
                missing.append((doc, target))
                continue
            referenced.add(resolved)

    on_disk: set[str] = set()
    for image_dir in IMAGE_DIRS:
        base = os.path.join(ROOT, image_dir)
        for root, _dirs, files in os.walk(base):
            rel_root = os.path.normpath(os.path.relpath(root, ROOT))
            if any(rel_root == g or rel_root.startswith(g + os.sep) for g in GENERATED_DIRS):
                continue
            for f in files:
                if f.lower().endswith(IMAGE_EXT):
                    on_disk.add(os.path.normpath(os.path.relpath(os.path.join(root, f), ROOT)))

    orphans = sorted(on_disk - referenced)

    print(f"referenced: {len(referenced)}  on disk: {len(on_disk)}")
    for doc, target in sorted(missing):
        print(f"  MISSING {doc} -> {target}")
    for orphan in orphans:
        print(f"  ORPHAN {orphan}")
    print(f"\n{len(missing)} dangling image reference(s), {len(orphans)} orphaned image(s)")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())