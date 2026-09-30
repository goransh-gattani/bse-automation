// Cloudflare Worker: same job as local_proxy.py's /api, for the hosted page.
// Forwards the query string to BSE's announcements API with browser-like
// headers and returns the reply with CORS headers. Only that one endpoint
// is reachable. Set ALLOWED_ORIGIN (e.g. https://<you>.github.io) to stop
// other sites from using your worker; leave it unset to allow any origin.

const UPSTREAM = "https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w";

const UPSTREAM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.bseindia.com/",
  Origin: "https://www.bseindia.com",
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

    const { search } = new URL(request.url);
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
