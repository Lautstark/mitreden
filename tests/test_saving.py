#!/usr/bin/env python3
"""Checks that a save cannot leave half a file behind.

phrases.json is the only copy those sentences have. It used to be written with
write_text, which truncates the file first and writes afterwards: a Ctrl-C, a
full disk or a container stopping in that window left nothing behind but an
empty file, and the phrases were gone. Everything that matters goes through
write_atomic now — a temporary file beside it, then a rename, which cannot land
half way.

Checked here: an interrupted save leaves the previous file untouched and no
stray temporary lying around, config.json and .env go the same way, .env is
readable by nobody else from the moment it exists rather than a moment later,
and a key carrying its own line break is refused instead of quietly writing a
second variable into the file.
"""

from __future__ import annotations

import os
import pathlib
import stat
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

FOLDER = tempfile.mkdtemp(prefix="mitreden-saving-")
# Before the import: mitreden works out where your phrases live exactly once,
# when it is loaded. Never anybody's own folder — this test writes keys.
os.environ["MITREDEN_DIR"] = FOLDER
sys.path.insert(0, str(ROOT))
import mitreden as m                                  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def strays() -> list[str]:
    """Anything left over from a write that did not finish."""
    return sorted(p.name for p in m.DATA.iterdir() if p.name.endswith(".tmp"))


# --- The cases ---------------------------------------------------------------

def check_interrupted_save() -> None:
    """The old file survives a save that dies half way through."""
    m.DATA.mkdir(parents=True, exist_ok=True)
    m.save_phrases([{"id": "hallo", "text": "Hallo", "collections": []}])
    before = m.PHRASES.read_text()

    real = pathlib.Path.write_text

    def dies_half_way(self, *args, **kwargs):
        if self.name.endswith(".tmp"):
            real(self, '[{"id": "half')      # a torn file lands in the temp
            raise KeyboardInterrupt("disk full / Ctrl-C")
        return real(self, *args, **kwargs)

    pathlib.Path.write_text = dies_half_way
    try:
        m.save_phrases([{"id": "neu", "text": "Neu", "collections": []}])
        check("an interrupted save raises", False, "it returned quietly")
    except KeyboardInterrupt:
        check("an interrupted save raises", True)
    finally:
        pathlib.Path.write_text = real

    check("the old phrases.json is untouched", m.PHRASES.read_text() == before)
    check("and still loads", m.load_phrases() == [{"id": "hallo", "text": "Hallo",
                                                   "collections": []}])
    check("no half file is left behind", not strays(), ", ".join(strays()))


def check_env_file() -> None:
    """.env round-trips, and is never briefly readable by everyone."""
    m.set_env_var("AZURE_SPEECH_KEY", "secret-one")
    m.set_env_var("ELEVENLABS_API_KEY", "secret-two")
    mode = stat.S_IMODE(m.env_file().stat().st_mode)
    # Set on the temporary file, before the rename. Doing it afterwards left a
    # window in which the file with your key in it was readable by anyone.
    check("the .env belongs to you alone (0600)", mode == 0o600, oct(mode))

    m.set_env_var("AZURE_SPEECH_KEY", "")
    text = m.env_file().read_text()
    check("an empty value forgets that key", "AZURE_SPEECH_KEY" not in text)
    check("and leaves the other one alone", "ELEVENLABS_API_KEY=secret-two" in text)
    check("the mode survives a rewrite",
          stat.S_IMODE(m.env_file().stat().st_mode) == 0o600)

    os.environ.pop("ELEVENLABS_API_KEY", None)
    m.load_env()
    check("load_env reads it back",
          os.environ.get("ELEVENLABS_API_KEY") == "secret-two")

    # An export that is already there wins over the file, so that a key given
    # for one run is not silently replaced by an older one on disk.
    os.environ["ELEVENLABS_API_KEY"] = "from-the-shell"
    m.load_env()
    check("an export still wins over the file",
          os.environ["ELEVENLABS_API_KEY"] == "from-the-shell")


def check_key_with_a_line_break() -> None:
    """One variable per line is the whole format of a .env."""
    m.set_env_var("ELEVENLABS_API_KEY", "harmless")
    try:
        m.set_env_var("ELEVENLABS_API_KEY", "abc\nMITREDEN_VOICES=/somewhere/else")
        check("a key with a line break is refused", False, "it was written")
    except ValueError:
        check("a key with a line break is refused", True)
    check("nothing was smuggled into .env",
          "MITREDEN_VOICES" not in m.env_file().read_text())


def check_config() -> None:
    """config.json goes the same way, and stays readable as JSON."""
    cfg = m.load_config()
    check("a fresh install writes a config", m.CONFIG.exists())
    check("and it parses", isinstance(cfg, dict) and "backend" in cfg)
    check("no temporary is left beside it", not strays(), ", ".join(strays()))


def main() -> int:
    check_interrupted_save()
    check_env_file()
    check_key_with_a_line_break()
    check_config()

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
