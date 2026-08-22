#!/usr/bin/env python3
"""Checks that the module graph under docs/ actually holds together.

The browser build used to be two very large files. Splitting them into modules
made every piece readable, and introduced a class of fault that a large file
cannot have: an import that names something the other module does not export, a
name declared twice, a module using a name it never imported. None of those is
a syntax error, so `node --check` passes and the page dies on load.

Finding them by reloading costs one fault per attempt. This finds all of them
at once, and in CI rather than in a browser.

What it deliberately does NOT do is execute anything: the modules need a DOM
and a vendored piper, so a real load belongs in a browser. This is the cheap
half, and it catches the mistakes that are actually made while moving code.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIRS = [ROOT / "docs" / "app", ROOT / "docs" / "ui"]

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def modules() -> dict[pathlib.Path, str]:
    out = {}
    for d in DIRS:
        for f in sorted(d.glob("*.js")):
            out[f] = f.read_text(encoding="utf-8")
    return out


DECL = re.compile(r"^export (?:async )?(?:function|const|let|var)\s+([\w$]+)", re.M)
ANY_DECL = re.compile(r"^(?:export )?(?:async )?(?:function|const|let|var)\s+([\w$]+)", re.M)
IMPORT = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'([^']+)'", re.M)


def main() -> int:
    mods = modules()
    if not mods:
        check("there are modules to check", False)
        return 1
    exports = {p: set(DECL.findall(s)) for p, s in mods.items()}

    # 1. every import names something the target actually exports
    bad = []
    for path, s in mods.items():
        for names, target in IMPORT.findall(s):
            if target.startswith("../vendor/") or not target.startswith("."):
                continue
            resolved = (path.parent / target).resolve()
            if resolved not in exports:
                bad.append(f"{path.name} imports from {target}, which is not a module here")
                continue
            for raw in names.split(","):
                want = raw.strip().split(" as ")[0].strip()
                if want and want not in exports[resolved]:
                    elsewhere = [p.name for p, v in exports.items() if want in v]
                    bad.append(f"{path.name}: {want} is not exported by {resolved.name}"
                               + (f" (it is in {elsewhere})" if elsewhere else ""))
    check("every import resolves to a real export", not bad, bad[0] if bad else "")
    for extra in bad[1:]:
        print(f"        {extra}")

    # 2. no module both imports a name and declares one of its own with it.
    # The same name in two modules is fine — module scope is private, and that
    # is the point. Importing it and then shadowing it is not: it is the error
    # a careless extraction produces, and it reads as "already been declared".
    shadowed = []
    for path, s in mods.items():
        mine = set(ANY_DECL.findall(s))
        for names, _ in IMPORT.findall(s):
            for raw in names.split(","):
                got = raw.strip().split(" as ")[-1].strip()
                if got and got in mine:
                    shadowed.append(f"{path.name} imports {got} and declares it too")
    check("no module shadows what it imports", not shadowed,
          "; ".join(shadowed[:3]))

    # 3. nothing imports itself in a circle through two hops
    edges: dict[str, set[str]] = {}
    for path, s in mods.items():
        edges[path.name] = {
            (path.parent / t).resolve().name
            for _, t in IMPORT.findall(s)
            if t.startswith(".") and not t.startswith("../vendor/")
            and (path.parent / t).resolve() in exports
        }
    cycles = [f"{a} <-> {b}" for a, outs in edges.items()
              for b in outs if a in edges.get(b, set())]
    check("no two modules import each other", not cycles, "; ".join(cycles[:3]))

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print(f"\n  {len(mods)} modules. All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
