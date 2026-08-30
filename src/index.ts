// App Worker entry (alexandria).
// Placeholder only — node G1.2 replaces this with the Hono API skeleton
// mounted at /api/public, /api/admin and /api/agent. Static SPA assets
// are served directly by the Cloudflare assets layer; this Worker only
// runs for paths excluded from asset routing (see wrangler.jsonc
// "run_worker_first": ["/api/*"]).
export default {
  async fetch(_request: Request): Promise<Response> {
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler;
