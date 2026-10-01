"""Hosted version of the app for Railway: the page in docs/ behind a Microsoft sign-in.

    uvicorn server.app:app --host 0.0.0.0 --port $PORT

People sign in with Microsoft through Supabase Auth on the page; every /api
call must carry that Supabase access token, which is checked here before the
request is forwarded to BSE (same fetch logic as proxy/local_proxy.py).
Settings come from environment variables; see .env.example.

    GET /health   always "ok" (Railway's health check)
    GET /diag     how BSE answers each way of reaching it, from this server
    GET /api      BSE announcements (signed in only)
    GET /api/pdf  a filing's PDF as a download (signed in only)
"""

import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

import jwt
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from proxy import local_proxy as bse

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
# Only for Supabase projects still on the legacy shared JWT secret; newer
# projects sign tokens with keys published at the JWKS URL below.
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
# e.g. "equirus.com" or "equirus.com,example.com"; empty allows any account
# Supabase lets in.
ALLOWED_EMAIL_DOMAINS = {
    d.strip().lower().lstrip("@") for d in os.environ.get("ALLOWED_EMAIL_DOMAINS", "").split(",") if d.strip()
}
# "true" to also require the email to be in the allowed_users table
# (supabase/allowlist.sql).
USE_ALLOWLIST_TABLE = os.environ.get("USE_ALLOWLIST_TABLE", "").lower() in ("1", "true", "yes")
AUTH_DISABLED = os.environ.get("AUTH_DISABLED", "").lower() in ("1", "true", "yes")

if not AUTH_DISABLED and not (SUPABASE_URL and SUPABASE_ANON_KEY):
    raise RuntimeError("Set SUPABASE_URL and SUPABASE_ANON_KEY (or AUTH_DISABLED=true for local testing)")

ISSUER = f"{SUPABASE_URL}/auth/v1"
_jwks = jwt.PyJWKClient(f"{ISSUER}/.well-known/jwks.json", cache_keys=True) if SUPABASE_URL else None

# email -> (allowed, checked_at), so the table isn't queried on every call.
_allowlist_cache = {}
ALLOWLIST_TTL = 300

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def _claims(token):
    """Decode and verify a Supabase access token, or raise a jwt.PyJWTError."""
    alg = jwt.get_unverified_header(token).get("alg")
    if alg == "HS256":
        if not SUPABASE_JWT_SECRET:
            raise jwt.InvalidTokenError("HS256 token but SUPABASE_JWT_SECRET is not set")
        key = SUPABASE_JWT_SECRET
    else:
        key = _jwks.get_signing_key_from_jwt(token).key
    return jwt.decode(token, key, algorithms=[alg], audience="authenticated", issuer=ISSUER)


def _in_allowlist(token, email):
    """Ask Supabase's is_allowed() function, as the signed-in user."""
    cached = _allowlist_cache.get(email)
    if cached and time.time() - cached[1] < ALLOWLIST_TTL:
        return cached[0]
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/is_allowed",
        data=b"{}",
        method="POST",
        headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        allowed = json.loads(resp.read()) is True
    _allowlist_cache[email] = (allowed, time.time())
    return allowed


def require_user(request: Request):
    """Return the signed-in user's email, or raise 401 with a reason the page shows."""
    if AUTH_DISABLED:
        return "auth-disabled"
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(401, "Sign in first")
    token = header[7:]
    try:
        claims = _claims(token)
    except jwt.PyJWTError as exc:  # includes failing to fetch Supabase's keys
        raise HTTPException(401, f"Your sign-in has expired or is invalid ({exc}). Sign in again.")
    email = (claims.get("email") or "").lower()
    if ALLOWED_EMAIL_DOMAINS and email.rpartition("@")[2] not in ALLOWED_EMAIL_DOMAINS:
        raise HTTPException(401, f"{email or 'This account'} is not allowed to use this app")
    if USE_ALLOWLIST_TABLE:
        try:
            allowed = _in_allowlist(token, email)
        except Exception as exc:
            raise HTTPException(502, f"Could not check the allowed users list: {exc}")
        if not allowed:
            raise HTTPException(401, f"{email} is not on the allowed users list")
    return email


@app.exception_handler(HTTPException)
async def plain_errors(request, exc):
    return PlainTextResponse(str(exc.detail), status_code=exc.status_code)


@app.get("/health")
def health():
    return PlainTextResponse("ok")


@app.get("/config.js")
def config_js():
    """Public settings the page needs to start Supabase sign-in (the anon key is meant to be public)."""
    config = {"proxy": "/api"}
    if not AUTH_DISABLED:
        config.update(supabaseUrl=SUPABASE_URL, supabaseAnonKey=SUPABASE_ANON_KEY)
    return Response(
        f"window.APP_CONFIG = {json.dumps(config)};\n",
        media_type="application/javascript",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/diag")
def diag():
    """Same as `local_proxy.py --diag`, run from this server, so you can see if BSE blocks its IP."""
    url = bse.UPSTREAM + "?" + (
        "pageno=1&strCat=Result&strPrevDate=20260630&strScrip=532942&strSearch=P"
        "&strToDate=20260930&strType=C&subcategory=Financial+Results"
    )
    results = []
    for name, fetch in bse.strategies():
        try:
            status, body, _ = fetch(url)
            results.append({"client": name, "status": status, "body": body[:200].decode("utf-8", "replace")})
        except Exception as exc:
            results.append({"client": name, "error": repr(exc)})
    working = [r["client"] for r in results if r.get("status") == 200 and r["body"].lstrip()[:1] == "{"]
    return JSONResponse({"bse_reachable": bool(working), "working_clients": working, "results": results})


@app.get("/api")
def announcements(request: Request):
    require_user(request)
    query = request.url.query
    status, body, ctype = bse.fetch_upstream(bse.UPSTREAM + ("?" + query if query else ""))
    return Response(body, status_code=status, media_type=ctype, headers={"Cache-Control": "no-store"})


@app.get("/api/pdf")
def pdf(request: Request, name: str = "", filename: str = ""):
    require_user(request)
    if not bse.PDF_NAME.match(name):
        return PlainTextResponse("Bad attachment name", status_code=400)
    status, body, ctype = bse.fetch_upstream(bse.PDF_BASE + name)
    if status != 200:
        return Response(body, status_code=status, media_type=ctype)
    filename = re.sub(r"[^A-Za-z0-9 ._()&-]", "_", filename or name).strip() or "announcement.pdf"
    return Response(
        body,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{urllib.parse.quote(filename)}"},
    )


# Last, so the routes above win over files of the same name (docs/config.js
# is the empty stand-in GitHub Pages serves).
app.mount("/", StaticFiles(directory=DOCS_DIR, html=True), name="docs")
