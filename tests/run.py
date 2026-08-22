#!/usr/bin/env python3
"""Runs every test in this folder and says what failed.

    python3 tests/run.py              # all of them
    python3 tests/run.py voice        # only the ones whose name contains this

The folder is the list. A file named test_*.py runs, and that is the whole
rule — nothing has to be added to a workflow by hand, so a test nobody
remembered to register cannot sit there looking exactly like a test that
passes.

Each test is a separate process on purpose. mitreden reads MITREDEN_DIR once,
when it is imported, and every one of these points it at a temporary folder of
its own; importing them all into one interpreter would let the first one decide
where the others keep their phrases. Two of them start the real server and bind
a port as well.

The exit code is what CI reads: 0 only if every test passed.

This mirrors tests/run.py in the vorlaut project, deliberately — the two are
neighbours and there is no reason to learn a second set of habits to read them.
"""

from __future__ import annotations

import subprocess
import sys
import time

SKIPPED = 77                       # a test that could not run, not one that passed
from pathlib import Path

HERE = Path(__file__).resolve().parent


def tests_matching(needles: list[str]) -> list[Path]:
    """Every test file, or the ones whose name contains one of the arguments.

    A substring rather than the whole name, so that "voice" finds
    test_voice.py without anybody typing the prefix and the suffix.
    """
    found = sorted(HERE.glob("test_*.py"))
    if not needles:
        return found
    return [t for t in found if any(n in t.name for n in needles)]


def main(argv: list[str]) -> int:
    tests = tests_matching(argv[1:])
    if not tests:
        print("No test matches that.", file=sys.stderr)
        return 2

    failed: list[str] = []
    skipped: list[str] = []
    started = time.time()
    for test in tests:
        print(f"\n=== {test.name} " + "=" * max(0, 60 - len(test.name)), flush=True)
        # Output goes straight through rather than being captured: what these
        # tests print is meant to be read, and holding it back until the end
        # would turn a run that hangs into a run that says nothing.
        result = subprocess.run([sys.executable, str(test)], cwd=HERE.parent)
        # 77 means the test could not run at all — a missing browser, not a
        # verdict. Counting it as a pass is how a suite goes green while the
        # thing it was written to check never happened.
        if result.returncode == SKIPPED:
            skipped.append(test.name)
        elif result.returncode != 0:
            failed.append(test.name)

    print("\n" + "=" * 68)
    ran = len(tests) - len(skipped)
    line = f"{ran} test file(s) in {time.time() - started:.0f}s"
    if skipped:
        line += f", {len(skipped)} skipped: " + ", ".join(skipped)
    print(line)
    if failed:
        print(f"{len(failed)} failed:")
        for name in failed:
            print(f"  {name}")
        return 1
    print("All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
