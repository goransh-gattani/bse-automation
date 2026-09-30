"""Local test server for the web app: serves docs/ and proxies /api to BSE.

    python proxy/local_proxy.py            # then open http://localhost:8000

Browsers can't call BSE's API directly (no CORS headers, and BSE rejects
requests without a bseindia.com Referer), so /api forwards the query string
to BSE with browser-like headers and adds CORS headers to the reply.
Only BSE's announcements endpoint is reachable through it. Stdlib only.
"""

import argparse
import http.server
import os
import urllib.error
import urllib.request
from functools import partial
from pathlib import Path

UPSTREAM = os.environ.get(
    "BSE_UPSTREAM", "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w"
)
DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"

UPSTREAM_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.bseindia.com/",
    "Origin": "https://www.bseindia.com",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path.startswith("/api"):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path.rstrip("/") != "/api":
            return super().do_GET()
        req = urllib.request.Request(UPSTREAM + ("?" + query if query else ""), headers=UPSTREAM_HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                status, body = resp.status, resp.read()
                ctype = resp.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as exc:
            status, body, ctype = exc.code, exc.read(), exc.headers.get("Content-Type", "text/plain")
        except (urllib.error.URLError, OSError) as exc:
            status, body, ctype = 502, f"Proxy could not reach BSE: {exc}".encode(), "text/plain"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    server = http.server.ThreadingHTTPServer(
        (args.host, args.port), partial(Handler, directory=str(DOCS_DIR))
    )
    print(f"Open http://localhost:{args.port}  (API proxy at /api, Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
