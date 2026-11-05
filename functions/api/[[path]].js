// Thin read-only proxy for Polymarket public APIs (CORS + light cache).
const ALLOW = new Set([
  "data-api.polymarket.com",
  "gamma-api.polymarket.com",
  "polymarket.com",
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

export async function onRequest(context) {
  const { request } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method" }, 405);
  }

  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  if (!target) return json({ error: "missing url" }, 400);

  let u;
  try { u = new URL(target); } catch { return json({ error: "bad url" }, 400); }
  if (u.protocol !== "https:" || !ALLOW.has(u.hostname)) {
    return json({ error: "host not allowed" }, 403);
  }
  if (/auth|login|password|api-key|derive/i.test(u.pathname)) {
    return json({ error: "blocked path" }, 403);
  }

  try {
    const upstream = await fetch(u.toString(), {
      method: "GET",
      headers: {
        "User-Agent": "pmscan/1.0",
        Accept: "application/json",
        Origin: "https://polymarket.com",
        Referer: "https://polymarket.com/",
      },
      cf: { cacheTtl: 30, cacheEverything: true },
    });
    const body = request.method === "HEAD" ? null : await upstream.arrayBuffer();
    const headers = {
      ...CORS,
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "public, max-age=30",
    };
    return new Response(body, { status: upstream.status, headers });
  } catch (e) {
    return json({ error: "upstream", message: String(e) }, 502);
  }
}

function json(o, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
