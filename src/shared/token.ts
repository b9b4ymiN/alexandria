// Signed, expiring Admin session tokens (SPEC.md §17; AGENT.md §13).
//
// Owned by node G1.6 (Admin Auth & Login Rate Limit).
//
// Format:
//   `${base64url(payloadJson)}.${base64url(hmacSha256(payloadB64, secret))}`
// The HMAC is computed over the UTF-8 bytes of the *base64url-encoded*
// payload string, not the raw JSON — signing and verification therefore
// never have to agree on a canonical JSON re-serialization, only on the
// exact encoded string that was signed.
//
// The payload is signed but never encrypted (Node G1.6 requirement 9), so
// it must never carry secret material — it holds only `sub`, `iat`, `exp`.
//
// No cookies, no D1-backed sessions: IMPLEMENTATION_PLAN.md Architecture
// Constraint 2 and Node G1.6 Out of Scope.

export interface AdminTokenPayload {
  sub: "admin";
  iat: number;
  exp: number;
}

/** 8 hours, SPEC.md §17 default target expiry. */
export const DEFAULT_TOKEN_TTL_SECONDS = 8 * 60 * 60;

export type TokenVerificationFailure = "AUTH_INVALID" | "AUTH_EXPIRED";

export type TokenVerificationResult =
  | { ok: true; payload: AdminTokenPayload }
  | { ok: false; reason: TokenVerificationFailure };

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Throws on input containing characters outside the base64url alphabet. */
function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("invalid base64url input");
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(padLength));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmacSign(payloadB64: string, secret: string): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return new Uint8Array(signature);
}

/**
 * Signs a fresh 8-hour (by default) Admin session token. `iat`/`exp` are
 * always computed here from the current time and `ttlSeconds` — callers
 * never pass their own, so a caller cannot mint a token with an inflated
 * expiry.
 */
export async function signToken(
  secret: string,
  ttlSeconds: number = DEFAULT_TOKEN_TTL_SECONDS,
): Promise<{ token: string; payload: AdminTokenPayload }> {
  const iat = nowSeconds();
  const exp = iat + ttlSeconds;
  const payload: AdminTokenPayload = { sub: "admin", iat, exp };
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signatureBytes = await hmacSign(payloadB64, secret);
  const token = `${payloadB64}.${base64UrlEncode(signatureBytes)}`;
  return { token, payload };
}

function isAdminTokenPayload(value: unknown): value is AdminTokenPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).sub === "admin" &&
    typeof (value as Record<string, unknown>).iat === "number" &&
    typeof (value as Record<string, unknown>).exp === "number"
  );
}

/**
 * Verifies a token's signature (constant-time via `crypto.subtle.
 * timingSafeEqual`, Node G1.6 requirement 1/2) and, only once the
 * signature is confirmed valid, checks expiry. Every rejection path
 * returns a precise `AUTH_INVALID` (malformed / tampered / foreign-signed)
 * or `AUTH_EXPIRED` (well-formed but expired) reason — the caller (the
 * `requireAdmin` middleware) maps that 1:1 to the matching AppError code.
 */
export async function verifyToken(token: string, secret: string): Promise<TokenVerificationResult> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "AUTH_INVALID" };
  }
  const [payloadB64, signatureB64] = parts;
  if (!payloadB64 || !signatureB64) {
    return { ok: false, reason: "AUTH_INVALID" };
  }

  let providedSignature: Uint8Array;
  try {
    providedSignature = base64UrlDecode(signatureB64);
  } catch {
    return { ok: false, reason: "AUTH_INVALID" };
  }

  const expectedSignature = await hmacSign(payloadB64, secret);

  // A length mismatch alone (not a secret-dependent comparison — HMAC-SHA256
  // output length is fixed and public) is rejected before the constant-time
  // call, since `timingSafeEqual`'s documented contract is for
  // equal-length buffers. The actual signature bytes are always compared
  // via `crypto.subtle.timingSafeEqual` (Node G1.6 requirement 1) — never a
  // naive `===`/string comparison.
  if (
    expectedSignature.byteLength !== providedSignature.byteLength ||
    !crypto.subtle.timingSafeEqual(expectedSignature, providedSignature)
  ) {
    return { ok: false, reason: "AUTH_INVALID" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch {
    return { ok: false, reason: "AUTH_INVALID" };
  }
  if (!isAdminTokenPayload(payload)) {
    return { ok: false, reason: "AUTH_INVALID" };
  }

  if (payload.exp <= nowSeconds()) {
    return { ok: false, reason: "AUTH_EXPIRED" };
  }

  return { ok: true, payload };
}
