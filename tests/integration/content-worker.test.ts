// Node G1.9 — Content Worker: Serve Current Version.
//
// Runs inside the content Worker's own pool project (see vitest.config.ts,
// "content" project, pointed at wrangler.content.jsonc), so `env.DB` and
// `env.DOCS` here are the content Worker's actual bindings — a real local
// D1 and a real local R2 bucket inside the Workers runtime, not a mock.
// G1.5 (DocumentService) has not been built yet, so test data is seeded
// directly into D1 and R2, reusing the migration-loading pattern from
// tests/integration/schema.test.ts (duplicated locally rather than
// imported, since that file exports nothing and belongs to a different
// node).
import { beforeEach, describe, expect, it, vi } from "vitest";
// `cloudflare:test` and Vite's `?raw` suffix import both resolve and work
// at runtime but ship no ambient type usable from an ordinary `.ts` file
// (see tests/integration/schema.test.ts for the full explanation). Each
// import is suppressed locally, same as that file.
// @ts-expect-error - "cloudflare:test" has no ambient type outside the
// package's optional "./types" subpath, which is out of this node's scope
import { env, reset, SELF } from "cloudflare:test";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0001 from "../../migrations/0001_init.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0002 from "../../migrations/0002_seed_categories.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import fixtureHtml from "../../mauboussin-expectations-investing-summary.html?raw";

interface ContentTestEnv {
  DB: D1Database;
  DOCS: R2Bucket;
  APP_ORIGIN: string;
}

function getEnv(): ContentTestEnv {
  return env as unknown as ContentTestEnv;
}

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

async function applyMigrations(db: D1Database): Promise<void> {
  for (const statement of splitStatements(migration0001)) {
    await db.prepare(statement).run();
  }
  for (const statement of splitStatements(migration0002)) {
    await db.prepare(statement).run();
  }
}

const NOW = "2026-08-30T12:00:00.000Z";

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Seeds one category + document + version (and, unless `skipR2Put` is set,
 * the matching R2 object) directly into the content Worker's own D1 and
 * R2, mirroring what DocumentService/VersionService will do once G1.5
 * exists. Returns everything a test needs to assert against.
 */
async function seedDocument(
  overrides: Partial<{ slug: string; html: string; skipR2Put: boolean; noCurrentVersion: boolean }> = {},
): Promise<{ slug: string; sha256: string; r2Key: string; html: string }> {
  const testEnv = getEnv();
  const html = overrides.html ?? "<!doctype html><html><body><h1>Hello</h1></body></html>";
  const bytes = new TextEncoder().encode(html);
  const sha256 = await sha256Hex(bytes);

  const categoryId = newId("cat");
  await testEnv.DB.prepare(
    "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES (?, NULL, 'Test', ?, 0, ?, ?)",
  )
    .bind(categoryId, newId("cat-slug"), NOW, NOW)
    .run();

  const documentId = newId("doc");
  const slug = overrides.slug ?? newId("doc-slug");
  await testEnv.DB.prepare(
    "INSERT INTO documents (id, slug, title, description, category_id, current_version_id, created_at, updated_at) VALUES (?, ?, 'Title', '', ?, NULL, ?, ?)",
  )
    .bind(documentId, slug, categoryId, NOW, NOW)
    .run();

  const r2Key = `documents/${documentId}/versions/${newId("ver")}.html`;
  if (!overrides.noCurrentVersion) {
    const versionId = newId("ver");
    await testEnv.DB.prepare(
      "INSERT INTO document_versions (id, document_id, version_no, r2_key, sha256, size_bytes, created_by, created_at, restored_from_version_no, note) VALUES (?, ?, 1, ?, ?, ?, 'admin', ?, NULL, '')",
    )
      .bind(versionId, documentId, r2Key, sha256, bytes.byteLength, NOW)
      .run();
    await testEnv.DB.prepare("UPDATE documents SET current_version_id = ? WHERE id = ?")
      .bind(versionId, documentId)
      .run();
  }

  if (!overrides.skipR2Put) {
    await testEnv.DOCS.put(r2Key, bytes);
  }

  return { slug, sha256, r2Key, html };
}

describe("content worker — GET /d/:slug and GET /health", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(getEnv().DB);
  });

  describe("positive", () => {
    it("GET /health returns a minimal liveness response", async () => {
      const res = await SELF.fetch("https://content.test/health");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    });

    it("serves a known slug's current version with the required headers", async () => {
      const { slug, sha256, html } = await seedDocument({ slug: "known-slug" });

      const res = await SELF.fetch(`https://content.test/d/${slug}`);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(html);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cache-control")).toBe("public, max-age=60");
      expect(res.headers.get("etag")).toBe(`"${sha256}"`);

      // Requirement 6/7: frame-ancestors is the ONLY CSP directive, driven
      // by the APP_ORIGIN configuration var, so nothing here blocks the
      // external fonts/images/scripts SPEC allows uploaded HTML to load.
      const csp = res.headers.get("content-security-policy");
      expect(csp).toBe(`frame-ancestors ${getEnv().APP_ORIGIN}`);
      expect(csp?.split(";").length).toBe(1);
    });

    it("returns a 304 with no body when If-None-Match matches the current ETag", async () => {
      const { slug } = await seedDocument({ slug: "etag-round-trip" });

      const first = await SELF.fetch(`https://content.test/d/${slug}`);
      const etag = first.headers.get("etag");
      expect(etag).toBeTruthy();

      const second = await SELF.fetch(`https://content.test/d/${slug}`, {
        headers: { "if-none-match": etag ?? "" },
      });

      expect(second.status).toBe(304);
      expect(await second.text()).toBe("");
    });

    it("serves the Mauboussin acceptance fixture byte-identically, verified by sha256", async () => {
      const { slug, sha256, r2Key } = await seedDocument({ slug: "mauboussin-fixture", html: fixtureHtml });

      const res = await SELF.fetch(`https://content.test/d/${slug}`);

      expect(res.status).toBe(200);
      const servedBytes = new Uint8Array(await res.arrayBuffer());
      expect(await sha256Hex(servedBytes)).toBe(sha256);
      expect(res.headers.get("etag")).toBe(`"${sha256}"`);

      // Same object the Worker read from, read back independently.
      const stored = await getEnv().DOCS.get(r2Key);
      const storedBytes = new Uint8Array(await stored!.arrayBuffer());
      expect(await sha256Hex(storedBytes)).toBe(sha256);
    });

    it("streams a large (~5 MiB) document without failing or truncating it", async () => {
      const largeHtml = `<!doctype html><html><body>${"x".repeat(5 * 1024 * 1024)}</body></html>`;
      const { slug, sha256 } = await seedDocument({ slug: "large-document", html: largeHtml });

      const res = await SELF.fetch(`https://content.test/d/${slug}`);

      expect(res.status).toBe(200);
      const servedBytes = new Uint8Array(await res.arrayBuffer());
      expect(servedBytes.byteLength).toBe(new TextEncoder().encode(largeHtml).byteLength);
      expect(await sha256Hex(servedBytes)).toBe(sha256);
    });
  });

  describe("negative", () => {
    it("returns 404 for an unknown slug and reveals nothing about other documents", async () => {
      await seedDocument({ slug: "exists-but-not-requested" });

      const res = await SELF.fetch("https://content.test/d/does-not-exist");

      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).not.toContain("exists-but-not-requested");
      expect(body.toLowerCase()).not.toContain("alexandria");
    });

    it("returns 404 when the document has no current version", async () => {
      const { slug } = await seedDocument({ slug: "no-current-version", noCurrentVersion: true });

      const res = await SELF.fetch(`https://content.test/d/${slug}`);

      expect(res.status).toBe(404);
    });

    it("returns 404 and logs server-side when the R2 object is missing", async () => {
      const { slug } = await seedDocument({ slug: "missing-r2-object", skipR2Put: true });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await SELF.fetch(`https://content.test/d/${slug}`);

      expect(res.status).toBe(404);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("returns 404 for a slug containing path traversal characters", async () => {
      const res = await SELF.fetch("https://content.test/d/..%2f..%2fetc%2fpasswd");
      expect(res.status).toBe(404);
    });

    it("returns 404 for an extremely long slug rather than an unhandled error", async () => {
      const res = await SELF.fetch(`https://content.test/d/${"a".repeat(5000)}`);
      expect(res.status).toBe(404);
    });

    it("never emits Set-Cookie on 200, 304 or 404 responses", async () => {
      const { slug } = await seedDocument({ slug: "no-cookie-emitted" });

      const ok = await SELF.fetch(`https://content.test/d/${slug}`);
      const notModified = await SELF.fetch(`https://content.test/d/${slug}`, {
        headers: { "if-none-match": ok.headers.get("etag") ?? "" },
      });
      const missing = await SELF.fetch("https://content.test/d/does-not-exist-either");
      const healthRes = await SELF.fetch("https://content.test/health");

      expect(ok.headers.get("set-cookie")).toBeNull();
      expect(notModified.headers.get("set-cookie")).toBeNull();
      expect(missing.headers.get("set-cookie")).toBeNull();
      expect(healthRes.headers.get("set-cookie")).toBeNull();
    });

    it("serves the same bytes whether or not the request carries a Cookie header", async () => {
      // Behavioral proxy for "never reads a cookie" (Requirement 9): a
      // request carrying a Cookie header — even one shaped like an admin
      // session — is served identically to one without it.
      const { slug, html } = await seedDocument({ slug: "cookie-ignored" });

      const res = await SELF.fetch(`https://content.test/d/${slug}`, {
        headers: { cookie: "admin_session=fake-token-should-be-ignored" },
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(html);
    });

    it("rejects non-GET methods on /d/:slug and /health", async () => {
      const { slug } = await seedDocument({ slug: "no-post-allowed" });

      const postDoc = await SELF.fetch(`https://content.test/d/${slug}`, { method: "POST" });
      const postHealth = await SELF.fetch("https://content.test/health", { method: "POST" });

      expect(postDoc.status).toBe(404);
      expect(postHealth.status).toBe(404);
    });
  });

  describe("regression", () => {
    it("served bytes equal stored bytes equal seeded bytes across the whole chain", async () => {
      const { slug, sha256, r2Key, html } = await seedDocument({ slug: "chain-regression", html: fixtureHtml });

      const seededBytes = new TextEncoder().encode(html);
      expect(await sha256Hex(seededBytes)).toBe(sha256);

      const stored = await getEnv().DOCS.get(r2Key);
      const storedBytes = new Uint8Array(await stored!.arrayBuffer());
      expect(await sha256Hex(storedBytes)).toBe(sha256);

      const res = await SELF.fetch(`https://content.test/d/${slug}`);
      const servedBytes = new Uint8Array(await res.arrayBuffer());
      expect(await sha256Hex(servedBytes)).toBe(sha256);
    });
  });
});
