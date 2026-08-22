#!/usr/bin/env python3
"""Opens docs/ in a real browser and uses the page the way a visitor would.

The other tests check the parts. This one checks that the parts still add up
to a page: that index.html loads with nothing broken in the console, that the
strings really were baked in, that a sentence typed into the box arrives in
the list and is still there after a reload, and that the vendored modules
import from the paths the built page names. Those are the failures a static
site has — a renamed file, a module that no longer parses, a build that went
out half-written — and none of them show up in a unit test, because there is
no unit that is wrong.

It serves docs/ over http rather than opening a file:// path, because that is
what GitHub Pages does and because modules and IndexedDB behave differently
under file://. The folder it serves is the folder that gets published, so what
passes here is what goes out.

WHAT IT DELIBERATELY DOES NOT DO is speak. Every request that leaves the local
server is blocked, which means piper's voice never arrives and the recording
fails — and the page is expected to survive that, with the sentence in the
list saying it is not recorded yet. This is not a gap in the test, it is the
choice: the real voice is 63 MB from huggingface.co, so a gate that waits for
it would tie publishing this page to somebody else's server being up, and
would spend a minute of the run on a download whose result is the same every
time. Blocking also checks something worth checking on its own — the page
promises that nothing you type is sent anywhere, and a page that quietly grew
a request to a third party would fail here.

    MITREDEN_E2E_FULL=1 python3 tests/test_e2e_page.py

runs the other half: huggingface.co is allowed through, the sentence is
actually spoken, and the file that comes back has to be an mp3. That is the
whole chain including the parts only a browser has — the WASM decoder, the
AudioContext, the encoder. It takes minutes and depends on a download, so it
is asked for by hand or by a nightly run, and it is not what publishing waits
on.

Skipped, not failed, where playwright or its browser is missing: the same rule
the browser tests follow, so that a contributor without them can still run
everything else. Not under CI, though — where this test is what publishing
waits on, a skip is a green run that opened nothing, which is the one way a
gate can be worse than no gate at all. CI=true turns the skip into a failure,
and the workflow installs what is needed.
"""

from __future__ import annotations

import functools
import http.server
import os
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "docs"

FULL = os.environ.get("MITREDEN_E2E_FULL") == "1"
# Set by GitHub Actions, and by every other runner worth the name.
CI = bool(os.environ.get("CI"))
VOICE_HOST = "huggingface.co"

# One sentence, typed as a visitor would type it. Long enough to be spoken in
# the full run, and distinctive enough that finding it in the list means the
# list drew this one and not something left over.
SENTENCE = "The pipeline typed this sentence."

# The blocked run only has to wait for a fetch to be refused. The full run
# waits for a voice to be downloaded and a recording to be made, which is
# minutes on a cold cache.
SPOKEN_TIMEOUT_MS = 900_000 if FULL else 60_000


class Report:
    """Collects what went wrong instead of stopping at the first thing.

    A page that fails one check usually fails several, and the useful output
    is all of them at once — running the browser again to find the second
    problem costs more than printing it the first time.
    """

    def __init__(self) -> None:
        self.failed: list[str] = []

    def check(self, ok: bool, what: str, detail: str = "") -> bool:
        if ok:
            print(f"  ok    {what}")
        else:
            self.failed.append(what)
            print(f"  FAIL  {what}" + (f"\n          {detail}" if detail else ""))
        return ok


class Quiet(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler without the request log.

    Every asset the page pulls would otherwise be a line, and the vendored
    bundle alone is enough to bury the test's own output.
    """

    def log_message(self, *args) -> None:
        pass


def serve(directory: Path) -> tuple[http.server.ThreadingHTTPServer, str]:
    """Serves a folder on a port the operating system picks.

    Port 0 rather than a fixed number: this runs in CI next to whatever else
    the runner has open, and a test that fails because a port was taken is a
    test nobody trusts.
    """
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(Quiet, directory=str(directory)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    host, port = server.socket.getsockname()[:2]
    return server, f"http://{host}:{port}"


def browser_checks(play, base: str, report: Report) -> None:
    browser = play.chromium.launch()
    # A fresh context per run, so IndexedDB starts empty and "the sentence is
    # still there after a reload" means this run put it there.
    context = browser.new_context()
    page = context.new_page()

    console: list[str] = []
    page.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: console.append(str(e)))

    missing: list[str] = []      # assets the page asked for and did not get
    page.on("response", lambda r: missing.append(f"{r.status} {r.url}")
            if r.status >= 400 else None)

    # Everything that leaves the local server is refused and written down.
    # blob: and data: never reach the network and are left alone.
    outside: list[str] = []

    def gate(route):
        url = route.request.url
        if not url.startswith("http") or url.startswith(base):
            route.continue_()
            return
        outside.append(url)
        # The full run lets everything through rather than only the voice
        # host: huggingface hands large files off to a CDN on another name,
        # and a list of hostnames maintained here would go stale silently.
        # The check that this page asks nothing of anyone else still holds,
        # because it is made after loading and before anything is recorded.
        if FULL:
            route.continue_()
            return
        route.abort()

    page.route("**/*", gate)

    # ?lang=en rather than whatever the runner's browser asks for: the checks
    # below compare what the page shows against what the language files say,
    # and they need to know which language is on screen.
    page.goto(f"{base}/index.html?lang=en", wait_until="load")
    page.wait_for_function("() => document.getElementById('add').textContent !== ''")

    report.check(not console, "the page loads with a clean console",
                 "; ".join(console[:3]))
    report.check(not missing, "every asset the page asks for is there",
                 "; ".join(missing[:5]))
    report.check(not outside, "the page asks nothing of anyone else",
                 "; ".join(outside[:3]))

    # The strings are baked in by tools/build-site.py, and the page applies
    # them. Comparing the button against the file rather than against a
    # spelling written out here: what is being checked is that the wiring
    # holds, and a test that has to be edited when a translation is improved
    # is a test that will be edited carelessly.
    baked = page.evaluate("() => window.MITREDEN_STRINGS || {}")
    report.check(set(baked) >= {"de", "en"}, "both languages are in the page",
                 f"found {sorted(baked)}")
    if baked.get("en"):
        # The send button is a round arrow, so its string lives in the label a
        # screen reader reads rather than in the text on screen. That is where
        # to check it: the visible glyph is the same in every language and
        # would go on passing after the wiring broke.
        label = page.get_attribute("#add", "aria-label")
        report.check(
            label == baked["en"]["add_phrase"],
            "the chosen language is the one on screen",
            f"button is labelled {label!r}")
    report.check(page.get_attribute("html", "lang") == "en",
                 "the document says which language it is in")

    # Read the list from the module that owns it. It used to hang off a global
    # the page no longer sets, and the split would not have been caught here.
    voices = page.evaluate(
        "async () => (await import('./app/voices.js')).VOICES.length")
    options = page.eval_on_selector_all("#voice option", "els => els.length")
    report.check(voices > 0 and options == voices,
                 "every voice the backend has is offered",
                 f"{voices} voices, {options} in the menu")

    # The modules the page loads on demand. They are only imported when
    # somebody records, so nothing else here would notice a vendored file that
    # had been truncated, renamed, or served as the wrong type.
    loaded = page.evaluate("""async () => {
      const out = {};
      for (const path of ['./app/media.js', './app/speak.js', './vendor/lamejs.js', './vendor/vits-web.js']) {
        try { out[path] = Object.keys(await import(path)).length > 0; }
        catch (e) { out[path] = String(e); }
      }
      return out;
    }""")
    for path, ok in loaded.items():
        report.check(ok is True, f"{path} imports", "" if ok is True else str(ok))

    # ---------------------------------------------------------------- using it
    page.fill("#t", SENTENCE)
    page.click("#add")
    page.wait_for_selector(".item", timeout=SPOKEN_TIMEOUT_MS)

    shown = page.eval_on_selector_all(".item .line", "els => els.map(e => e.textContent)")
    report.check(shown == [SENTENCE], "the sentence typed in is the sentence listed",
                 f"list shows {shown}")
    report.check(page.is_visible("#s") and page.inner_text("#s").strip() != "",
                 "the page says what it did")

    if FULL:
        page.wait_for_selector(".item.ok audio", timeout=SPOKEN_TIMEOUT_MS)
        head = page.evaluate("""async () => {
          const src = document.querySelector('.item.ok audio').src;
          const b = new Uint8Array(await (await fetch(src)).arrayBuffer());
          return { bytes: b.length, magic: [b[0], b[1], b[2]] };
        }""")
        b0, b1, _ = head["magic"]
        # An ID3 tag or a bare frame header. Either is an mp3; anything else
        # means the encoder handed back something no talker will play.
        mp3 = head["magic"][:3] == [0x49, 0x44, 0x33] or (b0 == 0xFF and b1 & 0xE0 == 0xE0)
        report.check(mp3 and head["bytes"] > 1000,
                     "the recording that comes back is an mp3",
                     f"{head['bytes']} bytes, starts {head['magic']}")
    else:
        state = page.get_attribute(".item", "class") or ""
        report.check("missing" in state,
                     "a sentence that could not be recorded is kept and said so",
                     f"row is {state!r}")

    # The sentences are the only thing here that cannot be made again, and
    # they live in IndexedDB. A reload is how anybody would find out.
    before = len(console)
    page.reload(wait_until="load")
    page.wait_for_selector(".item", timeout=30_000)
    kept = page.eval_on_selector_all(".item .line", "els => els.map(e => e.textContent)")
    report.check(kept == [SENTENCE], "the sentence survives a reload", f"list shows {kept}")
    report.check(len(console) == before, "the reload is as quiet as the first load",
                 "; ".join(console[before:][:3]))

    # Filtering is what the list does most often, and it is the one place
    # where a mistake hides sentences rather than showing an error.
    page.fill("#q", "nothing matches this")
    page.wait_for_function("() => document.querySelectorAll('.item').length === 0")
    report.check(True, "a search that matches nothing shows nothing")
    page.fill("#q", "")
    page.wait_for_function("() => document.querySelectorAll('.item').length === 1")
    report.check(True, "clearing the search brings the sentence back")

    # The footer link is the only way off this page, and it is a relative
    # path in a folder that gets published as it stands.
    about = page.get_attribute("footer a", "href")
    reply = page.request.get(f"{base}/{about}")
    report.check(reply.status == 200, f"the footer link reaches {about}",
                 f"status {reply.status}")

    # Every page in docs/ is published, and the ones that are not the
    # interface are the ones nobody opens while working. The folder is the
    # list, so a page added later is checked without anybody remembering to
    # add it here. Each one has to load with nothing missing and nothing in
    # the console — index.html included, since by now it has a sentence in it
    # and drawing a list on load is not the same as drawing an empty one.
    for name in sorted(p.name for p in SITE.glob("*.html")):
        quiet_until, complete_until = len(console), len(missing)
        page.goto(f"{base}/{name}", wait_until="load")
        report.check(len(console) == quiet_until and len(missing) == complete_until,
                     f"{name} loads with nothing missing and nothing in the console",
                     "; ".join((console[quiet_until:] + missing[complete_until:])[:3]))

    context.close()
    browser.close()


SKIPPED = 77                       # tests/run.py reports this apart from a pass


def missing(what: str) -> int:
    """Says what is not installed, and whether that is allowed to be fine."""
    if CI:
        print(f"  FAIL  {what}, so this ran in no browser at all — and this is CI,")
        print("        where a skipped browser test is a page nobody looked at")
        return 1
    print(f"  skipped: {what}, so the page cannot be opened")
    print("           pip install playwright && playwright install chromium")
    # Not "All good.": nothing was checked. The runner reads this code and says
    # so in the summary, because a run that skipped the only test that opens
    # the page should not look the same as a run that passed it.
    return SKIPPED


def main() -> int:
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except ImportError:
        return missing("playwright is not installed")

    if not (SITE / "index.html").exists():
        print("  FAIL  docs/index.html is missing — run tools/build-site.py")
        return 1

    print(f"  serving {SITE.relative_to(ROOT)}"
          + (f", speaking for real via {VOICE_HOST}" if FULL else ", nothing may leave"))
    server, base = serve(SITE)
    report = Report()
    try:
        with sync_playwright() as play:
            try:
                browser_checks(play, base, report)
            except PlaywrightError as e:
                first = str(e).splitlines()[0] if str(e) else ""
                if "Executable doesn't exist" in str(e):
                    return missing("playwright has no browser installed")
                print(f"  FAIL  the browser could not finish: {first}")
                return 1
    finally:
        server.shutdown()
        server.server_close()

    if report.failed:
        print(f"\n  {len(report.failed)} check(s) failed:")
        for name in report.failed:
            print(f"    {name}")
        return 1
    print("\n  All good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
