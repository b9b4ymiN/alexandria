// Node G1.1 — D1 Schema, Migrations & Seed.
//
// Runs the real migrations/0001_init.sql and migrations/0002_seed_categories.sql
// files against a real local D1 database inside the Workers runtime (via
// @cloudflare/vitest-pool-workers), so this suite tests exactly the SQL that
// ships, not a hand-copied approximation of it.
//
// D1 storage under the vitest Workers pool is ephemeral per test file and is
// NOT shared with `wrangler d1 migrations apply --local` (confirmed by
// direct probing while building this suite: a fresh `env.DB` here reports
// "no such table" even immediately after a successful CLI migration run).
// Migrations are therefore applied in `beforeEach`, after `reset()` wipes
// storage, giving every test a clean, fully-migrated database.
//
// `reset()`/re-migration replaces `db.exec()` for loading the migration
// files: `D1Database#exec()` requires exactly one statement per line with no
// comments (confirmed by probing — it rejects this file's leading comment
// block), so statements are split and run individually via `db.prepare()`.
import { beforeEach, describe, expect, it } from "vitest";
// `cloudflare:test` and Vite's `?raw` suffix import both resolve and work
// correctly at runtime (verified against this project's installed
// @cloudflare/vitest-pool-workers and Vite versions) but ship no ambient
// type usable from an ordinary `.ts` file: `cloudflare:test`'s types live in
// a package `./types` subpath that must be added to a tsconfig `types`
// array to apply project-wide, and a wildcard `declare module "*.sql?raw"`
// block is only honored inside a `.d.ts` file, not here. Neither tsconfig
// nor a new ambient-types file is in this node's file scope (adding the
// `./types` subpath via a triple-slash reference was tried and rejected: it
// globally changes `ExportedHandler`/`Fetcher` typing for the whole
// tsconfig.worker.json program and broke tests/unit/smoke.test.ts, a file
// this node does not own). Each import is therefore suppressed locally.
// @ts-expect-error - "cloudflare:test" has no ambient type outside the
// package's optional "./types" subpath, which is out of this node's scope
import { env, reset } from "cloudflare:test";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0001 from "../../migrations/0001_init.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0002 from "../../migrations/0002_seed_categories.sql?raw";

/**
 * Splits a migration file into individually-runnable statements: strips
 * `--` line comments, then splits on `;`. Safe here because the migration
 * files are authored by this node and contain no string literal with an
 * embedded semicolon or a `--` sequence inside a value.
 */
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

function getDb(): D1Database {
  return (env as unknown as { DB: D1Database }).DB;
}

const NOW = "2026-08-30T12:00:00.000Z";

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function insertCategory(
  db: D1Database,
  overrides: Partial<{
    id: string;
    parentId: string | null;
    name: string;
    slug: string;
    sortOrder: number;
  }> = {},
): Promise<string> {
  const category = {
    id: overrides.id ?? newId("cat"),
    parentId: overrides.parentId ?? null,
    name: overrides.name ?? "Category",
    slug: overrides.slug ?? newId("slug"),
    sortOrder: overrides.sortOrder ?? 0,
  };
  await db
    .prepare(
      "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(category.id, category.parentId, category.name, category.slug, category.sortOrder, NOW, NOW)
    .run();
  return category.id;
}

async function insertDocument(
  db: D1Database,
  categoryId: string,
  overrides: Partial<{ id: string; slug: string; title: string }> = {},
): Promise<string> {
  const documentId = overrides.id ?? newId("doc");
  await db
    .prepare(
      "INSERT INTO documents (id, slug, title, description, category_id, current_version_id, created_at, updated_at) VALUES (?, ?, ?, '', ?, NULL, ?, ?)",
    )
    .bind(documentId, overrides.slug ?? newId("doc-slug"), overrides.title ?? "Title", categoryId, NOW, NOW)
    .run();
  return documentId;
}

async function insertVersion(
  db: D1Database,
  documentId: string,
  versionNo: number,
  overrides: Partial<{ r2Key: string; createdBy: string; id: string }> = {},
): Promise<string> {
  const versionId = overrides.id ?? newId("ver");
  await db
    .prepare(
      "INSERT INTO document_versions (id, document_id, version_no, r2_key, sha256, size_bytes, created_by, created_at, restored_from_version_no, note) VALUES (?, ?, ?, ?, 'sha256hash', 1, ?, ?, NULL, '')",
    )
    .bind(versionId, documentId, versionNo, overrides.r2Key ?? newId("r2key"), overrides.createdBy ?? "admin", NOW)
    .run();
  return versionId;
}

const TABLE_COLUMNS: Record<string, string[]> = {
  categories: ["id", "parent_id", "name", "slug", "sort_order", "created_at", "updated_at"],
  documents: [
    "id",
    "slug",
    "title",
    "description",
    "category_id",
    "current_version_id",
    "created_at",
    "updated_at",
  ],
  document_versions: [
    "id",
    "document_id",
    "version_no",
    "r2_key",
    "sha256",
    "size_bytes",
    "created_by",
    "created_at",
    "restored_from_version_no",
    "note",
  ],
  tags: ["id", "name", "normalized_name", "created_at", "updated_at"],
  document_tags: ["document_id", "tag_id", "created_at"],
};

describe("D1 schema (migrations/0001_init.sql, migrations/0002_seed_categories.sql)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(getDb());
  });

  describe("positive", () => {
    it("creates exactly the five specified tables, no more, no fewer", async () => {
      const db = getDb();
      const rows = await db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' ORDER BY name")
        .all<{ name: string }>();
      expect(rows.results.map((r) => r.name)).toEqual(
        ["categories", "document_tags", "document_versions", "documents", "tags"].sort(),
      );
    });

    it.each(Object.entries(TABLE_COLUMNS))("table %s has exactly the SPEC §5 columns", async (table, expectedColumns) => {
      const db = getDb();
      const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      expect(info.results.map((c) => c.name).sort()).toEqual([...expectedColumns].sort());
    });

    it("seeds exactly the four Phase 1 categories as ordinary, deletable rows", async () => {
      const db = getDb();
      const rows = await db
        .prepare("SELECT id, parent_id, name, slug, sort_order FROM categories ORDER BY sort_order")
        .all<{ id: string; parent_id: string | null; name: string; slug: string }>();
      expect(rows.results.map((r) => r.slug)).toEqual(["stocks", "books", "research", "uncategorized"]);
      expect(rows.results.every((r) => r.parent_id === null)).toBe(true);

      // Ordinary rows: deletable exactly like any other category, no special
      // guard protects a seed row.
      const firstId = rows.results[0]!.id;
      const del = await db.prepare("DELETE FROM categories WHERE id = ?").bind(firstId).run();
      expect(del.success).toBe(true);
      const remaining = await db.prepare("SELECT count(*) AS c FROM categories").first<{ c: number }>();
      expect(remaining?.c).toBe(3);
    });

    it("inserts a valid document, version, and tag link", async () => {
      const db = getDb();
      const categoryId = await insertCategory(db, { slug: "valid-doc-category" });
      const documentId = await insertDocument(db, categoryId, { slug: "valid-document" });
      const versionId = await insertVersion(db, documentId, 1);
      await db.prepare("UPDATE documents SET current_version_id = ? WHERE id = ?").bind(versionId, documentId).run();

      const tagId = newId("tag");
      await db
        .prepare("INSERT INTO tags (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(tagId, "Valuation", "valuation", NOW, NOW)
        .run();
      await db
        .prepare("INSERT INTO document_tags (document_id, tag_id, created_at) VALUES (?, ?, ?)")
        .bind(documentId, tagId, NOW)
        .run();

      const doc = await db
        .prepare("SELECT current_version_id FROM documents WHERE id = ?")
        .bind(documentId)
        .first<{ current_version_id: string }>();
      expect(doc?.current_version_id).toBe(versionId);
      const link = await db
        .prepare("SELECT * FROM document_tags WHERE document_id = ? AND tag_id = ?")
        .bind(documentId, tagId)
        .all();
      expect(link.results.length).toBe(1);
    });

    it("cascades version and tag-link deletion when a document is deleted", async () => {
      const db = getDb();
      const categoryId = await insertCategory(db, { slug: "cascade-category" });
      const documentId = await insertDocument(db, categoryId, { slug: "cascade-document" });
      await insertVersion(db, documentId, 1);
      const tagId = newId("tag");
      await db
        .prepare("INSERT INTO tags (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(tagId, "Cascade", "cascade", NOW, NOW)
        .run();
      await db
        .prepare("INSERT INTO document_tags (document_id, tag_id, created_at) VALUES (?, ?, ?)")
        .bind(documentId, tagId, NOW)
        .run();

      await db.prepare("DELETE FROM documents WHERE id = ?").bind(documentId).run();

      const versions = await db.prepare("SELECT * FROM document_versions WHERE document_id = ?").bind(documentId).all();
      const tagLinks = await db.prepare("SELECT * FROM document_tags WHERE document_id = ?").bind(documentId).all();
      expect(versions.results.length).toBe(0);
      expect(tagLinks.results.length).toBe(0);
      // The tag itself is not a child of the document and must survive.
      const tag = await db.prepare("SELECT id FROM tags WHERE id = ?").bind(tagId).first();
      expect(tag).not.toBeNull();
    });

    it("enforces foreign keys — verified, not assumed", async () => {
      const db = getDb();
      const pragma = await db.prepare("PRAGMA foreign_keys").first<{ foreign_keys: number }>();
      expect(pragma?.foreign_keys).toBe(1);
    });
  });

  describe("negative — constraint violations", () => {
    it("rejects two root categories sharing a slug (partial unique index ux_categories_root_slug)", async () => {
      const db = getDb();
      await insertCategory(db, { parentId: null, slug: "duplicate-root" });
      await expect(insertCategory(db, { parentId: null, slug: "duplicate-root" })).rejects.toThrow();
    });

    it("rejects two sibling categories under the same parent sharing a slug", async () => {
      const db = getDb();
      const parentId = await insertCategory(db, { slug: "parent-for-siblings" });
      await insertCategory(db, { parentId, slug: "duplicate-sibling" });
      await expect(insertCategory(db, { parentId, slug: "duplicate-sibling" })).rejects.toThrow();
    });

    it("rejects deleting a category that still has a child category (ON DELETE RESTRICT)", async () => {
      const db = getDb();
      const parentId = await insertCategory(db, { slug: "parent-with-child" });
      await insertCategory(db, { parentId, slug: "child" });
      await expect(db.prepare("DELETE FROM categories WHERE id = ?").bind(parentId).run()).rejects.toThrow();
    });

    it("rejects deleting a category that still has a document (ON DELETE RESTRICT)", async () => {
      const db = getDb();
      const categoryId = await insertCategory(db, { slug: "category-with-document" });
      await insertDocument(db, categoryId, { slug: "document-blocks-delete" });
      await expect(db.prepare("DELETE FROM categories WHERE id = ?").bind(categoryId).run()).rejects.toThrow();
    });

    it("rejects a duplicate version_no for the same document", async () => {
      const db = getDb();
      const categoryId = await insertCategory(db, { slug: "dup-version-no-category" });
      const documentId = await insertDocument(db, categoryId, { slug: "dup-version-no-document" });
      await insertVersion(db, documentId, 1, { r2Key: newId("r2key-a") });
      await expect(insertVersion(db, documentId, 1, { r2Key: newId("r2key-b") })).rejects.toThrow();
    });

    it("rejects two versions sharing an r2_key", async () => {
      const db = getDb();
      const categoryId = await insertCategory(db, { slug: "dup-r2key-category" });
      const documentId = await insertDocument(db, categoryId, { slug: "dup-r2key-document" });
      const sharedKey = newId("shared-r2key");
      await insertVersion(db, documentId, 1, { r2Key: sharedKey });
      await expect(insertVersion(db, documentId, 2, { r2Key: sharedKey })).rejects.toThrow();
    });

    it("rejects created_by outside ('admin', 'agent')", async () => {
      const db = getDb();
      const categoryId = await insertCategory(db, { slug: "bad-created-by-category" });
      const documentId = await insertDocument(db, categoryId, { slug: "bad-created-by-document" });
      await expect(insertVersion(db, documentId, 1, { createdBy: "public" })).rejects.toThrow();
    });

    it("rejects a document referencing a non-existent category", async () => {
      const db = getDb();
      await expect(insertDocument(db, "category-that-does-not-exist", { slug: "orphan-document" })).rejects.toThrow();
    });
  });
});
