// Node G5.1 — Agent Auth & Agent API Routes, exercised through the real
// Hono app with REAL bindings (createApp().fetch(request, env)), matching
// the pattern established by tests/integration/api-documents.test.ts and
// tests/integration/category-api.test.ts.
//
// This file covers the POSITIVE contract: the eight documented routes
// work end to end for a correctly authenticated agent, agent-created
// versions record created_by = 'agent', and agent search returns the same
// results as public search. Negative/permission-boundary cases live in
// tests/integration/agent-permission-boundary.test.ts.
import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error - "cloudflare:test" has no ambient type outside the
// package's optional "./types" subpath
import { env as workersEnv, reset } from "cloudflare:test";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0001 from "../../migrations/0001_init.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0002 from "../../migrations/0002_seed_categories.sql?raw";

import { createApp } from "../../src/api/app";
import type { Env } from "../../src/shared/types";

const APP_ORIGIN = "https://app.test";
const CONTENT_ORIGIN = "https://content.test";
const AGENT_KEY = "agent-api-test-key-not-a-real-secret";

// The eight documented Agent routes (SPEC.md §18 Agent), typed out
// explicitly per the orchestrator's clarification — never derived from
// the code under test, so a ninth route fails this test until reviewed
// (node G5.1 requirement 7).
const EXPECTED_AGENT_ROUTES = [
  "POST /api/agent/documents",
  "POST /api/agent/documents/:slug/versions",
  "GET /api/agent/documents/:slug",
  "GET /api/agent/documents",
  "PATCH /api/agent/documents/:slug",
  "POST /api/agent/documents/:slug/move",
  "GET /api/agent/categories",
  "GET /api/agent/tags",
].sort();

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
    ADMIN_SESSION_SIGNING_SECRET: "agent-api-test-signing-secret",
    AGENT_API_KEY: AGENT_KEY,
    ...overrides,
  };
}

function db(): D1Database {
  return (workersEnv as unknown as { DB: D1Database }).DB;
}

async function applyMigrations(database: D1Database): Promise<void> {
  for (const statement of [...splitStatements(migration0001), ...splitStatements(migration0002)]) {
    await database.prepare(statement).run();
  }
}

const SEEDED_CATEGORY_ID = "cat_8f2a1b6e3d4c47a1"; // "Stocks", migration 0002
const OTHER_CATEGORY_ID = "cat_1e7b9c2f5a6d48b2"; // "Books", migration 0002

function simpleHtml(title: string, keywords = ""): string {
  return `<!doctype html>
<html><head><title>${title}</title>
<meta name="description" content="Description for ${title}.">${
    keywords ? `\n<meta name="keywords" content="${keywords}">` : ""
  }
</head><body><h1>${title}</h1><p>Body text.</p></body></html>`;
}

function htmlFile(content: string, filename = "doc.html"): File {
  return new File([content], filename, { type: "text/html" });
}

function agentGet(path: string, key: string | null = AGENT_KEY): Request {
  const headers: Record<string, string> = {};
  if (key !== null) headers.authorization = `Bearer ${key}`;
  return new Request(`https://app.test${path}`, { headers });
}

function agentJson(path: string, method: string, body: unknown, key: string | null = AGENT_KEY): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers.authorization = `Bearer ${key}`;
  return new Request(`https://app.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function agentUpload(
  path: string,
  fields: { file?: File; categoryId?: string; title?: string; tags?: string; note?: string },
  key: string | null = AGENT_KEY,
): Request {
  const form = new FormData();
  if (fields.file) form.set("file", fields.file);
  if (fields.categoryId !== undefined) form.set("categoryId", fields.categoryId);
  if (fields.title !== undefined) form.set("title", fields.title);
  if (fields.tags !== undefined) form.set("tags", fields.tags);
  if (fields.note !== undefined) form.set("note", fields.note);
  const headers: Record<string, string> = {};
  if (key !== null) headers.authorization = `Bearer ${key}`;
  return new Request(`https://app.test${path}`, { method: "POST", headers, body: form });
}

async function versionCreatedBy(documentId: string, versionNo: number): Promise<string | null> {
  const row = await db()
    .prepare("SELECT created_by AS createdBy FROM document_versions WHERE document_id = ? AND version_no = ?")
    .bind(documentId, versionNo)
    .first<{ createdBy: string }>();
  return row?.createdBy ?? null;
}

/**
 * Publishes a document as the agent and returns the envelope's `data`.
 * Hono types `app.fetch()` as `Response | Promise<Response>`, so the
 * response must be awaited — it cannot be chained off `.then()`.
 */
async function createAgentDocument(
  app: ReturnType<typeof createApp>,
  fields: Parameters<typeof agentUpload>[1],
): Promise<{ documentId: string; slug: string; versionNo: number }> {
  const res = await app.fetch(agentUpload("/api/agent/documents", fields), testEnv());
  const body = (await res.json()) as {
    data: { documentId: string; slug: string; versionNo: number };
  };
  if (res.status !== 201) {
    throw new Error(`setup failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body.data;
}

describe("Agent API (G5.1)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  describe("route inventory", () => {
    it("registers exactly the eight documented Agent routes, nothing more", () => {
      const app = createApp();
      const agentPaths = new Set(
        app.routes.filter((r) => r.path.startsWith("/api/agent")).map((r) => `${r.method} ${r.path}`),
      );
      expect([...agentPaths].sort()).toEqual(EXPECTED_AGENT_ROUTES);
    });
  });

  describe("positive flow — create, version, update, move, list", () => {
    it("creates a document with createdBy = agent", async () => {
      const app = createApp();
      const res = await app.fetch(
        agentUpload("/api/agent/documents", {
          file: htmlFile(simpleHtml("Agent Report")),
          categoryId: SEEDED_CATEGORY_ID,
        }),
        testEnv(),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { ok: boolean; data: { documentId: string; slug: string; versionNo: number } };
      expect(body.ok).toBe(true);
      expect(await versionCreatedBy(body.data.documentId, body.data.versionNo)).toBe("agent");
    });

    it("adds a version with createdBy = agent", async () => {
      const app = createApp();
      const created = await createAgentDocument(app, {
        file: htmlFile(simpleHtml("Versioned Report")),
        categoryId: SEEDED_CATEGORY_ID,
      });

      const res = await app.fetch(
        agentUpload(`/api/agent/documents/${created.slug}/versions`, {
          file: htmlFile(simpleHtml("Versioned Report", "updated")),
        }),
        testEnv(),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { versionNo: number; unchanged: boolean } };
      expect(body.data.unchanged).toBe(false);
      expect(body.data.versionNo).toBe(2);
      expect(await versionCreatedBy(created.documentId, 2)).toBe("agent");
    });

    it("re-uploading identical bytes returns UNCHANGED, same as admin", async () => {
      const app = createApp();
      const content = simpleHtml("Stable Report");
      const created = await createAgentDocument(app, {
        file: htmlFile(content),
        categoryId: SEEDED_CATEGORY_ID,
      });

      const res = await app.fetch(
        agentUpload(`/api/agent/documents/${created.slug}/versions`, { file: htmlFile(content) }),
        testEnv(),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { unchanged: boolean; versionNo: number } };
      expect(body.data.unchanged).toBe(true);
      expect(body.data.versionNo).toBe(1);
    });

    it("gets a document by slug without HTML body bytes", async () => {
      const app = createApp();
      const created = await createAgentDocument(app, {
        file: htmlFile(simpleHtml("Gettable Report")),
        categoryId: SEEDED_CATEGORY_ID,
      });

      const res = await app.fetch(agentGet(`/api/agent/documents/${created.slug}`), testEnv());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Record<string, unknown> };
      expect(body.data.slug).toBe(created.slug);
      expect(body.data.contentUrl).toContain(CONTENT_ORIGIN);
      expect(JSON.stringify(body.data)).not.toContain("<html");
    });

    it("updates title/description/tags, implicitly creating a new tag", async () => {
      const app = createApp();
      const created = await createAgentDocument(app, {
        file: htmlFile(simpleHtml("Updatable Report")),
        categoryId: SEEDED_CATEGORY_ID,
      });

      const res = await app.fetch(
        agentJson(`/api/agent/documents/${created.slug}`, "PATCH", {
          title: "Renamed by Agent",
          tags: ["brand-new-agent-tag"],
        }),
        testEnv(),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { title: string; tags: string[] } };
      expect(body.data.title).toBe("Renamed by Agent");
      expect(body.data.tags).toContain("brand-new-agent-tag");

      const tagsRes = await app.fetch(agentGet("/api/agent/tags"), testEnv());
      const tagsBody = (await tagsRes.json()) as { data: Array<{ name: string }> };
      expect(tagsBody.data.map((t) => t.name)).toContain("brand-new-agent-tag");
    });

    it("moves a document into an existing category", async () => {
      const app = createApp();
      const created = await createAgentDocument(app, {
        file: htmlFile(simpleHtml("Movable Report")),
        categoryId: SEEDED_CATEGORY_ID,
      });

      const res = await app.fetch(
        agentJson(`/api/agent/documents/${created.slug}/move`, "POST", { categoryId: OTHER_CATEGORY_ID }),
        testEnv(),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { categoryId: string } };
      expect(body.data.categoryId).toBe(OTHER_CATEGORY_ID);
    });

    it("lists categories and tags", async () => {
      const app = createApp();
      const categoriesRes = await app.fetch(agentGet("/api/agent/categories"), testEnv());
      expect(categoriesRes.status).toBe(200);
      const categoriesBody = (await categoriesRes.json()) as { data: { categories: Array<{ id: string }> } };
      expect(categoriesBody.data.categories.length).toBeGreaterThanOrEqual(4);

      const tagsRes = await app.fetch(agentGet("/api/agent/tags"), testEnv());
      expect(tagsRes.status).toBe(200);
      const tagsBody = (await tagsRes.json()) as { data: unknown[] };
      expect(Array.isArray(tagsBody.data)).toBe(true);
    });
  });

  describe("category not found", () => {
    it("rejects an upload into a non-existent category, creating nothing", async () => {
      const app = createApp();
      const before = await db().prepare("SELECT COUNT(*) AS c FROM documents").first<{ c: number }>();

      const res = await app.fetch(
        agentUpload("/api/agent/documents", {
          file: htmlFile(simpleHtml("Orphan Report")),
          categoryId: "does-not-exist",
        }),
        testEnv(),
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("CATEGORY_NOT_FOUND");

      const after = await db().prepare("SELECT COUNT(*) AS c FROM documents").first<{ c: number }>();
      expect(after?.c).toBe(before?.c);
    });
  });

  describe("slug is immutable", () => {
    it("rejects a PATCH body carrying slug with SLUG_IMMUTABLE", async () => {
      const app = createApp();
      const created = await createAgentDocument(app, {
        file: htmlFile(simpleHtml("Immutable Slug Report")),
        categoryId: SEEDED_CATEGORY_ID,
      });

      const res = await app.fetch(
        agentJson(`/api/agent/documents/${created.slug}`, "PATCH", {
          slug: "hijacked-slug",
          title: "Still Renamed",
        }),
        testEnv(),
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("SLUG_IMMUTABLE");
    });
  });

  describe("agent search matches public search", () => {
    it("returns the same documents for the same query", async () => {
      const app = createApp();
      await app.fetch(
        agentUpload("/api/agent/documents", {
          file: htmlFile(simpleHtml("Searchable Widget Report")),
          categoryId: SEEDED_CATEGORY_ID,
        }),
        testEnv(),
      );

      const agentRes = await app.fetch(agentGet("/api/agent/documents?q=Widget"), testEnv());
      const publicRes = await app.fetch(new Request("https://app.test/api/public/documents?q=Widget"), testEnv());

      expect(agentRes.status).toBe(200);
      expect(publicRes.status).toBe(200);
      const agentBody = (await agentRes.json()) as { data: { items: Array<{ slug: string }>; query: string } };
      const publicBody = (await publicRes.json()) as { data: { items: Array<{ slug: string }>; query: string } };
      expect(agentBody.data.query).toBe(publicBody.data.query);
      expect(agentBody.data.items.map((i) => i.slug)).toEqual(publicBody.data.items.map((i) => i.slug));
      expect(agentBody.data.items.length).toBeGreaterThan(0);
    });
  });

  describe("keeps the route thin", () => {
    it("has no SQL and no direct storage access in the agent route files", async () => {
      const files = await Promise.all([
        // @ts-expect-error - Vite ?raw import has no shipped ambient type
        import("../../src/api/routes/agent/documents.ts?raw"),
        // @ts-expect-error - Vite ?raw import has no shipped ambient type
        import("../../src/api/routes/agent/categories.ts?raw"),
        // @ts-expect-error - Vite ?raw import has no shipped ambient type
        import("../../src/api/routes/agent/tags.ts?raw"),
      ]);
      for (const file of files) {
        const source = (file.default as string)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        expect(source).not.toMatch(/\.prepare\s*\(/);
        expect(source).not.toMatch(/\.batch\s*\(/);
        expect(source).not.toMatch(/env\.DB\s*\./);
        expect(source).not.toMatch(/env\.DOCS\s*\./);
        expect(source).not.toMatch(/\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i);
      }
    });
  });
});
