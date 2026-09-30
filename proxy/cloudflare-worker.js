// Cloudflare Worker: same job as local_proxy.py's /api, for the hosted page.
// Forwards the query string to BSE's announcements API with browser-like
// headers and returns the reply with CORS headers. Only that one endpoint
// is reachable. Set ALLOWED_ORIGIN (e.g. https://<you>.github.io) to stop
// other sites from using your worker; leave it unset to allow any origin.

const UPSTREAM = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w";
const PDF_BASE = "https://www.bseindia.com/xml-data/corpfiling/AttachHis/";
const PDF_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/i;

const UPSTREAM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.bseindia.com",
  Referer: "https://www.bseindia.com/",
  "Sec-Ch-Ua": '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
};

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    Vary: "Origin",
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });

    const { pathname, search, searchParams } = new URL(request.url);
    // /pdf?name=<ATTACHMENTNAME>&filename=<save as>: the PDF as a download.
    if (pathname.replace(/\/+$/, "").endsWith("/pdf")) return downloadPdf(searchParams, cors);

    let upstream;
    try {
      upstream = await fetch(UPSTREAM + search, { headers: UPSTREAM_HEADERS });
    } catch (err) {
      return new Response(`Proxy could not reach BSE: ${err}`, { status: 502, headers: cors });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  },
};

async function downloadPdf(params, cors) {
  const name = params.get("name") || "";
  if (!PDF_NAME.test(name)) return new Response("Bad attachment name", { status: 400, headers: cors });
  const filename = (params.get("filename") || name).replace(/[^A-Za-z0-9 ._()&-]/g, "_").trim() || "announcement.pdf";
  let upstream;
  try {
    upstream = await fetch(PDF_BASE + name, { headers: UPSTREAM_HEADERS });
  } catch (err) {
    return new Response(`Proxy could not reach BSE: ${err}`, { status: 502, headers: cors });
  }
  if (!upstream.ok) return new Response(`BSE returned HTTP ${upstream.status}`, { status: upstream.status, headers: cors });
  return new Response(upstream.body, {
    headers: { ...cors, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}
