#!/usr/bin/env python3
"""Checks that a phrase is honest about the voice you can hear in it.

Phrases may be recorded with different voices, and each one keeps the voice it
was given until somebody records it again. That only works if what a phrase
says about itself is true.

It was not. When the voice a phrase was recorded with had gone — a model
deleted, a key removed, another machine — rendering fell back to the configured
voice, which is right, but wrote the old, dead voice id back onto the phrase.
The row then read "Thorsten" over audio that was plainly Anna, and the state
said "ok", so nothing would ever have put it right.

The second one was found while testing the first. A backend that writes no file
and still exits happily left the previous recording in build/raw, and ffmpeg
converted that instead — so a phrase whose recording had just failed came out
sounding like whatever it said the last time, reported as a success.

Checked here: the fallback relabels honestly, a voice that is still there is
never repainted, an explicit voice wins, a backend that produces nothing is an
error rather than a recording, and no raw file survives to be mistaken for one.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

os.environ["MITREDEN_DIR"] = tempfile.mkdtemp(prefix="mitreden-voice-")
sys.path.insert(0, str(ROOT))
import mitreden as m                                  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


# --- A recording without a recording -----------------------------------------
# No TTS backend and no ffmpeg are involved here. What is being checked is what
# render() writes onto the phrase, and that has to hold whichever program does
# the speaking — so the speaking is a stub and ffmpeg is a no-op.

SAID: list[dict] = []


def stub(text, dest, opt):
    SAID.append(dict(opt))
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(b"RIFF-not-really-audio")


def silent(text, dest, opt):
    """Exits happily, writes nothing. The failure mode that hid behind a raw."""
    SAID.append(dict(opt))


def setup():
    m.BACKENDS["say"] = stub
    m.BACKENDS["piper"] = stub
    m.run = lambda *args, **kwargs: None       # ffmpeg does not run here
    m.shutil.which = lambda binary: "/usr/bin/" + binary
    cfg = json.loads(json.dumps(m.DEFAULT_CONFIG))
    cfg["backend"] = "say"
    return cfg


ANNA = {"id": "say", "label": "Anna · say", "backend": "say", "active": True}
THORSTEN = {"id": "piper:de_DE-thorsten-medium", "label": "Thorsten · piper",
            "backend": "piper", "model": "/voices/de_DE-thorsten-medium.onnx"}


def pretend_recorded(pid, cfg):
    """An output file, so that render() is deciding rather than just catching up."""
    m.OUT.mkdir(parents=True, exist_ok=True)
    m.out_file(pid, cfg).write_bytes(b"x")


# --- The cases ---------------------------------------------------------------

def check_gone_voice(cfg) -> None:
    """A voice that is not here any more must not stay on the phrase."""
    item = {"id": "hallo", "text": "Hallo", "voice_id": THORSTEN["id"]}
    pretend_recorded("hallo", cfg)
    m.render(item, cfg, force=True, voices=[ANNA])     # Thorsten is not offered

    check("it is recorded with the voice that is actually here",
          SAID[-1] == cfg["say"], str(SAID[-1]))
    check("the phrase says so too", item["voice_id"] == "say", item["voice_id"])
    check("and its backend agrees", item["backend"] == "say", item["backend"])
    check("the interface names the voice you can hear",
          m.voice_name(cfg, m.phrase_voice(item, cfg), [ANNA]) == ANNA["label"],
          m.voice_name(cfg, m.phrase_voice(item, cfg), [ANNA]))
    check("and it does not sit there stale for ever",
          m.phrase_state(item, cfg, [ANNA]) == "ok",
          m.phrase_state(item, cfg, [ANNA]))


def check_voice_that_is_there(cfg) -> None:
    """Catching up on what is missing must not repaint the rest."""
    item = {"id": "zwei", "text": "Zwei", "voice_id": THORSTEN["id"]}
    pretend_recorded("zwei", cfg)
    m.render(item, cfg, force=True, voices=[ANNA, THORSTEN])

    check("a voice that is still offered is kept",
          item["voice_id"] == THORSTEN["id"], item["voice_id"])
    check("and it is the one that speaks",
          SAID[-1].get("model") == THORSTEN["model"], str(SAID[-1]))


def check_explicit_voice(cfg) -> None:
    """Asking for a voice by name beats whatever the phrase remembers."""
    item = {"id": "drei", "text": "Drei", "voice_id": THORSTEN["id"]}
    pretend_recorded("drei", cfg)
    m.render(item, cfg, force=True, voice_id="say", voices=[ANNA, THORSTEN])
    check("an explicit voice wins", item["voice_id"] == "say", item["voice_id"])


def check_backend_that_says_nothing(cfg) -> None:
    """No file, no recording — whatever is lying about in build/raw."""
    item = {"id": "vier", "text": "Vier"}
    pretend_recorded("vier", cfg)
    m.RAW.mkdir(parents=True, exist_ok=True)
    (m.RAW / "vier.wav").write_bytes(b"THE-RECORDING-FROM-LAST-TIME")

    m.BACKENDS["say"] = silent
    try:
        m.render(item, cfg, force=True, voices=[ANNA])
        check("a backend that writes nothing is an error", False,
              "it reported a recording")
    except RuntimeError as why:
        check("a backend that writes nothing is an error", True, str(why)[:40])
    finally:
        m.BACKENDS["say"] = stub

    check("the recording from last time is not reused",
          not (m.RAW / "vier.wav").exists())


def check_no_raw_survives(cfg) -> None:
    """Nothing reads the raw again once out/ has the finished file."""
    item = {"id": "fuenf", "text": "Fuenf"}
    pretend_recorded("fuenf", cfg)
    m.render(item, cfg, force=True, voices=[ANNA])
    left = sorted(p.name for p in m.RAW.glob("*")) if m.RAW.exists() else []
    check("a finished recording leaves no raw behind", not left, ", ".join(left))


def main() -> int:
    cfg = setup()
    check_gone_voice(cfg)
    check_voice_that_is_there(cfg)
    check_explicit_voice(cfg)
    check_backend_that_says_nothing(cfg)
    check_no_raw_survives(cfg)

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
