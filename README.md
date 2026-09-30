# BSE Automation

A web page that lists a company's filings from BSE's announcements API and links each filing's PDF. It is a static page (`docs/`, no build step) that can be hosted on GitHub Pages.

Browsers can't call BSE's API directly: BSE sends no CORS headers and rejects requests that don't carry a bseindia.com `Referer`. So the page talks to BSE through a small proxy. Two are included, with the same behaviour:

- `proxy/local_proxy.py` for testing on your own computer.
- `proxy/cloudflare-worker.js` for the hosted page.

Both only forward to BSE's announcements endpoint, so they can't be used as an open proxy.

## 1. Test locally (start here)

Needs Python 3.8+ and nothing else. From the repository's top folder (not `docs/`):

```bash
python3 proxy/local_proxy.py
```

Keep that terminal open while you use the page. If the page says BSE refused the request (HTTP 403):

1. `python3 -m pip install curl_cffi` and start the proxy again. It then makes its requests look like Chrome (and warms up cookies from bseindia.com), which BSE's CDN checks for.
2. Still 403? `python3 proxy/local_proxy.py --diag` tries every way of reaching BSE and prints what each got back.
3. Or skip the proxy: open http://localhost:8000/bookmarklet.html and use the bookmarklet, which runs the same lookup from a bseindia.com tab in your own browser. Don't run `docs/app.js` with Node; it is browser code that the page loads itself.

Open http://localhost:8000. The script serves the page and proxies `/api` to BSE, so the page's **Proxy URL** is already set to `/api`. Use `--port 9000` if 8000 is taken.

## 2. Deploy the proxy (Cloudflare Worker)

1. Sign in at https://dash.cloudflare.com (the free plan is enough) and go to **Workers & Pages → Create → Create Worker**.
2. Name it (e.g. `bse-proxy`), click **Deploy**, then **Edit code**, replace the code with `proxy/cloudflare-worker.js`, and **Deploy** again.
3. Optional: under the worker's **Settings → Variables**, add `ALLOWED_ORIGIN` = `https://<your-username>.github.io` so only your page can use it.
4. Note the worker URL, e.g. `https://bse-proxy.<you>.workers.dev`. Opening `https://bse-proxy.<you>.workers.dev/?strScrip=532942&pageno=1&strCat=Result&subcategory=Financial%20Results&strPrevDate=20260630&strToDate=20260930&strSearch=P&strType=C` should return JSON.

Or with the CLI: `npx wrangler deploy proxy/cloudflare-worker.js --name bse-proxy --compatibility-date 2024-01-01`.

**Caveat:** BSE sometimes blocks requests from cloud and datacenter IPs, including Cloudflare's. If the worker URL returns an HTML error page or HTTP 403 while the local proxy works, BSE is blocking Cloudflare; keep using the local proxy (you can point the hosted page at it by setting its Proxy URL to `http://localhost:8000/api`).

## 3. Host the page on GitHub Pages

1. Merge this branch into `main`.
2. In the repository, open **Settings → Pages**, set **Source** to *Deploy from a branch*, branch `main`, folder `/docs`, and save.
3. After a minute the page is at `https://<your-username>.github.io/bse-automation/`.
4. Open it, expand **Parameters**, paste the worker URL into **Proxy URL**, and press **Fetch**. The page remembers it in your browser.

## Usage

1. Type or paste one or more scrip codes (e.g. `532942, 500325`, or one per line) and press **Fetch** or Enter. With several codes the page fetches them one after another and shows one combined table, newest first, with a **Scrip** column. The status line lists codes with no results, codes that have more pages, and codes that failed.
2. The table lists date, company, headline and category for each announcement.
3. Click **📄 View** to open `https://www.bseindia.com/xml-data/corpfiling/AttachHis/<ATTACHMENTNAME>` in a new tab, or **⬇ Download** to save it as `<Company name>_<YYYY-MM-DD>.pdf` (e.g. `Reliance Industries Ltd_2026-08-20.pdf`; the scrip code is used when BSE gives no company name). On the page, downloads go through the proxy (`/api/pdf` locally, `/pdf` on the worker); in the bookmarklet they are fetched straight from bseindia.com. Rows without an attachment show `—`.

The other query parameters (`pageno`, `strCat`, `subcategory`, `strPrevDate`, `strToDate`, `strSearch`, `strType`) are editable in the **Parameters** panel. Dates are `YYYYMMDD`. Your last scrip code, parameters and proxy URL are remembered in the browser; **Reset params** restores the defaults. **Prev/Next page** step through `pageno`.
