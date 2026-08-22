#!/usr/bin/env python3
"""Checks that the page reaches exactly one host, and that the about pages say so.

The about pages tell people the voice is downloaded once and then it stays on
their machine. That is a promise about runtime behaviour made in prose, and
prose does not fail when the behaviour changes underneath it — the paragraph
goes on being reassuring while it stops being true.

The promise held when it was written: everything the page loads comes from our
own origin, except the voice model, which comes from where the piper project
publishes it. This asserts the shape that makes that true, so that adding a
font, an analytics snippet or a CDN script breaks a test rather than a promise.

Note what the vendored onnxruntime does when it wants a build we did not ship
(the non-SIMD fallback, deliberately left out to keep the download at 28 MB):
it resolves the name against its own script URL, asks our origin, and 404s. It
cannot fall back to a CDN, because the bundle names no CDN. Failing is the
correct behaviour here and the check below is what keeps it that way.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

# The one host the running page is allowed to reach, and why.
ALLOWED = {"huggingface.co": "the voice model, fetched once and cached in OPFS"}

# Hosts that may appear in prose, licences and XML namespaces but are never
# fetched: no code path turns these into a request.
PROSE_OK = {
    "creativecommons.org", "www.w3.org", "www.caito.de",
    "web.dev", "www.mp3dev.org", "github.com", "arasaac.org",
}


def hosts_in(text: str) -> set[str]:
    return set(re.findall(r"https?://([a-zA-Z0-9.-]+)", text))


def main() -> int:
    bad: list[str] = []

    # 1. Nothing the browser loads names a host outside the two lists above.
    shipped = [p for d in ("app", "ui", "vendor") for p in (DOCS / d).rglob("*.js")]
    shipped += [DOCS / "index.html"]
    for path in shipped:
        if not path.exists():
            continue
        for host in hosts_in(path.read_text(errors="replace")) - set(ALLOWED) - PROSE_OK:
            bad.append(f"{path.relative_to(ROOT)} names {host}, which is on neither list")

    # 2. No <script>/<link> in the page points off-origin. Vendoring was the
    #    whole point; a CDN tag would undo it without touching any module.
    page = (DOCS / "index.html").read_text(errors="replace")
    for tag in re.findall(r"<(?:script|link)\b[^>]*>", page):
        m = re.search(r'(?:src|href)\s*=\s*["\']([^"\']+)', tag)
        if m and re.match(r"https?://|//", m.group(1)):
            bad.append(f"docs/index.html loads {m.group(1)} from off-origin")

    # 3. The about pages must name the fetch, not only deny the ones we avoid.
    #    A page that says what does not leave, while silent on what does, is the
    #    exact failure this file exists to prevent.
    for name in ("about.html", "about.de.html"):
        text = (DOCS / name).read_text(errors="replace").lower()
        if "hugging face" not in text and "huggingface" not in text:
            bad.append(f"docs/{name} promises local operation without naming the one fetch")

    for line in bad:
        print(f"  {line}")
    if bad:
        print(f"\n{len(bad)} problem(s).")
        return 1

    print(f"  {len(shipped)} shipped file(s) reach {len(ALLOWED)} host: "
          + ", ".join(f"{h} — {why}" for h, why in ALLOWED.items()))
    print("  both about pages name it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
