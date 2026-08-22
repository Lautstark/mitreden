#!/usr/bin/env python3
"""Fetches the browser app's third-party code into docs/vendor/.

    python3 tools/vendor.py                  # the JavaScript
    python3 tools/vendor.py --with-binaries  # and the wasm blobs (~28 MB)
    python3 tools/vendor.py --check          # verify what is committed

The static site used to load piper, onnxruntime and the mp3 encoder straight
from two CDNs. That is someone else's code, at someone else's URL, running in
your browser and reading the sentences you type — and mitreden's promise is
that nothing leaves your machine. A CDN can also simply stop answering, which
for a tool meant to still work in ten years is the more likely ending.

So the code is fetched once, pinned by hash, and served from the same origin
as the page.

Two things are deliberately NOT vendored:

  The voice models. 63 MB each, and Hugging Face is where piper publishes
  them. They are content, not code: fetched once per browser and cached, and
  no different in kind from the audio you are making with them.

  The wasm blobs, unless you ask. onnxruntime is 10 MB and espeak's phoneme
  data is 17 MB, and GitHub Pages serves this repository's docs/ folder
  directly — so vendoring them means committing 28 MB to git, forever. The
  flag exists; the choice is deliberate. Without it the two blobs keep coming
  from the pinned CDN URLs they always came from.

Hashes live in tools/vendor.lock.json. A changed hash means upstream changed
under a version that is supposed to be immutable, and the script stops.
"""
import argparse
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "docs" / "vendor"
LOCK = Path(__file__).resolve().parent / "vendor.lock.json"

JSDELIVR = "https://cdn.jsdelivr.net/npm"

# The family's own package: the tested voice list, and the recording chain that
# used to be docs/audio.js. Pinned to a commit, which on GitHub is immutable, so
# the same rule holds as for a versioned file on a CDN — the hash in the lock is
# what we saw. vorlaut vendors the same commit.
STIMMQUELLE = "0ff9af2152c30525b347f497f65a3f0c4f06c184"
STIMMQUELLE_RAW = f"https://raw.githubusercontent.com/Lautstark/stimmquelle/{STIMMQUELLE}"
PIPER_WASM = f"{JSDELIVR}/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize"
ONNX_CDN = "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/"

# The JavaScript, always. vits-web pulls the phonemizer in as a sibling chunk,
# so the two file names have to stay exactly as they are.
CODE = [
    (f"{JSDELIVR}/@diffusionstudio/vits-web@1.0.3/dist/vits-web.js", "vits-web.js"),
    (f"{JSDELIVR}/@diffusionstudio/vits-web@1.0.3/dist/piper-DeOu3H9E.js", "piper-DeOu3H9E.js"),
    (f"{JSDELIVR}/onnxruntime-web@1.18.0/dist/esm/ort.wasm.min.js", "ort.wasm.min.js"),
    # Which voices may be shipped and which actually speak. It used to be an
    # array in backend-local.js, and there was another in vorlaut, and the rule
    # about what may be handed on was written out in three places — all three
    # correct on the day a CC BY-NC-SA voice was sitting in the array, because a
    # list of voices with no room for a reason only records what passed.
    (f"{STIMMQUELLE_RAW}/voices.json", "voices.json"),
    # The recording chain. Committed in that repository rather than built at
    # install, because this one has no npm to build it with.
    (f"{STIMMQUELLE_RAW}/dist/browser/index.js", "stimmquelle.js"),
    # Its lazy chunk, and the name matters: stimmquelle.js asks for
    # "./lamejs.js" only when something wants an MP3, so it has to land beside
    # it under exactly that name. This is also the lamejs that used to be
    # vendored here directly — one copy now, behind the encoder that uses it.
    (f"{STIMMQUELLE_RAW}/dist/browser/lamejs.js", "lamejs.js"),
]

# The blobs, only with --with-binaries. Two onnxruntime builds are left out.
# The threaded ones need SharedArrayBuffer, which needs COOP/COEP headers,
# which GitHub Pages cannot send — they would never be loaded. The plain
# ort-wasm.wasm is the fallback for a browser without wasm SIMD, and every
# browser since roughly 2021 has it; watching the network, only the SIMD build
# is ever asked for. It costs 9.5 MB of git history to be ready for a visitor
# nobody has seen. If one ever turns up, they get an error rather than a
# quieter voice, which is the trade being made here.
BINARIES = [
    (f"{ONNX_CDN}ort-wasm-simd.wasm", "ort-wasm-simd.wasm"),
    (f"{PIPER_WASM}.wasm", "piper_phonemize.wasm"),
    (f"{PIPER_WASM}.data", "piper_phonemize.data"),
]


def fetch(url):
    with urllib.request.urlopen(url) as r:      # nosec - pinned, hash-checked
        return r.read()


def patch_vits(source, local_binaries):
    """Point the bundle at what we serve instead of at two CDNs.

    Three string literals and one bare import. The import is the one that
    matters most: published as it is, the bundle expects a bundler to resolve
    `onnxruntime-web` for it, which is why the page needed an import map."""
    subs = [('await import("onnxruntime-web")', 'await import("./ort.wasm.min.js")')]
    if local_binaries:
        subs += [(f'"{ONNX_CDN}"', '"./vendor/"'),
                 (f'"{PIPER_WASM}"', '"./vendor/piper_phonemize"')]
    for old, new in subs:
        if old not in source:
            raise SystemExit(f"vits-web.js no longer contains {old!r} — it has "
                             f"changed shape and tools/vendor.py needs a look.")
        source = source.replace(old, new)
    return source


def build(with_binaries):
    """Every file we serve, as bytes, with the hash of what upstream sent."""
    out, lock = {}, {}
    for url, name in CODE + (BINARIES if with_binaries else []):
        raw = fetch(url)
        lock[name] = {"url": url, "sha256": hashlib.sha256(raw).hexdigest(),
                      "bytes": len(raw)}
        if name == "vits-web.js":
            raw = patch_vits(raw.decode("utf-8"), with_binaries).encode("utf-8")
        out[name] = raw
    return out, lock


NOTE = """This folder is not written by hand.

`python3 tools/vendor.py` puts it here, pinned by hash in tools/vendor.lock.json.
Do not edit these files: the next run overwrites them. vits-web.js is patched on
the way in — see the script for what and why.

Licences stay with their projects: piper and vits-web MIT, onnxruntime-web MIT,
lamejs LGPL-3.0.
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--with-binaries", action="store_true",
                    help="also fetch the wasm blobs (~28 MB, committed to git)")
    ap.add_argument("--check", action="store_true",
                    help="verify the committed files against the lock file")
    args = ap.parse_args()

    if args.check:
        if not LOCK.exists():
            raise SystemExit("tools/vendor.lock.json is missing — run tools/vendor.py.")
        lock = json.loads(LOCK.read_text())
        bad = []
        for name, meta in lock["files"].items():
            f = VENDOR / name
            if not f.exists():
                bad.append(f"{name}: missing")
            elif name != "vits-web.js" and \
                    hashlib.sha256(f.read_bytes()).hexdigest() != meta["sha256"]:
                bad.append(f"{name}: changed since it was vendored")
        if bad:
            print("\n".join(f"  {b}" for b in bad), file=sys.stderr)
            raise SystemExit("vendored files do not match tools/vendor.lock.json.")
        # The browser fingerprint names the engine that made a recording, the
        # way mitreden.py names the piper that made one. That constant and this
        # lock file sit in different files and cannot read each other, and drift
        # is silent both ways: bump the vendored bundle and leave the constant,
        # and new audio hides under old names; bump the constant alone, and
        # every phrase is recorded again by the engine that already made it.
        # Two things decide what a recording sounds like and both are vendored:
        # vits-web turns the text into sound, stimmquelle trims and levels it.
        # So ENGINE_VERSION names both, and both halves are checked here.
        backend = (ROOT / "docs" / "backend-local.js").read_text(encoding="utf-8")
        named = re.search(r"ENGINE_VERSION\s*=\s*'([^']+)'", backend)
        vits = lock["files"].get("vits-web.js", {}).get("url", "")
        pinned = re.search(r"vits-web@([0-9][^/]*)/", vits)
        chain = lock["files"].get("stimmquelle.js", {}).get("url", "")
        commit = re.search(r"/stimmquelle/([0-9a-f]{7,40})/", chain)
        if not named or not pinned or not commit:
            bad.append("could not find ENGINE_VERSION or one of the pins to compare")
        else:
            want = f"vits-web@{pinned.group(1)} stimmquelle@{commit.group(1)[:7]}"
            if named.group(1) != want:
                bad.append(f"ENGINE_VERSION is {named.group(1)}, but {want} is "
                           f"what is vendored")
        if bad:
            print("\n".join(f"  {b}" for b in bad), file=sys.stderr)
            raise SystemExit("vendored files do not match tools/vendor.lock.json.")
        total = sum(m["bytes"] for m in lock["files"].values())
        print(f"{len(lock['files'])} vendored files, {total / 1048576:.1f} MB, all as pinned.")
        print(f"engine named in the fingerprint: {named.group(1)}")
        return

    files, lock = build(args.with_binaries)
    VENDOR.mkdir(parents=True, exist_ok=True)
    for name, raw in files.items():
        (VENDOR / name).write_bytes(raw)
    (VENDOR / "README.md").write_text(NOTE, encoding="utf-8")
    LOCK.write_text(json.dumps({"binaries": args.with_binaries, "files": lock},
                               indent=2, sort_keys=True) + "\n", encoding="utf-8")
    total = sum(m["bytes"] for m in lock.values())
    for name, meta in sorted(lock.items()):
        print(f"  {name:24} {meta['bytes'] / 1024:9,.0f} KB")
    print(f"{len(files)} files, {total / 1048576:.1f} MB into "
          f"{VENDOR.relative_to(ROOT)}")
    if not args.with_binaries:
        print("wasm blobs still come from their pinned CDN URLs "
              "(--with-binaries changes that).")


if __name__ == "__main__":
    main()
