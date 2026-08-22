#!/usr/bin/env python3
"""Static server for the spike, plus a PUT sink so the page can drop files here.

The spike compares two ways of trimming and levelling audio. Comparing them
against the container means getting the same bytes out of the browser and onto
a disk where ffmpeg can look at them, and http.server alone cannot take a file.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DUMP = Path(__file__).parent / "dump"


class Handler(SimpleHTTPRequestHandler):
    def do_PUT(self):
        name = Path(self.path).name                 # never a path from outside
        if not name:
            self.send_error(400, "no file name")
            return
        DUMP.mkdir(exist_ok=True)
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        (DUMP / name).write_bytes(body)
        self.send_response(204)
        self.end_headers()
        sys.stderr.write(f"saved dump/{name} ({len(body)} bytes)\n")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8771
    ThreadingHTTPServer(("127.0.0.1", port),
                        lambda *a: Handler(*a, directory=str(Path(__file__).parent.parent))
                        ).serve_forever()
