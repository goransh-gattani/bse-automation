// BSE Explorer: look up a scrip code and see what BSE's own site shows for it, or run any
// BSE API by hand. Runs on a bseindia.com page (as a bookmarklet or pasted into the DevTools
// console). The calls then come from BSE's own site in your real browser, so BSE's CDN does
// not block them and no proxy or Postman is needed.
(() => {
  "use strict";

  // On localhost the page is served by proxy/local_proxy.py, which forwards /bse/... to BSE.
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (!LOCAL && !/(^|\.)bseindia\.com$/.test(location.hostname)) {
    alert("Open any page on www.bseindia.com first, then run this again.");
    location.href = "https://www.bseindia.com/";
    return;
  }
  const HOST_ID = "bse-explorer-host";
  const STORE = "bse_explorer";
  const SITE = "https://www.bseindia.com";
  const BASES = {
    api: "https://api.bseindia.com/BseIndiaAPI/api",
    realtime: "https://api.bseindia.com/RealTimeBseIndiaAPI/api",
    msource: "https://api.bseindia.com/MSource/1D",
  };
  document.getElementById(HOST_ID)?.remove();

  // ---------------------------------------------------------------- endpoint registry
  // [group, id, base, path, params, what it returns]. {scripcode}, {quarter} and {scripname}
  // are filled in from the scrip being looked at.
  const SC = "{scripcode}", QT = "{quarter}", NM = "{scripname}";
  const NEWS = "TabResults_PAR (NEWS)", RESULTS = "TabResults_PAR (RESULTS)", DETAIL = "Corp_detailedResult_Transpose_ng";
  const ENDPOINTS = [
    ["Scrip page", "getScripHeaderData", "api", "getScripHeaderData/w", { Debtflag: "", scripcode: SC, seriesid: "" },
      "Company names and SEO URLs, live price (LTP, Chg, PcChg), Open/High/Low/PrevClose, timestamp (Ason), notice count and ASM/GSM/EMS/SMS flag text."],
    ["Scrip page", "ComHeadernew_par", "api", "ComHeadernew_par/w", { quotetype: "", scripcode: SC, seriesid: "" },
      "Security master and ratios: ISIN, security id, group, index, sector/industry, face value, settlement type, EPS, CEPS, PE, PB, ROE, NPM, OPM and the consolidated versions (Con*)."],
    ["Scrip page", "MarketDepth", "realtime", "MarketDepth/w", { flag: "", quotetype: "EQ", scripcode: SC },
      "Top-5 order book: BPrice/BQty 1-5 (bids), SPrice/SQty 1-5 (asks), TotalBQty, TotalSQty, dttm."],
    ["Scrip page", "StockTrading", "api", "StockTrading/w", { flag: "", quotetype: "EQ", scripcode: SC },
      "WAP, turnover (+unit), traded quantity, 2-week average quantity, market cap (full and free-float, Rs Cr), circuit limits, ex-date."],
    ["Scrip page", "HighLow", "api", "HighLow/w", { Type: "EQ", flag: "C", scripcode: SC },
      "52-week high/low (adjusted and unadjusted, with dates) and week/month high-low."],
    ["Scrip page", "PriceBand", "api", "PriceBand/w", { scripcode: SC },
      "Price band per period (UpperT/LowerT today; D/W/M/Q/Y), band percentages, date."],
    ["Scrip page", "SecurityPosition", "api", "SecurityPosition/w", { quotetype: "EQ", scripcode: SC },
      "Quantity traded, deliverable quantity and deliverable % (a JSON string inside JSON; the explorer decodes it)."],
    ["Scrip page", "StockReachGraphCas", "api", "StockReachGraphCas/w", { scripcode: SC, flag: "0", fromdate: "", todate: "", seriesid: "" },
      "Intraday series in Data (a JSON string, decoded here), plus PrevClose and day high/low. flag=0 is intraday; other ranges are untested."],
    ["Scrip page", "EQPeerGp", "api", "EQPeerGp/w", { scripcomare: "", scripcode: SC },
      "Peer table (Table[]): name, code, LTP, change %, EPS, PE, PB, revenue and PAT (Rs Cr), OPM, NPM, 52-week range, result quarter."],
    ["Scrip page", NEWS, "api", "TabResults_PAR/w", { scripcode: SC, tabtype: "NEWS" },
      "Recent announcements: Newsid, NewsSubj, Newsdt (JSON string, decoded here)."],
    ["Filings", "AnnSubCategoryGetData", "api", "AnnSubCategoryGetData/w", { strCat: "-1", strPrevDate: "", strScrip: SC, strSearch: "P", strToDate: "", strType: "C", subcategory: "-1", pageno: "1" },
      "Corporate announcements and filings from BSE's announcements page: Table[] rows (SCRIP_CD, SLONGNAME, NEWS_DT, HEADLINE, CATEGORYNAME, SUBCATNAME, ATTACHMENTNAME = the PDF) and Table1[0].ROWCNT = total rows. A page is about 50 rows; pageno selects it. strCat/subcategory -1 = all; strPrevDate/strToDate are YYYYMMDD."],
    ["Scrip page", RESULTS, "api", "TabResults_PAR/w", { scripcode: SC, tabtype: "RESULTS" },
      "Latest quarter, previous quarter and FY for revenue, net profit, EPS, cash EPS, OPM, NPM (Cr and millions) plus result-page links whose qtr= is the quarter id."],
    ["Scrip page", "ScripwiseCautionaryMsg", "api", "ScripwiseCautionaryMsg/w", { scripcode: SC },
      "Cautionary/surveillance messages (Table, Table1). Empty when none."],
    ["Scrip page", "LeftMenunew", "api", "LeftMenunew/w", { quotetype: "LMN", scripcode: SC },
      "Which sections apply to the scrip (results, derivatives, SLB, debt, ETF, ...)."],
    ["Results page", DETAIL, "api", "Corp_detailedResult_Transpose_ng/w", { Scrip_cd: SC, Qtr: QT },
      "Full P&L for one quarter (Qtr is a quarter id: 130.00 = Jun-26, 129.00 = Mar-26, one step per quarter): sales, other income, expense lines (negative), PBT, tax, net profit, EPS, plus type and period dates. Figures are as originally filed."],
    ["Results page", "Corp_BSEDnBResults_SEBI_Consolidated_Res_ng", "api", "Corp_BSEDnBResults_SEBI_Consolidated_Res_ng/w",
      { type1: "c", strtype: QT, strscripcd: SC, strscripname: NM, strresultType: "", action: "show" },
      "SEBI-format summary as {Description, Amount} rows, including discontinued operations and comprehensive income. Amounts are labelled Rs million."],
    ["Results page", "Corp_SEGMENTS_QUART_COMP_ng", "api", "Corp_SEGMENTS_QUART_COMP_ng/w", { Scrip_cd: SC, QuarterID: QT },
      "Segment revenue and result in columns Q1..Q5 (meaning unconfirmed). Empty for the two latest quarters of ABB."],
    ["Results page", "Corp_Segments_Total_p_ng", "api", "Corp_Segments_Total_p_ng/w", { Scrip_cd: SC, QuarterID: QT },
      "Segment totals. Empty in every test."],
    ["Results page", "Corp_GET_BSEDnBResultNotes_ng", "api", "Corp_GET_BSEDnBResultNotes_ng/w", { scrip_cd: SC, currQtr: QT },
      "The notes to the results, as text."],
    ["Scrip search", "GetQuoteAllSearchDatabeta", "msource", "GetQuoteAllSearchDatabeta.aspx", { searchString: SC },
      "Search box. Takes a scrip code, symbol, name fragment or ISIN; returns [{strSricpCode, shortName, scripName, Isin, SEOUrl, Type}]. Empty text returns a default list."],
    ["Scrip search", "ListofScripData_new", "api", "ListofScripData_new/w", { Group: "", Scripcode: "", segment: "Equity", status: "Active", scripName: "" },
      "Securities matching the filters: SCRIP_CD, scrip_id, Scrip_Name, Issuer_Name, Segment, Status, GROUP, FACE_VALUE, ISIN_NUMBER, Mktcap (Rs Cr), NSURL. segment is required; Scripcode is exact; scripName is a contains match. Unpaginated: big segments are many MB."],
    ["Scrip search", "ddlGroup", "api", "ddlGroup/w", { flag: "0" }, "The 25 group codes (GROUP_CODE) valid for the Group filter."],
    ["Other", "Mkt_GetTicker_ng", "api", "Mkt_GetTicker_ng/w", { env: "1" }, "Site-wide ticker banners. Not scrip-specific."],
  ].map(([group, id, base, path, params, returns]) => ({ group, id, base, path, params, returns }));
  const byId = Object.fromEntries(ENDPOINTS.map((e) => [e.id, e]));
  const DASH = ["getScripHeaderData", "ComHeadernew_par", "MarketDepth", "StockTrading", "HighLow", "PriceBand", "SecurityPosition",
    "StockReachGraphCas", "EQPeerGp", RESULTS, "ScripwiseCautionaryMsg", "LeftMenunew"];
  const SEGMENTS = [["Equity", "Equity T+1"], ["EQT0", "Equity T+0"], ["MF", "MF/ETF"], ["HS", "Hybrid Security"], ["MB", "Municipal Bonds"],
    ["PreferenceShares", "Preference Shares"], ["Debentures and Bonds", "Debentures and Bonds"],
    ["Equity - Institutional Series", "Equity - Institutional Series"], ["Commercial Papers", "Commercial Papers"], ["SSE", "SSE"]];

  // ---------------------------------------------------------------- state and helpers
  const state = { code: "", name: "", quarter: "", res: {}, token: 0 };
  const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; } };
  const remember = (patch) => { try { localStorage.setItem(STORE, JSON.stringify({ ...load(), ...patch })); } catch { /* storage may be blocked */ } };

  // DOM builder. Text always goes in as text nodes: API data is never parsed as HTML.
  const h = (tag, props, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, "");
      else if (v !== false && v != null) node.setAttribute(k, v);
    }
    node.append(...kids.flat().filter((k) => k != null && k !== false));
    return node;
  };
  const svgEl = (tag, props, ...kids) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(props || {})) node.setAttribute(k, v);
    node.append(...kids);
    return node;
  };
  const g = (obj, path) => path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), obj);
  const blank = (v) => v == null || v === "";
  const show = (v) => (blank(v) ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  const num = (v) => parseFloat(String(v).replace(/,/g, ""));

  // BSE sometimes returns JSON inside a JSON string; decode those wherever they appear.
  const unwrap = (v) => {
    if (typeof v === "string") {
      const t = v.trim();
      if ((t[0] === "{" && t.endsWith("}")) || (t[0] === "[" && t.endsWith("]"))) {
        try { return unwrap(JSON.parse(t)); } catch { /* plain text that looks like JSON */ }
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(unwrap);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)]));
    return v;
  };

  const fill = (params) => Object.fromEntries(Object.entries(params).map(([k, v]) => [k,
    v.replace(SC, state.code).replace(QT, state.quarter).replace(NM, state.name.replace(/\s+/g, "-"))]));
  const buildUrl = (e, params) => `${LOCAL ? "/bse/" + e.base : BASES[e.base]}/${e.path}?` +
    Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

  // Never throws: failures come back as {ok:false, error} so each card can show its own.
  async function call(e, params) {
    const url = buildUrl(e, params);
    const t0 = performance.now();
    try {
      const res = await fetch(url);
      const text = await res.text();
      const out = { url, status: res.status, ms: Math.round(performance.now() - t0), bytes: text.length, text, ok: res.ok };
      if (LOCAL && res.status === 404) return { ...out, ok: false, error: "This server has no BSE proxy (404). Stop it and run  python3 proxy/local_proxy.py  from the repo root, then reload this page." };
      if (!res.ok) return { ...out, error: `HTTP ${res.status}${res.status === 403 ? " (BSE refused the request)" : ""}: ${text.slice(0, 120)}` };
      try { out.data = unwrap(JSON.parse(text)); } catch { return { ...out, ok: false, error: `Not JSON: ${text.slice(0, 120)}` }; }
      return out;
    } catch (err) {
      return { url, status: 0, ms: Math.round(performance.now() - t0), bytes: 0, text: "", ok: false, error: `Request failed: ${err.message}` };
    }
  }

  const saveFile = (name, text, type) => {
    const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a);
    a.click();
    a.remove();
  };
  const csvCell = (v) => { const s = show(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const toCsv = (rows, cols) => [cols.map(csvCell).join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
  const pretty = (data) => { const s = JSON.stringify(data, null, 2); return s.length > 150000 ? s.slice(0, 150000) + "\n… truncated, use Download for the full response" : s; };
  const rowsFrom = (data) => {
    const isRows = (a) => Array.isArray(a) && a.length && a[0] && typeof a[0] === "object" && !Array.isArray(a[0]);
    if (isRows(data)) return data;
    return data && typeof data === "object" ? Object.values(data).find(isRows) || null : null;
  };

  // ---------------------------------------------------------------- shell
  const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.panel{position:absolute;inset:0;display:flex;flex-direction:column;background:#fff;color:#1c1c1a;border:1px solid #b9b9b4;border-radius:8px;
  box-shadow:0 8px 32px rgba(0,0,0,.35);font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
header{display:flex;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid #ddd;flex-wrap:wrap}
header strong{font-size:15px}
header form{display:flex;gap:6px;flex:1;min-width:260px}
header input{flex:1;min-width:160px}
input,select,button,textarea{font:inherit;padding:4px 8px;border:1px solid #b9b9b4;border-radius:4px;background:#fff;color:inherit}
button{cursor:pointer}button:disabled{opacity:.45;cursor:default}
button.primary{background:#1f5fbf;border-color:#1f5fbf;color:#fff}
.x{border:none;background:none;font-size:20px;line-height:1}
nav{display:flex;gap:2px;padding:0 12px;border-bottom:1px solid #ddd}
nav button{border:none;border-bottom:2px solid transparent;border-radius:0;padding:7px 12px;background:none}
nav button.on{border-bottom-color:#1f5fbf;color:#1f5fbf;font-weight:600}
#status{padding:4px 12px;color:#555;min-height:24px}
#picks{padding:0 12px 6px;display:flex;flex-direction:column;gap:2px}
#picks button{text-align:left;border:none;background:#f4f4f1}#picks button:hover{background:#e6edf9}
main{flex:1;overflow:auto;padding:12px}
.muted{color:#6b6b66}.err{color:#b3261e}.up{color:#157f3b}.dn{color:#b3261e}
h2{margin:0 0 4px;font-size:18px}h3{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#555}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;margin:10px 0}
.card{border:1px solid #ddd;border-radius:6px;padding:10px;min-width:0;overflow:auto}
.wide{grid-column:1/-1}
.price{font-size:26px;font-weight:600}
table{border-collapse:collapse;width:100%}
th,td{padding:3px 8px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
th{background:#f7f7f4;font-weight:600;position:sticky;top:0}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.kv td:first-child{color:#555;width:48%}
tr.derived td{background:#f4f8ff}tr.click{cursor:pointer}tr.click:hover td{background:#eef3fb}
.bar{display:flex;gap:6px;align-items:center;margin:6px 0;flex-wrap:wrap}
.scroll{max-height:62vh;overflow:auto;border:1px solid #eee}
pre{margin:0;padding:8px;background:#f7f7f4;border-radius:4px;overflow:auto;max-height:62vh;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-all}
label.f{display:flex;flex-direction:column;font-size:11px;color:#555;gap:2px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}
.console{display:grid;grid-template-columns:minmax(240px,320px) 1fr;gap:12px}
@media(max-width:800px){.console{grid-template-columns:1fr}}
details{margin:4px 0}summary{cursor:pointer}
`;
  const host = h("div");
  host.id = HOST_ID;
  host.style.cssText = "position:fixed;inset:12px;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });
  try {
    const sheet = new CSSStyleSheet(); // CSSOM, so a strict page CSP can't block it
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
  } catch {
    root.append(h("style", {}, CSS));
  }

  const qBox = h("input", { placeholder: "Scrip code, symbol, name or ISIN", autocomplete: "off", spellcheck: "false" });
  const status = h("div", { id: "status", role: "status" });
  const picks = h("div", { id: "picks" });
  const views = {};
  const TABS = [["scrip", "Scrip"], ["fin", "Financials"], ["console", "API console"], ["find", "Find scrips"]];
  const tabBtns = {};
  const say = (text, isErr) => { status.textContent = text; status.className = isErr ? "err" : ""; };
  const openTab = (name) => {
    for (const [id] of TABS) { views[id].hidden = id !== name; tabBtns[id].className = id === name ? "on" : ""; }
    remember({ tab: name });
    if (name === "find") findOpened();
  };

  for (const [id, label] of TABS) {
    views[id] = h("main", { hidden: true });
    tabBtns[id] = h("button", { type: "button", onclick: () => openTab(id) }, label);
  }
  const form = h("form", { onsubmit: (ev) => { ev.preventDefault(); lookup(qBox.value.trim()); } }, qBox,
    h("button", { class: "primary", type: "submit" }, "Fetch"));
  root.append(h("div", { class: "panel" },
    h("header", {}, h("strong", {}, "BSE Explorer"), form, LOCAL ? "" : h("button", { class: "x", type: "button", title: "Close", onclick: () => host.remove() }, "×")),
    h("nav", {}, ...TABS.map(([id]) => tabBtns[id])), status, picks, ...TABS.map(([id]) => views[id])));
  document.body.append(host);

  // ---------------------------------------------------------------- generic table with filter and paging
  function dataTable(rows, cols, { onRow, page = 100 } = {}) {
    let view = rows, at = 0;
    const info = h("span", { class: "muted" });
    const body = h("tbody");
    const prev = h("button", { type: "button", onclick: () => { at = Math.max(0, at - page); draw(); } }, "‹");
    const next = h("button", { type: "button", onclick: () => { at += page; draw(); } }, "›");
    const box = h("input", { placeholder: "Filter rows…", oninput: () => {
      const q = box.value.toLowerCase();
      view = q ? rows.filter((r) => cols.some((c) => show(r[c]).toLowerCase().includes(q))) : rows;
      at = 0;
      draw();
    } });
    function draw() {
      body.replaceChildren(...view.slice(at, at + page).map((r) =>
        h("tr", onRow ? { class: "click", title: "Open this scrip", onclick: () => onRow(r) } : {}, ...cols.map((c) => h("td", {}, show(r[c]))))));
      info.textContent = view.length ? `${at + 1}-${Math.min(at + page, view.length)} of ${view.length}` : "No rows";
      prev.disabled = at === 0;
      next.disabled = at + page >= view.length;
    }
    draw();
    return {
      get rows() { return view; },
      node: h("div", {}, h("div", { class: "bar" }, box, prev, next, info),
        h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, ...cols.map((c) => h("th", {}, c)))), body))),
    };
  }

  // ---------------------------------------------------------------- lookup
  async function lookup(text) {
    picks.replaceChildren();
    if (!text) return say("Enter a scrip code, symbol, name or ISIN.", true);
    if (/^\d{5,6}$/.test(text)) return loadScrip(text);
    say("Searching…");
    const r = await call(byId.GetQuoteAllSearchDatabeta, { searchString: text });
    if (!r.ok) return say(r.error, true);
    const seen = new Set();
    const hits = (Array.isArray(r.data) ? r.data : []).filter((x) => { const k = x.strSricpCode + x.Type; return !seen.has(k) && seen.add(k); }).slice(0, 12);
    if (!hits.length) return say(`No match for "${text}".`, true);
    say(`${hits.length} match(es). Pick one:`);
    picks.append(...hits.map((x) => h("button", { type: "button", onclick: () => { picks.replaceChildren(); qBox.value = x.strSricpCode; loadScrip(x.strSricpCode); } },
      `${x.scripName} · ${x.shortName} · ${x.strSricpCode} · ${x.Type}`)));
  }

  // Every endpoint is requested at once and each card fills in as soon as its own answer arrives.
  async function loadScrip(code) {
    const token = ++state.token;
    Object.assign(state, { code, name: "", quarter: "", res: {} });
    remember({ code });
    qBox.value = code;
    finReset();
    renderScrip();
    openTab("scrip");
    annLoad(false);
    let done = 0, failed = 0;
    const progress = () => say(done < DASH.length ? `Loaded ${done} of ${DASH.length} endpoints…`
      : failed ? `${failed} of ${DASH.length} calls failed (details on each card).` : `Loaded ${DASH.length} endpoints.`, done === DASH.length && failed > 0);
    progress();
    await Promise.all(DASH.map(async (id) => {
      const r = await call(byId[id], fill(byId[id].params));
      if (token !== state.token) return; // a newer lookup superseded this one
      state.res[id] = r;
      done++;
      if (!r.ok) failed++;
      if (id === "getScripHeaderData") state.name = g(r.data, "Cmpname.FullN") || "";
      repaint(id);
      if (id === RESULTS) { // the latest quarter's link is on the results tab; check it as soon as it is known
        state.quarter = (/qtr=([\d.]+)/.exec(g(r.data, "resultinS.0.LLQ") || "") || [])[1] || "";
        detectLatest(token);
      }
      progress();
    }));
    if (token === state.token) consoleApi.refresh();
  }

  // ---------------------------------------------------------------- Scrip tab
  // A slot is one box on the page fed by one or more endpoints. It says "Loading…" until all of
  // them have answered, then shows the error of the first that failed, or the built content.
  // With raw=true it is repainted on every answer and decides for itself what is ready.
  const slots = [];
  function paint(e) {
    const list = e.ids.map((id) => state.res[id]);
    let body;
    try {
      if (e.raw) body = e.render();
      else if (list.some((r) => !r)) body = h("p", { class: "muted" }, "Loading…");
      else { const bad = list.find((r) => !r.ok); body = bad ? h("p", { class: "err" }, bad.error) : e.render(...list.map((r) => r.data)); }
    } catch (err) { body = h("p", { class: "err" }, `Could not display this data: ${err.message}`); }
    e.box.replaceChildren(body);
  }
  function slot(ids, render, raw) {
    const e = { ids: [].concat(ids), box: h("div", {}), render, raw };
    slots.push(e);
    paint(e);
    return e.box;
  }
  const repaint = (id) => slots.filter((e) => e.ids.includes(id)).forEach(paint);
  const card = (title, ids, build, cls) => h("section", { class: `card ${cls || ""}` }, h("h3", {}, title), slot(ids, build));
  const kv = (rows) => h("table", { class: "kv" }, h("tbody", {}, ...rows.filter(([, v]) => !blank(v)).map(([k, v]) => h("tr", {}, h("td", {}, k), h("td", {}, show(v))))));

  function chart(data) {
    const pts = (data.Data || []).map((p) => {
      const key = Object.keys(p).find((k) => /^vale\d+$/.test(k));
      return { t: Date.parse(p.dttm), y: num(p[key]) };
    }).filter((p) => isFinite(p.t) && isFinite(p.y));
    if (pts.length < 2) return h("p", { class: "muted" }, "No intraday points returned.");
    const prev = num(data.PrevClose);
    const ys = pts.map((p) => p.y).concat(isFinite(prev) ? [prev] : []);
    const lo = Math.min(...ys), hi = Math.max(...ys), t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const W = 640, H = 170, P = 38;
    const x = (t) => P + (W - 2 * P) * (t1 === t0 ? 0 : (t - t0) / (t1 - t0));
    const y = (v) => H - 22 - (H - 40) * (hi === lo ? 0.5 : (v - lo) / (hi - lo));
    const hm = (t) => new Date(t).toTimeString().slice(0, 5);
    const label = (tx, ty, text, anchor) => svgEl("text", { x: tx, y: ty, "font-size": 10, fill: "#555", "text-anchor": anchor || "start" }, text);
    return svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Intraday price" },
      isFinite(prev) ? svgEl("line", { x1: P, x2: W - P, y1: y(prev), y2: y(prev), stroke: "#999", "stroke-dasharray": "4 3" }) : "",
      svgEl("polyline", { fill: "none", stroke: "#1f5fbf", "stroke-width": 1.5, points: pts.map((p) => `${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ") }),
      label(2, y(hi) + 3, hi.toFixed(2)), label(2, y(lo) + 3, lo.toFixed(2)),
      isFinite(prev) ? label(W - P + 2, y(prev) + 3, `prev ${prev.toFixed(2)}`) : "",
      label(P, H - 6, hm(t0)), label(W - P, H - 6, hm(t1), "end"));
  }

  // ---- Announcements: BSE's filings feed (the one behind the announcements page), with PDF links.
  // The first load shows one page of x rows; "Load more" adds the next two pages (2x rows).
  const PDF_BASE = SITE + "/xml-data/corpfiling/AttachHis/";
  const ANN_CATS = [["All announcements", "-1", "-1"], ["Financial results", "Result", "Financial Results"]];
  const ANN_RANGES = [["Last 12 months", 365], ["Last 3 years", 1095], ["Last 5 years", 1825]];
  const ann = { cat: 0, range: 0, rows: [], total: 0, pages: 0, x: 0, busy: false, error: "", token: 0 };
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const annBody = h("div", {});
  const annBox = h("div", {},
    h("div", { class: "row" },
      h("label", { class: "f" }, "Show", h("select", { onchange: (e) => { ann.cat = +e.target.value; annLoad(false); } }, ...ANN_CATS.map(([l], i) => h("option", { value: i }, l)))),
      h("label", { class: "f" }, "Period", h("select", { onchange: (e) => { ann.range = +e.target.value; annLoad(false); } }, ...ANN_RANGES.map(([l], i) => h("option", { value: i }, l))))),
    annBody);

  // "<Company>_<YYYY-MM-DD>.pdf", or the scrip code when BSE gives no company name.
  const pdfFileName = (row) => {
    const company = String(row.SLONGNAME || "").replace(/[^A-Za-z0-9 .&()-]/g, "").replace(/\s+/g, " ").trim().replace(/\.+$/, "");
    const day = String(row.NEWS_DT || row.DT_TM || "").replace(/\D/g, "").slice(0, 8).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
    return [company || row.SCRIP_CD || state.code, day].filter(Boolean).join("_") + ".pdf";
  };
  // On bseindia.com the PDF is fetched from the same site and saved under our name; on localhost
  // the local proxy serves it as a download. If saving fails, the link just opens the PDF.
  function savePdf(e) {
    const link = e.currentTarget, label = link.textContent;
    e.preventDefault();
    link.textContent = "Saving…";
    fetch(link.href)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
      .then((blob) => saveFile(link.getAttribute("download"), blob, "application/pdf"))
      .catch(() => window.open(link.href, "_blank", "noopener"))
      .then(() => { link.textContent = label; });
  }
  function pdfCell(row) {
    const name = String(row.ATTACHMENTNAME || "").trim();
    if (!name) return "—";
    const file = pdfFileName(row), url = PDF_BASE + encodeURIComponent(name);
    return [h("a", { href: url, target: "_blank", rel: "noopener" }, "📄 View"), " ",
      LOCAL ? h("a", { href: `/api/pdf?name=${encodeURIComponent(name)}&filename=${encodeURIComponent(file)}`, download: file }, "⬇ Download")
        : h("a", { href: url, download: file, onclick: savePdf }, "⬇ Download")];
  }
  function drawAnn() {
    const left = ann.total - ann.rows.length;
    annBody.replaceChildren(
      ann.error ? h("p", { class: "err" }, ann.error) : "",
      ann.rows.length ? h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, ...["Date", "Headline", "Category", "PDF"].map((t) => h("th", {}, t)))),
        h("tbody", {}, ...ann.rows.map((r) => h("tr", {}, h("td", {}, show(r.NEWS_DT || r.DT_TM)), h("td", {}, show(r.HEADLINE || r.NEWSSUB)),
          h("td", {}, show(r.SUBCATNAME || r.CATEGORYNAME)), h("td", {}, pdfCell(r)))))))
        : h("p", { class: "muted" }, ann.busy ? "Loading…" : ann.error ? "" : "No announcements in this period."),
      ann.rows.length ? h("p", { class: "muted" }, `Showing ${ann.rows.length} of ${ann.total}.`) : "",
      ann.rows.length && left > 0 ? h("button", { type: "button", disabled: ann.busy, onclick: () => annLoad(true) }, ann.busy ? "Loading…" : `Load ${Math.min(2 * ann.x, left)} more`) : "");
  }
  async function annLoad(more) {
    const token = ++ann.token;
    if (!more) Object.assign(ann, { rows: [], total: 0, pages: 0, x: 0 });
    ann.busy = true;
    ann.error = "";
    drawAnn();
    const now = new Date(), since = new Date(now.getTime() - ANN_RANGES[ann.range][1] * 864e5);
    const pages = more ? [ann.pages + 1, ann.pages + 2] : [1];
    const res = await Promise.all(pages.map((p) => call(byId.AnnSubCategoryGetData, { strCat: ANN_CATS[ann.cat][1], strPrevDate: ymd(since), strScrip: state.code,
      strSearch: "P", strToDate: ymd(now), strType: "C", subcategory: ANN_CATS[ann.cat][2], pageno: String(p) })));
    if (token !== ann.token) return; // another scrip, filter or load superseded this one
    ann.busy = false;
    const bad = res.find((r) => !r.ok);
    if (bad) ann.error = bad.error;
    else {
      res.forEach((r) => ann.rows.push(...((r.data && r.data.Table) || [])));
      ann.total = parseInt(g(res[0].data, "Table1.0.ROWCNT"), 10) || ann.rows.length;
      ann.pages += pages.length;
      if (!more) ann.x = ann.rows.length;
    }
    drawAnn();
  }

  function renderScrip() {
    slots.length = 0;
    const R = state.res, D = (id) => g(R[id], "data");
    const title = slot(["getScripHeaderData", "ComHeadernew_par"], () => {
      const head = D("getScripHeaderData"), com = D("ComHeadernew_par");
      const chg = g(head, "CurrRate.Chg"), pc = g(head, "CurrRate.PcChg");
      const dir = num(chg) < 0 ? "dn" : num(chg) > 0 ? "up" : "";
      const link = g(head, "Cmpname.SEOUrlEQ");
      return h("div", {},
        h("h2", {}, g(head, "Cmpname.FullN") || g(com, "SecurityId") || state.code),
        h("div", { class: "muted" }, [g(com, "SecurityId"), state.code, g(com, "ISIN"), g(com, "Group") && `Group ${g(com, "Group")}`, g(com, "Sector"), g(com, "IndustryNew")].filter(Boolean).join(" · "),
          link ? [" · ", h("a", { href: SITE + link, target: "_blank", rel: "noopener" }, "Open on BSE")] : ""),
        !R.getScripHeaderData ? h("p", { class: "muted" }, "Loading price…")
          : head ? h("div", {}, h("span", { class: "price" }, g(head, "Header.LTP") || g(head, "CurrRate.LTP") || ""), " ",
            h("span", { class: dir }, `${chg || ""} (${pc || ""}%)`), " ", h("span", { class: "muted" }, g(head, "Header.Ason") || ""))
            : h("p", { class: "err" }, R.getScripHeaderData.error));
    }, true);

    const ratio = (c, label, a, b) => h("tr", {}, h("td", {}, label), h("td", { class: "n" }, show(g(c, a)) || "—"), h("td", { class: "n" }, show(g(c, b)) || "—"));
    const flags = (head, cm) => {
      const hd = g(head, "Header") || {};
      const items = ["ASMText", "GSMText", "EMSText", "SMSText", "IRPText", "DisplayText"].filter((k) => hd[k]).map((k) => `${k}: ${hd[k]}`);
      const caution = [...(cm?.Table || []), ...(cm?.Table1 || [])].map(show);
      const all = [...items, ...caution];
      return all.length ? h("ul", {}, ...all.map((t) => h("li", {}, t))) : h("p", { class: "muted" }, "None reported.");
    };

    const resultsCard = card("Latest results (Rs Cr)", RESULTS, (d) => h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, ""), ...["col2", "col3", "col4"].map((c) => h("th", { class: "n" }, d[c] || "")))),
      h("tbody", {}, ...(d.resultinCr || []).map((r) => h("tr", {}, h("td", {}, r.title), ...["v1", "v2", "v3"].map((k) => h("td", { class: "n" }, r[k] ?? "")))))));

    const download = () => saveFile(`bse_${state.code}_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ scripcode: state.code, fetchedAt: new Date().toISOString(),
        responses: Object.fromEntries(DASH.filter((id) => R[id]).map((id) => [id, { url: R[id].url, status: R[id].status, data: R[id].data, error: R[id].error }])) }, null, 2), "application/json");

    views.scrip.replaceChildren(title, h("div", { class: "grid" },
      card("Intraday", "StockReachGraphCas", chart, "wide"),
      card("Day range", "getScripHeaderData", (d) => kv([["Open", d.Header.Open], ["High", d.Header.High], ["Low", d.Header.Low], ["Previous close", d.Header.PrevClose]])),
      card("52-week / week / month", "HighLow", (d) => kv([["52-wk high", d.Fifty2WkHigh_unadj], ["52-wk low", d.Fifty2WkLow_unadj], ["Week high / low", d.WeekHighLow], ["Month high / low", d.MonthHighLow]])),
      card("Trading", ["StockTrading", "SecurityPosition", "PriceBand"], (t, s, p) => kv([
        ["WAP", t.WAP], ["Turnover", t.Turnover && `${t.Turnover} ${t.Turnoverin || ""}`], ["Traded qty", t.TTQ], ["2-wk avg qty", t.TwoWkAvgQty && `${t.TwoWkAvgQty} ${t.TwoWkAvgQtyin || ""}`],
        ["Delivered qty", s.DeliverableQty], ["Delivery % of traded", s.PcDQ_TQ], ["As of", s.TradeDate],
        ["Price band (lower / upper)", p.LowerT && `${p.LowerT} / ${p.UpperT}`], ["Band %", p.PBpcUC && `${p.PBpcLC}% / ${p.PBpcUC}%`], ["Circuit limit", t.CktLimit], ["Ex date", t.ExDate],
        ["Market cap (Rs Cr)", t.MktCapFull], ["Free-float mcap (Rs Cr)", t.MktCapFF]])),
      card("Valuation and ratios", "ComHeadernew_par", (c) => h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", { class: "n" }, "Standalone"), h("th", { class: "n" }, "Consolidated"))),
        h("tbody", {}, ratio(c, "EPS", "EPS", "ConEPS"), ratio(c, "Cash EPS", "CEPS", "ConCEPS"), ratio(c, "PE", "PE", "ConPE"), ratio(c, "PB", "PB", "ConPB"),
          ratio(c, "ROE %", "ROE", "ConROE"), ratio(c, "OPM %", "OPM", "ConOPM"), ratio(c, "NPM %", "NPM", "ConNPM")))),
      card("Classification", "ComHeadernew_par", (d) => kv([["Sector", d.Sector], ["Industry (new)", d.IndustryNew], ["Industry", d.Industry], ["Industry group", d.IGroup], ["Sub-group", d.ISubGroup],
        ["Index", d.Index], ["Group", d.Group], ["Face value", d.FaceVal], ["Settlement", d.SetlType]])),
      card("Market depth", "MarketDepth", (d) => h("table", {},
        h("thead", {}, h("tr", {}, ...["Bid qty", "Bid", "Ask", "Ask qty"].map((t, i) => h("th", { class: "n" }, t)))),
        h("tbody", {}, ...[1, 2, 3, 4, 5].map((i) => h("tr", {}, ...[`BQty${i}`, `BPrice${i}`, `SPrice${i}`, `SQty${i}`].map((k) => h("td", { class: "n" }, d[k] ?? "")))),
          h("tr", {}, h("td", { class: "n" }, h("b", {}, d.TotalBQty)), h("td", {}, "total"), h("td", {}, "total"), h("td", { class: "n" }, h("b", {}, d.TotalSQty)))))),
      resultsCard,
      card("Flags and cautions", ["getScripHeaderData", "ScripwiseCautionaryMsg"], flags),
      h("section", { class: "card wide" }, h("h3", {}, "Announcements"), annBox),
      card("Peers (Rs Cr)", "EQPeerGp", (d) => {
        const cols = ["Name", "scrip_cd", "LTP", "Change", "PE", "PB", "EPS", "Revenue", "PAT", "OPM", "NPM", "w52hi", "w52lo", "Results_QuarterName"];
        return h("table", {}, h("thead", {}, h("tr", {}, ...cols.map((c) => h("th", {}, c === "Change" ? "Chg %" : c)))),
          h("tbody", {}, ...(d.Table || []).map((r) => h("tr", {}, ...cols.map((c) => h("td", {}, show(r[c])))))));
      }, "wide")),
      h("div", { class: "bar" }, h("button", { type: "button", onclick: download }, "Download all as JSON")),
      h("details", {}, h("summary", {}, "Raw responses"), ...DASH.map((id) => slot(id, () => {
        const r = R[id];
        return !r ? h("p", { class: "muted" }, `${id} · loading…`) : h("details", {}, h("summary", { class: r.ok ? "" : "err" }, `${id} · ${r.status} · ${r.ms} ms · ${r.bytes} chars`),
          h("div", { class: "muted" }, r.url), h("pre", {}, r.ok ? pretty(r.data) : r.error));
      }, true))));
  }

  // ---------------------------------------------------------------- Financials tab
  // BSE numbers quarters 126 = Jun-25, 127 = Sep-25, ... one per quarter (checked for ABB). People
  // think in "Q1 FY27", so the id is only used under the hood and labels come from BSE's own dates.
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fyLabel = (year, month) => `Q${{ 5: 1, 8: 2, 11: 3, 2: 4 }[month] || "?"} FY${String(month <= 2 ? year : year + 1).slice(-2)}`;
  const idEnd = (id) => { const m = 2025 * 12 + 5 + 3 * (Math.round(num(id)) - 126); return [Math.floor(m / 12), m % 12]; };
  const idLabel = (id) => { const [y, mo] = idEnd(id); return `${fyLabel(y, mo)} · ${MONTHS[mo]}-${String(y).slice(-2)}`; };
  const endLabel = (end) => { // "30-Jun-26" -> "Q1 FY27"
    const m = /^\d+-(\w{3})-(\d{2})$/.exec(end || "");
    return m && MONTHS.includes(m[1]) ? fyLabel(2000 + +m[2], MONTHS.indexOf(m[1])) : "";
  };
  const latestGuess = () => { // the last quarter that has ended, when BSE's results link gave none
    const now = new Date();
    return 126 + Math.floor((now.getFullYear() * 12 + now.getMonth() - 1 - (2025 * 12 + 5)) / 3);
  };
  const finQ = h("select", {});
  const finN = h("input", { type: "number", min: 1, max: 12, value: 5, style: "width:60px" });
  const finOut = h("div", {});
  // note: "" (nothing to say), or what the background check found
  const finNote = h("p", { class: "muted" });
  let finTable = null;
  const LINE = { sales: "Net Sales/Revenue From Operations", cmc: "Cost of Materials Consumed", purch: "Purchases of stock-in-trade",
    inv: "Changes in inventories of finished goods, work-in-progress and stock-in-trade", emp: "Employee benefit expense", oth: "Other Expenses",
    pbt: "Profit (+)/ Loss (-) from Ordinary Activities before Tax", tax: "Tax", pat: "Net Profit (+)/ Loss (-) from Ordinary Activities after Tax" };

  views.fin.append(
    h("p", { class: "muted" }, "Quarterly P&L from BSE's results page, as originally filed (later restatements are not applied). Expenses are negative. BSE labels these amounts Rs million; check the SEBI summary in the API console if a company reports differently."),
    finNote,
    h("div", { class: "row" }, h("label", { class: "f" }, "Up to quarter", finQ), h("label", { class: "f" }, "How many", finN),
      h("button", { class: "primary", type: "button", onclick: () => loadFin(false) }, "Load"),
      h("button", { type: "button", onclick: () => finTable && saveFile(`bse_${state.code}_pnl.csv`, toCsv(finTable.rows, finTable.cols), "text/csv") }, "Download CSV")),
    finOut);

  let finDefault = "", finToken = 0;
  function fillQuarters(latest, tag, keep) { // keep: a quarter the person already picked
    finDefault = latest.toFixed(2);
    finQ.replaceChildren(...Array.from({ length: 16 }, (_, i) => latest - i).map((id) =>
      h("option", { value: id.toFixed(2) }, idLabel(id) + (id === latest ? `  (${tag})` : ""))));
    if (keep && [...finQ.options].some((o) => o.value === keep)) finQ.value = keep;
  }
  function finReset() {
    const fromBse = isFinite(num(state.quarter));
    finQ.value = "";
    fillQuarters(fromBse ? Math.round(num(state.quarter)) : latestGuess(), fromBse ? "latest on BSE" : "latest ended");
    finToken++;
    finNote.textContent = state.code ? "Checking which quarter is latest…" : "";
    finTable = null;
    finOut.replaceChildren(h("p", { class: "muted" }, `Pick the latest quarter and how many to show, then press Load. Quarters BSE has no results for yet are skipped.`));
  }

  // Runs after a scrip loads, without blocking it: asks BSE for the few quarters around the
  // expected latest one and keeps the newest that actually has results. This covers a stale or
  // missing link on the results tab, and a new quarter filed before that link was updated.
  async function detectLatest(token) {
    const base = isFinite(num(state.quarter)) ? Math.round(num(state.quarter)) : latestGuess();
    const ids = [base + 1, base, base - 1, base - 2, base - 3];
    const out = await Promise.all(ids.map((q) => call(byId[DETAIL], { Scrip_cd: state.code, Qtr: q.toFixed(2) })));
    if (token !== state.token) return; // another scrip was loaded meanwhile
    const found = ids.filter((q, i) => out[i].ok && ((out[i].data || {}).table1 || []).length);
    if (!found.length) {
      finNote.textContent = out.every((r) => !r.ok) ? `Could not check the latest quarter (${out[0].error}). Using ${idLabel(base)}.` : "No results found for the last few quarters.";
      return;
    }
    const latest = Math.max(...found);
    state.quarter = latest.toFixed(2);
    const picked = finQ.value === finDefault ? "" : finQ.value; // untouched default moves to the new latest
    fillQuarters(latest, "latest filed", picked);
    const end = (((out[ids.indexOf(latest)].data || {}).table1 || []).find((x) => x.fld_desc === "Date End") || {}).Value;
    finNote.textContent = `Latest filed quarter: ${endLabel(end) || idLabel(latest)}${end ? ` (ended ${end})` : ""}.`;
  }

  // The first Load fetches x quarters; "Load more" adds 2x older ones each time, until BSE has no more.
  let finIds = [], finRes = [], finX = 0, finDone = false;
  const FIN_MAX = 80;
  async function loadFin(more = false) {
    if (!state.code) return finOut.replaceChildren(h("p", { class: "err" }, "Fetch a scrip first."));
    let first, count;
    if (more) {
      first = num(finIds[finIds.length - 1]) - 1;
      count = Math.min(2 * finX, FIN_MAX - finIds.length);
    } else {
      first = num(finQ.value);
      count = finX = Math.min(12, Math.max(1, parseInt(finN.value, 10) || 5));
      finIds = []; finRes = []; finDone = false;
      finOut.replaceChildren(h("p", { class: "muted" }, "Loading…"));
    }
    const out = finRes, ids = finIds; // null in out until that quarter has answered
    const batch = Array.from({ length: count }, (_, i) => (first - i).toFixed(2));
    const from = ids.length;
    ids.push(...batch);
    batch.forEach(() => out.push(null));
    const token = ++finToken;
    const draw = () => {
    const cols = [];
    out.forEach((r, i) => {
      if (!r) return;
      const rows = (r.ok && r.data.table1) || [];
      if (!rows.length) return;
      const meta = (k) => (rows.find((x) => x.fld_desc === k) || {}).Value;
      cols.push({ q: ids[i], end: meta("Date End"), type: meta("Type"),
        lines: new Map(rows.filter((x) => x.Header !== "2").map((x) => [x.fld_desc, num(x.Value)])) });
    });
    const failed = out.filter((r) => r && !r.ok);
    const waiting = out.filter((r) => !r).length;
    if (!cols.length) return finOut.replaceChildren(waiting ? h("p", { class: "muted" }, `Loading… (${ids.length - waiting} of ${ids.length} quarters answered)`)
      : h("p", { class: "err" }, failed.length ? failed[0].error : "BSE returned no results for those quarters."));
    const names = [...new Set(cols.flatMap((c) => [...c.lines.keys()]))];
    const fmt = (v) => (isFinite(v) ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—");
    const pct = (v) => (isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");
    const get = (c, key) => c.lines.get(LINE[key]);
    const ebitda = (c) => { // only when every component line is present: a missing line would silently skew it
      const parts = ["sales", "cmc", "purch", "inv", "emp", "oth"].map((k) => get(c, k));
      return parts.every(isFinite) ? parts.reduce((a, b) => a + b, 0) : NaN;
    };
    const derived = [
      ["EBITDA (derived)", (c) => fmt(ebitda(c))],
      ["EBITDA margin (derived)", (c) => pct(ebitda(c) / get(c, "sales"))],
      ["PBT margin (derived)", (c) => pct(get(c, "pbt") / get(c, "sales"))],
      ["Tax rate (derived)", (c) => pct(-get(c, "tax") / get(c, "pbt"))],
      ["PAT margin (derived)", (c) => pct(get(c, "pat") / get(c, "sales"))],
    ];
    const head = (c) => (endLabel(c.end) ? `${endLabel(c.end)} (${c.end})` : c.end || c.q);
    const csvRows = names.map((nm) => Object.fromEntries([["Line", nm], ...cols.map((c) => [head(c), c.lines.get(nm)])]));
    finTable = { rows: csvRows, cols: ["Line", ...cols.map(head)] };
    finOut.replaceChildren(
      failed.length ? h("p", { class: "err" }, `${failed.length} quarter call(s) failed: ${failed[0].error}`) : "",
      waiting ? h("p", { class: "muted" }, `Loading ${waiting} more quarter(s)…`) : "",
      h("div", { class: "scroll" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Line"), ...cols.map((c) => h("th", { class: "n", title: `BSE quarter id ${c.q}` }, endLabel(c.end) || c.end || "?", h("div", { class: "muted" }, `${c.end || ""} · ${c.type || ""}`))))),
        h("tbody", {}, ...names.map((nm) => h("tr", {}, h("td", {}, nm), ...cols.map((c) => h("td", { class: "n" }, fmt(c.lines.get(nm)))))),
          ...derived.map(([label, f]) => h("tr", { class: "derived" }, h("td", {}, label), ...cols.map((c) => h("td", { class: "n" }, f(c))))))),
      h("p", { class: "muted" }, "Derived rows are computed here, not returned by BSE. EBITDA = sales + materials + stock-in-trade purchases + inventory change + employee + other expenses (expenses are negative); shown only when all six lines exist."),
      waiting ? "" : finDone || ids.length >= FIN_MAX
        ? h("p", { class: "muted" }, ids.length >= FIN_MAX ? `Stopped at ${FIN_MAX} quarters.` : "BSE has no older results for this company.")
        : h("button", { type: "button", onclick: () => loadFin(true) }, `Load ${Math.min(2 * finX, FIN_MAX - ids.length)} more quarters`)));
    };
    await Promise.all(batch.map(async (q, i) => {
      out[from + i] = await call(byId[DETAIL], { Scrip_cd: state.code, Qtr: q });
      if (token === finToken) draw(); // a newer Load or another scrip makes this one stale
    }));
    if (token === finToken && more) { // a whole batch of answered-but-empty quarters means we ran past the first filing
      finDone = out.slice(from).every((r) => r && r.ok && !((r.data || {}).table1 || []).length);
      draw();
    }
  }

  // ---------------------------------------------------------------- API console tab
  const consoleApi = (() => {
    const sel = h("select", { onchange: () => pick() },
      ...[...new Set(ENDPOINTS.map((e) => e.group))].map((grp) => h("optgroup", { label: grp }, ...ENDPOINTS.filter((e) => e.group === grp).map((e) => h("option", { value: e.id }, e.id)))));
    const desc = h("p", { class: "muted" });
    const paramBox = h("div", { class: "row", style: "flex-direction:column;align-items:stretch" });
    const out = h("div", {});
    let inputs = {}, last = null, mode = "json";

    function pick() {
      const e = byId[sel.value];
      desc.textContent = "Returns: " + e.returns;
      inputs = {};
      paramBox.replaceChildren(...Object.entries(fill(e.params)).map(([k, v]) => {
        const input = h("input", { value: v });
        inputs[k] = input;
        return h("label", { class: "f" }, k, input);
      }));
      out.replaceChildren();
    }
    function draw() {
      if (!last) return;
      const rows = rowsFrom(last.data);
      const cols = rows ? [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))] : [];
      out.replaceChildren(
        h("div", { class: last.ok ? "" : "err" }, `${last.ok ? "OK" : "Error"} · HTTP ${last.status} · ${last.ms} ms · ${last.bytes} chars`),
        h("div", { class: "muted" }, last.url),
        h("div", { class: "bar" },
          h("button", { type: "button", onclick: () => navigator.clipboard?.writeText(last.url) }, "Copy URL"),
          h("button", { type: "button", disabled: !last.ok, onclick: () => saveFile(`${sel.value}.json`, JSON.stringify(last.data, null, 2), "application/json") }, "Download JSON"),
          rows ? h("button", { type: "button", onclick: () => { mode = mode === "json" ? "table" : "json"; draw(); } }, mode === "json" ? "Show as table" : "Show as JSON") : "",
          rows && mode === "table" ? h("button", { type: "button", onclick: () => saveFile(`${sel.value}.csv`, toCsv(rows, cols), "text/csv") }, "Download CSV") : ""),
        last.ok ? (rows && mode === "table" ? dataTable(rows, cols).node : h("pre", {}, pretty(last.data))) : h("pre", {}, last.error));
    }
    async function send() {
      out.replaceChildren(h("p", { class: "muted" }, "Loading…"));
      last = await call(byId[sel.value], Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])));
      mode = "json";
      draw();
    }
    views.console.append(h("div", { class: "console" },
      h("div", {}, h("label", { class: "f" }, "Endpoint", sel), desc, paramBox,
        h("div", { class: "bar" }, h("button", { class: "primary", type: "button", onclick: send }, "Send")),
        h("p", { class: "muted" }, "Parameters default to the current scrip. BSE expects every parameter to be present, even when empty.")),
      out));
    pick();
    return { refresh: pick };
  })();

  // ---------------------------------------------------------------- Find scrips tab
  const fSeg = h("select", {}, ...SEGMENTS.map(([v, l]) => h("option", { value: v }, l)));
  const fStatus = h("select", {}, ...[["", "Any"], ["Active", "Active"], ["Suspended", "Suspended"], ["Delisted", "Delisted"]].map(([v, l]) => h("option", { value: v }, l)));
  const fGroup = h("select", {}, h("option", { value: "" }, "Any"));
  const fName = h("input", { placeholder: "name contains" });
  const fCode = h("input", { placeholder: "exact code", size: 8 });
  const fOut = h("div", {});
  let fTable = null, groupsLoaded = false;
  const FCOLS = ["SCRIP_CD", "scrip_id", "Scrip_Name", "Issuer_Name", "Segment", "Status", "GROUP", "FACE_VALUE", "ISIN_NUMBER", "Mktcap"];

  async function findOpened() {
    if (groupsLoaded) return;
    groupsLoaded = true;
    const r = await call(byId.ddlGroup, { flag: "0" });
    if (r.ok && Array.isArray(r.data)) fGroup.append(...r.data.map((x) => h("option", { value: x.GROUP_CODE }, x.GROUP_CODE)));
  }
  async function findRun() {
    fOut.replaceChildren(h("p", { class: "muted" }, "Loading… (large segments can take a while)"));
    const r = await call(byId.ListofScripData_new, { Group: fGroup.value, Scripcode: fCode.value.trim(), segment: fSeg.value, status: fStatus.value, scripName: fName.value.trim() });
    if (!r.ok) return fOut.replaceChildren(h("p", { class: "err" }, r.error));
    const rows = Array.isArray(r.data) ? r.data : [];
    const openable = ["Equity", "EQT0"].includes(fSeg.value);
    fTable = dataTable(rows, FCOLS, openable ? { onRow: (row) => { qBox.value = row.SCRIP_CD; loadScrip(row.SCRIP_CD); } } : {});
    fOut.replaceChildren(h("p", { class: "muted" }, `${rows.length} rows in ${r.ms} ms (${(r.bytes / 1048576).toFixed(1)} MB).${openable ? " Click a row to open it in the Scrip tab." : ""}`),
      h("div", { class: "bar" }, h("button", { type: "button", onclick: () => saveFile("bse_scrips.csv", toCsv(fTable.rows, FCOLS), "text/csv") }, "Download CSV (current filter)")),
      fTable.node);
  }
  views.find.append(
    h("p", { class: "muted" }, "Backed by BSE's List Of Securities page. Preference Shares, Debentures and Commercial Papers return tens of thousands of rows; add a name or status filter first."),
    h("div", { class: "row" }, h("label", { class: "f" }, "Segment", fSeg), h("label", { class: "f" }, "Status", fStatus), h("label", { class: "f" }, "Group", fGroup),
      h("label", { class: "f" }, "Name", fName), h("label", { class: "f" }, "Code", fCode), h("button", { class: "primary", type: "button", onclick: findRun }, "Search")),
    fOut);

  // ---------------------------------------------------------------- start
  const saved = load();
  qBox.value = saved.code || "";
  finReset();
  openTab(saved.tab && views[saved.tab] ? saved.tab : "scrip");
  views.scrip.append(h("p", { class: "muted" }, "Enter a scrip code (e.g. 500002) or a name, symbol or ISIN above and press Fetch."));
  say("Ready.");
  qBox.focus();
})();
