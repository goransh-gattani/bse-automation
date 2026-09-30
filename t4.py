from playwright.sync_api import sync_playwright
import urllib.request
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
    ctx = b.new_context(accept_downloads=True, viewport={"width": 1200, "height": 700})
    errs = []
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8030/")
    pg.fill("#scrip", "532942 500325"); pg.press("#scrip", "Enter")
    pg.wait_for_function("!document.getElementById('status').textContent.startsWith('Fetching') && document.querySelectorAll('#rows a.download').length == 2", timeout=20000)
    with pg.expect_download() as d:
        pg.click("#rows a.download >> nth=0")
    dl = d.value
    print("PAGE download:", dl.suggested_filename, open(dl.path(), "rb").read()[:40])
    pg.screenshot(path="dl-page.png")

    ctx.route("https://www.bseindia.com/xml-data/**", lambda r: r.fulfill(status=200, content_type="application/pdf", headers={"Content-Disposition": "inline"}, body=b"%PDF-1.4 fake from bse " + r.request.url.encode()))
    ctx.route("https://www.bseindia.com/corporates/**", lambda r: r.fulfill(status=200, content_type="text/html", body="<html><body>stub</body></html>"))
    def api(r):
        url = r.request.url.replace("https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w", "http://127.0.0.1:9106/w")
        with urllib.request.urlopen(url) as resp:
            r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=resp.read())
    ctx.route("https://api.bseindia.com/**", api)
    pg2 = ctx.new_page(); pg2.on("pageerror", lambda e: errs.append(str(e)))
    pg2.goto("https://www.bseindia.com/corporates/ann.html")
    pg2.evaluate(open("/home/claude/bse-automation/docs/bookmarklet.js").read())
    pg2.fill("#bse-auto-panel textarea", "532942 500325")
    pg2.locator("#bse-auto-panel button", has_text="Fetch").click()
    pg2.wait_for_selector("#bse-auto-panel a:has-text('Download') >> nth=1")
    pg2.wait_for_timeout(300)
    with pg2.expect_download() as d2:
        pg2.locator("#bse-auto-panel a", has_text="Download").first.click()
    dl2 = d2.value
    print("BM download:", dl2.suggested_filename, open(dl2.path(), "rb").read()[:60])
    print("errors", errs)
    b.close()
