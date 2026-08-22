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


DECL = re.compile(r"^export (?:async )?(?:function|const|let|var)\s+(.+)$", re.M)

# `export const A = 1, B = 2` declares both. Reading only the first name is how
# a real export gets reported as missing, which sends the reader to fix the
# import that was right all along.
def declared(line: str) -> list[str]:
    m = re.match(r"([\w$]+)", line.strip())
    if not m:
        return []
    names, depth = [m.group(1)], 0
    for i, ch in enumerate(line):
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            more = re.match(r"\s*([\w$]+)", line[i + 1:])
            if more:
                names.append(more.group(1))
    return names
ANY_DECL = re.compile(r"^(?:export )?(?:async )?(?:function|const|let|var)\s+([\w$]+)", re.M)
# The path may be empty: bound_names reads a copy with string bodies blanked,
# and a `+` here quietly matched nothing there, so every imported name looked
# undeclared.
IMPORT = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'([^']*)'", re.M)



# Everything a module binds a name with. Deliberately generous: counting one
# name too many costs a missed fault, counting one too few cries wolf, and a
# check that cries wolf is one nobody reads.
BIND_KW = re.compile(r"\b(?:let|const|var)\s+")
# Words that can stand before a bracket without being a call.
KEYWORDS = set("""
if for while switch catch return typeof instanceof void delete await yield new async
function class do else try in of case break continue throw import export default
""".split())

GLOBALS = set("""
window document console navigator location history screen fetch Response Request Headers
setTimeout clearTimeout setInterval clearInterval queueMicrotask requestAnimationFrame
Promise Array Object String Number Boolean Math JSON Date RegExp Map Set WeakMap WeakSet
Error TypeError RangeError Symbol Proxy Reflect Intl AbortController
Uint8Array Int16Array Uint16Array Int32Array Uint32Array Float32Array Float64Array
ArrayBuffer DataView Blob File FileReader FormData URL URLSearchParams TextEncoder TextDecoder
indexedDB IDBKeyRange caches crypto performance structuredClone atob btoa
AudioContext OfflineAudioContext Audio Image Option Event CustomEvent KeyboardEvent Worker
addEventListener removeEventListener dispatchEvent matchMedia getComputedStyle
alert confirm prompt isNaN parseInt parseFloat encodeURIComponent decodeURIComponent
globalThis undefined NaN Infinity self
""".split())


def without_noise(src: str) -> str:
    """Comments and string bodies, blanked, so only code is read.

    Scanned rather than matched. A regex for block comments reads `lang/*.json`
    inside a line comment as the start of one and swallows everything up to the
    next `*/` — which here was two dozen lines of real declarations, quietly
    turning them into names nothing declared.
    """
    out, i, n = [], 0, len(src)
    while i < n:
        c, nxt = src[i], src[i + 1:i + 2]
        if c == "/" and nxt == "/":
            while i < n and src[i] != "\n":
                i += 1
        elif c == "/" and nxt == "*":
            i += 2
            while i < n and src[i:i + 2] != "*/":
                i += 1
            i += 2
        elif c in "'\"`":
            quote, i = c, i + 1
            while i < n and src[i] != quote:
                i += 2 if src[i] == "\\" else 1
            i += 1
            out.append(quote * 2)
        else:
            out.append(c)
            i += 1
    return "".join(out)


def bound_names(src: str) -> set[str]:
    names: set[str] = set()
    # let/const/var, including `const a = 1, b = 2` and destructuring patterns
    for m in BIND_KW.finditer(src):
        i = m.end()
        depth, j = 0, i
        while j < len(src):
            c = src[j]
            if c in "([{":
                depth += 1
            elif c in ")]}":
                if depth == 0:
                    break
                depth -= 1
            elif depth == 0 and c == ";":
                break
            elif depth == 0 and c == "\n":
                if not src[i:j].rstrip().endswith((",", "=", "(", "&&", "||", "?", ":", "+")):
                    break
            j += 1
        names |= set(re.findall(r"[A-Za-z_$][\w$]*", src[i:j]))
    names |= set(re.findall(r"\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)", src))
    names |= set(re.findall(r"\bclass\s+([A-Za-z_$][\w$]*)", src))
    names |= set(re.findall(r"\bcatch\s*\(\s*([A-Za-z_$][\w$]*)", src))
    # parameter lists, of both function and arrow forms
    for m in re.finditer(r"\(([^()]*)\)\s*(?:=>|\{)", src):
        names |= set(re.findall(r"[A-Za-z_$][\w$]*", m.group(1)))
    names |= set(re.findall(r"(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>", src))
    for names_part, _ in IMPORT.findall(src):
        for raw in names_part.split(","):
            got = raw.strip().split(" as ")[-1].strip()
            if got:
                names.add(got)
    names |= set(re.findall(r"\bimport\s+([A-Za-z_$][\w$]*)", src))
    return names


def main() -> int:
    mods = modules()
    if not mods:
        check("there are modules to check", False)
        return 1
    exports = {p: {n for line in DECL.findall(s) for n in declared(line)}
               for p, s in mods.items()}

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
    # 2b. no module assigns to a name it imported. An imported binding is
    # read-only, so the assignment throws at runtime — in strict mode, silently
    # as far as the page is concerned, because it happens inside whatever
    # handler ran. The page's language was set this way and never arrived.
    written = []
    for path, s in mods.items():
        imported = set()
        for names, _ in IMPORT.findall(s):
            for raw in names.split(","):
                got = raw.strip().split(" as ")[-1].strip()
                if got:
                    imported.add(got)
        for name in sorted(imported):
            hit = re.search(r"(?<![\w$.])" + re.escape(name) +
                            r"\s*(?:\+\+|--|[+\-*/%|&^]?=(?![=>]))", s)
            if hit:
                written.append(f"{path.name} assigns to {name}, which it imports")
    check("no module assigns to what it imports", not written,
          "\n".join(f"        {w}" for w in written))

    # 2c. no module assigns to a name nothing ever declared. Modules are strict,
    # so this throws where it stands — inside a handler, where the page simply
    # stops doing that one thing and says nothing. Renaming a Sammlung and the
    # page's own language both failed this way, in different files, unnoticed.
    stray = []
    for path, s in mods.items():
        clean = without_noise(s)
        known = bound_names(clean) | GLOBALS
        for m in re.finditer(r"(?<![\w$.])([A-Za-z_$][\w$]*)\s*"
                             r"(?:\+\+|--|[+\-*/%|&^]?=(?![=>]))", clean):
            if m.group(1) not in known:
                stray.append(f"{path.name} assigns to {m.group(1)}, which is declared nowhere")
        # Calling one is the same fault wearing a different hat, and it is how
        # both a menu action and the whole voice picker died: the split left a
        # function in a file where neither it nor what it calls existed.
        for m in re.finditer(r"(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(", clean):
            name = m.group(1)
            if name not in known and name not in KEYWORDS:
                stray.append(f"{path.name} calls {name}, which is declared nowhere")

    stray = sorted(set(stray))
    check("no module assigns to a name it never declared", not stray,
          "\n".join(f"        {w}" for w in stray))

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
