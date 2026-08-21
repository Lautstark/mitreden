#!/usr/bin/env python3
"""Checks that another site's page cannot change anything here.

The interface has no sign-in — whoever reaches the port may change what is in
it, and on your own machine that is the deal. What was not part of the deal is
that a page somewhere else could reach the port through the browser of whoever
is sitting in front of it. Binding to localhost does not help against that:
the browser making the request *is* on localhost.

A POST with a plain content type is a "simple request", which a browser sends
across origins without asking permission first. Nothing here looked at where
the request came from, so this worked, and the phrases were gone:

    curl -X POST http://127.0.0.1:8815/api/delete \\
      -H 'Content-Type: text/plain' \\
      -H 'Origin: https://evil.example' \\
      --data '{"id":"hallo"}'

application/json is not a simple content type, so requiring it makes the
browser ask first — and this server answers no such question. The Origin
header is the other half: the browser sets it and no script can talk it out
of it.

Checked here: the exploit above is refused and the phrase survives it, each
half of it is refused on its own, the interface's own request still goes
through, curl on the machine itself still works because it is not a browser
and not the hole, and reading is untouched — a foreign page could never read
the answers anyway, and blocking GET would only break the audio player.
"""

from __future__ import annotations

import http.client
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8815
HERE = f"127.0.0.1:{PORT}"
ELSEWHERE = "https://evil.example"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not ok:
        failures.append(name)


# --- Requests ----------------------------------------------------------------
# http.client rather than urllib, because several of these are only interesting
# if the headers are wrong on purpose.

def post(path: str, body: bytes, headers: dict[str, str]) -> tuple[int, bytes]:
    """One POST, exactly as spelled here. Status 0 means no answer came."""
    connection = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    try:
        connection.putrequest("POST", path, skip_accept_encoding=True)
        for name, value in headers.items():
            connection.putheader(name, value)
        connection.putheader("Content-Length", str(len(body)))
        connection.endheaders()
        if body:
            connection.send(body)
        answer = connection.getresponse()
        return answer.status, answer.read()
    except (TimeoutError, OSError, http.client.HTTPException):
        return 0, b""
    finally:
        connection.close()


def as_json(path, payload, origin=None, kind="application/json"):
    headers = {"Content-Type": kind} if kind else {}
    if origin:
        headers["Origin"] = origin
    return post(path, json.dumps(payload).encode("utf-8"), headers)


def phrases(folder: Path) -> list[str]:
    """The ids that are in the file right now."""
    return [i["id"] for i in json.loads((folder / "phrases.json").read_text())]


def serve(folder: Path):
    environment = dict(os.environ, MITREDEN_DIR=str(folder))
    for key in ("AZURE_SPEECH_KEY", "ELEVENLABS_API_KEY"):
        environment.pop(key, None)          # no calls out of a test
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "mitreden.py"), "ui", "--port", str(PORT)],
        cwd=ROOT, env=environment,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://{HERE}/api/phrases", timeout=10).close()
            return process
        except Exception:
            time.sleep(0.2)
    process.terminate()
    raise SystemExit("the server did not come up")


# --- The cases ---------------------------------------------------------------

def check_the_exploit(folder: Path) -> None:
    status, _ = post("/api/delete", b'{"id":"hallo"}',
                     {"Content-Type": "text/plain", "Origin": ELSEWHERE})
    check("the reported exploit is refused", 400 <= status < 500, f"HTTP {status}")
    check("and the phrase is still there", "hallo" in phrases(folder),
          ", ".join(phrases(folder)))


def check_each_half() -> None:
    # No Origin at all, only the content type: this is what another site's
    # page can send without being asked anything first.
    for kind in ("text/plain", "application/x-www-form-urlencoded",
                 "multipart/form-data", ""):
        status, _ = as_json("/api/tags", {"ids": ["hallo"], "tags": ["x"]},
                            kind=kind)
        check(f"a {kind or 'missing'} content type is refused",
              status == 403, f"HTTP {status}")

    # The right content type, the wrong origin.
    status, _ = as_json("/api/tags", {"ids": ["hallo"], "tags": ["x"]},
                        origin=ELSEWHERE)
    check("a foreign Origin is refused", status == 403, f"HTTP {status}")

    status, _ = as_json("/api/tags", {"ids": ["hallo"], "tags": ["x"]},
                        origin="null")
    check("an opaque Origin is refused", status == 403, f"HTTP {status}")


def check_the_page_itself(folder: Path) -> None:
    """The shape the interface actually sends has to keep working."""
    status, _ = as_json("/api/tags", {"ids": ["hallo"], "tags": ["spiel"],
                                      "mode": "add"}, origin=f"http://{HERE}")
    check("the interface's own request goes through", status == 200,
          f"HTTP {status}")
    tags = json.loads((folder / "phrases.json").read_text())[0].get("tags")
    check("and it took effect", "spiel" in tags, str(tags))

    # curl on the machine itself sends no Origin. That is not a browser and
    # not the hole, so it stays allowed.
    status, _ = as_json("/api/tags", {"ids": ["hallo"], "tags": ["zuhause"],
                                      "mode": "add"})
    check("a request without an Origin still goes through", status == 200,
          f"HTTP {status}")


def check_reading_is_untouched() -> None:
    """A foreign page could never read these answers; blocking them would only
    break the player and the page itself."""
    for path in ("/", "/api/phrases", "/api/voices", "/api/strings"):
        try:
            request = urllib.request.Request(f"http://{HERE}{path}",
                                             headers={"Origin": ELSEWHERE})
            with urllib.request.urlopen(request, timeout=10) as answer:
                status = answer.status
        except Exception as why:
            status = f"{why}"
        check(f"GET {path} still answers", status == 200, str(status))


def main() -> int:
    with tempfile.TemporaryDirectory() as name:
        folder = Path(name)
        (folder / "phrases.json").write_text(json.dumps(
            [{"id": "hallo", "text": "Hallo", "tags": []}]), encoding="utf-8")
        process = serve(folder)
        try:
            check_the_exploit(folder)
            check_each_half()
            check_the_page_itself(folder)
            check_reading_is_untouched()
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
