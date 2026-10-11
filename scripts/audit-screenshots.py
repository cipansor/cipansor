#!/usr/bin/env python3
"""Flag screenshots that are effectively blank (all-white or a single flat
colour), which the DOM-based sweep cannot see: a page can have text in the
accessibility tree yet paint nothing.

    python3 scripts/audit-screenshots.py apps/web/.qa-all
"""
from __future__ import annotations

import os
import sys

from PIL import Image

# Pages that are legitimately almost all white and must not be reported as
# blank. Each entry needs a reason: this is the one place a real blank page
# could hide, so it stays short and specific.
ALLOWLIST = {
    "unauthorized.png": "centred 403 card on an empty page - white is correct",
    # `public/…` is the same page captured via the public host.
    "public/unauthorized.png": "centred 403 card on an empty page - white is correct",
}


def audit(path: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for root, _dirs, files in os.walk(path):
        for name in sorted(files):
            if not name.endswith(".png"):
                continue
            full = os.path.join(root, name)
            rel = os.path.relpath(full, path)
            if rel.replace(os.sep, "/") in ALLOWLIST:
                continue
            try:
                im = Image.open(full).convert("RGB").resize((160, 100))
            except Exception as e:  # unreadable file is itself a problem
                out.append((rel, f"unreadable: {e}"))
                continue
            pixels = list(im.getdata())
            total = len(pixels)
            white = sum(1 for p in pixels if min(p) > 245)
            if white / total > 0.97:
                out.append((rel, f"blank/white ({white * 100 // total}% white)"))
                continue
            # Flat single colour: nearly no variance across the image.
            avg = tuple(sum(c[i] for c in pixels) // total for i in range(3))
            varied = sum(
                1
                for p in pixels
                if abs(p[0] - avg[0]) + abs(p[1] - avg[1]) + abs(p[2] - avg[2]) > 18
            )
            if varied / total < 0.02:
                out.append((rel, f"flat colour rgb{avg}"))
    return out


def main() -> int:
    target = sys.argv[1] if len(sys.argv) > 1 else "apps/web/.qa-all"
    problems = audit(target)
    print(f"{target}: {len(problems)} suspicious screenshots")
    for rel, why in problems:
        print(f"  {rel}: {why}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())