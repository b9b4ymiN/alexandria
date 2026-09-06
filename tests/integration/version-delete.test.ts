// Node G3.2 — Restore & Version Delete Guards (delete half).
//
// Exercised through the real Hono app with REAL bindings
// (createApp().fetch(request, env)), matching the pattern established by
// tests/integration/document-update.test.ts (G3.1) and the R2-failure
// injection technique from tests/integration/write-compensation.test.ts.
// G3.1's own suite is frozen and untouched.
//
// SPEC.md §13 Delete Rules:
//   cannot delete the current version
//   cannot delete the only remaining version
// Guard precedence is fixed: LAST_VERSION_CANNOT_DELETE is checked BEFORE
// VERSION_IS_CURRENT, so a single-version document — which is always both
// the last and the current version — reports the more specific code (node
// G3.2, requirement 5). Version numbers are never renumbered after a
// deletion; gaps are expected and correct.
import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error - "cloudflare:test" has no ambient type outside the
// package's optional "./types" subpath, which is out of this node's scope
import { env as workersEnv, reset } from "cloudflare:test";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0001 from "../../migrations/0001_init.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0002 from "../../migrations/0002_seed_categories.sql?raw";

import { createApp } from "../../src/api/app";
import { signToken } from "../../src/shared/token";
import type { Env } from "../../src/shared/types";
import { createDocument } from "../../src/domain/documents/document-service";
import { appendVersion, deleteVersion, type Storage } from "../../src/domain/versions/version-service";
import { buildR2Key } from "../../src/domain/versions/r2-keys";
import { AppError } from "../../src/shared/errors";

const SIGNING_SECRET = "version-delete-test-signing-secret";
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

function storage(): Storage {
  const typed = workersEnv as unknown as { DB: D1Database; DOCS: R2Bucket };
  return { db: typed.DB, docs: typed.DOCS };
}

function db(): D1Database {
  return storage().db;
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

const SIMPLE_HTML = `<!doctype html>
<html><head><title>Quarterly Review</title>
<meta name="description" content="A review of the quarter just gone.">
</head><body><h1>Quarterly Review</h1><p>Body.</p></body></html>`;

async function seedCategory(database: D1Database, id = "cat-delete"): Promise<string> {
  const now = "2026-08-30T00:00:00.000Z";
  await database
    .prepare(
      "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES (?, NULL, 'Delete Test', ?, 0, ?, ?)",
    )
    .bind(id, `slug-${id}`, now, now)
    .run();
  return id;
}

function deleteRequest(slug: string, versionNo: number | string, token: string | null): Request {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request(`https://app.test/api/admin/documents/${slug}/versions/${versionNo}`, {
    method: "DELETE",
    headers,
  });
}

/**
 * Wraps a live binding so ONE named method fails while every other method
 * still runs for real. Copied from tests/integration/write-compensation.test.ts
 * so the injected-R2-failure test below matches the established pattern.
 */
function failingMethod<T extends object>(base: T, method: string, message: string): T {
  return new Proxy(base, {
    get(target, prop) {
      if (prop === method) {
        return () => Promise.reject(new Error(message));
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as T;
}

function bucketWithFailingDelete(base: R2Bucket): R2Bucket {
  return failingMethod(base, "delete", "injected R2 delete failure");
}

async function documentRow(documentId: string): Promise<{ currentVersionId: string } | null> {
  return db()
    .prepare("SELECT current_version_id AS currentVersionId FROM documents WHERE id = ?")
    .bind(documentId)
    .first<{ currentVersionId: string }>();
}

async function remainingVersionNumbers(documentId: string): Promise<number[]> {
  const rows = await db()
    .prepare("SELECT version_no FROM document_versions WHERE document_id = ? ORDER BY version_no")
    .bind(documentId)
    .all<{ version_no: number }>();
  return rows.results.map((row) => row.version_no);
}

describe("Admin API — delete version (G3.2)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  describe("HTTP route — permitted deletion", () => {
    it("deletes a non-current, non-last version and leaves a numbering gap", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });
      for (let i = 2; i <= 5; i += 1) {
        await appendVersion(store, {
          documentId: created.documentId,
          bytes: toBytes(SIMPLE_HTML.replace("Body.", `Body ${i}.`)),
          createdBy: "admin",
        });
      }
      expect(await remainingVersionNumbers(created.documentId)).toEqual([1, 2, 3, 4, 5]);

      const app = createApp();
      const res = await app.fetch(deleteRequest(created.slug, 2, await adminToken()), testEnv());

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { deletedVersionNo: number } };
      expect(body.data.deletedVersionNo).toBe(2);

      // Gap at 2, never renumbered.
      expect(await remainingVersionNumbers(created.documentId)).toEqual([1, 3, 4, 5]);

      // The current pointer (v5) is untouched.
      const row = await documentRow(created.documentId);
      const currentRow = await db()
        .prepare("SELECT version_no AS versionNo FROM document_versions WHERE id = ?")
        .bind(row?.currentVersionId)
        .first<{ versionNo: number }>();
      expect(currentRow?.versionNo).toBe(5);
    });

    it("removes the R2 object for a permitted delete", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });
      const second = await appendVersion(store, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Body 2.")),
        createdBy: "admin",
      });
      await appendVersion(store, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Body 3.")),
        createdBy: "admin",
      });

      const key = buildR2Key(created.documentId, second.versionId);
      expect(await store.docs.head(key)).not.toBeNull();

      await deleteVersion(store, { slug: created.slug, versionNo: 2 });

      expect(await store.docs.head(key)).toBeNull();
    });
  });

  describe("HTTP route — negative cases", () => {
    it("rejects deleting the current version with VERSION_IS_CURRENT", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });
      await appendVersion(store, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Body 2.")),
        createdBy: "admin",
      });

      const app = createApp();
      const res = await app.fetch(deleteRequest(created.slug, 2, await adminToken()), testEnv());
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("VERSION_IS_CURRENT");

      expect(await remainingVersionNumbers(created.documentId)).toEqual([1, 2]);
    });

    it("rejects deleting the only remaining version with LAST_VERSION_CANNOT_DELETE", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const app = createApp();
      const res = await app.fetch(deleteRequest(created.slug, 1, await adminToken()), testEnv());
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("LAST_VERSION_CANNOT_DELETE");
    });

    it("reports LAST_VERSION_CANNOT_DELETE (not VERSION_IS_CURRENT) when both guards apply on a single-version document", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      // The one version present is simultaneously the current version and
      // the last version — precedence must resolve to the more specific
      // last-version code.
      await expect(deleteVersion(store, { slug: created.slug, versionNo: 1 })).rejects.toMatchObject({
        code: "LAST_VERSION_CANNOT_DELETE",
      });
    });

    it("rejects an unknown version number with VERSION_NOT_FOUND", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });
      await appendVersion(store, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Body 2.")),
        createdBy: "admin",
      });

      const app = createApp();
      const res = await app.fetch(deleteRequest(created.slug, 999, await adminToken()), testEnv());
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("VERSION_NOT_FOUND");
    });

    it("rejects an unauthenticated delete", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });
      await appendVersion(store, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Body 2.")),
        createdBy: "admin",
      });

      const app = createApp();
      const res = await app.fetch(deleteRequest(created.slug, 1, null), testEnv());
      expect(res.status).toBe(401);

      expect(await remainingVersionNumbers(created.documentId)).toEqual([1, 2]);
    });
  });

  describe("R2 cleanup — best-effort, metadata authoritative", () => {
    it("succeeds and logs the orphan when the R2 object is already gone before delete", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });
      const second = await appendVersion(store, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Body 2.")),
        createdBy: "admin",
      });
      await appendVersion(store, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Body 3.")),
        createdBy: "admin",
      });

      // Simulate the R2 object having already vanished independently of
      // the delete path under test.
      const key = buildR2Key(created.documentId, second.versionId);
      await store.docs.delete(key);

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await deleteVersion(store, { slug: created.slug, versionNo: 2 });
        expect(result.deletedVersionNo).toBe(2);

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const logged = JSON.parse(String(errorSpy.mock.calls[0]?.[0])) as {
          event: string;
          documentId: string;
          versionId: string;
          r2Key: string;
        };
        expect(logged.event).toBe("r2_version_object_already_missing");
        expect(logged.documentId).toBe(created.documentId);
        expect(logged.versionId).toBe(second.versionId);
        expect(logged.r2Key).toBe(key);
      } finally {
        errorSpy.mockRestore();
      }

      // The D1 row is gone regardless of the R2 outcome.
      expect(await remainingVersionNumbers(created.documentId)).toEqual([1, 3]);
    });

    it("succeeds and logs the failure when the R2 delete call itself fails", async () => {
      const real = storage();
      const categoryId = await seedCategory(real.db);
      const created = await createDocument(real, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });
      const second = await appendVersion(real, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Body 2.")),
        createdBy: "admin",
      });
      await appendVersion(real, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Body 3.")),
        createdBy: "admin",
      });

      const failingStore: Storage = { db: real.db, docs: bucketWithFailingDelete(real.docs) };
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await deleteVersion(failingStore, { slug: created.slug, versionNo: 2 });
        expect(result.deletedVersionNo).toBe(2);

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const logged = JSON.parse(String(errorSpy.mock.calls[0]?.[0])) as {
          event: string;
          documentId: string;
          versionId: string;
          r2Key: string;
          cause: string;
        };
        expect(logged.event).toBe("r2_version_delete_failed");
        expect(logged.documentId).toBe(created.documentId);
        expect(logged.versionId).toBe(second.versionId);
      } finally {
        errorSpy.mockRestore();
      }

      // The D1 row is gone even though the R2 object could not be removed
      // — metadata is authoritative (node G3.2, requirement 6).
      expect(await remainingVersionNumbers(created.documentId)).toEqual([1, 3]);
    });
  });

  describe("route inventory — no agent route exposes version deletion", () => {
    it("returns 404 (no route) for every plausible agent version-delete path", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });
      await appendVersion(store, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Body 2.")),
        createdBy: "admin",
      });

      const app = createApp();
      const res = await app.fetch(
        new Request(`https://app.test/api/agent/documents/${created.slug}/versions/1`, {
          method: "DELETE",
        }),
        testEnv(),
      );
      expect(res.status).toBe(404);

      expect(await remainingVersionNumbers(created.documentId)).toEqual([1, 2]);
    });

    it("no agent-owned route file references a DELETE method or a delete-version handler", async () => {
      const strip = (raw: string) => raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const sources = await Promise.all([
        // @ts-expect-error - Vite ?raw import has no shipped ambient type
        import("../../src/api/routes/agent/index.ts?raw"),
        // @ts-expect-error - Vite ?raw import has no shipped ambient type
        import("../../src/api/routes/agent/documents.ts?raw"),
        // @ts-expect-error - Vite ?raw import has no shipped ambient type
        import("../../src/api/routes/agent/categories.ts?raw"),
        // @ts-expect-error - Vite ?raw import has no shipped ambient type
        import("../../src/api/routes/agent/tags.ts?raw"),
      ]);
      for (const module of sources) {
        const source = strip((module as { default: string }).default);
        expect(source).not.toMatch(/\.delete\s*\(/);
        expect(source).not.toMatch(/deleteVersion/);
      }
    });
  });

  describe("keeps the route handlers thin", () => {
    it("has no SQL and no direct storage access anywhere in the versions route file", async () => {
      // @ts-expect-error - Vite ?raw import has no shipped ambient type
      const raw = (await import("../../src/api/routes/admin/versions.ts?raw")).default as string;
      const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

      expect(source).not.toMatch(/\.prepare\s*\(/);
      expect(source).not.toMatch(/\.batch\s*\(/);
      expect(source).not.toMatch(/env\.DB\s*\./);
      expect(source).not.toMatch(/env\.DOCS\s*\./);
      expect(source).not.toMatch(/\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i);
    });
  });

  describe("domain service — direct checks", () => {
    it("raises DOCUMENT_NOT_FOUND for an unknown slug", async () => {
      await expect(
        deleteVersion(storage(), { slug: "does-not-exist", versionNo: 1 }),
      ).rejects.toBeInstanceOf(AppError);
      await expect(
        deleteVersion(storage(), { slug: "does-not-exist", versionNo: 1 }),
      ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    });
  });
});
