"""Thin client for BSE's corporate-announcements API."""

from dataclasses import dataclass

import requests

API_URL = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w"
PDF_BASE_URL = "https://www.bseindia.com/xml-data/corpfiling/AttachHis/"

# Defaults taken from the sample URL; all of them are editable in the UI.
DEFAULT_PARAMS = {
    "pageno": "1",
    "strCat": "Result",
    "strPrevDate": "20260630",
    "strToDate": "20260930",
    "strSearch": "P",
    "strType": "C",
    "subcategory": "Financial Results",
}

# BSE rejects requests that don't look like they come from its own site.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.bseindia.com/",
    "Origin": "https://www.bseindia.com",
}


class BseApiError(Exception):
    pass


@dataclass
class Announcement:
    date: str
    company: str
    headline: str
    subject: str
    category: str
    attachment: str

    @property
    def pdf_url(self):
        return pdf_url(self.attachment)


def pdf_url(attachment_name, base_url=PDF_BASE_URL):
    """Return the PDF link for an ATTACHMENTNAME, or "" if there is none."""
    attachment_name = (attachment_name or "").strip()
    if not attachment_name:
        return ""
    return base_url.rstrip("/") + "/" + attachment_name


def parse_response(data):
    """Turn the API's JSON into (announcements, total_rows)."""
    if not isinstance(data, dict):
        raise BseApiError("Unexpected response format from BSE")
    rows = data.get("Table") or []
    announcements = [
        Announcement(
            date=str(row.get("NEWS_DT") or row.get("DT_TM") or ""),
            company=str(row.get("SLONGNAME") or ""),
            headline=str(row.get("HEADLINE") or ""),
            subject=str(row.get("NEWSSUB") or ""),
            category=str(row.get("SUBCATNAME") or row.get("CATEGORYNAME") or ""),
            attachment=str(row.get("ATTACHMENTNAME") or ""),
        )
        for row in rows
    ]
    total = len(announcements)
    table1 = data.get("Table1") or []
    if table1 and isinstance(table1[0], dict) and "ROWCNT" in table1[0]:
        try:
            total = int(table1[0]["ROWCNT"])
        except (TypeError, ValueError):
            pass
    return announcements, total


def fetch_announcements(scrip_code, params=None, timeout=20):
    scrip_code = str(scrip_code).strip()
    if not scrip_code:
        raise BseApiError("Enter a scrip code")
    query = dict(DEFAULT_PARAMS)
    query.update(params or {})
    query["strScrip"] = scrip_code
    try:
        resp = requests.get(API_URL, params=query, headers=HEADERS, timeout=timeout)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise BseApiError(f"Request to BSE failed: {exc}") from exc
    try:
        data = resp.json()
    except ValueError as exc:
        raise BseApiError("BSE did not return JSON (the request may have been blocked)") from exc
    return parse_response(data)
