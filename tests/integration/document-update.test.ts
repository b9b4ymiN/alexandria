// Node G3.1 — Update Document & Version History, exercised through the
// real Hono app with REAL bindings (createApp().fetch(request, env)),
// matching the pattern established by tests/integration/api-documents.test.ts
// and tests/integration/document-metadata.test.ts, plus direct domain-level
// tests for compensation, matching tests/integration/write-compensation.test.ts.
//
// Orchestrator clarification (IMPLEMENTATION_PLAN.md node G3.1): `UNCHANGED`
// is not an error on this route. ERROR_STATUS maps the code to 409 only
// because the union must list it (SPEC.md §24) — the route never throws it,
// it answers HTTP 200 through ok() with `{ unchanged: true }`. Every test
// below that exercises the unchanged path asserts status 200, not 409.
import { beforeEach, describe, expect, it } from "vitest";
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
import {
  appendVersion,
  listVersionHistory,
  updateDocumentVersion,
  type Storage,
} from "../../src/domain/versions/version-service";
import { buildR2Key } from "../../src/domain/versions/r2-keys";
import { sha256Hex } from "../../src/domain/versions/hash";
import { AppError } from "../../src/shared/errors";

const SIGNING_SECRET = "document-update-test-signing-secret";
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

function htmlFile(name: string, content: string): File {
  return new File([content], name, { type: "text/html" });
}

function updateRequest(
  slug: string,
  token: string | null,
  fields: { file?: File; note?: string },
  contentTypeOverride?: string,
): Request {
  const form = new FormData();
  if (fields.file) form.set("file", fields.file);
  if (fields.note !== undefined) form.set("note", fields.note);

  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (contentTypeOverride !== undefined) headers["content-type"] = contentTypeOverride;

  return new Request(`https://app.test/api/admin/documents/${slug}/versions`, {
    method: "POST",
    headers,
    body: contentTypeOverride === undefined ? form : "not-a-form",
  });
}

function historyRequest(slug: string, token: string | null): Request {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request(`https://app.test/api/admin/documents/${slug}/versions`, { headers });
}

async function seedCategory(database: D1Database, id = "cat-update"): Promise<string> {
  const now = "2026-08-30T00:00:00.000Z";
  await database
    .prepare(
      "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES (?, NULL, 'Update Test', ?, 0, ?, ?)",
    )
    .bind(id, `slug-${id}`, now, now)
    .run();
  return id;
}

/**
 * Wraps a live binding so ONE named method fails while every other method
 * still runs for real. Copied from tests/integration/write-compensation.test.ts
 * so the injected-D1-failure test below matches the established pattern.
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

function dbWithFailingBatch(base: D1Database): D1Database {
  return failingMethod(base, "batch", "injected D1 batch failure");
}

describe("Admin API — update document & version history (G3.1)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  describe("HTTP route — update creates a new version", () => {
    it("creates version 2, moves the current pointer, and keeps the public URL and slug", async () => {
      const categoryId = await seedCategory(db());
      const app = createApp();
      const token = await adminToken();

      const createRes = await app.fetch(
        new Request("https://app.test/api/admin/documents", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: (() => {
            const form = new FormData();
            form.set("file", htmlFile("one.html", SIMPLE_HTML));
            form.set("categoryId", categoryId);
            return form;
          })(),
        }),
        testEnv(),
      );
      const created = (await createRes.json()) as { data: { slug: string; url: string; versionNo: number } };
      expect(created.data.versionNo).toBe(1);

      const updateRes = await app.fetch(
        updateRequest(created.data.slug, token, {
          file: htmlFile("one.html", SIMPLE_HTML.replace("Body.", "Revised body.")),
          note: "First revision",
        }),
        testEnv(),
      );

      expect(updateRes.status).toBe(201);
      const updated = (await updateRes.json()) as {
        data: { versionId: string; versionNo: number; unchanged: boolean; url: string };
      };
      expect(updated.data.unchanged).toBe(false);
      expect(updated.data.versionNo).toBe(2);
      expect(updated.data.url).toBe(created.data.url);

      const documentRow = await db()
        .prepare("SELECT slug, current_version_id AS currentVersionId FROM documents WHERE slug = ?")
        .bind(created.data.slug)
        .first<{ slug: string; currentVersionId: string }>();
      expect(documentRow?.slug).toBe(created.data.slug);
      expect(documentRow?.currentVersionId).toBe(updated.data.versionId);
    });

    it("stores and returns the note on the created version", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const app = createApp();
      const res = await app.fetch(
        updateRequest(created.slug, await adminToken(), {
          file: htmlFile("one.html", SIMPLE_HTML.replace("Body.", "Noted revision.")),
          note: "Fixed a typo",
        }),
        testEnv(),
      );
      const body = (await res.json()) as { data: { versionId: string } };

      const row = await db()
        .prepare("SELECT note FROM document_versions WHERE id = ?")
        .bind(body.data.versionId)
        .first<{ note: string }>();
      expect(row?.note).toBe("Fixed a typo");
    });

    it("lists history with both versions ordered newest first and the current flag correct", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const app = createApp();
      const token = await adminToken();
      await app.fetch(
        updateRequest(created.slug, token, {
          file: htmlFile("one.html", SIMPLE_HTML.replace("Body.", "Second body.")),
        }),
        testEnv(),
      );

      const res = await app.fetch(historyRequest(created.slug, token), testEnv());
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: {
          versions: Array<{
            versionNo: number;
            versionId: string;
            isCurrent: boolean;
            restoredFromVersionNo: number | null;
          }>;
        };
      };
      expect(body.data.versions.map((v) => v.versionNo)).toEqual([2, 1]);
      expect(body.data.versions[0]?.isCurrent).toBe(true);
      expect(body.data.versions[1]?.isCurrent).toBe(false);
      expect(body.data.versions[0]?.restoredFromVersionNo).toBeNull();
    });

    it("never includes HTML body content in the history payload", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const app = createApp();
      const text = await (
        await app.fetch(historyRequest(created.slug, await adminToken()), testEnv())
      ).text();
      expect(text).not.toContain("<body");
      expect(text).not.toContain("<!doctype");
    });
  });

  describe("HTTP route — UNCHANGED is a successful no-op, not an error", () => {
    it("returns HTTP 200 with unchanged: true through ok(), never 409 through fail()", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const app = createApp();
      const res = await app.fetch(
        updateRequest(created.slug, await adminToken(), { file: htmlFile("one.html", SIMPLE_HTML) }),
        testEnv(),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        data: { unchanged: boolean; versionId: string; versionNo: number };
      };
      expect(body.ok).toBe(true);
      expect(body.data.unchanged).toBe(true);
      expect(body.data.versionId).toBe(created.versionId);
      expect(body.data.versionNo).toBe(1);
    });

    it("writes nothing anywhere for identical bytes, asserted against both D1 and R2", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const versionCountBefore = await db()
        .prepare("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?")
        .bind(created.documentId)
        .first<{ c: number }>();
      const documentRowBefore = await db()
        .prepare("SELECT updated_at AS updatedAt FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ updatedAt: string }>();
      const objectCountBefore = (await store.docs.list()).objects.length;

      const app = createApp();
      await app.fetch(
        updateRequest(created.slug, await adminToken(), { file: htmlFile("one.html", SIMPLE_HTML) }),
        testEnv(),
      );

      const versionCountAfter = await db()
        .prepare("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?")
        .bind(created.documentId)
        .first<{ c: number }>();
      const documentRowAfter = await db()
        .prepare("SELECT updated_at AS updatedAt FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ updatedAt: string }>();
      const objectCountAfter = (await store.docs.list()).objects.length;

      expect(versionCountAfter?.c).toBe(versionCountBefore?.c);
      expect(documentRowAfter?.updatedAt).toBe(documentRowBefore?.updatedAt);
      expect(objectCountAfter).toBe(objectCountBefore);
    });
  });

  describe("HTTP route — negative cases", () => {
    it("rejects an unauthenticated update", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const app = createApp();
      const res = await app.fetch(
        updateRequest(created.slug, null, { file: htmlFile("one.html", SIMPLE_HTML.replace("Body.", "X.")) }),
        testEnv(),
      );
      expect(res.status).toBe(401);

      const count = await db()
        .prepare("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?")
        .bind(created.documentId)
        .first<{ c: number }>();
      expect(count?.c).toBe(1);
    });

    it("rejects an unknown slug with DOCUMENT_NOT_FOUND", async () => {
      await seedCategory(db());
      const app = createApp();
      const res = await app.fetch(
        updateRequest("no-such-document", await adminToken(), {
          file: htmlFile("one.html", SIMPLE_HTML),
        }),
        testEnv(),
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("DOCUMENT_NOT_FOUND");
    });

    it("rejects an invalid file through the same validation chain as create, leaving the current version untouched", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const app = createApp();
      const res = await app.fetch(
        updateRequest(created.slug, await adminToken(), { file: htmlFile("bad.txt", "not html at all") }),
        testEnv(),
      );
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("INVALID_FILE_EXTENSION");

      const documentRow = await db()
        .prepare("SELECT current_version_id AS currentVersionId FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ currentVersionId: string }>();
      expect(documentRow?.currentVersionId).toBe(created.versionId);
    });

    it("rejects a note longer than 500 characters with a validation error", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const app = createApp();
      const res = await app.fetch(
        updateRequest(created.slug, await adminToken(), {
          file: htmlFile("one.html", SIMPLE_HTML.replace("Body.", "Noted.")),
          note: "x".repeat(501),
        }),
        testEnv(),
      );
      expect(res.status).toBeGreaterThanOrEqual(400);

      const count = await db()
        .prepare("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?")
        .bind(created.documentId)
        .first<{ c: number }>();
      expect(count?.c).toBe(1);
    });

    it("history endpoint rejects an unknown slug and an unauthenticated request", async () => {
      await seedCategory(db());
      const app = createApp();

      const anonymous = await app.fetch(historyRequest("whatever", null), testEnv());
      expect(anonymous.status).toBe(401);

      const unknown = await app.fetch(historyRequest("no-such-document", await adminToken()), testEnv());
      expect(unknown.status).toBe(404);
    });
  });

  describe("keeps the route thin", () => {
    it("has no SQL and no direct storage access in the route file", async () => {
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

  describe("domain service — update orchestration", () => {
    it("creates a new version when bytes match version 1 but version 3 is current", async () => {
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
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Second body.")),
        createdBy: "admin",
      });
      const third = await appendVersion(store, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Third body.")),
        createdBy: "admin",
      });
      expect(third.versionNo).toBe(3);

      // Re-upload version 1's exact bytes while version 3 is current.
      const result = await updateDocumentVersion(store, {
        slug: created.slug,
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        createdBy: "admin",
      });

      expect(result.unchanged).toBe(false);
      expect(result.versionNo).toBe(4);

      const documentRow = await store.db
        .prepare("SELECT current_version_id AS currentVersionId FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ currentVersionId: string }>();
      expect(documentRow?.currentVersionId).toBe(result.versionId);
    });

    it("records created_by per version when an agent's current version is updated by admin", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "agent",
      });

      const updated = await updateDocumentVersion(store, {
        slug: created.slug,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Admin revision.")),
        filename: "one.html",
        createdBy: "admin",
      });

      const rows = await store.db
        .prepare("SELECT version_no AS versionNo, created_by AS createdBy FROM document_versions WHERE document_id = ? ORDER BY version_no")
        .bind(created.documentId)
        .all<{ versionNo: number; createdBy: string }>();
      expect(rows.results).toEqual([
        { versionNo: 1, createdBy: "agent" },
        { versionNo: 2, createdBy: "admin" },
      ]);
      expect(updated.versionNo).toBe(2);
    });

    it("two concurrent updates produce distinct version numbers, no number reused, one ends up current", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const [a, b] = await Promise.all([
        updateDocumentVersion(store, {
          slug: created.slug,
          bytes: toBytes(SIMPLE_HTML.replace("Body.", "Concurrent A.")),
          filename: "one.html",
          createdBy: "admin",
        }),
        updateDocumentVersion(store, {
          slug: created.slug,
          bytes: toBytes(SIMPLE_HTML.replace("Body.", "Concurrent B.")),
          filename: "one.html",
          createdBy: "admin",
        }),
      ]);

      expect(new Set([a.versionNo, b.versionNo]).size).toBe(2);
      const numbers = await store.db
        .prepare("SELECT version_no FROM document_versions WHERE document_id = ? ORDER BY version_no")
        .bind(created.documentId)
        .all<{ version_no: number }>();
      expect(numbers.results.map((r) => r.version_no)).toEqual([1, 2, 3]);

      const documentRow = await store.db
        .prepare("SELECT current_version_id AS currentVersionId FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ currentVersionId: string }>();
      expect([a.versionId, b.versionId]).toContain(documentRow?.currentVersionId);
    });
  });

  describe("domain service — injected D1 failure", () => {
    it("leaves the old version current and removes the new R2 object when the D1 batch fails", async () => {
      const real = storage();
      const categoryId = await seedCategory(real.db);
      const created = await createDocument(real, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const failingStore: Storage = { db: dbWithFailingBatch(real.db), docs: real.docs };

      await expect(
        updateDocumentVersion(failingStore, {
          slug: created.slug,
          bytes: toBytes(SIMPLE_HTML.replace("Body.", "Will fail.")),
          filename: "one.html",
          createdBy: "admin",
        }),
      ).rejects.toMatchObject({ code: "DATABASE_ERROR" });

      const documentRow = await real.db
        .prepare("SELECT current_version_id AS currentVersionId FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ currentVersionId: string }>();
      expect(documentRow?.currentVersionId).toBe(created.versionId);

      const versionCount = await real.db
        .prepare("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?")
        .bind(created.documentId)
        .first<{ c: number }>();
      expect(versionCount?.c).toBe(1);

      // Compensation removed the orphaned object; only version 1's object
      // remains.
      const objects = await real.docs.list();
      expect(objects.objects.length).toBe(1);
      expect(objects.objects[0]?.key).toBe(buildR2Key(created.documentId, created.versionId));
    });
  });

  describe("regression — immutability across repeated updates", () => {
    it("keeps version 1's R2 object byte-identical and never reuses an R2 key across 20 sequential updates", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const v1Key = buildR2Key(created.documentId, created.versionId);
      const v1ObjectBefore = await store.docs.get(v1Key);
      const v1HashBefore = await sha256Hex(await v1ObjectBefore!.arrayBuffer());

      const keys = new Set<string>([v1Key]);
      for (let i = 0; i < 20; i += 1) {
        const result = await updateDocumentVersion(store, {
          slug: created.slug,
          bytes: toBytes(SIMPLE_HTML.replace("Body.", `Revision ${i}.`)),
          filename: "one.html",
          createdBy: "admin",
        });
        const key = buildR2Key(created.documentId, result.versionId);
        expect(keys.has(key)).toBe(false);
        keys.add(key);
      }

      expect(keys.size).toBe(21);

      const v1ObjectAfter = await store.docs.get(v1Key);
      const v1HashAfter = await sha256Hex(await v1ObjectAfter!.arrayBuffer());
      expect(v1HashAfter).toBe(v1HashBefore);
    });
  });

  describe("listVersionHistory — direct domain checks", () => {
    it("raises DOCUMENT_NOT_FOUND for an unknown slug", async () => {
      await expect(listVersionHistory(db(), "does-not-exist")).rejects.toBeInstanceOf(AppError);
      await expect(listVersionHistory(db(), "does-not-exist")).rejects.toMatchObject({
        code: "DOCUMENT_NOT_FOUND",
      });
    });
  });
});
