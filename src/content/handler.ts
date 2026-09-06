// Content Worker request handler (Node G1.9).
//
// Serves the current version of a published document by slug, streaming
// the original bytes straight from R2. This is the browser-security
// boundary of the whole product: uploaded HTML executes on this origin, so
// this file must stay strictly read-only and must never see an admin or
// agent secret (IMPLEMENTATION_PLAN.md §5 Architecture Constraint 3, Node
// G1.9 Implementation Requirements 1-2).
//
// This file imports NOTHING from src/shared/ except src/shared/signing.ts
// — see the Orchestrator clarification on Node G1.9 and the one exception
// node G3.4 authorizes. The content Worker serves HTML, not the JSON API
// envelope, so it carries its own minimal 404 page and logs failures with
// local literal strings rather than the API's AppError/error-code
// vocabulary. signing.ts is admitted because it is pure WebCrypto with no
// imports, no storage and no environment access, and because the
// alternative — a second copy of the signature formula living here — is
// the kind of drift that turns a security boundary into a bug.
import { verifyPreviewClaim } from "../shared/signing";

export interface ContentEnv {
  DB: D1Database;
  DOCS: R2Bucket;
  // Configuration, not a literal in source, so the value changes with the
  // deployment (Node G1.9 Implementation Requirement 7).
  APP_ORIGIN: string;
  // The ONLY secret this Worker holds (node G3.4). It is set with
  // `wrangler secret put` and never declared in wrangler.content.jsonc, so
  // no secret name or value is ever checked in. An admin password, session
  // signing secret or agent key must never join it — that separation IS the
  // origin isolation guarantee (AGENT.md §8, §13).
  CONTENT_PREVIEW_SIGNING_SECRET: string;
}

const NOT_FOUND_BODY = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Not Found</title></head>
<body><p>Not found.</p></body>
</html>
`;

// A slug that cannot possibly have been produced by the Slug Service
// (src/domain/documents/slug.ts, Node G1.3: lowercase alphanumerics
// joined by single hyphens, at most 80 characters) is rejected before it
// ever reaches D1. This also covers path-traversal characters and
// pathological lengths without any file-system semantics being involved
// (Node G1.9 Edge Cases).
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 80;

function isPlausibleSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug);
}

interface CurrentVersionRow {
  r2_key: string;
  sha256: string;
}

// Prepared statement — the slug is bound, never concatenated (Node G1.9
// Implementation Requirement 3). A document whose current_version_id is
// NULL simply produces no join match, which the caller treats the same
// way as an unknown slug.
async function resolveCurrentVersion(db: D1Database, slug: string): Promise<CurrentVersionRow | null> {
  const row = await db
    .prepare(
      `SELECT v.r2_key AS r2_key, v.sha256 AS sha256
       FROM documents d
       JOIN document_versions v ON v.id = d.current_version_id
       WHERE d.slug = ?`,
    )
    .bind(slug)
    .first<CurrentVersionRow>();
  return row ?? null;
}

function notFound(): Response {
  return new Response(NOT_FOUND_BODY, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function health(): Response {
  return new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// No CSP directive here restricts external stylesheets, fonts, images or
// scripts — frame-ancestors is the only directive, because uploaded
// documents are allowed to load external resources (Node G1.9
// Implementation Requirement 6; AGENT.md §7).
function frameAncestorsHeader(appOrigin: string): string {
  return `frame-ancestors ${appOrigin}`;
}

/**
 * The version hash as a WEAK entity tag.
 *
 * Verified on production 2026-08-30: a STRONG tag (`"<sha256>"`) is stripped
 * entirely by Cloudflare's edge before the response reaches a reader,
 * because the edge re-encodes the streamed body and a strong tag asserts
 * byte-for-byte equality it can no longer guarantee. The result was that no
 * conditional request ever succeeded and every reader re-downloaded the
 * whole document each minute. A weak tag makes the weaker claim the edge
 * can keep — semantically equivalent content — and survives.
 *
 * The comparison below accepts both forms so a client that echoes back a
 * strong tag from a cached older response still gets its 304.
 */
function weakEtag(sha256: string): string {
  return `W/"${sha256}"`;
}

function etagMatches(ifNoneMatch: string | null, sha256: string): boolean {
  if (ifNoneMatch === null) return false;
  const normalise = (value: string) => value.trim().replace(/^W\//, "");
  return ifNoneMatch
    .split(",")
    .some((candidate) => normalise(candidate) === normalise(`"${sha256}"`));
}

async function serveVersion(current: CurrentVersionRow, env: ContentEnv, request: Request): Promise<Response> {
  const etag = weakEtag(current.sha256);
  const ifNoneMatch = request.headers.get("if-none-match");
  if (etagMatches(ifNoneMatch, current.sha256)) {
    return new Response(null, {
      status: 304,
      headers: {
        etag,
        "cache-control": "public, max-age=60",
        "content-security-policy": frameAncestorsHeader(env.APP_ORIGIN),
      },
    });
  }

  const object = await env.DOCS.get(current.r2_key);
  if (object === null) {
    // Failure logged server-side; the client still receives a plain,
    // information-free 404 (Node G1.9 Edge Cases: "missing R2 object").
    console.error("content worker: R2_READ_FAILED", { r2Key: current.r2_key });
    return notFound();
  }

  // The R2 object's body is passed straight through as a stream — never
  // buffered, never transformed (Node G1.9 Implementation Requirement 4).
  return new Response(object.body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "content-security-policy": frameAncestorsHeader(env.APP_ORIGIN),
      "cache-control": "public, max-age=60",
      etag,
    },
  });
}

async function handleGetDocument(slug: string, env: ContentEnv, request: Request): Promise<Response> {
  if (!isPlausibleSlug(slug)) {
    return notFound();
  }

  const current = await resolveCurrentVersion(env.DB, slug);
  if (!current) {
    return notFound();
  }

  return serveVersion(current, env, request);
}

// ---------------------------------------------------------------------------
// Signed historical preview — node G3.4.
//
// /d/:slug serves the CURRENT version to anyone. /p/:documentId/:versionId
// serves ONE historical version to whoever holds an unexpired signature for
// exactly that document and version. The signature is the only credential:
// this Worker holds no session, reads no cookie and cannot ask the app
// Worker anything.
//
// The r2_key is read from D1 rather than rebuilt from the two ids, so this
// file never has to know the key format (src/domain/versions/r2-keys.ts owns
// it), and so a version id that does not actually belong to the named
// document resolves to nothing even if a signature somehow covered it.
// ---------------------------------------------------------------------------
const PREVIEW_PATH = /^\/p\/([^/]+)\/([^/]+)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FORBIDDEN_BODY = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Forbidden</title></head>
<body><p>This preview link is not valid.</p></body>
</html>
`;

/**
 * One response for every rejection — expired, tampered, wrong document,
 * wrong version, missing parameters. A caller learns that the link does not
 * work and nothing else (node G3.4 requirement 3).
 */
function forbidden(): Response {
  return new Response(FORBIDDEN_BODY, {
    status: 403,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}

async function resolveVersionKey(
  db: D1Database,
  documentId: string,
  versionId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT r2_key AS r2_key FROM document_versions WHERE id = ? AND document_id = ?")
    .bind(versionId, documentId)
    .first<{ r2_key: string }>();
  return row?.r2_key ?? null;
}

async function handleGetPreview(
  documentId: string,
  versionId: string,
  url: URL,
  env: ContentEnv,
): Promise<Response> {
  if (!UUID_PATTERN.test(documentId) || !UUID_PATTERN.test(versionId)) {
    return forbidden();
  }

  const expRaw = url.searchParams.get("exp");
  const signature = url.searchParams.get("sig");
  if (expRaw === null || signature === null || !/^[0-9]+$/.test(expRaw)) {
    return forbidden();
  }

  const verification = await verifyPreviewClaim(
    { documentId, versionId, exp: Number.parseInt(expRaw, 10) },
    signature,
    env.CONTENT_PREVIEW_SIGNING_SECRET ?? "",
  );
  if (!verification.ok) {
    return forbidden();
  }

  const r2Key = await resolveVersionKey(env.DB, documentId, versionId);
  if (r2Key === null) {
    return notFound();
  }

  const object = await env.DOCS.get(r2Key);
  if (object === null) {
    console.error("content worker: R2_READ_FAILED", { r2Key });
    return notFound();
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "content-security-policy": frameAncestorsHeader(env.APP_ORIGIN),
      // A superseded version must never sit in a shared cache: the link is
      // short-lived on purpose and the bytes are not published content.
      "cache-control": "private, no-store",
    },
  });
}

const DOCUMENT_PATH = /^\/d\/([^/]+)$/;

// The Worker never reads a cookie (no code path here inspects the Cookie
// request header) and never emits the response header that would start a
// browser session on this origin (Node G1.9 Implementation Requirement 9)
// — every Response constructed in this file omits it.
export async function handleContentRequest(request: Request, env: ContentEnv): Promise<Response> {
  if (request.method !== "GET") {
    return notFound();
  }

  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return health();
  }

  const previewMatch = PREVIEW_PATH.exec(url.pathname);
  if (previewMatch) {
    return handleGetPreview(previewMatch[1] ?? "", previewMatch[2] ?? "", url, env);
  }

  const match = DOCUMENT_PATH.exec(url.pathname);
  if (!match) {
    return notFound();
  }

  return handleGetDocument(match[1] ?? "", env, request);
}
