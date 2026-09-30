"use strict";

const PDF_BASE_URL = "https://www.bseindia.com/xml-data/corpfiling/AttachHis/";
const STORAGE_KEY = "bse_automation";

// Defaults taken from the sample URL; all of them are editable in the page.
const DEFAULT_PARAMS = {
  pageno: "1",
  strCat: "Result",
  subcategory: "Financial Results",
  strPrevDate: "20260630",
  strToDate: "20260930",
  strSearch: "P",
  strType: "C",
};

const PARAM_LABELS = {
  pageno: "Page no",
  strCat: "Category (strCat)",
  subcategory: "Subcategory",
  strPrevDate: "From date (YYYYMMDD)",
  strToDate: "To date (YYYYMMDD)",
  strSearch: "strSearch",
  strType: "strType",
};

const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

const $ = (id) => document.getElementById(id);
const paramInputs = {};

function pdfUrl(attachment) {
  attachment = (attachment || "").trim();
  return attachment ? PDF_BASE_URL + encodeURIComponent(attachment) : "";
}

function parseResponse(data) {
  if (!data || typeof data !== "object") throw new Error("Unexpected response format from BSE");
  const rows = (data.Table || []).map((row) => ({
    date: String(row.NEWS_DT || row.DT_TM || ""),
    company: String(row.SLONGNAME || ""),
    headline: String(row.HEADLINE || row.NEWSSUB || ""),
    category: String(row.SUBCATNAME || row.CATEGORYNAME || ""),
    pdf: pdfUrl(row.ATTACHMENTNAME),
  }));
  let total = rows.length;
  const table1 = data.Table1 || [];
  if (table1[0] && table1[0].ROWCNT != null && !isNaN(parseInt(table1[0].ROWCNT, 10))) {
    total = parseInt(table1[0].ROWCNT, 10);
  }
  return { rows, total };
}

function loadSettings() {
  const settings = { scrip: "532942", params: { ...DEFAULT_PARAMS }, proxy: isLocal ? "/api" : "" };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (saved.scrip) settings.scrip = saved.scrip;
    Object.assign(settings.params, saved.params || {});
    if (saved.proxy) settings.proxy = saved.proxy;
  } catch (e) {
    // Storage blocked or corrupt: fall back to defaults.
  }
  return settings;
}

function saveSettings() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ scrip: $("scrip").value.trim(), params: currentParams(), proxy: $("proxy").value.trim() })
    );
  } catch (e) {
    // Not fatal; settings just won't be remembered.
  }
}

function currentParams() {
  const params = {};
  for (const [key, input] of Object.entries(paramInputs)) params[key] = input.value.trim();
  return params;
}

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

function renderRows(rows) {
  const tbody = $("rows");
  tbody.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const key of ["date", "company", "headline", "category"]) {
      const td = document.createElement("td");
      td.textContent = row[key];
      td.className = key;
      tr.append(td);
    }
    const pdfCell = document.createElement("td");
    pdfCell.className = "pdf";
    if (row.pdf) {
      const a = document.createElement("a");
      a.href = row.pdf;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "📄 PDF";
      pdfCell.append(a);
    } else {
      pdfCell.textContent = "—";
      tr.classList.add("nopdf");
    }
    tr.append(pdfCell);
    tbody.append(tr);
  }
}

let busy = false;

async function fetchAnnouncements() {
  if (busy) return;
  const scrip = $("scrip").value.trim();
  const proxy = $("proxy").value.trim();
  if (!scrip) return setStatus("Enter a scrip code.", true);
  if (!proxy) {
    $("params-panel").open = true;
    $("proxy").focus();
    return setStatus("Set the Proxy URL first (see the README).", true);
  }
  saveSettings();

  const url = new URL(proxy, location.href);
  const params = currentParams();
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("strScrip", scrip);

  busy = true;
  $("fetch-btn").disabled = true;
  setStatus(`Fetching announcements for ${scrip}…`);
  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await resp.text();
    if (resp.status === 403) {
      throw new Error(
        "BSE refused the request (HTTP 403). Run `python3 proxy/local_proxy.py --diag` and send its output, or use the bookmarklet version (link at the top)."
      );
    }
    if (!resp.ok) throw new Error(`BSE returned HTTP ${resp.status}: ${text.slice(0, 200)}`);
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("BSE did not return JSON (the request may have been blocked)");
    }
    const { rows, total } = parseResponse(data);
    renderRows(rows);
    setStatus(
      rows.length
        ? `${rows.length} results on page ${params.pageno} (${total} total). Click PDF to open.`
        : `No announcements found (page ${params.pageno}).`
    );
  } catch (err) {
    renderRows([]);
    const msg = err instanceof TypeError ? `Could not reach the proxy at ${url.origin} (is it running?)` : err.message;
    setStatus("Error: " + msg, true);
  } finally {
    busy = false;
    $("fetch-btn").disabled = false;
  }
}

function changePage(delta) {
  const page = parseInt(paramInputs.pageno.value, 10) || 1;
  paramInputs.pageno.value = String(Math.max(1, page + delta));
  fetchAnnouncements();
}

function init() {
  const settings = loadSettings();
  $("scrip").value = settings.scrip;
  $("proxy").value = settings.proxy;
  for (const [key, label] of Object.entries(PARAM_LABELS)) {
    const wrap = document.createElement("label");
    wrap.textContent = label;
    const input = document.createElement("input");
    input.name = key;
    input.autocomplete = "off";
    input.value = settings.params[key] ?? DEFAULT_PARAMS[key];
    wrap.append(input);
    $("params").append(wrap);
    paramInputs[key] = input;
  }
  $("fetch-form").addEventListener("submit", (e) => {
    e.preventDefault();
    fetchAnnouncements();
  });
  $("prev-btn").addEventListener("click", () => changePage(-1));
  $("next-btn").addEventListener("click", () => changePage(1));
  $("reset-btn").addEventListener("click", () => {
    for (const [key, input] of Object.entries(paramInputs)) input.value = DEFAULT_PARAMS[key];
    saveSettings();
  });
  $("scrip").focus();
}

init();
