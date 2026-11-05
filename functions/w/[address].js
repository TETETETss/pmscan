export async function onRequestGet(context) {
  const { request, env } = context;
  // Serve the static wallet page; client JS reads the address from /w/:address
  const assetUrl = new URL("/wallet", request.url);
  try {
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(assetUrl);
      if (res.ok) {
        const headers = new Headers(res.headers);
        headers.set("Cache-Control", "public, max-age=60");
        return new Response(await res.arrayBuffer(), { status: 200, headers });
      }
    }
  } catch (e) {}
  // Fallback: redirect to query form
  const addr = context.params.address || "";
  const u = new URL("/wallet", request.url);
  u.searchParams.set("w", addr);
  return Response.redirect(u.toString(), 302);
}
