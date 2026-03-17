/**
 * Schwab Callback Router
 *
 * Stable callback URL to register with Schwab developer portal.
 * Dynamically routes to the active project's OAuth handler via env var.
 *
 * Register with Schwab: https://schwab-callback-router.finleg.workers.dev/schwab/callback
 *
 * Environment variables:
 *   CALLBACK_TARGET — full base URL of the active handler, e.g.:
 *     "https://schwab-oauth.finleg.workers.dev"   (finleg)
 *     "https://your-portsie-worker.workers.dev"    (portsie)
 *
 * To switch targets:
 *   wrangler secret put CALLBACK_TARGET
 *   (then paste the new base URL)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Only handle the callback path
    if (url.pathname !== "/schwab/callback") {
      return new Response(JSON.stringify({
        service: "schwab-callback-router",
        status: "ok",
        target: env.CALLBACK_TARGET || "(not set)",
        usage: "Register https://schwab-callback-router.finleg.workers.dev/schwab/callback with Schwab"
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Validate target is configured
    if (!env.CALLBACK_TARGET) {
      return new Response(JSON.stringify({
        error: "CALLBACK_TARGET not configured",
        fix: "Run: wrangler secret put CALLBACK_TARGET"
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Build the redirect URL preserving all query params (code, state, etc.)
    const targetUrl = new URL("/schwab/callback", env.CALLBACK_TARGET);
    targetUrl.search = url.search;

    // 302 redirect preserves the query params for the downstream handler
    return Response.redirect(targetUrl.toString(), 302);
  }
};
