// Canonical HTTP response envelope for every Alexandria API response.
//
// Written by node G1.2. Every route builds its Response only through ok()
// and fail() so the API, the MCP server and the SPA never see more than
// one response shape (SPEC.md §18):
//
//   success: { "ok": true,  "data": <T> }
//   error:   { "ok": false, "error": { "code": string, "message": string } }

import type { AppError } from "./errors";

export interface OkEnvelope<T> {
  ok: true;
  data: T;
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export function ok<T>(data: T, init: ResponseInit = {}): Response {
  const body: OkEnvelope<T> = { ok: true, data };
  return jsonResponse(body, { status: 200, ...init });
}

export function fail(error: AppError, init: ResponseInit = {}): Response {
  // `error.detail` is intentionally never read here. It exists for
  // server-side logging only (see the global error handler in
  // src/api/app.ts) and must never leak internal state to the client
  // (AGENT.md §13; IMPLEMENTATION_PLAN.md node G1.2, requirement 3).
  const body: ErrorEnvelope = {
    ok: false,
    error: { code: error.code, message: error.message },
  };
  return jsonResponse(body, { status: error.status, ...init });
}

function jsonResponse(body: OkEnvelope<unknown> | ErrorEnvelope, init: ResponseInit): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}
