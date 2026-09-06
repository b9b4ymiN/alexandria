// Node G3.3 — Delete Document & R2 Cleanup.
//
// Exercised through the real Hono app with REAL bindings
// (createApp().fetch(request, env)), matching the pattern established by
// tests/integration/document-update.test.ts (G3.1) and
// tests/integration/version-delete.test.ts (G3.2). Those suites are frozen
// and untouched.
//
// SPEC.md §13: deletion is permanent. It is the only irreversible operation
// in Phase 1, so the contract is deliberately unforgiving — the caller must
// echo the slug back exactly, and a mismatch deletes nothing at all.
//
// Ordering is the mirror of create: D1 rows first, R2 objects second. An
// orphaned object is recoverable waste; metadata pointing at bytes that no
// longer exist is a document that reads as published and cannot be opened.
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
import { createDocument, deleteDocument } from "../../src/domain/documents/document-service";
import { appendVersion, type Storage } from "../../src/domain/versions/version-service";
import { AppError } from "../../src/shared/errors";

const SIGNING_SECRET = "document-delete-test-signing-secret";
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

async function seedCategory(database: D1Database, id = "cat-doc-delete"): Promise<string> {
  const now = "2026-08-30T00:00:00.000Z";
  await database
    .prepare(
      "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES (?, NULL, 'Document Delete Test', ?, 0, ?, ?)",
    )
    .bind(id, `slug-${id}`, now, now)
    .run();
  return id;
}

function deleteRequest(slug: string, body: unknown, token: string | null): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request(`https://app.test/api/admin/documents/${slug}`, {
    method: "DELETE",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * A bucket whose `delete` rejects for a named set of keys and behaves
 * normally for every other key, so a PARTIAL R2 failure can be observed —
 * the 3-of-12 shape node G3.3's Edge Cases call for. Every other method is
 * the live binding's.
 */
function bucketFailingDeleteFor(base: R2Bucket, failing: Set<string>): R2Bucket {
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "delete") {
        return (key: string) =>
          failing.has(key)
            ? Promise.reject(new Error(`injected R2 delete failure for ${key}`))
            : (target.delete(key) as Promise<void>);
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as R2Bucket;
}

async function versionKeys(documentId: string): Promise<string[]> {
  const rows = await db()
    .prepare("SELECT r2_key AS r2Key FROM document_versions WHERE document_id = ? ORDER BY version_no")
    .bind(documentId)
    .all<{ r2Key: string }>();
  return rows.results.map((row) => row.r2Key);
}

async function countRows(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await db()
    .prepare(sql)
    .bind(...binds)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

async function existingKeys(): Promise<string[]> {
  const listed = await storage().docs.list();
  return listed.objects.map((object) => object.key).sort();
}

/** Creates a document with `versions` total versions and the given tags. */
async function seedDocument(
  categoryId: string,
  options: { versions?: number; tags?: string[]; marker?: string } = {},
): Promise<{ documentId: string; slug: string }> {
  const store = storage();
  const marker = options.marker ?? "one";
  const created = await createDocument(store, {
    bytes: toBytes(SIMPLE_HTML.replace("Quarterly Review", `Quarterly Review ${marker}`)),
    filename: `${marker}.html`,
    categoryId,
    createdBy: "admin",
    overrides: options.tags === undefined ? undefined : { tags: options.tags },
  });

  for (let i = 2; i <= (options.versions ?? 1); i += 1) {
    await appendVersion(store, {
      documentId: created.documentId,
      bytes: toBytes(SIMPLE_HTML.replace("Body.", `Body ${marker} ${i}.`)),
      createdBy: "admin",
    });
  }

  return { documentId: created.documentId, slug: created.slug };
}

describe("Admin API — delete document (G3.3)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  describe("HTTP route — permitted deletion", () => {
    it("removes the document, every version row and every tag link, and reports accurate counts", async () => {
      const categoryId = await seedCategory(db());
      const { documentId, slug } = await seedDocument(categoryId, {
        versions: 3,
        tags: ["investing", "valuation"],
      });

      expect(await countRows("SELECT COUNT(*) AS c FROM document_tags WHERE document_id = ?", documentId)).toBe(2);

      const res = await createApp().fetch(
        deleteRequest(slug, { confirmSlug: slug }, await adminToken()),
        testEnv(),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        data: {
          deleted: boolean;
          documentId: string;
          versionsDeleted: number;
          r2ObjectsDeleted: number;
          r2ObjectsFailed: number;
        };
      };
      expect(body.ok).toBe(true);
      expect(body.data).toEqual({
        deleted: true,
        documentId,
        versionsDeleted: 3,
        r2ObjectsDeleted: 3,
        r2ObjectsFailed: 0,
      });

      // The D1 cascade is asserted, not assumed: the schema declares
      // ON DELETE CASCADE on both children, and these three counts prove it
      // actually fires in the Workers runtime.
      expect(await countRows("SELECT COUNT(*) AS c FROM documents WHERE id = ?", documentId)).toBe(0);
      expect(await countRows("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?", documentId)).toBe(0);
      expect(await countRows("SELECT COUNT(*) AS c FROM document_tags WHERE document_id = ?", documentId)).toBe(0);
    });

    it("removes every R2 object belonging to the document", async () => {
      const categoryId = await seedCategory(db());
      const { documentId, slug } = await seedDocument(categoryId, { versions: 4 });
      const keys = await versionKeys(documentId);
      expect(keys).toHaveLength(4);
      expect(await existingKeys()).toEqual([...keys].sort());

      await createApp().fetch(deleteRequest(slug, { confirmSlug: slug }, await adminToken()), testEnv());

      expect(await existingKeys()).toEqual([]);
    });

    it("removes all twelve versions and all twelve objects of a heavily revised document", async () => {
      const categoryId = await seedCategory(db());
      const { documentId, slug } = await seedDocument(categoryId, { versions: 12 });
      expect(await versionKeys(documentId)).toHaveLength(12);

      const res = await createApp().fetch(
        deleteRequest(slug, { confirmSlug: slug }, await adminToken()),
        testEnv(),
      );
      const body = (await res.json()) as { data: { versionsDeleted: number; r2ObjectsDeleted: number } };

      expect(body.data.versionsDeleted).toBe(12);
      expect(body.data.r2ObjectsDeleted).toBe(12);
      expect(await existingKeys()).toEqual([]);
    });

    it("succeeds and reports no failures when the R2 objects are already gone", async () => {
      const categoryId = await seedCategory(db());
      const { documentId, slug } = await seedDocument(categoryId, { versions: 3 });
      for (const key of await versionKeys(documentId)) {
        await storage().docs.delete(key);
      }

      const res = await createApp().fetch(
        deleteRequest(slug, { confirmSlug: slug }, await adminToken()),
        testEnv(),
      );
      const body = (await res.json()) as {
        data: { versionsDeleted: number; r2ObjectsDeleted: number; r2ObjectsFailed: number };
      };

      expect(res.status).toBe(200);
      // R2's delete is idempotent, so nothing actually failed here. Counting
      // an already-absent object as a failure would be the dishonest answer.
      expect(body.data).toMatchObject({ versionsDeleted: 3, r2ObjectsDeleted: 3, r2ObjectsFailed: 0 });
      expect(await countRows("SELECT COUNT(*) AS c FROM documents WHERE id = ?", documentId)).toBe(0);
    });
  });

  describe("HTTP route — confirmation is mandatory", () => {
    it("deletes nothing when confirmSlug does not match the target slug", async () => {
      const categoryId = await seedCategory(db());
      const { documentId, slug } = await seedDocument(categoryId, { versions: 2 });

      const res = await createApp().fetch(
        deleteRequest(slug, { confirmSlug: `${slug}-not-quite` }, await adminToken()),
        testEnv(),
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("CONFIRMATION_MISMATCH");

      expect(await countRows("SELECT COUNT(*) AS c FROM documents WHERE id = ?", documentId)).toBe(1);
      expect(await countRows("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?", documentId)).toBe(2);
      expect(await existingKeys()).toHaveLength(2);
    });

    it("deletes nothing when confirmSlug is missing entirely", async () => {
      const categoryId = await seedCategory(db());
      const { documentId, slug } = await seedDocument(categoryId, { versions: 2 });

      const res = await createApp().fetch(deleteRequest(slug, {}, await adminToken()), testEnv());

      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("CONFIRMATION_MISMATCH");
      expect(await countRows("SELECT COUNT(*) AS c FROM documents WHERE id = ?", documentId)).toBe(1);
      expect(await existingKeys()).toHaveLength(2);
    });
  });

  describe("HTTP route — negative cases", () => {
    it("rejects an unknown slug with DOCUMENT_NOT_FOUND", async () => {
      await seedCategory(db());

      const res = await createApp().fetch(
        deleteRequest("does-not-exist", { confirmSlug: "does-not-exist" }, await adminToken()),
        testEnv(),
      );

      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("DOCUMENT_NOT_FOUND");
    });

    it("rejects an unauthenticated delete and leaves everything in place", async () => {
      const categoryId = await seedCategory(db());
      const { documentId, slug } = await seedDocument(categoryId, { versions: 2 });

      const res = await createApp().fetch(deleteRequest(slug, { confirmSlug: slug }, null), testEnv());

      expect(res.status).toBe(401);
      expect(await countRows("SELECT COUNT(*) AS c FROM documents WHERE id = ?", documentId)).toBe(1);
      expect(await countRows("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?", documentId)).toBe(2);
      expect(await existingKeys()).toHaveLength(2);
    });

    it("returns DOCUMENT_NOT_FOUND rather than failing loudly on a concurrent second delete", async () => {
      const categoryId = await seedCategory(db());
      const { slug } = await seedDocument(categoryId, { versions: 2 });
      const token = await adminToken();
      const app = createApp();

      const [first, second] = await Promise.all([
        app.fetch(deleteRequest(slug, { confirmSlug: slug }, token), testEnv()),
        app.fetch(deleteRequest(slug, { confirmSlug: slug }, token), testEnv()),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 404]);
      const loser = first.status === 404 ? first : second;
      expect(((await loser.json()) as { error: { code: string } }).error.code).toBe("DOCUMENT_NOT_FOUND");
    });
  });

  describe("R2 cleanup — best-effort, metadata authoritative", () => {
    it("still removes the metadata, counts the failures honestly and logs every failed key when 3 of 12 objects fail", async () => {
      const categoryId = await seedCategory(db());
      const { documentId, slug } = await seedDocument(categoryId, { versions: 12 });
      const keys = await versionKeys(documentId);
      const doomed = new Set([keys[2] as string, keys[5] as string, keys[9] as string]);

      const store = storage();
      const failingStore: Storage = { db: store.db, docs: bucketFailingDeleteFor(store.docs, doomed) };

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await deleteDocument(failingStore, { slug, confirmSlug: slug });

        expect(result).toEqual({
          deleted: true,
          documentId,
          versionsDeleted: 12,
          r2ObjectsDeleted: 9,
          r2ObjectsFailed: 3,
        });

        // One structured line, carrying the document id and every key that
        // survived, so the orphans can be reconciled later.
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const logged = JSON.parse(String(errorSpy.mock.calls[0]?.[0])) as {
          event: string;
          documentId: string;
          failedKeys: string[];
        };
        expect(logged.event).toBe("r2_document_delete_failed");
        expect(logged.documentId).toBe(documentId);
        expect([...logged.failedKeys].sort()).toEqual([...doomed].sort());
      } finally {
        errorSpy.mockRestore();
      }

      // Metadata is authoritative: it is gone regardless of R2's outcome.
      expect(await countRows("SELECT COUNT(*) AS c FROM documents WHERE id = ?", documentId)).toBe(0);
      expect(await countRows("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?", documentId)).toBe(0);
      expect(await existingKeys()).toEqual([...doomed].sort());
    });

    it("logs nothing when every object is removed cleanly", async () => {
      const categoryId = await seedCategory(db());
      const { slug } = await seedDocument(categoryId, { versions: 2 });

      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await deleteDocument(storage(), { slug, confirmSlug: slug });
        expect(errorSpy).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe("regression — deletion touches nothing it does not own", () => {
    it("leaves the category in place, empty, and leaves tags alive with a zero count", async () => {
      const categoryId = await seedCategory(db());
      const { slug } = await seedDocument(categoryId, { versions: 1, tags: ["solo-tag"] });

      await createApp().fetch(deleteRequest(slug, { confirmSlug: slug }, await adminToken()), testEnv());

      expect(await countRows("SELECT COUNT(*) AS c FROM categories WHERE id = ?", categoryId)).toBe(1);
      expect(await countRows("SELECT COUNT(*) AS c FROM documents WHERE category_id = ?", categoryId)).toBe(0);
      // A tag is independent of any single document (SPEC.md §7) — it
      // survives its last document with a count of zero rather than being
      // garbage-collected behind the operator's back.
      expect(await countRows("SELECT COUNT(*) AS c FROM tags WHERE normalized_name = ?", "solo-tag")).toBe(1);
      expect(
        await countRows(
          "SELECT COUNT(*) AS c FROM document_tags dt JOIN tags t ON t.id = dt.tag_id WHERE t.normalized_name = ?",
          "solo-tag",
        ),
      ).toBe(0);
    });

    it("leaves another document's rows, tag links and objects untouched", async () => {
      const categoryId = await seedCategory(db());
      const victim = await seedDocument(categoryId, { versions: 2, tags: ["shared"], marker: "victim" });
      const survivor = await seedDocument(categoryId, { versions: 3, tags: ["shared"], marker: "survivor" });
      const survivorKeys = await versionKeys(survivor.documentId);

      await createApp().fetch(
        deleteRequest(victim.slug, { confirmSlug: victim.slug }, await adminToken()),
        testEnv(),
      );

      expect(await countRows("SELECT COUNT(*) AS c FROM documents WHERE id = ?", survivor.documentId)).toBe(1);
      expect(
        await countRows("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?", survivor.documentId),
      ).toBe(3);
      expect(
        await countRows("SELECT COUNT(*) AS c FROM document_tags WHERE document_id = ?", survivor.documentId),
      ).toBe(1);
      expect(await existingKeys()).toEqual([...survivorKeys].sort());
    });
  });

  describe("permission boundary — deletion is admin-only, forever", () => {
    it("exposes no document-delete route under /api/agent", async () => {
      const categoryId = await seedCategory(db());
      const { slug } = await seedDocument(categoryId);
      const app = createApp();

      for (const path of [
        `/api/agent/documents/${slug}`,
        `/api/agent/documents/${slug}/delete`,
      ]) {
        const res = await app.fetch(
          new Request(`https://app.test${path}`, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ confirmSlug: slug }),
          }),
          testEnv(),
        );
        expect(res.status).toBe(404);
      }
    });

    it("no agent-owned route file registers a delete handler or calls deleteDocument", async () => {
      const files = await Promise.all([
        // @ts-expect-error - Vite ?raw import has no shipped ambient type
        import("../../src/api/routes/agent/index.ts?raw"),
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
        expect(source).not.toMatch(/\.delete\s*\(/);
        expect(source).not.toContain("deleteDocument");
      }
    });
  });

  describe("keeps the route thin", () => {
    it("has no SQL and no direct storage access in the admin documents route file", async () => {
      // @ts-expect-error - Vite ?raw import has no shipped ambient type
      const raw = (await import("../../src/api/routes/admin/documents.ts?raw")).default as string;
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
        deleteDocument(storage(), { slug: "nope", confirmSlug: "nope" }),
      ).rejects.toBeInstanceOf(AppError);
      await expect(
        deleteDocument(storage(), { slug: "nope", confirmSlug: "nope" }),
      ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    });

    it("refuses a mismatched confirmation before it reads anything", async () => {
      const categoryId = await seedCategory(db());
      const { documentId, slug } = await seedDocument(categoryId, { versions: 2 });

      await expect(
        deleteDocument(storage(), { slug, confirmSlug: "" }),
      ).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });

      expect(await countRows("SELECT COUNT(*) AS c FROM documents WHERE id = ?", documentId)).toBe(1);
    });
  });
});
