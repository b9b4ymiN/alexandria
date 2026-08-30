// Content Worker request handler (Node G1.9).
//
// Serves the current version of a published document by slug, streaming
// the original bytes straight from R2. This is the browser-security
// boundary of the whole product: uploaded HTML executes on this origin, so
// this file must stay strictly read-only and must never see an admin or
// agent secret (IMPLEMENTATION_PLAN.md §5 Architecture Constraint 3, Node
// G1.9 Implementation Requirements 1-2).
//
// This file intentionally does NOT import from src/shared/ — see the
// Orchestrator clarification on Node G1.9. The content Worker serves HTML,
// not the JSON API envelope, so it carries its own minimal 404 page and
// logs failures with local literal strings rather than the API's
// AppError/error-code vocabulary.

export interface ContentEnv {
  DB: D1Database;
  DOCS: R2Bucket;
  // Configuration, not a literal in source, so the value changes with the
  // deployment (Node G1.9 Implementation Requirement 7).
  APP_ORIGIN: string;
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

async function serveVersion(current: CurrentVersionRow, env: ContentEnv, request: Request): Promise<Response> {
  const etag = `"${current.sha256}"`;
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch !== null && ifNoneMatch === etag) {
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

  const match = DOCUMENT_PATH.exec(url.pathname);
  if (!match) {
    return notFound();
  }

  return handleGetDocument(match[1] ?? "", env, request);
}
