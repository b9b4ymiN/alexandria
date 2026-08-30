// Node G2.2 — the four admin tag endpoints, exercised through the real
// Hono app with REAL bindings (never a bare fetch with no env), following
// the pattern in tests/integration/api-documents.test.ts.
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

const SIGNING_SECRET = "tag-api-test-signing-secret";
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

function db(): D1Database {
  return (workersEnv as unknown as { DB: D1Database }).DB;
}

function jsonRequest(path: string, method: string, token: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request(`https://app.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createTagViaApi(
  app: ReturnType<typeof createApp>,
  token: string,
  name: string,
): Promise<{ id: string; name: string; normalizedName: string }> {
  const res = await app.fetch(jsonRequest("/api/admin/tags", "POST", token, { name }), testEnv());
  const body = (await res.json()) as { data: { id: string; name: string; normalizedName: string } };
  return body.data;
}

describe("Admin API — tags (G2.2)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  describe("POST /api/admin/tags", () => {
    it("creates a tag", async () => {
      const app = createApp();
      const res = await app.fetch(
        jsonRequest("/api/admin/tags", "POST", await adminToken(), { name: "Value Investing" }),
        testEnv(),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { normalizedName: string } };
      expect(body.data.normalizedName).toBe("value investing");
    });

    it("rejects an unauthenticated request", async () => {
      const app = createApp();
      const res = await app.fetch(
        jsonRequest("/api/admin/tags", "POST", null, { name: "Value Investing" }),
        testEnv(),
      );
      expect(res.status).toBe(401);
      const count = await db().prepare("SELECT COUNT(*) AS c FROM tags").first<{ c: number }>();
      expect(count?.c).toBe(0);
    });

    it("rejects an over-length name", async () => {
      const app = createApp();
      const res = await app.fetch(
        jsonRequest("/api/admin/tags", "POST", await adminToken(), { name: "a".repeat(51) }),
        testEnv(),
      );
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("TAG_NAME_TOO_LONG");
    });
  });

  describe("PATCH /api/admin/tags/:id", () => {
    it("renames a tag", async () => {
      const app = createApp();
      const token = await adminToken();
      const tag = await createTagViaApi(app, token, "Moat");

      const res = await app.fetch(
        jsonRequest(`/api/admin/tags/${tag.id}`, "PATCH", token, { name: "Economic Moat" }),
        testEnv(),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { normalizedName: string } };
      expect(body.data.normalizedName).toBe("economic moat");
    });

    it("rejects a colliding rename with a conflict rather than a silent merge", async () => {
      const app = createApp();
      const token = await adminToken();
      await createTagViaApi(app, token, "ROIC");
      const moat = await createTagViaApi(app, token, "Moat");

      const res = await app.fetch(
        jsonRequest(`/api/admin/tags/${moat.id}`, "PATCH", token, { name: "roic" }),
        testEnv(),
      );
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("TAG_NAME_CONFLICT");

      const count = await db()
        .prepare("SELECT COUNT(*) AS c FROM tags WHERE normalized_name = 'roic'")
        .first<{ c: number }>();
      expect(count?.c).toBe(1);
    });

    it("rejects an unauthenticated request", async () => {
      const app = createApp();
      const tag = await createTagViaApi(app, await adminToken(), "Moat");

      const res = await app.fetch(
        jsonRequest(`/api/admin/tags/${tag.id}`, "PATCH", null, { name: "New Name" }),
        testEnv(),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/admin/tags/:id/merge", () => {
    it("merges one tag into another and preserves document links", async () => {
      const app = createApp();
      const token = await adminToken();
      const source = await createTagViaApi(app, token, "Value Investing");
      const target = await createTagViaApi(app, token, "Value");

      const categoryId = "cat-merge";
      const now = "2026-08-30T00:00:00.000Z";
      await db()
        .prepare(
          "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES (?, NULL, 'Merge Cat', 'merge-cat', 0, ?, ?)",
        )
        .bind(categoryId, now, now)
        .run();
      await db()
        .prepare(
          "INSERT INTO documents (id, slug, title, description, category_id, current_version_id, created_at, updated_at) VALUES ('doc-merge', 'doc-merge', 'Doc', '', ?, NULL, ?, ?)",
        )
        .bind(categoryId, now, now)
        .run();
      await db()
        .prepare("INSERT INTO document_tags (document_id, tag_id, created_at) VALUES ('doc-merge', ?, ?)")
        .bind(source.id, now)
        .run();

      const res = await app.fetch(
        jsonRequest(`/api/admin/tags/${source.id}/merge`, "POST", token, { targetId: target.id }),
        testEnv(),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { movedLinks: number; targetId: string } };
      expect(body.data.movedLinks).toBe(1);
      expect(body.data.targetId).toBe(target.id);

      const remainingSource = await db()
        .prepare("SELECT COUNT(*) AS c FROM tags WHERE id = ?")
        .bind(source.id)
        .first<{ c: number }>();
      expect(remainingSource?.c).toBe(0);
    });

    it("rejects merging a tag into itself", async () => {
      const app = createApp();
      const token = await adminToken();
      const tag = await createTagViaApi(app, token, "Moat");

      const res = await app.fetch(
        jsonRequest(`/api/admin/tags/${tag.id}/merge`, "POST", token, { targetId: tag.id }),
        testEnv(),
      );
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("TAG_SELF_MERGE");
    });

    it("rejects an unauthenticated request", async () => {
      const app = createApp();
      const token = await adminToken();
      const a = await createTagViaApi(app, token, "A");
      const b = await createTagViaApi(app, token, "B");

      const res = await app.fetch(
        jsonRequest(`/api/admin/tags/${a.id}/merge`, "POST", null, { targetId: b.id }),
        testEnv(),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("DELETE /api/admin/tags/:id", () => {
    it("deletes a tag and reports removed links", async () => {
      const app = createApp();
      const token = await adminToken();
      const tag = await createTagViaApi(app, token, "Moat");

      const res = await app.fetch(
        jsonRequest(`/api/admin/tags/${tag.id}`, "DELETE", token),
        testEnv(),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { removedLinks: number } };
      expect(body.data.removedLinks).toBe(0);

      const remaining = await db()
        .prepare("SELECT COUNT(*) AS c FROM tags WHERE id = ?")
        .bind(tag.id)
        .first<{ c: number }>();
      expect(remaining?.c).toBe(0);
    });

    it("rejects an unauthenticated request and deletes nothing", async () => {
      const app = createApp();
      const token = await adminToken();
      const tag = await createTagViaApi(app, token, "Moat");

      const res = await app.fetch(jsonRequest(`/api/admin/tags/${tag.id}`, "DELETE", null), testEnv());
      expect(res.status).toBe(401);

      const remaining = await db()
        .prepare("SELECT COUNT(*) AS c FROM tags WHERE id = ?")
        .bind(tag.id)
        .first<{ c: number }>();
      expect(remaining?.c).toBe(1);
    });
  });

  it("keeps the route thin: no SQL and no direct storage access in the route file", async () => {
    // @ts-expect-error - Vite ?raw import has no shipped ambient type
    const raw = (await import("../../src/api/routes/admin/tags.ts?raw")).default as string;
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    expect(source).not.toMatch(/\.prepare\s*\(/);
    expect(source).not.toMatch(/\.batch\s*\(/);
    expect(source).not.toMatch(/env\.DB\s*\./);
    expect(source).not.toMatch(/\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i);
  });
});
