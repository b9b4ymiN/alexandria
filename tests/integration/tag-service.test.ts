// Node G2.2 — TagService, exercised against a real D1 database inside the
// Workers runtime. Follows the pattern established by
// tests/integration/document-create.test.ts: reset() then apply the real
// migration files with Vite's `?raw` suffix.
import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error - "cloudflare:test" has no ambient type outside the
// package's optional "./types" subpath, which is out of this node's scope
import { env, reset } from "cloudflare:test";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0001 from "../../migrations/0001_init.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0002 from "../../migrations/0002_seed_categories.sql?raw";

import {
  createTag,
  deleteTag,
  listTags,
  mergeTags,
  renameTag,
  setDocumentTags,
  MAX_DOCUMENT_TAGS,
  MAX_TAG_NAME_LENGTH,
} from "../../src/domain/tags/tag-service";
import { createDocument } from "../../src/domain/documents/document-service";
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

function db(): D1Database {
  return (env as unknown as { DB: D1Database }).DB;
}

async function applyMigrations(database: D1Database): Promise<void> {
  for (const statement of [...splitStatements(migration0001), ...splitStatements(migration0002)]) {
    await database.prepare(statement).run();
  }
}

let categoryCounter = 0;
async function seedCategory(database: D1Database): Promise<string> {
  categoryCounter += 1;
  const id = `cat-${categoryCounter}`;
  const now = "2026-08-30T00:00:00.000Z";
  await database
    .prepare(
      "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES (?, NULL, ?, ?, 0, ?, ?)",
    )
    .bind(id, `Name ${id}`, `slug-${id}`, now, now)
    .run();
  return id;
}

let documentCounter = 0;
async function seedDocument(database: D1Database, categoryId: string): Promise<string> {
  documentCounter += 1;
  const id = `doc-${documentCounter}`;
  const now = "2026-08-30T00:00:00.000Z";
  await database
    .prepare(
      `INSERT INTO documents (id, slug, title, description, category_id, current_version_id, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, NULL, ?, ?)`,
    )
    .bind(id, `slug-${id}`, `Title ${id}`, categoryId, now, now)
    .run();
  return id;
}

async function link(database: D1Database, documentId: string, tagId: string): Promise<void> {
  await database
    .prepare("INSERT INTO document_tags (document_id, tag_id, created_at) VALUES (?, ?, ?)")
    .bind(documentId, tagId, "2026-08-30T00:00:00.000Z")
    .run();
}

async function tagRowCount(database: D1Database, normalizedName: string): Promise<number> {
  const row = await database
    .prepare("SELECT COUNT(*) AS c FROM tags WHERE normalized_name = ?")
    .bind(normalizedName)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

async function linkedTagNames(database: D1Database, documentId: string): Promise<string[]> {
  const rows = await database
    .prepare(
      `SELECT t.normalized_name AS n FROM document_tags dt
       JOIN tags t ON t.id = dt.tag_id WHERE dt.document_id = ? ORDER BY t.normalized_name`,
    )
    .bind(documentId)
    .all<{ n: string }>();
  return rows.results.map((r) => r.n);
}

describe("TagService", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  describe("create and normalization", () => {
    it("resolves '  Value   Investing  ' and 'value investing' to one tag", async () => {
      const first = await createTag(db(), "  Value   Investing  ");
      const second = await createTag(db(), "value investing");

      expect(second.id).toBe(first.id);
      expect(await tagRowCount(db(), "value investing")).toBe(1);
    });

    it("preserves the first writer's display casing on reuse", async () => {
      await createTag(db(), "Value Investing");
      const reused = await createTag(db(), "VALUE INVESTING");
      expect(reused.name).toBe("Value Investing");
    });

    it("rejects a blank name with TAG_NAME_REQUIRED", async () => {
      await expect(createTag(db(), "   ")).rejects.toMatchObject({ code: "TAG_NAME_REQUIRED" });
    });

    it("rejects a name over the length cap with TAG_NAME_TOO_LONG", async () => {
      const tooLong = "a".repeat(MAX_TAG_NAME_LENGTH + 1);
      await expect(createTag(db(), tooLong)).rejects.toMatchObject({ code: "TAG_NAME_TOO_LONG" });
    });

    it("accepts a name exactly at the length cap", async () => {
      const exact = "a".repeat(MAX_TAG_NAME_LENGTH);
      const tag = await createTag(db(), exact);
      expect(tag.name).toBe(exact);
    });
  });

  describe("rename", () => {
    it("updates both the display name and the normalized identity", async () => {
      const tag = await createTag(db(), "Moat");
      const renamed = await renameTag(db(), tag.id, "Economic Moat");
      expect(renamed.name).toBe("Economic Moat");
      expect(renamed.normalizedName).toBe("economic moat");
    });

    it("rejects a rename that collides with another tag after normalization", async () => {
      const a = await createTag(db(), "ROIC");
      const b = await createTag(db(), "Moat");

      await expect(renameTag(db(), b.id, "  roic  ")).rejects.toMatchObject({
        code: "TAG_NAME_CONFLICT",
      });

      const untouched = await listTags(db());
      expect(untouched.find((t) => t.id === b.id)?.normalizedName).toBe("moat");
      expect(untouched.find((t) => t.id === a.id)?.normalizedName).toBe("roic");
    });

    it("allows renaming a tag to its own current name (no-op)", async () => {
      const tag = await createTag(db(), "Moat");
      const renamed = await renameTag(db(), tag.id, "Moat");
      expect(renamed.id).toBe(tag.id);
    });

    it("raises TAG_NOT_FOUND for an unknown id", async () => {
      await expect(renameTag(db(), "does-not-exist", "New Name")).rejects.toMatchObject({
        code: "TAG_NOT_FOUND",
      });
    });
  });

  describe("merge", () => {
    it("preserves every distinct document link and removes the source", async () => {
      const source = await createTag(db(), "Value Investing");
      const target = await createTag(db(), "Value");
      const categoryId = await seedCategory(db());
      const docA = await seedDocument(db(), categoryId);
      const docB = await seedDocument(db(), categoryId);
      await link(db(), docA, source.id);
      await link(db(), docB, source.id);

      const result = await mergeTags(db(), source.id, target.id);

      expect(result.movedLinks).toBe(2);
      expect(result.skippedDuplicateLinks).toBe(0);
      expect(await linkedTagNames(db(), docA)).toEqual(["value"]);
      expect(await linkedTagNames(db(), docB)).toEqual(["value"]);
      expect(await tagRowCount(db(), "value investing")).toBe(0);
    });

    it("produces one surviving link with no duplicate-key failure when both tags already share a document", async () => {
      const source = await createTag(db(), "Value Investing");
      const target = await createTag(db(), "Value");
      const categoryId = await seedCategory(db());
      const shared = await seedDocument(db(), categoryId);
      const sourceOnly = await seedDocument(db(), categoryId);
      await link(db(), shared, source.id);
      await link(db(), shared, target.id);
      await link(db(), sourceOnly, source.id);

      const result = await mergeTags(db(), source.id, target.id);

      expect(result.movedLinks).toBe(1);
      expect(result.skippedDuplicateLinks).toBe(1);
      expect(await linkedTagNames(db(), shared)).toEqual(["value"]);
      expect(await linkedTagNames(db(), sourceOnly)).toEqual(["value"]);

      const linkCount = await db()
        .prepare("SELECT COUNT(*) AS c FROM document_tags WHERE document_id = ? AND tag_id = ?")
        .bind(shared, target.id)
        .first<{ c: number }>();
      expect(linkCount?.c).toBe(1);
    });

    it("rejects merging a tag into itself", async () => {
      const tag = await createTag(db(), "Moat");
      await expect(mergeTags(db(), tag.id, tag.id)).rejects.toMatchObject({
        code: "TAG_SELF_MERGE",
      });
    });

    it("raises TAG_NOT_FOUND for a non-existent source", async () => {
      const target = await createTag(db(), "Moat");
      await expect(mergeTags(db(), "does-not-exist", target.id)).rejects.toMatchObject({
        code: "TAG_NOT_FOUND",
      });
    });

    it("raises TAG_NOT_FOUND for a non-existent target", async () => {
      const source = await createTag(db(), "Moat");
      await expect(mergeTags(db(), source.id, "does-not-exist")).rejects.toMatchObject({
        code: "TAG_NOT_FOUND",
      });
    });
  });

  describe("delete", () => {
    it("deletes a tag linked to many documents, succeeds, and reports the count", async () => {
      const tag = await createTag(db(), "Popular");
      const categoryId = await seedCategory(db());
      const docs = await Promise.all(
        Array.from({ length: 5 }, () => seedDocument(db(), categoryId)),
      );
      for (const documentId of docs) {
        await link(db(), documentId, tag.id);
      }

      const result = await deleteTag(db(), tag.id);
      expect(result.removedLinks).toBe(5);

      const remainingLinks = await db()
        .prepare("SELECT COUNT(*) AS c FROM document_tags WHERE tag_id = ?")
        .bind(tag.id)
        .first<{ c: number }>();
      expect(remainingLinks?.c).toBe(0);
    });

    it("raises TAG_NOT_FOUND for an unknown id", async () => {
      await expect(deleteTag(db(), "does-not-exist")).rejects.toMatchObject({
        code: "TAG_NOT_FOUND",
      });
    });
  });

  describe("list", () => {
    it("returns accurate document counts", async () => {
      const popular = await createTag(db(), "Popular");
      const lonely = await createTag(db(), "Lonely");
      const categoryId = await seedCategory(db());
      const docA = await seedDocument(db(), categoryId);
      const docB = await seedDocument(db(), categoryId);
      await link(db(), docA, popular.id);
      await link(db(), docB, popular.id);

      const list = await listTags(db());
      expect(list.find((t) => t.id === popular.id)?.documentCount).toBe(2);
      expect(list.find((t) => t.id === lonely.id)?.documentCount).toBe(0);
    });
  });

  describe("setDocumentTags", () => {
    it("adds and removes in one operation", async () => {
      const categoryId = await seedCategory(db());
      const documentId = await seedDocument(db(), categoryId);
      const a = await createTag(db(), "A");
      const b = await createTag(db(), "B");
      await link(db(), documentId, a.id);
      await link(db(), documentId, b.id);

      const result = await setDocumentTags(db(), documentId, ["B", "C"]);

      expect(result.tags).toEqual(["b", "c"]);
      expect(await linkedTagNames(db(), documentId)).toEqual(["b", "c"]);
    });

    it("removes all links when given an empty array", async () => {
      const categoryId = await seedCategory(db());
      const documentId = await seedDocument(db(), categoryId);
      const a = await createTag(db(), "A");
      await link(db(), documentId, a.id);

      const result = await setDocumentTags(db(), documentId, []);

      expect(result.tags).toEqual([]);
      expect(await linkedTagNames(db(), documentId)).toEqual([]);
    });

    it("rejects 21 supplied tags with TAG_LIMIT_EXCEEDED and writes nothing", async () => {
      const categoryId = await seedCategory(db());
      const documentId = await seedDocument(db(), categoryId);
      const names = Array.from({ length: MAX_DOCUMENT_TAGS + 1 }, (_, i) => `tag-${i}`);

      await expect(setDocumentTags(db(), documentId, names)).rejects.toMatchObject({
        code: "TAG_LIMIT_EXCEEDED",
      });
      expect(await linkedTagNames(db(), documentId)).toEqual([]);
    });

    it("raises DOCUMENT_NOT_FOUND for an unknown document", async () => {
      await expect(setDocumentTags(db(), "does-not-exist", ["A"])).rejects.toMatchObject({
        code: "DOCUMENT_NOT_FOUND",
      });
    });

    it("raises TAG_NAME_TOO_LONG and writes nothing when one supplied name is over the cap", async () => {
      const categoryId = await seedCategory(db());
      const documentId = await seedDocument(db(), categoryId);

      await expect(
        setDocumentTags(db(), documentId, ["Fine", "a".repeat(MAX_TAG_NAME_LENGTH + 1)]),
      ).rejects.toMatchObject({ code: "TAG_NAME_TOO_LONG" });
      expect(await linkedTagNames(db(), documentId)).toEqual([]);
    });
  });

  describe("regression: tags created by the G1.5 upload path", () => {
    const SIMPLE_HTML = `<!doctype html>
<html><head><title>Upload Path Report</title></head>
<body><h1>Upload Path Report</h1><p>Body.</p></body></html>`;

    function toBytes(text: string): ArrayBuffer {
      return new TextEncoder().encode(text).buffer as ArrayBuffer;
    }

    it("remain valid and are not duplicated by TagService", async () => {
      const categoryId = await seedCategory(db());
      const docs = (env as unknown as { DOCS: R2Bucket }).DOCS;

      const created = await createDocument(
        { db: db(), docs },
        {
          bytes: toBytes(SIMPLE_HTML),
          filename: "upload-path.html",
          categoryId,
          createdBy: "admin",
          overrides: { tags: ["Moat"] },
        },
      );

      // Reusing the exact same normalized tag through the new service must
      // not create a second "moat" row.
      expect(await tagRowCount(db(), "moat")).toBe(1);

      const result = await setDocumentTags(db(), created.documentId, ["moat", "ROIC"]);
      expect(result.tags.sort()).toEqual(["moat", "roic"]);
      expect(await tagRowCount(db(), "moat")).toBe(1);

      const list = await listTags(db());
      expect(list.find((t) => t.normalizedName === "moat")?.documentCount).toBe(1);
    });
  });

  it("never throws a non-AppError for a validation failure", async () => {
    try {
      await createTag(db(), "");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
    }
  });
});
