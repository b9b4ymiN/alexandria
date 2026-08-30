// Node G2.1 — Admin Category API, exercised through the real Hono app with
// REAL bindings (createApp().fetch(request, env)), never a bare fetch with
// no env — matching the pattern established by tests/integration/
// api-documents.test.ts.
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

const SIGNING_SECRET = "category-api-test-signing-secret";
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

function jsonRequest(path: string, method: string, token: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request(`https://app.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createCategoryViaApi(
  app: ReturnType<typeof createApp>,
  token: string,
  body: { parentId?: string | null; name: string; slug?: string; sortOrder?: number },
): Promise<{ id: string; parentId: string | null; name: string; slug: string }> {
  const res = await app.fetch(jsonRequest("/api/admin/categories", "POST", token, body), testEnv());
  const parsed = (await res.json()) as { data: { id: string; parentId: string | null; name: string; slug: string } };
  if (res.status !== 201) {
    throw new Error(`expected 201, got ${res.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed.data;
}

describe("Admin API — categories (G2.1)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  describe("POST /api/admin/categories", () => {
    it("creates a root category and returns 201", async () => {
      const app = createApp();
      const res = await app.fetch(
        jsonRequest("/api/admin/categories", "POST", await adminToken(), { name: "Podcasts" }),
        testEnv(),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { ok: boolean; data: { id: string; slug: string } };
      expect(body.ok).toBe(true);
      expect(body.data.slug).toBe("podcasts");
    });

    it("rejects an unauthenticated call and writes nothing", async () => {
      const app = createApp();
      const before = await db().prepare("SELECT COUNT(*) AS c FROM categories").first<{ c: number }>();

      const res = await app.fetch(jsonRequest("/api/admin/categories", "POST", null, { name: "Nope" }), testEnv());

      expect(res.status).toBe(401);
      const after = await db().prepare("SELECT COUNT(*) AS c FROM categories").first<{ c: number }>();
      expect(after?.c).toBe(before?.c);
    });

    it("rejects a blank name with CATEGORY_REQUIRED", async () => {
      const app = createApp();
      const res = await app.fetch(
        jsonRequest("/api/admin/categories", "POST", await adminToken(), { name: "   " }),
        testEnv(),
      );
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("CATEGORY_REQUIRED");
    });

    it("rejects a parent that does not exist with CATEGORY_NOT_FOUND", async () => {
      const app = createApp();
      const res = await app.fetch(
        jsonRequest("/api/admin/categories", "POST", await adminToken(), {
          parentId: "does-not-exist",
          name: "Orphan",
        }),
        testEnv(),
      );
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("CATEGORY_NOT_FOUND");
    });

    it("rejects a sibling slug conflict with CATEGORY_SLUG_CONFLICT", async () => {
      const app = createApp();
      const token = await adminToken();
      await createCategoryViaApi(app, token, { name: "Newsletters", slug: "newsletters" });

      const res = await app.fetch(
        jsonRequest("/api/admin/categories", "POST", token, { name: "Newsletters 2", slug: "newsletters" }),
        testEnv(),
      );
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("CATEGORY_SLUG_CONFLICT");
    });
  });

  describe("PATCH /api/admin/categories/:id", () => {
    it("renames a category without touching its slug", async () => {
      const app = createApp();
      const token = await adminToken();
      const created = await createCategoryViaApi(app, token, { name: "Old Name" });

      const res = await app.fetch(
        jsonRequest(`/api/admin/categories/${created.id}`, "PATCH", token, { name: "New Name" }),
        testEnv(),
      );
      const body = (await res.json()) as { data: { name: string; slug: string } };
      expect(body.data.name).toBe("New Name");
      expect(body.data.slug).toBe(created.slug);
    });

    it("rejects an unauthenticated call", async () => {
      const app = createApp();
      const created = await createCategoryViaApi(app, await adminToken(), { name: "Whatever" });

      const res = await app.fetch(
        jsonRequest(`/api/admin/categories/${created.id}`, "PATCH", null, { name: "New" }),
        testEnv(),
      );
      expect(res.status).toBe(401);
    });

    it("returns CATEGORY_NOT_FOUND for an unknown id", async () => {
      const app = createApp();
      const res = await app.fetch(
        jsonRequest("/api/admin/categories/does-not-exist", "PATCH", await adminToken(), { name: "New" }),
        testEnv(),
      );
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("CATEGORY_NOT_FOUND");
    });
  });

  describe("POST /api/admin/categories/:id/move", () => {
    it("moves a category to a new parent", async () => {
      const app = createApp();
      const token = await adminToken();
      const a = await createCategoryViaApi(app, token, { name: "Parent A" });
      const b = await createCategoryViaApi(app, token, { name: "Parent B" });
      const child = await createCategoryViaApi(app, token, { parentId: a.id, name: "Child" });

      const res = await app.fetch(
        jsonRequest(`/api/admin/categories/${child.id}/move`, "POST", token, { parentId: b.id }),
        testEnv(),
      );
      const body = (await res.json()) as { data: { parentId: string | null } };
      expect(body.data.parentId).toBe(b.id);
    });

    it("rejects moving a category into its own subtree with CATEGORY_CYCLE", async () => {
      const app = createApp();
      const token = await adminToken();
      const parent = await createCategoryViaApi(app, token, { name: "Cycle Parent" });
      const child = await createCategoryViaApi(app, token, { parentId: parent.id, name: "Cycle Child" });

      const res = await app.fetch(
        jsonRequest(`/api/admin/categories/${parent.id}/move`, "POST", token, { parentId: child.id }),
        testEnv(),
      );
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("CATEGORY_CYCLE");
    });

    it("rejects moving a category into itself with CATEGORY_CYCLE", async () => {
      const app = createApp();
      const token = await adminToken();
      const solo = await createCategoryViaApi(app, token, { name: "Solo Mover" });

      const res = await app.fetch(
        jsonRequest(`/api/admin/categories/${solo.id}/move`, "POST", token, { parentId: solo.id }),
        testEnv(),
      );
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("CATEGORY_CYCLE");
    });

    it("rejects an unauthenticated call", async () => {
      const app = createApp();
      const category = await createCategoryViaApi(app, await adminToken(), { name: "Whatever" });

      const res = await app.fetch(
        jsonRequest(`/api/admin/categories/${category.id}/move`, "POST", null, { parentId: null }),
        testEnv(),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("DELETE /api/admin/categories/:id", () => {
    it("deletes an empty leaf category", async () => {
      const app = createApp();
      const token = await adminToken();
      const category = await createCategoryViaApi(app, token, { name: "Deletable" });

      const res = await app.fetch(
        jsonRequest(`/api/admin/categories/${category.id}`, "DELETE", token),
        testEnv(),
      );
      expect(res.status).toBe(200);

      const row = await db().prepare("SELECT id FROM categories WHERE id = ?").bind(category.id).first();
      expect(row).toBeNull();
    });

    it("rejects deleting a non-empty category with CATEGORY_NOT_EMPTY", async () => {
      const app = createApp();
      const token = await adminToken();
      const parent = await createCategoryViaApi(app, token, { name: "Has Child" });
      await createCategoryViaApi(app, token, { parentId: parent.id, name: "Child" });

      const res = await app.fetch(
        jsonRequest(`/api/admin/categories/${parent.id}`, "DELETE", token),
        testEnv(),
      );
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("CATEGORY_NOT_EMPTY");
    });

    it("rejects an unauthenticated call and does not delete", async () => {
      const app = createApp();
      const category = await createCategoryViaApi(app, await adminToken(), { name: "Protected" });

      const res = await app.fetch(
        jsonRequest(`/api/admin/categories/${category.id}`, "DELETE", null),
        testEnv(),
      );
      expect(res.status).toBe(401);

      const row = await db().prepare("SELECT id FROM categories WHERE id = ?").bind(category.id).first();
      expect(row).not.toBeNull();
    });
  });

  describe("no agent-reachable category mutation", () => {
    it("has no POST/PATCH/DELETE category route under /api/agent", async () => {
      const app = createApp();
      const token = await adminToken();

      for (const req of [
        jsonRequest("/api/agent/categories", "POST", token, { name: "Hijack" }),
        jsonRequest("/api/agent/categories/anything", "PATCH", token, { name: "Hijack" }),
        jsonRequest("/api/agent/categories/anything", "DELETE", token),
      ]) {
        const res = await app.fetch(req, testEnv());
        // Whatever the agent router does with these paths, it must not be
        // a successful mutation — either 404 (unclaimed route) or a
        // rejection, never `ok: true`.
        if (res.status < 300) {
          const body = (await res.json()) as { ok: boolean };
          expect(body.ok).toBe(false);
        }
      }

      const categoryCount = await db().prepare("SELECT COUNT(*) AS c FROM categories").first<{ c: number }>();
      const seededCount = 4; // migration 0002
      expect(categoryCount?.c).toBe(seededCount);
    });
  });

  describe("keeps the route thin", () => {
    it("has no SQL and no direct storage access in the route file", async () => {
      // @ts-expect-error - Vite ?raw import has no shipped ambient type
      const raw = (await import("../../src/api/routes/admin/categories.ts?raw")).default as string;
      const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

      expect(source).not.toMatch(/\.prepare\s*\(/);
      expect(source).not.toMatch(/\.batch\s*\(/);
      expect(source).not.toMatch(/env\.DB\s*\./);
      expect(source).not.toMatch(/\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i);
    });
  });
});
