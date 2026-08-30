// requireAdmin — Hono middleware protecting Admin routes (Node G1.6).
//
// Reads the bearer token from the `Authorization` header, verifies it
// against `ADMIN_SESSION_SIGNING_SECRET`, and rejects with the precise
// error code the caller needs (SPEC.md §24; IMPLEMENTATION_PLAN.md Node
// G1.6 requirement 3 and Edge Cases):
//   - Authorization header missing               -> AUTH_REQUIRED
//   - Authorization present but not "Bearer ..."  -> AUTH_INVALID
//   - Bearer present but token blank              -> AUTH_INVALID
//   - malformed / tampered / foreign-signed token -> AUTH_INVALID
//   - well-formed but expired token               -> AUTH_EXPIRED
//
// Never reads or sets a cookie (IMPLEMENTATION_PLAN.md Architecture
// Constraint 2 — the Admin token lives only in `sessionStorage` client-side
// and travels only in this header).
import type { MiddlewareHandler } from "hono";
import type { Env } from "../../shared/types";
import { AppError } from "../../shared/errors";
import { verifyToken } from "../../shared/token";

const BEARER_PREFIX = "Bearer ";

export const requireAdmin: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header) {
    throw new AppError("AUTH_REQUIRED");
  }
  if (!header.startsWith(BEARER_PREFIX)) {
    throw new AppError("AUTH_INVALID");
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  if (!token) {
    throw new AppError("AUTH_INVALID");
  }

  const result = await verifyToken(token, c.env.ADMIN_SESSION_SIGNING_SECRET);
  if (!result.ok) {
    throw new AppError(result.reason);
  }

  await next();
};
