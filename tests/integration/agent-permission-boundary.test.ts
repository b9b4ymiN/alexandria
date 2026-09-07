// Node G5.1 — Agent Auth & Agent API Routes.
//
// NEGATIVE coverage: credentials (missing, wrong, cross-role in both
// directions), category creation unreachable for an agent, document/
// version deletion and restore unreachable, slug change rejected, and a
// regression check that Admin routes keep working and stay closed to
// agent keys. Positive/contract coverage lives in
// tests/integration/agent-api.test.ts.
import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error - "cloudflare:test" has no ambient type outside the
// package's optional "./types" subpath
import { env as workersEnv, reset } from "cloudflare:test";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0001 from "../../migrations/0001_init.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0002 from "../../migrations/0002_seed_categories.sql?raw";

import { createApp } from "../../src/api/app";
import { signToken } from "../../src/shared/token";
import type { Env } from "../../src/shared/types";

const APP_ORIGIN = "https://app.test";
const CONTENT_ORIGIN = "https://content.test";
const AGENT_KEY = "agent-boundary-test-key-not-a-real-secret";
const SIGNING_SECRET = "agent-boundary-test-signing-secret";

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

async function adminToken(): Promise<string> {
  return (await signToken(SIGNING_SECRET)).token;
}

const SEEDED_CATEGORY_ID = "cat_8f2a1b6e3d4c47a1"; // "Stocks", migration 0002

function simpleHtml(title: string): string {
  return `<!doctype html>
<html><head><title>${title}</title>
<meta name="description" content="Description for ${title}.">
</head><body><h1>${title}</h1><p>Body text.</p></body></html>`;
}

function htmlFile(content: string, filename = "doc.html"): File {
  return new File([content], filename, { type: "text/html" });
}

function bearerRequest(path: string, method: string, token: string | null, body?: unknown): Request {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://app.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createAgentDocument(app: ReturnType<typeof createApp>, title = "Boundary Report") {
  const form = new FormData();
  form.set("file", htmlFile(simpleHtml(title)));
  form.set("categoryId", SEEDED_CATEGORY_ID);
  const res = await app.fetch(
    new Request("https://app.test/api/agent/documents", {
      method: "POST",
      headers: { authorization: `Bearer ${AGENT_KEY}` },
      body: form,
    }),
    testEnv(),
  );
  const body = (await res.json()) as { data: { slug: string; documentId: string } };
  if (res.status !== 201) throw new Error(`setup failed: ${JSON.stringify(body)}`);
  return body.data;
}

describe("Agent API permission boundary (G5.1)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  describe("credentials", () => {
    it("missing Authorization header -> AUTH_REQUIRED (401)", async () => {
      const app = createApp();
      const res = await app.fetch(bearerRequest("/api/agent/categories", "GET", null), testEnv());
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("AUTH_REQUIRED");
    });

    it("wrong agent key -> AGENT_KEY_INVALID (401)", async () => {
      const app = createApp();
      const res = await app.fetch(bearerRequest("/api/agent/categories", "GET", "totally-wrong-key"), testEnv());
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("AGENT_KEY_INVALID");
    });

    it("an Admin session token on an Agent route -> AGENT_KEY_INVALID (401), not accepted", async () => {
      const app = createApp();
      const token = await adminToken();
      const res = await app.fetch(bearerRequest("/api/agent/categories", "GET", token), testEnv());
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("AGENT_KEY_INVALID");
    });

    it("an Agent key on an Admin route -> AUTH_INVALID (401), not accepted", async () => {
      const app = createApp();
      const res = await app.fetch(bearerRequest("/api/admin/categories", "GET", AGENT_KEY), testEnv());
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("AUTH_INVALID");
    });

    it("a blank/misconfigured AGENT_API_KEY never matches an empty credential", async () => {
      const app = createApp();
      const res = await app.fetch(
        bearerRequest("/api/agent/categories", "GET", ""),
        testEnv({ AGENT_API_KEY: "" }),
      );
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("AGENT_KEY_INVALID");
    });
  });

  describe("category creation is unreachable for an agent", () => {
    it("has no POST/PATCH/DELETE category route under /api/agent", async () => {
      const app = createApp();
      const before = await db().prepare("SELECT COUNT(*) AS c FROM categories").first<{ c: number }>();

      for (const req of [
        bearerRequest("/api/agent/categories", "POST", AGENT_KEY, { name: "Hijack" }),
        bearerRequest("/api/agent/categories/anything", "PATCH", AGENT_KEY, { name: "Hijack" }),
        bearerRequest("/api/agent/categories/anything", "DELETE", AGENT_KEY),
      ]) {
        const res = await app.fetch(req, testEnv());
        expect(res.status).toBe(404);
      }

      const after = await db().prepare("SELECT COUNT(*) AS c FROM categories").first<{ c: number }>();
      expect(after?.c).toBe(before?.c);
    });
  });

  describe("destructive operations are unreachable", () => {
    it("DELETE /api/agent/documents/:slug -> 404, document not deleted", async () => {
      const app = createApp();
      const created = await createAgentDocument(app);

      const res = await app.fetch(
        bearerRequest(`/api/agent/documents/${created.slug}`, "DELETE", AGENT_KEY, {
          confirmSlug: created.slug,
        }),
        testEnv(),
      );
      expect(res.status).toBe(404);

      const row = await db().prepare("SELECT id FROM documents WHERE slug = ?").bind(created.slug).first();
      expect(row).not.toBeNull();
    });

    it("version delete and restore are unreachable under any path shape -> 404, nothing changes", async () => {
      const app = createApp();
      const created = await createAgentDocument(app);

      for (const req of [
        bearerRequest(`/api/agent/documents/${created.slug}/versions/1`, "DELETE", AGENT_KEY),
        bearerRequest(`/api/agent/documents/${created.slug}/restore/1`, "POST", AGENT_KEY),
        bearerRequest(`/api/agent/documents/${created.slug}/versions/1/restore`, "POST", AGENT_KEY),
      ]) {
        const res = await app.fetch(req, testEnv());
        expect(res.status).toBe(404);
      }

      const versionCount = await db()
        .prepare("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?")
        .bind(created.documentId)
        .first<{ c: number }>();
      expect(versionCount?.c).toBe(1);
    });
  });

  describe("slug is immutable", () => {
    it("rejects a move body carrying slug with SLUG_IMMUTABLE", async () => {
      const app = createApp();
      const created = await createAgentDocument(app);

      const res = await app.fetch(
        bearerRequest(`/api/agent/documents/${created.slug}/move`, "POST", AGENT_KEY, {
          slug: "hijacked",
          categoryId: SEEDED_CATEGORY_ID,
        }),
        testEnv(),
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("SLUG_IMMUTABLE");
    });
  });

  describe("route inventory locks the surface", () => {
    it("registers exactly the eight documented Agent routes", () => {
      const app = createApp();
      const agentPaths = new Set(
        app.routes.filter((r) => r.path.startsWith("/api/agent")).map((r) => `${r.method} ${r.path}`),
      );
      expect([...agentPaths].sort()).toEqual(
        [
          "POST /api/agent/documents",
          "POST /api/agent/documents/:slug/versions",
          "GET /api/agent/documents/:slug",
          "GET /api/agent/documents",
          "PATCH /api/agent/documents/:slug",
          "POST /api/agent/documents/:slug/move",
          "GET /api/agent/categories",
          "GET /api/agent/tags",
        ].sort(),
      );
    });
  });

  describe("regression — Admin routes unchanged and closed to agent keys", () => {
    it("Admin can still create a category with a valid session token", async () => {
      const app = createApp();
      const token = await adminToken();
      const res = await app.fetch(
        bearerRequest("/api/admin/categories", "POST", token, { name: "Still Works" }),
        testEnv(),
      );
      expect(res.status).toBe(201);
    });

    it("Admin document create/update/move all reject an agent key", async () => {
      const app = createApp();
      const createRes = await app.fetch(
        bearerRequest("/api/admin/documents", "POST", AGENT_KEY),
        testEnv(),
      );
      expect(createRes.status).toBe(401);

      const patchRes = await app.fetch(
        bearerRequest("/api/admin/documents/anything", "PATCH", AGENT_KEY, { title: "x" }),
        testEnv(),
      );
      expect(patchRes.status).toBe(401);

      const moveRes = await app.fetch(
        bearerRequest("/api/admin/documents/anything/move", "POST", AGENT_KEY, { categoryId: SEEDED_CATEGORY_ID }),
        testEnv(),
      );
      expect(moveRes.status).toBe(401);
    });
  });
});
