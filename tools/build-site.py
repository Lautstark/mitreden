#!/usr/bin/env python3
"""Builds the static site page out of the same ui.html the container serves.

    python3 tools/build-site.py           # writes docs/app/index.html
    python3 tools/build-site.py --check   # fails if it is out of date

There is one interface, not two. The container reads ui.html straight off
disk; GitHub Pages cannot, because it only publishes docs/ and cannot run
anything. So the page is assembled here instead: the same markup, with the
languages baked in (there is no /api/strings to ask) and the local backend
loaded ahead of it.

--check is what CI runs. Editing ui.html and forgetting this step would leave
the published site quietly a version behind, which is exactly the kind of
difference nobody notices until it matters.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "ui.html"
LANGS = ROOT / "lang"
OUT = ROOT / "docs" / "app" / "index.html"

# The backend has to have run before the page's own script does, so it is a
# plain script and not a module: a module would be deferred to after it.
#
# The import map is for vits-web, which still imports onnxruntime-web by bare
# name and so expects a bundler. 1.18.0 on purpose: vits-web loads its wasm
# binaries from that exact version, and a mismatched pair fails deep inside
# the runtime with nothing useful to read. An import map has to be in the
# document before the first module loads, which is why it lives here and not
# in backend-local.js.
HEAD = """<script type="importmap">
{{
  "imports": {{
    "onnxruntime-web": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.wasm.min.js"
  }}
}}
</script>
<script>window.MITREDEN_STRINGS = {strings};</script>
<script src="backend-local.js"></script>
"""

NOTE = """<!-- Built by tools/build-site.py from ui.html. Do not edit by hand:
     the next build overwrites it, and the container would keep the old text. -->
"""


def strings():
    return {f.stem: json.loads(f.read_text(encoding="utf-8"))
            for f in sorted(LANGS.glob("*.json"))}


def build():
    page = UI.read_text(encoding="utf-8")
    marker = "<script>\nconst $=id=>document.getElementById(id);"
    if marker not in page:
        raise SystemExit("ui.html no longer starts its script the way this "
                         "expects — tools/build-site.py needs adjusting.")
    head = HEAD.format(strings=json.dumps(strings(), ensure_ascii=False,
                                          sort_keys=True))
    return NOTE + page.replace(marker, head + marker, 1)


if __name__ == "__main__":
    want = build()
    if "--check" in sys.argv:
        have = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if have != want:
            print("docs/app/index.html is out of date — run "
                  "`python3 tools/build-site.py`.", file=sys.stderr)
            raise SystemExit(1)
        print("docs/app/index.html is current.")
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(want, encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)} ({len(want):,} bytes)")
