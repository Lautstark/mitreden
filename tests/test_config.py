#!/usr/bin/env python3
"""Checks that a config.json written by hand is not punished for being short.

The README invites people to edit config.json, and people write down the part
they care about. Only the top level was filled in from the defaults, so

    "espeak": {"voice": "de"}

lost the binary and came back as KeyError: 'binary' — a traceback, out of a
file somebody had just edited on purpose. Missing settings are filled in one
level deeper now, and what you wrote wins over what is filled in behind it.

Checked here: a half-written section still works, the values in it survive,
an unknown backend is still a sentence rather than a crash, and the two
commands that read every section at once do not fall over.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

os.environ["MITREDEN_DIR"] = tempfile.mkdtemp(prefix="mitreden-config-")
sys.path.insert(0, str(ROOT))
import mitreden as m                                  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def written(config: dict) -> dict:
    m.DATA.mkdir(parents=True, exist_ok=True)
    m.CONFIG.write_text(json.dumps(config), encoding="utf-8")
    return m.load_config()


# --- The cases ---------------------------------------------------------------

def check_half_written_section() -> None:
    cfg = written({"backend": "espeak", "espeak": {"voice": "de"}})
    check("a section with one setting keeps it", cfg["espeak"]["voice"] == "de",
          str(cfg["espeak"]))
    check("and gets the rest filled in",
          cfg["espeak"].get("binary") == "espeak-ng"
          and cfg["espeak"].get("speed") == 150, str(cfg["espeak"]))
    check("other sections are there too", "azure" in cfg and "output" in cfg)


def check_yours_wins() -> None:
    cfg = written({"backend": "espeak", "espeak": {"binary": "/opt/my/espeak"}})
    check("your own value is not overwritten",
          cfg["espeak"]["binary"] == "/opt/my/espeak", cfg["espeak"]["binary"])


def check_partial_output() -> None:
    cfg = written({"backend": "espeak", "output": {"format": "opus"}})
    check("a half-written output section keeps the format",
          m.out_format(cfg) == "opus", m.out_format(cfg))
    args = m.output_args(cfg)
    check("and still produces usable ffmpeg settings",
          "-ar" in args and "-b:a" in args, " ".join(args))


def check_the_commands_that_read_everything() -> None:
    """`backends` touches every section at once — it was the first to break."""
    written({"backend": "espeak", "espeak": {"voice": "de"}})
    try:
        m.check_backends()
        check("`mitreden.py backends` survives a short config", True)
    except KeyError as why:
        check("`mitreden.py backends` survives a short config", False,
              f"KeyError {why}")

    try:
        m.available_voices(m.load_config())
        check("the voice list survives it too", True)
    except KeyError as why:
        check("the voice list survives it too", False, f"KeyError {why}")


def check_unknown_backend_is_a_sentence() -> None:
    cfg = written({"backend": "nonesuch"})
    item = {"id": "x", "text": "X"}
    try:
        m.render(item, cfg, force=True, voices=[])
        check("an unknown backend is refused", False, "it tried to record")
    except RuntimeError as why:
        check("an unknown backend is refused in words",
              "nonesuch" in str(why), str(why)[:50])
    except KeyError as why:
        check("an unknown backend is refused in words", False, f"KeyError {why}")


def main() -> int:
    check_half_written_section()
    check_yours_wins()
    check_partial_output()
    check_the_commands_that_read_everything()
    check_unknown_backend_is_a_sentence()

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
