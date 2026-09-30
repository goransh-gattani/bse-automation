"""Local test server for the web app: serves docs/ and proxies /api to BSE.

    python3 proxy/local_proxy.py           # then open http://localhost:8000
    python3 proxy/local_proxy.py --diag    # show how BSE answers each client

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

# Page whose visit sets the cookies Akamai expects on the API call.
WARMUP_URL = os.environ.get("BSE_WARMUP", "https://www.bseindia.com/corporates/ann.html")

# With curl_cffi, let its Chrome impersonation pick the User-Agent and sec-ch-*
# headers so they match its TLS fingerprint; only add what the site adds.
IMPERSONATE_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.bseindia.com",
    "Referer": "https://www.bseindia.com/",
}

BLOCKED_HINT = (
    b"\n\nBSE refused the request. Run  python3 proxy/local_proxy.py --diag  and send its output,"
    b" or use the bookmarklet described in the README."
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
            return resp.status, _decode(resp.read(), resp.headers.get("Content-Encoding")), dict(resp.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, _decode(exc.read(), exc.headers.get("Content-Encoding")), dict(exc.headers)


def _via_curl(url):
    """The system curl has a different TLS fingerprint that BSE sometimes accepts."""
    cmd = ["curl", "-sS", "--compressed", "-m", "20", "-w", "\n%{http_code}"]
    for key, value in UPSTREAM_HEADERS.items():
        if key != "Accept-Encoding":
            cmd += ["-H", f"{key}: {value}"]
    out = subprocess.run(cmd + [url], capture_output=True, timeout=30, check=True).stdout
    body, _, status = out.rpartition(b"\n")
    ctype = "application/json" if body.lstrip()[:1] in (b"{", b"[") else "text/html"
    return int(status), body, {"Content-Type": ctype}


_session = None


def _via_curl_cffi(url, warm_up):
    """Chrome TLS/HTTP2 impersonation; optionally visit bseindia.com first for cookies."""
    global _session
    if _session is None or warm_up:
        _session = curl_requests.Session(impersonate="chrome")
    if warm_up:
        _session.get(WARMUP_URL, timeout=20)
    resp = _session.get(url, headers=IMPERSONATE_HEADERS, timeout=20)
    return resp.status_code, resp.content, dict(resp.headers)


def strategies():
    """(name, fetch) pairs, least-blockable first."""
    found = []
    if curl_requests is not None:
        found.append(("curl_cffi", lambda url: _via_curl_cffi(url, warm_up=False)))
        found.append(("curl_cffi+cookies", lambda url: _via_curl_cffi(url, warm_up=True)))
    found.append(("urllib", _via_urllib))
    if shutil.which("curl"):
        found.append(("curl", _via_curl))
    return found


def fetch_upstream(url):
    """Return (status, body, content_type) from the first strategy BSE doesn't refuse."""
    status, body, headers = 502, b"No way to reach BSE", {}
    for name, fetch in strategies():
        try:
            status, body, headers = fetch(url)
        except Exception as exc:  # network errors from any of the clients
            status, body, headers = 502, f"Proxy could not reach BSE via {name}: {exc}".encode(), {}
            continue
        if status != 403:
            break
    if status == 403:
        body += BLOCKED_HINT
    ctype = next((v for k, v in headers.items() if k.lower() == "content-type"), "text/plain")
    return status, body, ctype


def diagnose(query):
    """Try every strategy against BSE and print what came back."""
    url = UPSTREAM + "?" + query
    print("URL:", url)
    print("curl_cffi installed:", curl_requests is not None)
    for name, fetch in strategies():
        print(f"\n--- {name}")
        try:
            status, body, headers = fetch(url)
        except Exception as exc:
            print("  error:", repr(exc))
            continue
        print("  status:", status)
        for key, value in headers.items():
            if key.lower() in ("server", "content-type", "akamai-grn", "x-reference-error", "set-cookie", "location"):
                print(f"  {key}: {value[:150]}")
        print("  body:", body[:300].decode("utf-8", "replace").replace("\n", " "))


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
        status, body, ctype = fetch_upstream(UPSTREAM + ("?" + query if query else ""))
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
    parser.add_argument("--diag", action="store_true", help="try every way of reaching BSE, print the results, and exit")
    args = parser.parse_args()
    if args.diag:
        return diagnose(
            "pageno=1&strCat=Result&strPrevDate=20260630&strScrip=532942&strSearch=P"
            "&strToDate=20260930&strType=C&subcategory=Financial+Results"
        )
    server = http.server.ThreadingHTTPServer(
        (args.host, args.port), partial(Handler, directory=str(DOCS_DIR))
    )
    names = ", ".join(name for name, _ in strategies())
    print(f"Open http://localhost:{args.port}  (API proxy at /api, trying: {names}. Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
