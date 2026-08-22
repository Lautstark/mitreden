#!/usr/bin/env python3
"""Runs the browser build's audio tests, which are JavaScript.

The recording chain exists twice: once in mitreden.py with ffmpeg, once in
docs/audio.js for the browser. The Python half is covered by the tests
around it; the JavaScript half had nothing at all, and it is the half that
ships to a static site with no server between a bad commit and the visitor.

Those checks are in JavaScript because the code is, and they run under plain
node with no test framework and nothing installed — the same rule the rest of
this repository follows. This file is the bridge, so that `python3
tests/run.py` covers both halves and CI needs to know about only one command.

Skipped, not failed, where node is missing: a contributor without it can still
run everything else.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUITES = sorted((ROOT / "tests" / "browser").glob("*.test.mjs"))


def main() -> int:
    node = shutil.which("node")
    if not node:
        print("  skipped: node is not installed, so the browser tests cannot run")
        print("\n  All good.")
        return 0
    if not SUITES:
        print("  FAIL  no *.test.mjs found under tests/browser")
        return 1

    failed = []
    for suite in SUITES:
        print(f"  --- {suite.relative_to(ROOT)}")
        done = subprocess.run([node, str(suite)], capture_output=True, text=True)
        for line in (done.stdout or "").splitlines():
            if line.strip() and "All good" not in line:
                print(f"  {line}")
        if done.returncode:
            sys.stderr.write(done.stderr)
            failed.append(suite.name)

    if failed:
        print(f"\n  {len(failed)} suite(s) failed: {', '.join(failed)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
