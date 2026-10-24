/**
 * Worker tĩnh cho trang quản trị Pulse.
 * - Chỉ phục vụ file trong public/ (env.ASSETS), không có API riêng.
 * - Thêm header chống index và không cache HTML.
 */
export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);

    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");

    const type = headers.get("Content-Type") || "";
    if (type.includes("text/html")) {
      headers.set("Cache-Control", "no-store");
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
