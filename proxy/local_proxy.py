"""Local test server for the web app: serves docs/ and proxies /api to BSE.

    python proxy/local_proxy.py            # then open http://localhost:8000

Browsers can't call BSE's API directly (no CORS headers, and BSE rejects
requests without a bseindia.com Referer), so /api forwards the query string
to BSE with browser-like headers and adds CORS headers to the reply.
Only BSE's announcements endpoint is reachable through it. Stdlib only;
if curl_cffi is installed it is used to look like Chrome to BSE's CDN.
"""

import argparse
import gzip
import http.server
import os
import shutil
import subprocess
import urllib.error
import urllib.request
import zlib
from functools import partial
from pathlib import Path

try:  # Optional: impersonates Chrome's TLS fingerprint, which BSE's CDN checks.
    from curl_cffi import requests as curl_requests
except ImportError:
    curl_requests = None

UPSTREAM = os.environ.get(
    "BSE_UPSTREAM", "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w"
)
DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"

# Everything Chrome sends on bseindia.com's own call to this API; BSE's CDN
# (Akamai) answers 403 "Access Denied" to requests that look scripted.
UPSTREAM_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Origin": "https://www.bseindia.com",
    "Referer": "https://www.bseindia.com/",
    "Sec-Ch-Ua": '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
}

BLOCKED_HINT = (
    b"\n\nBSE refused the request. Install curl_cffi so the proxy can look like "
    b"Chrome, then restart it:  python3 -m pip install curl_cffi"
)


def _decode(body, encoding):
    encoding = (encoding or "").lower()
    if encoding == "gzip":
        return gzip.decompress(body)
    if encoding == "deflate":
        return zlib.decompress(body)
    return body


def _via_urllib(url):
    req = urllib.request.Request(url, headers=UPSTREAM_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, _decode(resp.read(), resp.headers.get("Content-Encoding")), resp.headers.get(
                "Content-Type", "application/json"
            )
    except urllib.error.HTTPError as exc:
        return exc.code, _decode(exc.read(), exc.headers.get("Content-Encoding")), exc.headers.get(
            "Content-Type", "text/plain"
        )


def _via_curl(url):
    """The system curl has a different TLS fingerprint that BSE often accepts."""
    cmd = ["curl", "-sS", "--compressed", "-m", "20", "-w", "\n%{http_code}"]
    for key, value in UPSTREAM_HEADERS.items():
        if key != "Accept-Encoding":
            cmd += ["-H", f"{key}: {value}"]
    out = subprocess.run(cmd + [url], capture_output=True, timeout=30, check=True).stdout
    body, _, status = out.rpartition(b"\n")
    return int(status), body, "application/json" if body.lstrip()[:1] in (b"{", b"[") else "text/html"


def fetch_upstream(url):
    """Return (status, body, content_type) from BSE, trying the least-blockable client first."""
    if curl_requests is not None:
        resp = curl_requests.get(url, headers=UPSTREAM_HEADERS, impersonate="chrome", timeout=20)
        return resp.status_code, resp.content, resp.headers.get("Content-Type", "application/json")
    status, body, ctype = _via_urllib(url)
    if status == 403 and shutil.which("curl"):
        try:
            status, body, ctype = _via_curl(url)
        except (subprocess.SubprocessError, OSError, ValueError):
            pass
    if status == 403:
        body += BLOCKED_HINT
    return status, body, ctype


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
        try:
            status, body, ctype = fetch_upstream(UPSTREAM + ("?" + query if query else ""))
        except Exception as exc:  # network errors from any of the clients
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
    client = "curl_cffi (Chrome impersonation)" if curl_requests else "urllib, falling back to curl"
    print(f"Open http://localhost:{args.port}  (API proxy at /api via {client}, Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
