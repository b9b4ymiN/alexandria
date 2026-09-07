// requireAgent — Hono middleware protecting Agent routes (Node G5.1).
//
// The Agent credential is a single static shared secret
// (`Authorization: Bearer <AGENT_API_KEY>`, SPEC.md §18 Agent), not a
// signed session token like requireAdmin's — so there is nothing to
// verify a signature on. It is instead compared the same timing-safe way
// the Admin password check works
// (src/api/routes/admin/auth.ts#passwordMatches): both sides are hashed to
// a fixed-length SHA-256 digest first, then compared only via
// `crypto.subtle.timingSafeEqual`, never `===` (node G5.1 requirement 2).
//
// Error codes (SPEC.md §24; node G5.1 Edge Cases):
//   - Authorization header missing                       -> AUTH_REQUIRED
//   - any other case that fails to match the key's digest -> AGENT_KEY_INVALID
//     (wrong scheme, blank token, wrong key, or an Admin session token
//     presented here — none of these can ever equal the AGENT_API_KEY
//     digest, so one code covers all of them; requirement 3's cross-role
//     rejection falls out of this by construction, nothing role-specific
//     is checked)
import type { MiddlewareHandler } from "hono";
import type { Env } from "../../shared/types";
import { AppError } from "../../shared/errors";

const BEARER_PREFIX = "Bearer ";

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
}

/**
 * Timing-safe key check, mirroring `passwordMatches` in
 * src/api/routes/admin/auth.ts exactly: both sides are hashed first, so
 * comparison time depends on neither the supplied key's length nor its
 * content.
 */
async function keyMatches(supplied: string, expected: string): Promise<boolean> {
  const [suppliedDigest, expectedDigest] = await Promise.all([sha256(supplied), sha256(expected)]);
  return crypto.subtle.timingSafeEqual(suppliedDigest, expectedDigest);
}

export const requireAgent: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header) {
    throw new AppError("AUTH_REQUIRED");
  }

  const supplied = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length).trim() : "";

  // Fail closed if AGENT_API_KEY is unset/blank (misconfiguration): an
  // empty supplied token must never be able to match an empty expected
  // key, the way `""` would match `""` in a naive comparison, so a blank
  // configured key always rejects rather than opening the API to anyone.
  const expected = c.env.AGENT_API_KEY ?? "";
  const matches = expected.length > 0 && (await keyMatches(supplied, expected));
  if (!matches) {
    throw new AppError("AGENT_KEY_INVALID");
  }

  await next();
};
