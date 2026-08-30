// Hono application skeleton — mounts /api/public, /api/admin and
// /api/agent.
//
// OWNERSHIP: this file is written by node G1.2 and must not be edited by
// any later node. G1.7, G1.8, G5.1 and every other route-owning node write
// only their own leaf route file under src/api/routes/**; the three
// routes/*/index.ts files (also G1.2-owned) mount those leaf files into
// the routers created here.
//
// No CORS middleware is registered anywhere in this file or in anything it
// mounts, deliberately: the content origin must never be trusted by this
// API (AGENT.md §8; IMPLEMENTATION_PLAN.md Architecture Constraint #2 — no
// cookies, and the Admin token travels only in an Authorization header
// this API alone reads). A later node that believes it needs CORS must
// STOP and report rather than add it here or anywhere else.
import { Hono } from "hono";
import type { Env } from "../shared/types";
import { AppError } from "../shared/errors";
import { fail } from "../shared/envelope";
import publicRouter from "./routes/public";
import adminRouter from "./routes/admin";
import agentRouter from "./routes/agent";

/**
 * Builds a fresh Hono app with the full Phase 1 routing skeleton and error
 * handling wired in. Exported (in addition to the `app` singleton below)
 * so tests can construct an isolated instance — e.g. to register a
 * throwaway route that exercises the global error handler without adding
 * a real handler to this file.
 */
export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.route("/api/public", publicRouter);
  app.route("/api/admin", adminRouter);
  app.route("/api/agent", agentRouter);

  // Any /api/* path not claimed by one of the three routers above lands
  // here — always a JSON envelope, never the SPA HTML shell. "NOT_FOUND"
  // is a transport-level code, not a Phase 1 domain ErrorCode (SPEC.md
  // §24 has no generic "route does not exist" code), so this is built
  // directly rather than through AppError/fail().
  app.notFound((c) =>
    c.json({ ok: false, error: { code: "NOT_FOUND", message: "Not Found" } }, 404),
  );

  // Global error handler. An AppError thrown by a Domain Service or route
  // converts to the matching envelope and status via fail(). Anything
  // else is an unexpected failure: the real cause is logged server-side,
  // but the client only ever sees a generic message and code — no stack
  // trace, no internal detail (AGENT.md §13; IMPLEMENTATION_PLAN.md node
  // G1.2, requirement 3). "INTERNAL_ERROR" is likewise a transport-level
  // code, not a Phase 1 domain ErrorCode.
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return fail(err);
    }
    console.error("Unhandled error in Alexandria API:", err);
    return c.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Internal Server Error" } },
      500,
    );
  });

  return app;
}

export const app = createApp();
