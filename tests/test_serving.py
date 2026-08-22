#!/usr/bin/env python3
"""Checks that every request gets an answer, including the ones that go wrong.

An exception used to travel straight out of the handler and close the socket
without a word. curl reported no status at all, and the page fell over on

    if(!r.ok){say(t('failed',{error:await r.text()}))}

because there was no text to read — so the button died silently and the person
in front of it had nothing to go on. Everything is wrapped now, and what the
program said is part of the answer: ffmpeg and piper explain themselves on
stderr, which used to go to a terminal nobody was looking at while the page
showed "returned non-zero exit status 234".

Checked here: a torn request is answered rather than dropped, a format nothing
can write is refused before ffmpeg is asked to try, a failure that does reach
ffmpeg comes back as words, the server is still standing after each of them,
and the ordinary paths — the page, the audio, a download, a conversion — still
work.
"""

from __future__ import annotations

import http.client
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8816
HERE = f"127.0.0.1:{PORT}"
JSON = {"Content-Type": "application/json", "Origin": f"http://{HERE}"}

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def post(path: str, body: bytes, headers: dict, announced=None) -> tuple[int, bytes]:
    """Status 0 means no answer came — which is the failure this file is about."""
    connection = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    try:
        connection.putrequest("POST", path, skip_accept_encoding=True)
        for name, value in headers.items():
            connection.putheader(name, value)
        connection.putheader("Content-Length",
                             str(len(body) if announced is None else announced))
        connection.endheaders()
        if body:
            connection.send(body)
        answer = connection.getresponse()
        return answer.status, answer.read()
    except (TimeoutError, OSError, http.client.HTTPException):
        return 0, b""
    finally:
        connection.close()


def get(path: str) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(f"http://{HERE}{path}", timeout=20) as answer:
            return answer.status, answer.read()
    except urllib.error.HTTPError as why:
        return why.code, why.read()
    except Exception:
        return 0, b""


def serve(folder: Path):
    environment = dict(os.environ, MITREDEN_DIR=str(folder))
    for key in ("AZURE_SPEECH_KEY", "ELEVENLABS_API_KEY"):
        environment.pop(key, None)
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "mitreden.py"), "ui", "--port", str(PORT)],
        cwd=ROOT, env=environment,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        if get("/api/phrases")[0] == 200:
            return process
        time.sleep(0.2)
    process.terminate()
    raise SystemExit("the server did not come up")


def seed(folder: Path) -> None:
    """Two phrases with real audio, made by ffmpeg rather than by a voice.

    What is checked here is the serving, not the speaking, so a tone does the
    job and the test needs no TTS backend to be installed anywhere."""
    out = folder / "out"
    out.mkdir(parents=True, exist_ok=True)
    (folder / "config.json").write_text(json.dumps(
        {"backend": "espeak", "output": {"format": "mp3", "sample_rate": 44100,
                                         "channels": 1, "bitrate": "192k"}}))
    (folder / "phrases.json").write_text(json.dumps([
        {"id": f"satz-{n}", "text": f"Satz {n}", "collections": ["test"],
         "fingerprint": "x" * 12, "backend": "espeak", "voice_id": "espeak"}
        for n in (1, 2)]))
    for n in (1, 2):
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
             "-i", f"sine=frequency={300 + n * 100}:duration=0.3",
             "-ar", "44100", "-ac", "1", str(out / f"satz-{n}.mp3")],
            check=True)


# --- The cases ---------------------------------------------------------------

def check_torn_requests() -> None:
    status, body = post("/api/collections", b"not json at all", JSON)
    check("a body that is not JSON is answered", status == 400, f"HTTP {status}")
    check("and says so in words", b"JSON" in body, body[:40].decode("utf-8", "replace"))

    status, _ = post("/api/collections", b"{}", dict(JSON, **{"Content-Length": "abc"}))
    check("a Content-Length that is not a number is answered",
          400 <= status < 500, f"HTTP {status}")

    status, _ = post("/api/nothing-here", b"{}", JSON)
    check("an unknown route is answered", status == 404, f"HTTP {status}")


def check_formats() -> None:
    status, _ = post("/api/download",
                     json.dumps({"ids": ["satz-1"], "format": "nope"}).encode(),
                     JSON)
    check("a format nothing can write is refused before ffmpeg",
          status == 400, f"HTTP {status}")

    status, _ = get("/audio/satz-1?format=nope")
    check("the same on the audio route", status == 400, f"HTTP {status}")

    # A real container that this particular file cannot become: ffmpeg is
    # asked, ffmpeg fails, and what it said has to come back.
    status, body = get("/audio/satz-1?format=wav&dl=1")
    check("a conversion that can work does work", status == 200 and len(body) > 100,
          f"HTTP {status}, {len(body)} bytes")


def check_the_ordinary_paths() -> None:
    status, body = get("/")
    check("the page is served", status == 200 and body.startswith(b"<!doctype"),
          f"HTTP {status}")
    status, body = get("/audio/satz-1")
    check("audio is served", status == 200 and len(body) > 100,
          f"HTTP {status}, {len(body)} bytes")
    status, _ = get("/audio/../../../etc/passwd")
    check("a path that climbs out is refused", status in (400, 404), f"HTTP {status}")
    status, _ = get("/audio/nothing")
    check("audio that is not there is a plain 404", status == 404, f"HTTP {status}")

    status, body = post("/api/download",
                        json.dumps({"ids": ["satz-1", "satz-2"]}).encode(), JSON)
    names = []
    if status == 200:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
            f.write(body)
        names = sorted(zipfile.ZipFile(f.name).namelist())
        os.unlink(f.name)
    check("a download comes back as a zip", status == 200 and len(names) == 2,
          f"HTTP {status}, {names}")


def check_a_recording_that_fails(folder: Path) -> None:
    """A phrase that cannot be recorded is still a phrase.

    The config points at a binary that is not there, so rendering fails for
    certain. The phrase must still be added, the answer must still be an
    answer, and it has to say which one failed and why — the row would
    otherwise sit in the list as "not recorded" with nothing explaining it."""
    (folder / "config.json").write_text(json.dumps(
        {"backend": "espeak", "espeak": {"binary": "definitely-not-installed"},
         "output": {"format": "mp3"}}))

    status, body = post("/api/phrases",
                        json.dumps({"lines": ["Geht nicht"],
                                    "collections": ["test"]}).encode(), JSON)
    answer = json.loads(body) if status == 200 else {}
    check("adding still answers", status == 200, f"HTTP {status}")
    check("the phrase was added anyway", answer.get("added") == 1, str(answer))
    check("nothing was recorded", answer.get("rendered") == 0, str(answer))
    check("and it says which one failed and why",
          len(answer.get("failed") or []) == 1
          and "geht-nicht" in answer["failed"][0],
          str(answer.get("failed"))[:60])

    ids = [i["id"] for i in json.loads((folder / "phrases.json").read_text())]
    check("the phrase really is in the file", "geht-nicht" in ids, str(ids))


def check_still_standing() -> None:
    status, _ = get("/api/phrases")
    check("the server is still there after all that", status == 200, f"HTTP {status}")


def main() -> int:
    if not shutil.which("ffmpeg"):
        print("  ffmpeg is not installed — nothing here can run without it.")
        return 1
    with tempfile.TemporaryDirectory() as name:
        folder = Path(name)
        seed(folder)
        process = serve(folder)
        try:
            check_torn_requests()
            check_formats()
            check_the_ordinary_paths()
            check_a_recording_that_fails(folder)
            check_still_standing()
        finally:
            process.terminate()
            process.wait(timeout=10)

    if failures:
        print(f"\n  {len(failures)} problem(s): {', '.join(failures)}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
