"""BSE MCP server: lets Claude pull live BSE India data by scrip code.

Runs on your own computer (BSE blocks cloud IPs), speaks MCP over stdio, and
reuses proxy/local_proxy.py's BSE fetch strategies. Install and register:

    pip install "mcp" curl_cffi            # curl_cffi: look like Chrome to BSE (recommended)
    claude mcp add bse -- python3 /path/to/bse-automation/mcp/bse_mcp.py       # Claude Code
    # Claude Desktop: see the "mcpServers" snippet in the README.

Tools: search_scrips, get_quote, get_market_depth, get_peers, get_financials,
get_announcements, download_announcement_pdf, list_scrips, call_bse_api.
Every tool raises on failure (BSE refused, not JSON, unknown scrip) so Claude
sees the real cause instead of an empty answer.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.parse
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "proxy"))
from local_proxy import PDF_BASE, PDF_NAME, fetch_upstream  # noqa: E402

try:  # mcp 2.x: only ToolError messages reach the model, anything else becomes "Error executing tool"
    from mcp.server.mcpserver import MCPServer as _Server
    from mcp.server.mcpserver.exceptions import ToolError
except ImportError:  # mcp 1.x passes every exception's message through
    from mcp.server.fastmcp import FastMCP as _Server
    from mcp.server.fastmcp.exceptions import ToolError

BASES = {
    "api": "https://api.bseindia.com/BseIndiaAPI/api",
    "realtime": "https://api.bseindia.com/RealTimeBseIndiaAPI/api",
    "msource": "https://api.bseindia.com/MSource/1D",
}

# Same registry as docs/explorer.js: name -> (base, path, default params). {scripcode} and
# {quarter} are filled in by call_bse_api; the other tools build their own params.
ENDPOINTS = {
    "getScripHeaderData": ("api", "getScripHeaderData/w", {"Debtflag": "", "scripcode": "{scripcode}", "seriesid": ""}),
    "ComHeadernew_par": ("api", "ComHeadernew_par/w", {"quotetype": "", "scripcode": "{scripcode}", "seriesid": ""}),
    "MarketDepth": ("realtime", "MarketDepth/w", {"flag": "", "quotetype": "EQ", "scripcode": "{scripcode}"}),
    "StockTrading": ("api", "StockTrading/w", {"flag": "", "quotetype": "EQ", "scripcode": "{scripcode}"}),
    "HighLow": ("api", "HighLow/w", {"Type": "EQ", "flag": "C", "scripcode": "{scripcode}"}),
    "PriceBand": ("api", "PriceBand/w", {"scripcode": "{scripcode}", "seriesid": ""}),
    "SecurityPosition": ("api", "SecurityPosition/w", {"scripcode": "{scripcode}"}),
    "StockReachGraphCas": ("api", "StockReachGraphCas/w", {"flag": "0", "fromdate": "", "scripcode": "{scripcode}", "seriesid": "", "todate": ""}),
    "EQPeerGp": ("api", "EQPeerGp/w", {"scripcomare": "", "scripcode": "{scripcode}"}),
    "TabResults_PAR_NEWS": ("api", "TabResults_PAR/w", {"scripcode": "{scripcode}", "tabtype": "NEWS"}),
    "TabResults_PAR_RESULTS": ("api", "TabResults_PAR/w", {"scripcode": "{scripcode}", "tabtype": "RESULTS"}),
    "ScripwiseCautionaryMsg": ("api", "ScripwiseCautionaryMsg/w", {"scripcode": "{scripcode}"}),
    "LeftMenunew": ("api", "LeftMenunew/w", {"scripcode": "{scripcode}"}),
    "Corp_detailedResult_Transpose_ng": ("api", "Corp_detailedResult_Transpose_ng/w", {"Scrip_cd": "{scripcode}", "Qtr": "{quarter}"}),
    "Corp_BSEDnBResults_SEBI_Consolidated_Res_ng": ("api", "Corp_BSEDnBResults_SEBI_Consolidated_Res_ng/w", {"Scrip_cd": "{scripcode}", "QuarterID": "{quarter}"}),
    "Corp_SEGMENTS_QUART_COMP_ng": ("api", "Corp_SEGMENTS_QUART_COMP_ng/w", {"Scrip_cd": "{scripcode}", "QuarterID": "{quarter}"}),
    "Corp_Segments_Total_p_ng": ("api", "Corp_Segments_Total_p_ng/w", {"Scrip_cd": "{scripcode}", "QuarterID": "{quarter}"}),
    "Corp_GET_BSEDnBResultNotes_ng": ("api", "Corp_GET_BSEDnBResultNotes_ng/w", {"scrip_cd": "{scripcode}", "currQtr": "{quarter}"}),
    "AnnSubCategoryGetData": ("api", "AnnSubCategoryGetData/w", {"strCat": "-1", "strPrevDate": "", "strScrip": "{scripcode}", "strSearch": "P", "strToDate": "", "strType": "C", "subcategory": "-1", "pageno": "1"}),
    "GetQuoteAllSearchDatabeta": ("msource", "GetQuoteAllSearchDatabeta.aspx", {"searchString": "{scripcode}"}),
    "ListofScripData_new": ("api", "ListofScripData_new/w", {"Group": "", "Scripcode": "", "segment": "Equity", "status": "Active", "scripName": ""}),
    "ddlGroup": ("api", "ddlGroup/w", {"flag": "0"}),
    "Mkt_GetTicker_ng": ("api", "Mkt_GetTicker_ng/w", {"env": "1"}),
}

SEGMENTS = ["Equity", "EQT0", "MF", "HS", "MB", "Preference Shares", "Debentures and Bonds", "Equity - Institutional Series",
            "Commercial Papers", "Government Securities", "Certificate of Deposit", "Treasury Bills"]


class BseError(ToolError):
    """BSE did not give a usable answer (blocked, not JSON, unknown code)."""


class ArgError(ToolError):
    """A tool argument that cannot be right; the message says what to pass instead."""


# ---------------------------------------------------------------- fetching
def unwrap(value):
    """BSE sometimes returns JSON inside a JSON string; decode those wherever they appear."""
    if isinstance(value, str):
        text = value.strip()
        if (text[:1] == "{" and text.endswith("}")) or (text[:1] == "[" and text.endswith("]")):
            try:
                return unwrap(json.loads(text))
            except ValueError:
                return value
        return value
    if isinstance(value, list):
        return [unwrap(v) for v in value]
    if isinstance(value, dict):
        return {k: unwrap(v) for k, v in value.items()}
    return value


def bse_get(name: str, params: dict):
    """Call one BSE endpoint and return its decoded JSON. Raises BseError on any failure."""
    base, path, _ = ENDPOINTS[name]
    url = f"{BASES[base]}/{path}?{urllib.parse.urlencode(params)}"
    status, body, _ctype = fetch_upstream(url)
    text = body.decode("utf-8", "replace")
    if status == 403:
        raise BseError(f"BSE refused {name} (HTTP 403). Install curl_cffi (pip install curl_cffi) so requests look like Chrome, "
                       "or run  python3 proxy/local_proxy.py --diag  to see which client BSE accepts.")
    if status != 200:
        raise BseError(f"{name} failed: HTTP {status}: {text[:200]}")
    try:
        return unwrap(json.loads(text))
    except ValueError:
        raise BseError(f"{name} did not return JSON: {text[:200]}") from None


def _num(value):
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _code(scripcode: str) -> str:
    code = str(scripcode).strip()
    if not re.fullmatch(r"\d{5,6}", code):
        raise ArgError(f"scripcode must be the 5-6 digit BSE code (got {scripcode!r}); use search_scrips to find it")
    return code


# ---------------------------------------------------------------- quarters
# BSE numbers result quarters 126 = Jun-25, 127 = Sep-25, ... one per quarter (checked for ABB).
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def quarter_end(qid: int) -> tuple[int, int]:
    """(year, month index 0-11) of the quarter-end for a BSE quarter id."""
    m = 2025 * 12 + 5 + 3 * (qid - 126)
    return m // 12, m % 12


def fy_label(year: int, month: int) -> str:
    """'Q1 FY27' for a quarter ending in (year, month). Indian FY: Apr-Mar."""
    q = {5: 1, 8: 2, 11: 3, 2: 4}.get(month)
    if q is None:
        raise ValueError(f"month {month} is not a quarter end")
    return f"Q{q} FY{str(year if month <= 2 else year + 1)[-2:]}"


def quarter_label(qid: int) -> str:
    y, m = quarter_end(qid)
    return f"{fy_label(y, m)} ({MONTHS[m]}-{str(y)[-2:]})"


def label_from_end(end: str) -> str | None:
    """'30-Jun-26' -> 'Q1 FY27' using BSE's own period-end date; None when it isn't that shape."""
    m = re.fullmatch(r"\d+-(\w{3})-(\d{2})", end or "")
    if not m or m.group(1) not in MONTHS:
        return None
    try:
        return fy_label(2000 + int(m.group(2)), MONTHS.index(m.group(1)))
    except ValueError:
        return None


def last_ended_quarter(today: date | None = None) -> int:
    today = today or date.today()
    return 126 + (today.year * 12 + today.month - 1 - 1 - (2025 * 12 + 5)) // 3


def quarter_id_for(label: str) -> int:
    """'Q1 FY27' -> 130. Also accepts a bare id like '130' or '130.00'."""
    label = label.strip().upper().replace("  ", " ")
    if re.fullmatch(r"\d{3}(\.\d+)?", label):
        return int(float(label))
    m = re.fullmatch(r"Q([1-4])\s*FY\s*(\d{2}|\d{4})", label)
    if not m:
        raise ArgError(f"quarter must look like 'Q1 FY27' (got {label!r})")
    q, fy = int(m.group(1)), int(m.group(2))
    fy = fy if fy > 100 else 2000 + fy
    month = {1: 5, 2: 8, 3: 11, 4: 2}[q]
    year = fy - 1 if q < 4 else fy
    return 126 + ((year * 12 + month) - (2025 * 12 + 5)) // 3


def detailed_result(code: str, qid: int) -> dict | None:
    """One quarter's P&L as {'quarter', 'period_end', 'type', 'lines': {name: value}} or None if unfiled."""
    data = bse_get("Corp_detailedResult_Transpose_ng", {"Scrip_cd": code, "Qtr": f"{qid:.2f}"})
    rows = data.get("table1") if isinstance(data, dict) else None
    if not rows:
        return None
    meta = {r["fld_desc"]: r.get("Value") for r in rows if r.get("Header") == "2"}
    lines = {r["fld_desc"]: _num(r.get("Value")) for r in rows if r.get("Header") != "2"}
    end = meta.get("Date End", "")
    return {"quarter": label_from_end(end) or quarter_label(qid), "bse_quarter_id": f"{qid:.2f}",
            "period_begin": meta.get("Date Begin"), "period_end": end, "type": meta.get("Type"), "lines": lines}


LINE = {"sales": "Net Sales/Revenue From Operations", "cmc": "Cost of Materials Consumed", "purch": "Purchases of stock-in-trade",
        "inv": "Changes in inventories of finished goods, work-in-progress and stock-in-trade", "emp": "Employee benefit expense",
        "oth": "Other Expenses", "pbt": "Profit (+)/ Loss (-) from Ordinary Activities before Tax", "tax": "Tax",
        "pat": "Net Profit (+)/ Loss (-) from Ordinary Activities after Tax"}


def derived(lines: dict) -> dict:
    """EBITDA and margins computed from BSE's lines; a metric is None when any input line is missing."""
    g = lambda k: lines.get(LINE[k])  # noqa: E731
    parts = [g(k) for k in ("sales", "cmc", "purch", "inv", "emp", "oth")]
    ebitda = round(sum(parts), 2) if all(p is not None for p in parts) else None
    sales, pbt, tax, pat = g("sales"), g("pbt"), g("tax"), g("pat")
    pct = lambda a, b: round(a / b, 4) if a is not None and b else None  # noqa: E731
    return {"ebitda": ebitda, "ebitda_margin": pct(ebitda, sales), "pbt_margin": pct(pbt, sales),
            "tax_rate": pct(-tax if tax is not None else None, pbt), "pat_margin": pct(pat, sales)}


# ---------------------------------------------------------------- server
server = _Server("bse", instructions=(
    "Live data from BSE India (Bombay Stock Exchange) by scrip code. Start with search_scrips when you only have a "
    "company name; the 5-6 digit code it returns is what every other tool takes. Amounts from get_financials are as "
    "BSE labels them (Rs million for most companies, as originally filed)."))


@server.tool()
def search_scrips(query: str) -> list[dict]:
    """Find BSE scrip codes by company name, symbol, ISIN or code fragment (e.g. 'reliance', 'ABB', 'INE117A01022').

    Returns up to 20 matches: {scripcode, symbol, name, isin, market}. Use the scripcode in the other tools.
    """
    rows = bse_get("GetQuoteAllSearchDatabeta", {"searchString": query.strip()})
    if not isinstance(rows, list):
        raise BseError(f"unexpected search reply: {str(rows)[:200]}")
    seen, out = set(), []
    for r in rows:
        key = (r.get("strSricpCode"), r.get("Type"))
        if key in seen:
            continue
        seen.add(key)
        out.append({"scripcode": r.get("strSricpCode"), "symbol": r.get("shortName"), "name": r.get("scripName"),
                    "isin": r.get("Isin"), "market": (r.get("Type") or "").strip()})
    return out[:20]


@server.tool()
def get_quote(scripcode: str) -> dict:
    """Live price and key facts for one BSE scrip: LTP, change, day/52-week range, volume, delivery %, market cap,
    EPS/PE/PB/ROE/margins (standalone and consolidated), group, sector/industry, ISIN, flags (ASM/GSM etc.)."""
    code = _code(scripcode)
    head = bse_get("getScripHeaderData", {"Debtflag": "", "scripcode": code, "seriesid": ""})
    com = bse_get("ComHeadernew_par", {"quotetype": "", "scripcode": code, "seriesid": ""})
    trade = bse_get("StockTrading", {"flag": "", "quotetype": "EQ", "scripcode": code})
    hilo = bse_get("HighLow", {"Type": "EQ", "flag": "C", "scripcode": code})
    pos = bse_get("SecurityPosition", {"scripcode": code})
    band = bse_get("PriceBand", {"scripcode": code, "seriesid": ""})
    h, cur, cmp_ = head.get("Header") or {}, head.get("CurrRate") or {}, head.get("Cmpname") or {}
    if not cmp_.get("FullN") and not com.get("SecurityId"):
        raise BseError(f"BSE has no equity scrip {code}; check the code with search_scrips")
    flags = {k: h[k] for k in ("ASMText", "GSMText", "EMSText", "SMSText", "IRPText", "DisplayText") if h.get(k)}
    return {
        "scripcode": code, "name": cmp_.get("FullN"), "symbol": com.get("SecurityId"), "isin": com.get("ISIN"),
        "bse_url": cmp_.get("SEOUrlEQ") and "https://www.bseindia.com" + cmp_["SEOUrlEQ"],
        "price": {"ltp": _num(h.get("LTP") or cur.get("LTP")), "change": _num(cur.get("Chg")), "change_pct": _num(cur.get("PcChg")),
                  "open": _num(h.get("Open")), "high": _num(h.get("High")), "low": _num(h.get("Low")), "prev_close": _num(h.get("PrevClose")),
                  "as_of": h.get("Ason")},
        "range": {"week52_high": hilo.get("Fifty2WkHigh_unadj"), "week52_low": hilo.get("Fifty2WkLow_unadj"),
                  "week_high_low": hilo.get("WeekHighLow"), "month_high_low": hilo.get("MonthHighLow"),
                  "price_band": [band.get("LowerT"), band.get("UpperT")], "circuit_limit": trade.get("CktLimit")},
        "trading": {"wap": _num(trade.get("WAP")), "turnover": trade.get("Turnover") and f"{trade.get('Turnover')} {trade.get('Turnoverin', '')}".strip(),
                    "traded_qty": _num(trade.get("TTQ")), "two_week_avg_qty": trade.get("TwoWkAvgQty") and f"{trade.get('TwoWkAvgQty')} {trade.get('TwoWkAvgQtyin', '')}".strip(),
                    "delivered_qty": _num(pos.get("DeliverableQty")), "delivery_pct": _num(pos.get("PcDQ_TQ")), "delivery_as_of": pos.get("TradeDate"),
                    "market_cap_cr": _num(trade.get("MktCapFull")), "free_float_mcap_cr": _num(trade.get("MktCapFF")), "ex_date": trade.get("ExDate")},
        "ratios": {"standalone": {k: _num(com.get(k)) for k in ("EPS", "CEPS", "PE", "PB", "ROE", "OPM", "NPM")},
                   "consolidated": {k[3:]: _num(com.get(k)) for k in ("ConEPS", "ConCEPS", "ConPE", "ConPB", "ConROE", "ConOPM", "ConNPM")}},
        "classification": {k: com.get(k) for k in ("Group", "Index", "Sector", "IndustryNew", "Industry", "IGroup", "ISubGroup", "FaceVal", "SetlType")},
        "flags": flags,
    }


@server.tool()
def get_market_depth(scripcode: str) -> dict:
    """Top-5 bids and asks (price and quantity) with totals for one BSE scrip."""
    code = _code(scripcode)
    d = bse_get("MarketDepth", {"flag": "", "quotetype": "EQ", "scripcode": code})
    return {"scripcode": code, "as_of": d.get("dttm"),
            "bids": [{"price": _num(d.get(f"BPrice{i}")), "qty": _num(d.get(f"BQty{i}"))} for i in range(1, 6)],
            "asks": [{"price": _num(d.get(f"SPrice{i}")), "qty": _num(d.get(f"SQty{i}"))} for i in range(1, 6)],
            "total_bid_qty": _num(d.get("TotalBQty")), "total_ask_qty": _num(d.get("TotalSQty"))}


@server.tool()
def get_peers(scripcode: str) -> list[dict]:
    """BSE's peer group for a scrip: each peer's code, LTP, change %, PE, PB, EPS, revenue and PAT (Rs Cr), OPM, NPM,
    52-week range and the quarter those results are from."""
    code = _code(scripcode)
    d = bse_get("EQPeerGp", {"scripcomare": "", "scripcode": code})
    rows = d.get("Table") if isinstance(d, dict) else None
    if not rows:
        raise BseError(f"BSE returned no peer table for {code}")
    keys = ["Name", "scrip_cd", "LTP", "Change", "PE", "PB", "EPS", "Revenue", "PAT", "OPM", "NPM", "w52hi", "w52lo", "Results_QuarterName"]
    return [{k: r.get(k) for k in keys} for r in rows]


@server.tool()
def get_financials(scripcode: str, quarters: int = 5, upto: str | None = None) -> dict:
    """Quarterly P&L from BSE's results filings, newest first, with derived EBITDA, margins and tax rate.

    quarters: how many to return (1-16). upto: the newest quarter to include, like 'Q1 FY27'; by default the latest
    one BSE has results for is detected automatically. Values are as originally filed; expenses are negative.
    BSE labels the amounts Rs million for most companies.
    """
    code = _code(scripcode)
    n = max(1, min(16, int(quarters)))
    if upto:
        latest = quarter_id_for(upto)
    else:
        # The results tab links to the latest quarter; probe one ahead and a few behind in case that link lags.
        tab = bse_get("TabResults_PAR_RESULTS", {"scripcode": code, "tabtype": "RESULTS"})
        link = ((tab.get("resultinS") or [{}])[0].get("LLQ") or "") if isinstance(tab, dict) else ""
        m = re.search(r"qtr=([\d.]+)", link)
        base = int(float(m.group(1))) if m else last_ended_quarter()
        latest = None
        for qid in (base + 1, base, base - 1, base - 2, base - 3):
            if detailed_result(code, qid):
                latest = qid
                break
        if latest is None:
            raise BseError(f"BSE has no quarterly results for {code} around {quarter_label(base)}")
    out, misses = [], 0
    qid = latest
    while len(out) < n and misses < 4:
        r = detailed_result(code, qid)
        qid -= 1
        if r is None:
            misses += 1
            continue
        misses = 0
        r["derived"] = derived(r["lines"])
        out.append(r)
    return {"scripcode": code, "quarters": out,
            "note": "Amounts as filed with BSE (Rs million unless the company reports otherwise); expenses negative. "
                    "derived.* are computed here: ebitda = sales + materials + stock-in-trade purchases + inventory change + employee + other expenses."}


@server.tool()
def get_announcements(scripcode: str, months: int = 12, category: str = "all", page: int = 1) -> dict:
    """Corporate announcements and filings for a scrip from BSE's announcements feed, newest first, with PDF links.

    months: look back 1-12 months (BSE returns nothing for longer spans). category: 'all' or 'results' (financial
    results only). page: 1-based; about 50 rows per page, 'total' says how many exist.
    """
    code = _code(scripcode)
    months = max(1, min(12, int(months)))
    if category not in ("all", "results"):
        raise ArgError("category must be 'all' or 'results'")
    today = date.today()
    y, m = today.year, today.month - months
    while m <= 0:
        y, m = y - 1, m + 12
    since = date(y, m, min(today.day, 28))
    cat, sub = ("Result", "Financial Results") if category == "results" else ("-1", "-1")
    d = bse_get("AnnSubCategoryGetData", {"strCat": cat, "strPrevDate": since.strftime("%Y%m%d"), "strScrip": code, "strSearch": "P",
                                          "strToDate": today.strftime("%Y%m%d"), "strType": "C", "subcategory": sub, "pageno": str(max(1, int(page)))})
    rows = d.get("Table") or []
    total = _num(((d.get("Table1") or [{}])[0]).get("ROWCNT"))
    items = []
    for r in rows:
        att = (r.get("ATTACHMENTNAME") or "").strip()
        items.append({"date": r.get("NEWS_DT") or r.get("DT_TM"), "headline": _plain(r.get("HEADLINE") or r.get("NEWSSUB") or ""),
                      "category": r.get("CATEGORYNAME"), "subcategory": r.get("SUBCATNAME"), "attachment": att or None,
                      "pdf_url": PDF_BASE + urllib.parse.quote(att) if att else None})
    return {"scripcode": code, "from": since.isoformat(), "to": today.isoformat(), "page": page,
            "total": int(total) if total is not None else len(items), "announcements": items}


def _plain(text: str) -> str:
    """BSE headlines carry <BR> and entities; keep the line breaks, drop the rest."""
    import html
    text = re.sub(r"<\s*br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(text)).strip()


@server.tool()
def download_announcement_pdf(attachment: str, save_dir: str, filename: str | None = None) -> str:
    """Save an announcement's PDF (the 'attachment' from get_announcements) into save_dir and return the file path."""
    if not PDF_NAME.match(attachment):
        raise ArgError(f"not a BSE attachment name: {attachment!r}")
    status, body, _ = fetch_upstream(PDF_BASE + attachment)
    if status != 200 or not body.startswith(b"%PDF"):
        raise BseError(f"could not fetch {attachment}: HTTP {status}")
    name = re.sub(r"[^A-Za-z0-9 ._()&-]", "_", filename or attachment).strip() or attachment
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    target = Path(save_dir).expanduser()
    target.mkdir(parents=True, exist_ok=True)
    path = target / name
    path.write_bytes(body)
    return str(path)


@server.tool()
def list_scrips(segment: str = "Equity", status: str = "Active", group: str = "", name_contains: str = "",
                scripcode: str = "", limit: int = 200) -> dict:
    """List BSE securities from the List of Securities page, filtered by segment (Equity, EQT0, MF, HS, MB,
    'Preference Shares', 'Debentures and Bonds', 'Equity - Institutional Series', 'Commercial Papers',
    'Government Securities', 'Certificate of Deposit', 'Treasury Bills'), status (Active/Suspended/Delisted/''),
    group code (A, B, T, ...), a name fragment, or one exact code. Returns up to `limit` rows and the total count.
    Big segments without a name filter are several MB on BSE's side; add a filter when you can.
    """
    if segment not in SEGMENTS:
        raise ArgError(f"segment must be one of {SEGMENTS}")
    rows = bse_get("ListofScripData_new", {"Group": group, "Scripcode": scripcode.strip(), "segment": segment, "status": status,
                                            "scripName": name_contains.strip()})
    if not isinstance(rows, list):
        raise BseError(f"unexpected list reply: {str(rows)[:200]}")
    keys = ["SCRIP_CD", "scrip_id", "Scrip_Name", "Issuer_Name", "Segment", "Status", "GROUP", "FACE_VALUE", "ISIN_NUMBER", "Mktcap"]
    return {"total": len(rows), "returned": min(len(rows), max(1, int(limit))),
            "rows": [{k: r.get(k) for k in keys} for r in rows[: max(1, int(limit))]]}


@server.tool()
def call_bse_api(endpoint: str, params: dict | None = None, scripcode: str = "", quarter: str = "") -> object:
    """Call any documented BSE endpoint and return its raw decoded JSON. endpoint is one of the registry names
    (getScripHeaderData, ComHeadernew_par, MarketDepth, StockTrading, HighLow, PriceBand, SecurityPosition,
    StockReachGraphCas, EQPeerGp, TabResults_PAR_NEWS, TabResults_PAR_RESULTS, ScripwiseCautionaryMsg, LeftMenunew,
    Corp_detailedResult_Transpose_ng, Corp_BSEDnBResults_SEBI_Consolidated_Res_ng, Corp_SEGMENTS_QUART_COMP_ng,
    Corp_Segments_Total_p_ng, Corp_GET_BSEDnBResultNotes_ng, AnnSubCategoryGetData, GetQuoteAllSearchDatabeta,
    ListofScripData_new, ddlGroup, Mkt_GetTicker_ng). Default params are filled from scripcode and quarter
    (a BSE quarter id like '130.00', or 'Q1 FY27'); anything in params overrides them.
    """
    if endpoint not in ENDPOINTS:
        raise ArgError(f"unknown endpoint {endpoint!r}; see the tool description for the list")
    qid = f"{quarter_id_for(quarter):.2f}" if quarter else ""
    filled = {k: v.replace("{scripcode}", scripcode.strip()).replace("{quarter}", qid) for k, v in ENDPOINTS[endpoint][2].items()}
    filled.update({k: str(v) for k, v in (params or {}).items()})
    return bse_get(endpoint, filled)


if __name__ == "__main__":
    server.run()
