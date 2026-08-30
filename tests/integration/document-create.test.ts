// Node G1.5 — DocumentService.create, exercised against a real D1 database
// and a real R2 bucket inside the Workers runtime.
//
// Migrations are applied per test after cloudflare:test's reset(), matching
// the pattern established by tests/integration/schema.test.ts: the pool's
// storage is ephemeral and is not shared with `wrangler d1 migrations apply
// --local`, so the suite applies the real migration files itself.
import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error - "cloudflare:test" has no ambient type outside the
// package's optional "./types" subpath, which is out of this node's scope
import { env, reset } from "cloudflare:test";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0001 from "../../migrations/0001_init.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0002 from "../../migrations/0002_seed_categories.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import mauboussinFixture from "../../mauboussin-expectations-investing-summary.html?raw";

import { createDocument } from "../../src/domain/documents/document-service";
import { buildR2Key } from "../../src/domain/versions/r2-keys";
import { sha256Hex } from "../../src/domain/versions/hash";
import { appendVersion, type Storage } from "../../src/domain/versions/version-service";
import { AppError } from "../../src/shared/errors";

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

function storage(): Storage {
  const typed = env as unknown as { DB: D1Database; DOCS: R2Bucket };
  return { db: typed.DB, docs: typed.DOCS };
}

async function applyMigrations(db: D1Database): Promise<void> {
  for (const statement of [...splitStatements(migration0001), ...splitStatements(migration0002)]) {
    await db.prepare(statement).run();
  }
}

function toBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

const SIMPLE_HTML = `<!doctype html>
<html><head><title>Simple Report</title>
<meta name="description" content="A short description of the simple report.">
<meta name="keywords" content="Value Investing, ROIC, value  investing">
</head><body><h1>Simple Report</h1><p>Body text.</p></body></html>`;

async function seedCategory(db: D1Database, id = "cat-test"): Promise<string> {
  const now = "2026-08-30T00:00:00.000Z";
  await db
    .prepare(
      "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES (?, NULL, ?, ?, 0, ?, ?)",
    )
    .bind(id, `Name ${id}`, `slug-${id}`, now, now)
    .run();
  return id;
}

describe("DocumentService.create", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(storage().db);
  });

  describe("the acceptance fixture", () => {
    it("creates a document, version 1, a current pointer and the R2 object", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const bytes = toBytes(mauboussinFixture);

      const result = await createDocument(store, {
        bytes,
        filename: "mauboussin-expectations-investing-summary.html",
        categoryId,
        createdBy: "admin",
      });

      expect(result.versionNo).toBe(1);
      expect(result.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

      const document = await store.db
        .prepare("SELECT * FROM documents WHERE id = ?")
        .bind(result.documentId)
        .first<{ slug: string; title: string; current_version_id: string; category_id: string }>();
      expect(document?.current_version_id).toBe(result.versionId);
      expect(document?.category_id).toBe(categoryId);
      expect(document?.slug).toBe(result.slug);

      const object = await store.docs.get(buildR2Key(result.documentId, result.versionId));
      expect(object).not.toBeNull();
    });

    it("stores the bytes byte-identically (sha256 of the object equals the source)", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const bytes = toBytes(mauboussinFixture);
      const sourceHash = await sha256Hex(bytes);

      const result = await createDocument(store, {
        bytes,
        filename: "mauboussin-expectations-investing-summary.html",
        categoryId,
        createdBy: "admin",
      });

      const object = await store.docs.get(buildR2Key(result.documentId, result.versionId));
      const storedHash = await sha256Hex(await object!.arrayBuffer());
      expect(storedHash).toBe(sourceHash);

      const row = await store.db
        .prepare("SELECT sha256, size_bytes, created_by, r2_key FROM document_versions WHERE id = ?")
        .bind(result.versionId)
        .first<{ sha256: string; size_bytes: number; created_by: string; r2_key: string }>();
      expect(row?.sha256).toBe(sourceHash);
      expect(row?.size_bytes).toBe(bytes.byteLength);
      expect(row?.created_by).toBe("admin");
      expect(row?.r2_key).toBe(buildR2Key(result.documentId, result.versionId));
    });

    it("writes an R2 key matching documents/{uuid}/versions/{uuid}.html", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);

      const result = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "simple.html",
        categoryId,
        createdBy: "admin",
      });

      const row = await store.db
        .prepare("SELECT r2_key FROM document_versions WHERE id = ?")
        .bind(result.versionId)
        .first<{ r2_key: string }>();
      expect(row?.r2_key).toMatch(
        /^documents\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}\.html$/,
      );
    });
  });

  describe("metadata precedence", () => {
    it("uses extracted metadata when no override is supplied", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);

      const result = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "simple.html",
        categoryId,
        createdBy: "admin",
      });

      expect(result.title).toBe("Simple Report");
      expect(result.description).toBe("A short description of the simple report.");
    });

    it("lets an explicit override beat extraction", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);

      const result = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "simple.html",
        categoryId,
        createdBy: "admin",
        overrides: { title: "Chosen Title", description: "Chosen description." },
      });

      expect(result.title).toBe("Chosen Title");
      expect(result.description).toBe("Chosen description.");
    });

    it("honours an empty description override as an intentional empty description", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);

      const result = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "simple.html",
        categoryId,
        createdBy: "admin",
        overrides: { description: "" },
      });

      expect(result.description).toBe("");
    });

    it("treats an empty title override as absent and falls back to extraction", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);

      const result = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "simple.html",
        categoryId,
        createdBy: "admin",
        overrides: { title: "   " },
      });

      expect(result.title).toBe("Simple Report");
    });
  });

  describe("tags", () => {
    it("normalizes, de-duplicates and links tags from extracted keywords", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);

      const result = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "simple.html",
        categoryId,
        createdBy: "admin",
      });

      // "Value Investing" and "value  investing" collapse to one tag.
      expect(result.tags).toEqual(["value investing", "roic"]);

      const links = await store.db
        .prepare(
          `SELECT t.normalized_name AS n FROM document_tags dt
           JOIN tags t ON t.id = dt.tag_id WHERE dt.document_id = ? ORDER BY t.normalized_name`,
        )
        .bind(result.documentId)
        .all<{ n: string }>();
      expect(links.results.map((r) => r.n)).toEqual(["roic", "value investing"]);
    });

    it("reuses an existing tag rather than duplicating it across documents", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);

      await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
        overrides: { tags: ["Moat"] },
      });
      await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML.replace("Body text.", "Other body text here.")),
        filename: "two.html",
        categoryId,
        createdBy: "admin",
        overrides: { tags: ["  moat  "] },
      });

      const tags = await store.db
        .prepare("SELECT COUNT(*) AS c FROM tags WHERE normalized_name = 'moat'")
        .first<{ c: number }>();
      expect(tags?.c).toBe(1);
    });

    it("creates no links for an empty tag list", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);

      const result = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "simple.html",
        categoryId,
        createdBy: "admin",
        overrides: { tags: [] },
      });

      const links = await store.db
        .prepare("SELECT COUNT(*) AS c FROM document_tags WHERE document_id = ?")
        .bind(result.documentId)
        .first<{ c: number }>();
      expect(links?.c).toBe(0);
    });
  });

  describe("slug behaviour", () => {
    it("gives two documents with the same title slug and slug-2", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);

      const first = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "a.html",
        categoryId,
        createdBy: "admin",
      });
      const second = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML.replace("Body text.", "Different body text.")),
        filename: "b.html",
        categoryId,
        createdBy: "admin",
      });

      expect(first.slug).toBe("simple-report");
      expect(second.slug).toBe("simple-report-2");
    });
  });

  describe("category boundary", () => {
    it("raises CATEGORY_NOT_FOUND and writes nothing at all", async () => {
      const store = storage();
      await seedCategory(store.db);

      await expect(
        createDocument(store, {
          bytes: toBytes(SIMPLE_HTML),
          filename: "simple.html",
          categoryId: "does-not-exist",
          createdBy: "admin",
        }),
      ).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND" });

      const documents = await store.db.prepare("SELECT COUNT(*) AS c FROM documents").first<{ c: number }>();
      const versions = await store.db
        .prepare("SELECT COUNT(*) AS c FROM document_versions")
        .first<{ c: number }>();
      expect(documents?.c).toBe(0);
      expect(versions?.c).toBe(0);

      const objects = await store.docs.list();
      expect(objects.objects.length).toBe(0);
    });

    it("never creates a category on the caller's behalf", async () => {
      const store = storage();
      const before = await store.db.prepare("SELECT COUNT(*) AS c FROM categories").first<{ c: number }>();

      await expect(
        createDocument(store, {
          bytes: toBytes(SIMPLE_HTML),
          filename: "simple.html",
          categoryId: "invented-category",
          createdBy: "agent",
        }),
      ).rejects.toBeInstanceOf(AppError);

      const after = await store.db.prepare("SELECT COUNT(*) AS c FROM categories").first<{ c: number }>();
      expect(after?.c).toBe(before?.c);
    });
  });

  describe("immutability and version numbering", () => {
    it("never reuses an R2 key across many creates", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const keys = new Set<string>();

      for (let i = 0; i < 12; i += 1) {
        const result = await createDocument(store, {
          bytes: toBytes(SIMPLE_HTML.replace("Body text.", `Body text ${i}.`)),
          filename: `doc-${i}.html`,
          categoryId,
          createdBy: "admin",
        });
        keys.add(buildR2Key(result.documentId, result.versionId));
      }

      expect(keys.size).toBe(12);
    });

    it("assigns version numbers in SQL, so concurrent appends never collide", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "simple.html",
        categoryId,
        createdBy: "admin",
      });

      const [second, third] = await Promise.all([
        appendVersion(store, {
          documentId: created.documentId,
          bytes: toBytes(SIMPLE_HTML.replace("Body text.", "Second revision body.")),
          createdBy: "admin",
        }),
        appendVersion(store, {
          documentId: created.documentId,
          bytes: toBytes(SIMPLE_HTML.replace("Body text.", "Third revision body.")),
          createdBy: "admin",
        }),
      ]);

      const numbers = await store.db
        .prepare("SELECT version_no FROM document_versions WHERE document_id = ? ORDER BY version_no")
        .bind(created.documentId)
        .all<{ version_no: number }>();
      expect(numbers.results.map((r) => r.version_no)).toEqual([1, 2, 3]);
      expect(new Set([second.versionNo, third.versionNo]).size).toBe(2);
    });

    it("returns unchanged without writing when identical bytes are appended", async () => {
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const bytes = toBytes(SIMPLE_HTML);
      const created = await createDocument(store, {
        bytes,
        filename: "simple.html",
        categoryId,
        createdBy: "admin",
      });

      const objectsBefore = (await store.docs.list()).objects.length;
      const again = await appendVersion(store, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML),
        createdBy: "admin",
      });

      expect(again.unchanged).toBe(true);
      expect(again.versionId).toBe(created.versionId);

      const versions = await store.db
        .prepare("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?")
        .bind(created.documentId)
        .first<{ c: number }>();
      expect(versions?.c).toBe(1);
      expect((await store.docs.list()).objects.length).toBe(objectsBefore);
    });
  });
});
