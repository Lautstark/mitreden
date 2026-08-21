#!/usr/bin/env python3
"""Checks that the command line does not turn a mistake into a phrase.

Anything that was not recognised as an option became the text:

    $ mitreden.py add --tag
    added: tag

— a phrase that says "--tag", recorded in your voice and sitting in the list
until somebody notices. The flag was missing its value, which is worth saying
out loud rather than acting on.

Checked here: a flag with nothing after it stops instead of being spoken, a
second phrase in one call stops rather than being dropped in silence, and the
ordinary spellings of --tags all still work.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def run(folder: Path, *args) -> tuple[int, str]:
    """mitreden.py with its own folder. Never records: no backend is offered."""
    environment = dict(os.environ, MITREDEN_DIR=str(folder))
    for key in ("AZURE_SPEECH_KEY", "ELEVENLABS_API_KEY"):
        environment.pop(key, None)
    done = subprocess.run([sys.executable, str(ROOT / "mitreden.py"), *args],
                          cwd=ROOT, env=environment,
                          capture_output=True, text=True, timeout=120)
    return done.returncode, done.stdout + done.stderr


def phrases(folder: Path) -> list[str]:
    f = folder / "phrases.json"
    return [i["text"] for i in json.loads(f.read_text())] if f.exists() else []


# --- The cases ---------------------------------------------------------------

def check_flag_without_a_value(folder: Path) -> None:
    code, said = run(folder, "add", "--tag")
    check("a flag with no value stops", code != 0, f"exit {code}")
    check("and says what it wanted", "--tag" in said and "value" in said.lower(),
          said.strip().splitlines()[0][:60] if said.strip() else "(nothing)")
    check("no phrase was made from it", phrases(folder) == [], str(phrases(folder)))


def check_unknown_flag(folder: Path) -> None:
    code, said = run(folder, "add", "--verse", "Hallo")
    check("an unknown flag stops", code != 0, f"exit {code}")
    check("and nothing was added", phrases(folder) == [], str(phrases(folder)))


def check_two_phrases_at_once(folder: Path) -> None:
    """The second one used to be dropped without a word."""
    code, said = run(folder, "add", "Erster Satz", "Zweiter Satz")
    check("two phrases in one call stop", code != 0, f"exit {code}")
    check("and it names the one it could not place", "Zweiter Satz" in said,
          said.strip().splitlines()[0][:60] if said.strip() else "(nothing)")
    check("neither was added", phrases(folder) == [], str(phrases(folder)))


def check_the_ordinary_spellings(folder: Path) -> None:
    """Both spellings, both forms — these have to keep working."""
    for n, args in enumerate([
            ("add", "Satz A", "--tags", "spiel,zuhause"),
            ("add", "Satz B", "--tag", "spiel"),
            ("add", "Satz C", "--tags=spiel"),
            ("add", "Satz D"),
    ]):
        code, said = run(folder, *args)
        # No backend is installed in this folder, so recording fails and that
        # is fine: the phrase is added either way, which is the point.
        check(f"`{' '.join(args[1:])}` is accepted",
              "added:" in said, said.strip().splitlines()[0][:50])
    texts = phrases(folder)
    check("all four are in the file", len(texts) == 4, str(texts))


def main() -> int:
    with tempfile.TemporaryDirectory() as name:
        for case in (check_flag_without_a_value, check_unknown_flag,
                     check_two_phrases_at_once):
            folder = Path(name) / case.__name__
            folder.mkdir()
            case(folder)
        folder = Path(name) / "ordinary"
        folder.mkdir()
        check_the_ordinary_spellings(folder)

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
