// Node G3.4 — Signed Historical Preview URLs.
//
// Both halves of the boundary are exercised here: the app Worker mints a
// signed URL through its real Hono route, and the content Worker's real
// handler is called directly with a ContentEnv built from the same
// bindings. The content Worker cannot be reached over HTTP from this
// project (vitest.config.ts maps it to its own pool), and calling
// handleContentRequest is the same code path its entrypoint uses.
//
// The invariant under test is narrow and load-bearing: a signature is valid
// for exactly one document, one version and one time window. Everything
// else about the scheme follows from that.
import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error - "cloudflare:test" has no ambient type outside the
// package's optional "./types" subpath, which is out of this node's scope
import { env as workersEnv, reset } from "cloudflare:test";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0001 from "../../migrations/0001_init.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0002 from "../../migrations/0002_seed_categories.sql?raw";

import { createApp } from "../../src/api/app";
import { handleContentRequest, type ContentEnv } from "../../src/content/handler";
import { signToken } from "../../src/shared/token";
import {
  DEFAULT_PREVIEW_TTL_SECONDS,
  buildPreviewUrl,
  nowSeconds,
  signPreviewClaim,
  type PreviewClaim,
} from "../../src/shared/signing";
import type { Env } from "../../src/shared/types";
import { createDocument } from "../../src/domain/documents/document-service";
import { appendVersion, type Storage } from "../../src/domain/versions/version-service";

const SIGNING_SECRET = "preview-test-admin-session-secret";
const PREVIEW_SECRET = "preview-test-content-preview-secret";
const APP_ORIGIN = "https://app.test";
const CONTENT_ORIGIN = "https://content.test";

function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => {
      const commentIndex = line.indexOf("--");
      return commentIndex === -1 ? line : line.slice(0, commentIndex);
    })
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...(workersEnv as Env),
    APP_ORIGIN,
    CONTENT_ORIGIN,
    ADMIN_PASSWORD: "irrelevant-for-these-tests",
    ADMIN_SESSION_SIGNING_SECRET: SIGNING_SECRET,
    CONTENT_PREVIEW_SIGNING_SECRET: PREVIEW_SECRET,
    ...overrides,
  };
}

function storage(): Storage {
  const typed = workersEnv as unknown as { DB: D1Database; DOCS: R2Bucket };
  return { db: typed.DB, docs: typed.DOCS };
}

function db(): D1Database {
  return storage().db;
}

/** The content Worker's real bindings: storage plus its one secret. */
function contentEnv(overrides: Partial<ContentEnv> = {}): ContentEnv {
  return {
    DB: storage().db,
    DOCS: storage().docs,
    APP_ORIGIN,
    CONTENT_PREVIEW_SIGNING_SECRET: PREVIEW_SECRET,
    ...overrides,
  };
}

async function applyMigrations(database: D1Database): Promise<void> {
  for (const statement of [...splitStatements(migration0001), ...splitStatements(migration0002)]) {
    await database.prepare(statement).run();
  }
}

async function adminToken(): Promise<string> {
  return (await signToken(SIGNING_SECRET)).token;
}

function toBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

const V1_HTML = `<!doctype html>
<html><head><title>Quarterly Review</title>
<meta name="description" content="A review of the quarter just gone.">
</head><body><h1>Quarterly Review</h1><p>The first cut.</p></body></html>`;

const V2_HTML = V1_HTML.replace("The first cut.", "The revised cut.");

async function seedCategory(database: D1Database, id = "cat-preview"): Promise<string> {
  const now = "2026-08-30T00:00:00.000Z";
  await database
    .prepare(
      "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES (?, NULL, 'Preview Test', ?, 0, ?, ?)",
    )
    .bind(id, `slug-${id}`, now, now)
    .run();
  return id;
}

interface SeededDocument {
  documentId: string;
  slug: string;
  v1Id: string;
  v2Id: string;
}

/** A document with a superseded v1 and a current v2. */
async function seedDocument(categoryId: string, marker = "one"): Promise<SeededDocument> {
  const store = storage();
  const created = await createDocument(store, {
    bytes: toBytes(V1_HTML.replace("Quarterly Review", `Quarterly Review ${marker}`)),
    filename: `${marker}.html`,
    categoryId,
    createdBy: "admin",
  });
  const second = await appendVersion(store, {
    documentId: created.documentId,
    bytes: toBytes(V2_HTML.replace("Quarterly Review", `Quarterly Review ${marker}`)),
    createdBy: "admin",
  });
  return {
    documentId: created.documentId,
    slug: created.slug,
    v1Id: created.versionId,
    v2Id: second.versionId,
  };
}

function previewUrlRequest(slug: string, versionNo: number, token: string | null): Request {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request(`https://app.test/api/admin/documents/${slug}/versions/${versionNo}/preview-url`, {
    headers,
  });
}

async function issuePreviewUrl(slug: string, versionNo: number): Promise<{ url: string; expiresAt: string }> {
  const res = await createApp().fetch(previewUrlRequest(slug, versionNo, await adminToken()), testEnv());
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; data: { url: string; expiresAt: string } };
  expect(body.ok).toBe(true);
  return body.data;
}

function contentRequest(url: string): Request {
  return new Request(url);
}

async function versionSha(versionId: string): Promise<string> {
  const row = await db()
    .prepare("SELECT sha256 FROM document_versions WHERE id = ?")
    .bind(versionId)
    .first<{ sha256: string }>();
  return row?.sha256 ?? "";
}

async function sha256Of(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("Signed historical previews (G3.4)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  describe("issuance — admin only, no session material crosses over", () => {
    it("returns a content-origin URL and an expiry about five minutes out", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);

      const before = nowSeconds();
      const { url, expiresAt } = await issuePreviewUrl(doc.slug, 1);

      expect(url.startsWith(`${CONTENT_ORIGIN}/p/${doc.documentId}/${doc.v1Id}?`)).toBe(true);
      const expSeconds = Math.floor(new Date(expiresAt).getTime() / 1000);
      expect(expSeconds).toBeGreaterThanOrEqual(before + DEFAULT_PREVIEW_TTL_SECONDS);
      expect(expSeconds).toBeLessThanOrEqual(nowSeconds() + DEFAULT_PREVIEW_TTL_SECONDS);
      // The URL carries the claim and the signature — nothing else. No admin
      // token, no session, and above all no secret.
      expect(url).not.toContain(PREVIEW_SECRET);
      expect(url).not.toContain(SIGNING_SECRET);
      expect(new URL(url).searchParams.get("exp")).toBe(String(expSeconds));
    });

    it("rejects issuance without an admin token", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);

      const res = await createApp().fetch(previewUrlRequest(doc.slug, 1, null), testEnv());

      expect(res.status).toBe(401);
      expect(await res.text()).not.toContain(PREVIEW_SECRET);
    });

    it("rejects an unknown version number with VERSION_NOT_FOUND", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);

      const res = await createApp().fetch(previewUrlRequest(doc.slug, 99, await adminToken()), testEnv());

      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VERSION_NOT_FOUND");
    });

    it("never leaks the signing secret into the response body or headers", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);

      const res = await createApp().fetch(previewUrlRequest(doc.slug, 1, await adminToken()), testEnv());
      const text = await res.text();
      const headerBlob = [...res.headers.entries()].map(([k, v]) => `${k}:${v}`).join("\n");

      expect(text).not.toContain(PREVIEW_SECRET);
      expect(headerBlob).not.toContain(PREVIEW_SECRET);
    });
  });

  describe("content origin — a valid signature streams that exact version", () => {
    it("streams the superseded version's original bytes", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);
      const { url } = await issuePreviewUrl(doc.slug, 1);

      const res = await handleContentRequest(contentRequest(url), contentEnv());

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("The first cut.");
      expect(body).not.toContain("The revised cut.");
      expect(await sha256Of(body)).toBe(await versionSha(doc.v1Id));
    });

    it("marks the response private and uncacheable, and keeps the frame-ancestors policy", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);
      const { url } = await issuePreviewUrl(doc.slug, 1);

      const res = await handleContentRequest(contentRequest(url), contentEnv());

      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("content-security-policy")).toBe(`frame-ancestors ${APP_ORIGIN}`);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      // A historical version must never carry a validator that a shared
      // cache could use to serve it again.
      expect(res.headers.get("etag")).toBeNull();
    });

    it("allows previewing the CURRENT version, so Admin can compare", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);
      const { url } = await issuePreviewUrl(doc.slug, 2);

      const res = await handleContentRequest(contentRequest(url), contentEnv());

      expect(res.status).toBe(200);
      expect(await res.text()).toContain("The revised cut.");
    });

    it("returns 404, and logs, when the version row exists but its object is gone", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);
      const { url } = await issuePreviewUrl(doc.slug, 1);

      const key = await db()
        .prepare("SELECT r2_key AS r2Key FROM document_versions WHERE id = ?")
        .bind(doc.v1Id)
        .first<{ r2Key: string }>();
      await storage().docs.delete(key?.r2Key ?? "");

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const res = await handleContentRequest(contentRequest(url), contentEnv());
        expect(res.status).toBe(404);
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe("content origin — every rejection is a bare 403", () => {
    async function expectForbidden(url: string): Promise<void> {
      const res = await handleContentRequest(contentRequest(url), contentEnv());
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).not.toContain(PREVIEW_SECRET);
      // No hint about which check failed.
      expect(body.toLowerCase()).not.toContain("expired");
      expect(body.toLowerCase()).not.toContain("signature");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }

    it("rejects an expired signature with no grace period", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);
      const claim: PreviewClaim = {
        documentId: doc.documentId,
        versionId: doc.v1Id,
        exp: nowSeconds() - 1,
      };
      const url = buildPreviewUrl(CONTENT_ORIGIN, claim, await signPreviewClaim(claim, PREVIEW_SECRET));

      await expectForbidden(url);
    });

    it("rejects a tampered exp, because exp is inside the signed payload", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);
      const { url } = await issuePreviewUrl(doc.slug, 1);

      const tampered = new URL(url);
      tampered.searchParams.set("exp", String(nowSeconds() + 86_400));

      await expectForbidden(tampered.toString());
    });

    it("rejects a signature issued for a DIFFERENT version of the same document", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);
      const { url } = await issuePreviewUrl(doc.slug, 1);

      // Same signature and expiry, pointed at v2 instead of v1.
      const replayed = new URL(url);
      replayed.pathname = `/p/${doc.documentId}/${doc.v2Id}`;

      await expectForbidden(replayed.toString());
    });

    it("rejects a signature issued for a DIFFERENT document", async () => {
      const categoryId = await seedCategory(db());
      const first = await seedDocument(categoryId, "first");
      const second = await seedDocument(categoryId, "second");
      const { url } = await issuePreviewUrl(first.slug, 1);

      const replayed = new URL(url);
      replayed.pathname = `/p/${second.documentId}/${second.v1Id}`;

      await expectForbidden(replayed.toString());
    });

    it("rejects a forged signature", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);
      const claim: PreviewClaim = {
        documentId: doc.documentId,
        versionId: doc.v1Id,
        exp: nowSeconds() + 300,
      };
      const forged = await signPreviewClaim(claim, "not-the-real-secret");

      await expectForbidden(buildPreviewUrl(CONTENT_ORIGIN, claim, forged));
    });

    it("rejects unsigned access and a missing exp", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);
      const { url } = await issuePreviewUrl(doc.slug, 1);
      const parsed = new URL(url);

      await expectForbidden(`${CONTENT_ORIGIN}/p/${doc.documentId}/${doc.v1Id}`);

      const noSig = new URL(url);
      noSig.searchParams.delete("sig");
      await expectForbidden(noSig.toString());

      const noExp = new URL(url);
      noExp.searchParams.delete("exp");
      await expectForbidden(noExp.toString());

      const junkSig = new URL(url);
      junkSig.searchParams.set("sig", "zzzz");
      await expectForbidden(junkSig.toString());

      expect(parsed.searchParams.get("sig")).toMatch(/^[0-9a-f]{64}$/);
    });

    it("rejects everything when the content Worker holds no signing secret", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);
      const { url } = await issuePreviewUrl(doc.slug, 1);

      const res = await handleContentRequest(
        contentRequest(url),
        contentEnv({ CONTENT_PREVIEW_SIGNING_SECRET: "" }),
      );

      expect(res.status).toBe(403);
    });
  });

  describe("regression — the public route is untouched", () => {
    it("still serves /d/:slug publicly, cacheably and with an etag", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);

      const res = await handleContentRequest(
        contentRequest(`${CONTENT_ORIGIN}/d/${doc.slug}`),
        contentEnv(),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=60");
      expect(res.headers.get("etag")).toBe(`W/"${await versionSha(doc.v2Id)}"`);
      expect(await res.text()).toContain("The revised cut.");
    });

    it("still refuses a non-GET request and an unknown path", async () => {
      const categoryId = await seedCategory(db());
      const doc = await seedDocument(categoryId);
      const { url } = await issuePreviewUrl(doc.slug, 1);

      const posted = await handleContentRequest(new Request(url, { method: "POST" }), contentEnv());
      expect(posted.status).toBe(404);

      const unknown = await handleContentRequest(
        contentRequest(`${CONTENT_ORIGIN}/p/${doc.documentId}`),
        contentEnv(),
      );
      expect(unknown.status).toBe(404);
    });
  });
});
