#!/usr/bin/env python3
"""Checks what a fingerprint counts, and what it must not.

A fingerprint decides whether a phrase still counts as recorded. Two things
were wrong with it, and both were silent — no error, just audio that was
either stale or needlessly made again.

It contained the model's *path*. The container keeps its voices under /voices
and a laptop keeps them beside the phrases, so the same voice saying the same
sentence fingerprinted differently on the two machines. Carrying a phrases.json
between them re-rendered every piper phrase for nothing.

It did not contain the *piper version*. piper is what turns text into sound, so
a release that changes how a voice speaks leaves old recordings sitting under
names that claim to match new ones. Record half a set, upgrade, record the
rest, and one child's talker says two sentences in two voices — which is the
one thing this program exists to prevent.

So the rule is: what a fingerprint counts is what changes the sound. The text,
the voice, the output format and the program doing the speaking. Never where
any of it happens to live.

The last check here is the link between two files that cannot read each other.
The README tells people which piper to install; mitreden.py names the piper
the fingerprint counts. Drift is silent in both directions — the instruction
bumped and the constant left behind means new audio under old names, the
constant bumped and the instruction left behind means every phrase rendered
again by the piper that already made it.

It used to read the pin out of the Dockerfile. There is no Dockerfile any
more — the browser build is the product and the container is gone — so the
place that tells someone which piper to install is the README, and that is
what this now reads.
"""

from __future__ import annotations

import os
import pathlib
import re
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

os.environ["MITREDEN_DIR"] = tempfile.mkdtemp(prefix="mitreden-fingerprint-")
sys.path.insert(0, str(ROOT))
import mitreden as m                                  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def piper_cfg(model: str, binary: str = "piper") -> dict:
    return dict(m.DEFAULT_CONFIG, backend="piper",
                piper={"model": model, "binary": binary})


def check_paths_do_not_count() -> None:
    """The same voice on two machines is the same recording."""
    container = m.fingerprint("Hallo.", piper_cfg("/voices/de_DE-thorsten-medium.onnx"))
    laptop = m.fingerprint("Hallo.", piper_cfg(
        "/home/someone/mitreden/voices/de_DE-thorsten-medium.onnx"))
    check("the model's folder does not change the fingerprint",
          container == laptop, f"{container} vs {laptop}")

    here = m.fingerprint("Hallo.", piper_cfg("de_DE-thorsten-medium.onnx", "piper"))
    there = m.fingerprint("Hallo.", piper_cfg("de_DE-thorsten-medium.onnx",
                                              "/usr/local/bin/piper"))
    check("where the program lives does not change it either",
          here == there, f"{here} vs {there}")


def check_the_voice_still_counts() -> None:
    """Everything that does change the sound still has to."""
    thorsten = m.fingerprint("Hallo.", piper_cfg("/voices/de_DE-thorsten-medium.onnx"))
    kerstin = m.fingerprint("Hallo.", piper_cfg("/voices/de_DE-kerstin-low.onnx"))
    check("a different model is a different recording", thorsten != kerstin)

    other_text = m.fingerprint("Tschüss.", piper_cfg("/voices/de_DE-thorsten-medium.onnx"))
    check("a different text is a different recording", thorsten != other_text)

    cfg = piper_cfg("/voices/de_DE-thorsten-medium.onnx")
    as_wav = dict(cfg, output=dict(cfg.get("output") or {}, format="wav"))
    check("a different output format is a different recording",
          thorsten != m.fingerprint("Hallo.", as_wav))


def check_piper_version_counts() -> None:
    """Bumping piper has to invalidate what piper made — and only that."""
    before = m.fingerprint("Hallo.", piper_cfg("/voices/de_DE-thorsten-medium.onnx"))
    real = m.PIPER_VERSION
    try:
        m.PIPER_VERSION = real + ".test"
        after = m.fingerprint("Hallo.", piper_cfg("/voices/de_DE-thorsten-medium.onnx"))
        check("a new piper renames what piper recorded", before != after)

        # Azure synthesises on somebody else's machine. Which piper is
        # installed here says nothing about how those recordings came out, so
        # bumping it must not quietly re-render every cloud-spoken phrase.
        azure = dict(m.DEFAULT_CONFIG, backend="azure")
        with_test = m.fingerprint("Hallo.", azure)
        m.PIPER_VERSION = real
        without = m.fingerprint("Hallo.", azure)
        check("a new piper leaves Azure recordings alone", with_test == without)
    finally:
        m.PIPER_VERSION = real


def check_the_pin_and_the_constant_agree() -> None:
    """The link between two files that cannot read each other."""
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    found = re.search(r"piper-tts\s*==\s*([0-9][0-9A-Za-z.\-]*)", readme)
    if not found:
        check("the README pins piper-tts", False,
              "no `piper-tts==` found — telling people to install whatever is "
              "current lets the voice change under a fingerprint that says "
              "nothing changed")
        return
    check("the README pins piper-tts", True, found.group(1))
    check("the pin and PIPER_VERSION are the same version",
          found.group(1) == m.PIPER_VERSION,
          f"README {found.group(1)}, mitreden.py {m.PIPER_VERSION}")


def main() -> int:
    check_paths_do_not_count()
    check_the_voice_still_counts()
    check_piper_version_counts()
    check_the_pin_and_the_constant_agree()

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
