// App Worker entry (alexandria).
// Wires the Hono API (src/api/app.ts) at /api/* and otherwise defers to
// the Cloudflare assets layer, which serves the React SPA.
//
// wrangler.jsonc sets "run_worker_first": ["/api/*"], so in production
// Cloudflare's edge only ever invokes this Worker for /api/* requests —
// every other request is served directly from the built assets without
// this fetch handler running at all. The path check below is defensive:
// it keeps behavior correct even when the fetch handler is invoked
// directly (e.g. in tests, which bypass Cloudflare's edge routing), and
// it guarantees a non-/api request can never be answered by the JSON API
// 404/error envelope.
import { app } from "./api/app";
import type { Env } from "./shared/types";

export default {
  // env and ctx are optional here (narrower than ExportedHandler<Env>
  // requires) purely so this handler stays callable with a bare Request in
  // tests, matching the calling convention already used by
  // tests/unit/smoke.test.ts for both Worker entry points. Cloudflare's
  // runtime always supplies both in production.
  async fetch(request: Request, env?: Env, ctx?: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    // Non-API paths belong to the assets layer / SPA (see comment above).
    // This Worker declares no assets binding — it never needs one in
    // production, since Cloudflare's edge routes these paths to the
    // assets layer before this Worker runs. A plain, non-JSON 404 here is
    // only ever observed by a direct fetch() call that bypasses that
    // routing (e.g. this file's own tests).
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
