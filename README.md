# BSE Automation

A small desktop app that lists a company's filings from BSE's announcements API and opens each filing's PDF in your browser.

## Setup

Python 3.9+ with Tkinter (bundled with the python.org installers on Windows and macOS; on Debian/Ubuntu run `sudo apt install python3-tk`).

```bash
pip install -r requirements.txt
python main.py
```

## Usage

1. Type the company's scrip code (e.g. `532942`) and press **Fetch** or Enter.
2. The table lists date, company, headline and category for each announcement.
3. Click the **PDF** cell of a row (or double-click the row, or select it and press **Open PDF**) to open
   `https://www.bseindia.com/xml-data/corpfiling/AttachHis/<ATTACHMENTNAME>` in your browser.
   Rows without an attachment show `—`.

The other query parameters (`pageno`, `strCat`, `subcategory`, `strPrevDate`, `strToDate`, `strSearch`, `strType`) are editable in the **Parameters** panel. Dates are `YYYYMMDD`. Your last scrip code and parameters are remembered in `~/.bse_automation.json`; **Reset params** restores the defaults. **Prev/Next page** step through `pageno`.

## Tests

```bash
pip install pytest
pytest
```
