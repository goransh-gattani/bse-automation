// Runs on a www.bseindia.com page (as a bookmarklet or pasted into the
// DevTools console). The request then comes from BSE's own site in your
// real browser, so BSE's CDN doesn't block it and no proxy is needed.
(function () {
  "use strict";
  var API = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w";
  var PDF_BASE = "https://www.bseindia.com/xml-data/corpfiling/AttachHis/";
  var KEY = "bse_automation_bookmarklet";
  var DEFAULTS = {
    strScrip: "532942",
    pageno: "1",
    strCat: "Result",
    subcategory: "Financial Results",
    strPrevDate: "20260630",
    strToDate: "20260930",
    strSearch: "P",
    strType: "C",
  };
  var LABELS = {
    strScrip: "Scrip code",
    pageno: "Page no",
    strCat: "Category",
    subcategory: "Subcategory",
    strPrevDate: "From (YYYYMMDD)",
    strToDate: "To (YYYYMMDD)",
    strSearch: "strSearch",
    strType: "strType",
  };

  if (!/(^|\.)bseindia\.com$/.test(location.hostname)) {
    alert("Open any page on www.bseindia.com first, then run this again.");
    location.href = "https://www.bseindia.com/corporates/ann.html";
    return;
  }
  var old = document.getElementById("bse-auto-panel");
  if (old) old.remove();

  var saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch (e) {}
  var values = Object.assign({}, DEFAULTS, saved);

  function el(tag, style, text) {
    var node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (text != null) node.textContent = text;
    return node;
  }

  var panel = el(
    "div",
    "position:fixed;inset:16px;z-index:2147483647;background:#fff;color:#1c1c1a;border:1px solid #bbb;" +
      "border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.3);font:14px/1.4 system-ui,sans-serif;" +
      "display:flex;flex-direction:column;overflow:hidden"
  );
  panel.id = "bse-auto-panel";

  var head = el("div", "display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #ddd");
  head.append(el("strong", "font-size:16px", "BSE Announcements"));
  var close = el("button", "font-size:18px;border:none;background:none;cursor:pointer", "×");
  close.onclick = function () {
    panel.remove();
  };
  head.append(close);

  var form = el("form", "display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:10px 14px");
  var inputs = {};
  Object.keys(LABELS).forEach(function (key) {
    var label = el("label", "display:flex;flex-direction:column;font-size:12px;color:#555", LABELS[key]);
    var input = el("input", "padding:4px 6px;border:1px solid #bbb;border-radius:4px;width:" + (key === "subcategory" ? "150px" : "110px"));
    input.value = values[key];
    inputs[key] = input;
    label.append(input);
    form.append(label);
  });
  function button(text, onClick, primary) {
    var b = el(
      "button",
      "padding:5px 12px;border-radius:4px;cursor:pointer;border:1px solid " +
        (primary ? "#1f5fbf;background:#1f5fbf;color:#fff" : "#bbb;background:#fff;color:#1c1c1a"),
      text
    );
    b.type = primary ? "submit" : "button";
    if (onClick) b.onclick = onClick;
    return b;
  }
  function page(delta) {
    inputs.pageno.value = String(Math.max(1, (parseInt(inputs.pageno.value, 10) || 1) + delta));
    run();
  }
  form.append(
    button("Fetch", null, true),
    button("◀ Prev", function () {
      page(-1);
    }),
    button("Next ▶", function () {
      page(1);
    }),
    button("Reset", function () {
      Object.keys(DEFAULTS).forEach(function (k) {
        if (k !== "strScrip") inputs[k].value = DEFAULTS[k];
      });
    })
  );
  form.onsubmit = function (e) {
    e.preventDefault();
    run();
  };

  var status = el("div", "padding:0 14px 8px;color:#555");
  var wrap = el("div", "flex:1;overflow:auto;border-top:1px solid #ddd");
  var table = el("table", "width:100%;border-collapse:collapse");
  wrap.append(table);
  panel.append(head, form, status, wrap);
  document.body.append(panel);

  function cell(tr, text, extra) {
    var td = el("td", "padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top;" + (extra || ""), text);
    tr.append(td);
    return td;
  }

  function run() {
    var params = {};
    Object.keys(inputs).forEach(function (k) {
      params[k] = inputs[k].value.trim();
    });
    try {
      localStorage.setItem(KEY, JSON.stringify(params));
    } catch (e) {}
    status.style.color = "#555";
    status.textContent = "Fetching announcements for " + params.strScrip + "…";
    table.replaceChildren();
    fetch(API + "?" + new URLSearchParams(params), { headers: { Accept: "application/json, text/plain, */*" } })
      .then(function (r) {
        if (!r.ok) throw new Error("BSE returned HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        var rows = (data && data.Table) || [];
        var total = data && data.Table1 && data.Table1[0] && data.Table1[0].ROWCNT;
        var hr = el("tr", "background:#f4f4f2;text-align:left");
        ["Date", "Company", "Headline", "Category", "PDF"].forEach(function (h) {
          hr.append(el("th", "padding:6px 10px;position:sticky;top:0;background:#f4f4f2", h));
        });
        table.append(hr);
        rows.forEach(function (row) {
          var tr = el("tr");
          cell(tr, row.NEWS_DT || row.DT_TM || "", "white-space:nowrap");
          cell(tr, row.SLONGNAME || "");
          cell(tr, row.HEADLINE || row.NEWSSUB || "");
          cell(tr, row.SUBCATNAME || row.CATEGORYNAME || "");
          var td = cell(tr, "", "text-align:center;white-space:nowrap");
          var name = (row.ATTACHMENTNAME || "").trim();
          if (name) {
            var a = el("a", "color:#1f5fbf;font-weight:600", "📄 PDF");
            a.href = PDF_BASE + encodeURIComponent(name);
            a.target = "_blank";
            a.rel = "noopener";
            td.append(a);
          } else {
            td.textContent = "—";
          }
          table.append(tr);
        });
        status.textContent = rows.length
          ? rows.length + " results on page " + params.pageno + " (" + (total || rows.length) + " total). Click PDF to open."
          : "No announcements found (page " + params.pageno + ").";
      })
      .catch(function (err) {
        status.style.color = "#b3261e";
        status.textContent = "Error: " + err.message;
      });
  }

  run();
})();
