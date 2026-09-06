// Short-lived signed preview URLs for historical versions (SPEC.md §16;
// node G3.4).
//
// Owned by node G3.4. This is the ONE module the content Worker is allowed
// to import from src/shared/ (the G1.9 clarification's ban exists so the
// content Worker never picks up the JSON API envelope, the AppError
// vocabulary or a domain service — none of which is here). It holds pure
// WebCrypto with no imports of its own, no D1, no R2 and no environment
// access, so importing it cannot widen the content origin's reach.
//
// Why a signature rather than a lookup table: the content Worker must be
// able to answer "may this reader see these bytes?" while holding no
// privileged state at all (AGENT.md §8). An HMAC lets the app Worker grant
// access it can no longer revoke, which is exactly why the grant is short.
//
// The signed payload binds documentId, versionId and exp TOGETHER. Signing
// them separately, or leaving any of them out, would let a signature issued
// for one version be replayed on another — the whole point of the scheme.

export interface PreviewClaim {
  documentId: string;
  versionId: string;
  /** Absolute expiry, unix seconds. */
  exp: number;
}

/** SPEC.md §16: five minutes is long enough to open a tab, short enough that a leaked URL is worthless. */
export const DEFAULT_PREVIEW_TTL_SECONDS = 300;

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * The exact bytes that get signed. Versioned with a `v1:` prefix so the
 * scheme can change without an old signature silently remaining valid, and
 * field-separated by a character that cannot occur in a UUID, so no two
 * distinct claims can ever produce the same signing input.
 */
function signingInput(claim: PreviewClaim): string {
  return `v1:${claim.documentId}:${claim.versionId}:${claim.exp}`;
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

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** Returns null for anything that is not an even-length lowercase hex string. */
function fromHex(value: string): Uint8Array | null {
  if (value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/.test(value)) {
    return null;
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function signPreviewClaim(claim: PreviewClaim, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput(claim)));
  return toHex(new Uint8Array(signature));
}

export type PreviewVerificationFailure = "SIGNATURE_INVALID" | "SIGNATURE_EXPIRED";

export type PreviewVerificationResult = { ok: true } | { ok: false; reason: PreviewVerificationFailure };

/**
 * Verifies a signature against a claim, then expiry.
 *
 * The signature is checked FIRST and compared with
 * `crypto.subtle.timingSafeEqual`, exactly as src/shared/token.ts does for
 * admin tokens: a caller learns nothing about the secret from how long a
 * rejection takes. Expiry is checked only once the claim is known to be
 * authentic, so a forged claim can never reveal whether its exp was the
 * problem.
 *
 * There is NO grace period. Clock skew between the issuing Worker and the
 * verifying Worker is not compensated for, deliberately: both run on
 * Cloudflare's clock, and a tolerance window is a permanent widening of
 * every signature's life in exchange for nothing.
 */
export async function verifyPreviewClaim(
  claim: PreviewClaim,
  signatureHex: string,
  secret: string,
  now: number = nowSeconds(),
): Promise<PreviewVerificationResult> {
  const provided = fromHex(signatureHex);
  if (provided === null || secret.length === 0) {
    return { ok: false, reason: "SIGNATURE_INVALID" };
  }

  const expectedHex = await signPreviewClaim(claim, secret);
  const expected = fromHex(expectedHex);

  // A length mismatch is not a secret-dependent comparison (HMAC-SHA256's
  // output length is fixed and public) and `timingSafeEqual` requires
  // equal-length buffers, so it is rejected before the constant-time call.
  if (expected === null || expected.byteLength !== provided.byteLength) {
    return { ok: false, reason: "SIGNATURE_INVALID" };
  }
  if (!crypto.subtle.timingSafeEqual(expected, provided)) {
    return { ok: false, reason: "SIGNATURE_INVALID" };
  }

  if (claim.exp <= now) {
    return { ok: false, reason: "SIGNATURE_EXPIRED" };
  }

  return { ok: true };
}

/**
 * Builds the absolute preview URL a caller hands to a browser. The secret
 * is never part of it — only the claim and the signature derived from it.
 */
export function buildPreviewUrl(contentOrigin: string, claim: PreviewClaim, signatureHex: string): string {
  const origin = contentOrigin.replace(/\/+$/, "");
  return `${origin}/p/${claim.documentId}/${claim.versionId}?exp=${claim.exp}&sig=${signatureHex}`;
}
