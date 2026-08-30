// Owned by node G1.6 (Admin Auth & Login Rate Limit).
// Do not add handlers here from any other node.
//
// Mounted at /api/admin (root) by src/api/routes/admin/index.ts.
// Implements SPEC.md §17, §18:
//   POST /api/admin/login  -> "/login"
//   POST /api/admin/logout -> "/logout"
import { Hono } from "hono";
import type { Env } from "../../../shared/types";
import { AppError } from "../../../shared/errors";
import { ok } from "../../../shared/envelope";
import { signToken, DEFAULT_TOKEN_TTL_SECONDS } from "../../../shared/token";
import { requireAdmin } from "../../middleware/admin-auth";

// This route's one extra binding beyond the shared (G1.2-owned) Env
// contract in src/shared/types.ts. Node G1.6's file scope is
// "wrangler.jsonc (rate limiting binding only)" — the binding itself is
// declared there; this local extension is the minimal way to type it here
// without editing the shared Env contract. Hono's `route()` does not
// require a mounted sub-app's Bindings to match its parent's exactly (see
// node_modules/hono's `route<SubEnv extends Env, ...>` signature), so this
// is safe to mount under adminRouter as-is.
interface AuthEnv extends Env {
  LOGIN_RATE_LIMITER: RateLimit;
}

const auth = new Hono<{ Bindings: AuthEnv }>();

// Key used for the shared bucket when Cloudflare's trusted client-IP
// header is absent — the rate limit is never skipped, only bucketed
// coarsely (Node G1.6 requirement 4).
const SHARED_RATE_LIMIT_KEY = "no-cf-connecting-ip";

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
}

/**
 * Timing-safe password check (Node G1.6 requirement 1): both sides are
 * hashed to a fixed-length SHA-256 digest first — so comparison time
 * depends on neither the supplied password's length nor its content — and
 * compared only via `crypto.subtle.timingSafeEqual`, never `===`.
 */
async function passwordMatches(supplied: string, expected: string): Promise<boolean> {
  const [suppliedDigest, expectedDigest] = await Promise.all([sha256(supplied), sha256(expected)]);
  return crypto.subtle.timingSafeEqual(suppliedDigest, expectedDigest);
}

async function readPassword(c: { req: { json(): Promise<unknown> } }): Promise<string> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = undefined;
  }
  const password =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).password
      : undefined;
  return typeof password === "string" ? password : "";
}

auth.post("/login", async (c) => {
  // Rate limit first, before any password work, so an attacker gets no
  // information at all — not even timing — once the bucket is exhausted
  // (Node G1.6 requirement 5). Keyed only on the trusted
  // `CF-Connecting-IP` header, which Cloudflare sets and overwrites at the
  // edge; `X-Forwarded-For` is never read (requirement 4).
  const ip = c.req.header("CF-Connecting-IP");
  const { success } = await c.env.LOGIN_RATE_LIMITER.limit({ key: ip ?? SHARED_RATE_LIMIT_KEY });
  if (!success) {
    // "RATE_LIMITED" is a transport-level code, like "NOT_FOUND" and
    // "INTERNAL_ERROR" in src/api/app.ts — not a Phase 1 domain ErrorCode
    // (SPEC.md §24 has none for this), so it is built directly rather
    // than through AppError/fail(). The envelope shape matches fail()
    // exactly; only the code namespace differs.
    return c.json(
      {
        ok: false,
        error: { code: "RATE_LIMITED", message: "Too many login attempts. Try again later." },
      },
      429,
    );
  }

  const adminPassword = c.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    // Fail closed (edge case: ADMIN_PASSWORD not configured -> 500, never
    // open). Only the *fact* that it is unset is logged server-side; the
    // password value is never logged (requirement 8).
    console.error("POST /api/admin/login: ADMIN_PASSWORD is not configured");
    return c.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Internal Server Error" } },
      500,
    );
  }

  const password = await readPassword(c);
  const matches = await passwordMatches(password, adminPassword);
  if (!matches) {
    // Same code and message regardless of how wrong the password was
    // (requirement 6) — no hint of closeness, no cookie set anywhere.
    throw new AppError("AUTH_INVALID", { message: "Invalid password." });
  }

  const { token, payload } = await signToken(
    c.env.ADMIN_SESSION_SIGNING_SECRET,
    DEFAULT_TOKEN_TTL_SECONDS,
  );
  return ok({ token, expiresAt: new Date(payload.exp * 1000).toISOString() });
});

// Stateless (requirement 7): nothing is revoked server-side in Phase 1,
// the client simply discards the token. Still requires a currently valid
// token, consistent with every other Admin route.
auth.post("/logout", requireAdmin, async () => {
  return ok({ ok: true });
});

export default auth;
