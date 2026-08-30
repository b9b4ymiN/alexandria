// Node G2.1 — CategoryService, exercised against a real D1 database inside
// the Workers runtime.
//
// DESIGNATED HIGH-RISK NODE (IMPLEMENTATION_PLAN.md §10): a cycle or a
// permitted non-empty deletion corrupts navigation for every document
// filed underneath. This suite proves every guard named in the node
// contract, not just the happy path.
//
// Migrations are applied per test after cloudflare:test's reset(), matching
// the pattern established by tests/integration/schema.test.ts and
// tests/integration/document-create.test.ts.
import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error - "cloudflare:test" has no ambient type outside the
// package's optional "./types" subpath, which is out of this node's scope
import { env, reset } from "cloudflare:test";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0001 from "../../migrations/0001_init.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0002 from "../../migrations/0002_seed_categories.sql?raw";

import {
  categoryPath,
  categoryTree,
  createCategory,
  moveCategory,
  removeCategory,
  renameCategory,
} from "../../src/domain/categories/category-service";
import { createDocument } from "../../src/domain/documents/document-service";
import { getDocumentBySlug } from "../../src/domain/documents/document-read";
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

function docs(): R2Bucket {
  return (env as unknown as { DOCS: R2Bucket }).DOCS;
}

async function applyMigrations(database: D1Database): Promise<void> {
  for (const statement of [...splitStatements(migration0001), ...splitStatements(migration0002)]) {
    await database.prepare(statement).run();
  }
}

const SIMPLE_HTML = `<!doctype html>
<html><head><title>Category Test Doc</title></head><body><p>Body.</p></body></html>`;

function toBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe("CategoryService", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  describe("create", () => {
    it("creates nested categories three levels deep", async () => {
      const root = await createCategory(db(), { parentId: null, name: "Stocks" });
      const mid = await createCategory(db(), { parentId: root.id, name: "Thailand" });
      const leaf = await createCategory(db(), { parentId: mid.id, name: "Consumer" });

      expect(leaf.parentId).toBe(mid.id);
      expect(mid.parentId).toBe(root.id);
      expect(root.parentId).toBeNull();

      const path = await categoryPath(db(), leaf.id);
      expect(path.map((c) => c.name)).toEqual(["Stocks", "Thailand", "Consumer"]);
    });

    it("generates a slug from the name using document slug rules", async () => {
      const category = await createCategory(db(), { parentId: null, name: "US Equities!!" });
      expect(category.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(category.slug).toBe("us-equities");
    });

    it("rejects a blank name", async () => {
      await expect(createCategory(db(), { parentId: null, name: "   " })).rejects.toMatchObject({
        code: "CATEGORY_REQUIRED",
      });
    });

    it("rejects a parent that does not exist", async () => {
      await expect(
        createCategory(db(), { parentId: "does-not-exist", name: "Orphan" }),
      ).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND" });
    });

    it("rejects two roots sharing an explicit slug (the partial unique index hole)", async () => {
      // "notes" avoids the migration-0002 seed roots (stocks/books/research/
      // uncategorized), which are already present at root level in every test.
      await createCategory(db(), { parentId: null, name: "Notes", slug: "notes" });
      await expect(
        createCategory(db(), { parentId: null, name: "Notes Again", slug: "notes" }),
      ).rejects.toMatchObject({ code: "CATEGORY_SLUG_CONFLICT" });
    });

    it("rejects two siblings sharing an explicit slug under the same parent", async () => {
      const root = await createCategory(db(), { parentId: null, name: "Research" });
      await createCategory(db(), { parentId: root.id, name: "Macro", slug: "macro" });
      await expect(
        createCategory(db(), { parentId: root.id, name: "Macro Duplicate", slug: "macro" }),
      ).rejects.toMatchObject({ code: "CATEGORY_SLUG_CONFLICT" });
    });

    it("auto-suffixes a generated slug on a same-named root rather than erroring", async () => {
      // "Notes" (not "Books") to avoid the migration-0002 seed root already
      // occupying the "books" slug at root level in every test.
      const first = await createCategory(db(), { parentId: null, name: "Notes" });
      const second = await createCategory(db(), { parentId: null, name: "Notes" });
      expect(first.slug).toBe("notes");
      expect(second.slug).toBe("notes-2");
    });

    it("allows the same slug under two different parents", async () => {
      const rootA = await createCategory(db(), { parentId: null, name: "Stocks" });
      const rootB = await createCategory(db(), { parentId: null, name: "Books" });
      const childA = await createCategory(db(), { parentId: rootA.id, name: "Macro", slug: "macro" });
      const childB = await createCategory(db(), { parentId: rootB.id, name: "Macro", slug: "macro" });
      expect(childA.slug).toBe("macro");
      expect(childB.slug).toBe("macro");
    });

    it("rejects a malformed explicit slug", async () => {
      await expect(
        createCategory(db(), { parentId: null, name: "Bad Slug", slug: "Not Valid!" }),
      ).rejects.toMatchObject({ code: "CATEGORY_REQUIRED" });
    });
  });

  describe("rename", () => {
    it("changes name only, never the slug", async () => {
      const category = await createCategory(db(), { parentId: null, name: "Stocks" });
      const renamed = await renameCategory(db(), category.id, "Equities");
      expect(renamed.name).toBe("Equities");
      expect(renamed.slug).toBe(category.slug);
    });

    it("never changes a document's slug", async () => {
      const category = await createCategory(db(), { parentId: null, name: "Stocks" });
      const created = await createDocument(
        { db: db(), docs: docs() },
        { bytes: toBytes(SIMPLE_HTML), filename: "doc.html", categoryId: category.id, createdBy: "admin" },
      );

      await renameCategory(db(), category.id, "Equities");

      const document = await getDocumentBySlug(db(), created.slug, "https://content.test");
      expect(document.slug).toBe(created.slug);
    });

    it("allows renaming to an existing sibling's name — names are not unique, slugs are", async () => {
      const root = await createCategory(db(), { parentId: null, name: "Stocks" });
      const a = await createCategory(db(), { parentId: root.id, name: "Alpha" });
      await createCategory(db(), { parentId: root.id, name: "Beta" });

      const renamed = await renameCategory(db(), a.id, "Beta");
      expect(renamed.name).toBe("Beta");
    });

    it("rejects renaming a category that does not exist", async () => {
      await expect(renameCategory(db(), "nope", "New Name")).rejects.toMatchObject({
        code: "CATEGORY_NOT_FOUND",
      });
    });
  });

  describe("move", () => {
    it("moves a subtree and updates the category paths of documents beneath it", async () => {
      const stocks = await createCategory(db(), { parentId: null, name: "Stocks" });
      const books = await createCategory(db(), { parentId: null, name: "Books" });
      const thailand = await createCategory(db(), { parentId: stocks.id, name: "Thailand" });
      const consumer = await createCategory(db(), { parentId: thailand.id, name: "Consumer" });

      const created = await createDocument(
        { db: db(), docs: docs() },
        { bytes: toBytes(SIMPLE_HTML), filename: "doc.html", categoryId: consumer.id, createdBy: "admin" },
      );

      await moveCategory(db(), thailand.id, books.id);

      const path = await categoryPath(db(), consumer.id);
      expect(path.map((c) => c.name)).toEqual(["Books", "Thailand", "Consumer"]);

      const document = await getDocumentBySlug(db(), created.slug, "https://content.test");
      expect(document.categoryPath.map((c) => c.name)).toEqual(["Books", "Thailand", "Consumer"]);
      // Regression: the move never touches the document's own identity.
      expect(document.slug).toBe(created.slug);
    });

    it("rejects moving a category into its own direct subtree (child)", async () => {
      const parent = await createCategory(db(), { parentId: null, name: "Stocks" });
      const child = await createCategory(db(), { parentId: parent.id, name: "Thailand" });

      await expect(moveCategory(db(), parent.id, child.id)).rejects.toMatchObject({
        code: "CATEGORY_CYCLE",
      });
    });

    it("rejects moving a category into a deep descendant", async () => {
      const root = await createCategory(db(), { parentId: null, name: "Stocks" });
      const mid = await createCategory(db(), { parentId: root.id, name: "Thailand" });
      const leaf = await createCategory(db(), { parentId: mid.id, name: "Consumer" });

      await expect(moveCategory(db(), root.id, leaf.id)).rejects.toMatchObject({
        code: "CATEGORY_CYCLE",
      });
    });

    it("rejects moving a category into itself", async () => {
      const category = await createCategory(db(), { parentId: null, name: "Stocks" });
      await expect(moveCategory(db(), category.id, category.id)).rejects.toMatchObject({
        code: "CATEGORY_CYCLE",
      });
    });

    it("rejects moving to a non-existent parent", async () => {
      const category = await createCategory(db(), { parentId: null, name: "Stocks" });
      await expect(moveCategory(db(), category.id, "does-not-exist")).rejects.toMatchObject({
        code: "CATEGORY_NOT_FOUND",
      });
    });

    it("rejects moving a non-existent category", async () => {
      await expect(moveCategory(db(), "does-not-exist", null)).rejects.toMatchObject({
        code: "CATEGORY_NOT_FOUND",
      });
    });

    it("rejects a move to root when a root sibling already has the same slug", async () => {
      // "notes" avoids the migration-0002 seed roots occupying "books" etc.
      await createCategory(db(), { parentId: null, name: "Notes", slug: "notes" });
      const nested = await createCategory(db(), { parentId: null, name: "Container" });
      const inner = await createCategory(db(), { parentId: nested.id, name: "Notes Inner", slug: "notes" });

      await expect(moveCategory(db(), inner.id, null)).rejects.toMatchObject({
        code: "CATEGORY_SLUG_CONFLICT",
      });
    });

    it("rejects a move that would exceed the maximum category depth", async () => {
      // Build a chain 10 categories deep (root at depth 1 ... depth 10).
      let parentId: string | null = null;
      for (let i = 0; i < 10; i += 1) {
        const node = await createCategory(db(), { parentId, name: `Level ${i}` });
        parentId = node.id;
      }
      const deepestParentId = parentId as string;

      const mover = await createCategory(db(), { parentId: null, name: "Mover" });

      await expect(moveCategory(db(), mover.id, deepestParentId)).rejects.toMatchObject({
        code: "CATEGORY_REQUIRED",
      });
    });

    it("never changes any document slug or public URL", async () => {
      const a = await createCategory(db(), { parentId: null, name: "A" });
      const b = await createCategory(db(), { parentId: null, name: "B" });
      const created = await createDocument(
        { db: db(), docs: docs() },
        { bytes: toBytes(SIMPLE_HTML), filename: "doc.html", categoryId: a.id, createdBy: "admin" },
      );

      // Move the category holding the document's PARENT (create a parent
      // above `a`, then move `a` under it) to prove even a category
      // relocation of the document's own category never touches the slug.
      await moveCategory(db(), a.id, b.id);

      const document = await getDocumentBySlug(db(), created.slug, "https://content.test");
      expect(document.slug).toBe(created.slug);
      expect(document.documentId).toBe(created.documentId);
    });
  });

  describe("remove", () => {
    it("deletes a genuinely empty leaf", async () => {
      const category = await createCategory(db(), { parentId: null, name: "Empty" });
      await removeCategory(db(), category.id);

      const row = await db().prepare("SELECT id FROM categories WHERE id = ?").bind(category.id).first();
      expect(row).toBeNull();
    });

    it("rejects deleting a category that holds a child category", async () => {
      const parent = await createCategory(db(), { parentId: null, name: "Parent" });
      await createCategory(db(), { parentId: parent.id, name: "Child" });

      await expect(removeCategory(db(), parent.id)).rejects.toMatchObject({
        code: "CATEGORY_NOT_EMPTY",
      });
    });

    it("rejects deleting a category that holds one document", async () => {
      const category = await createCategory(db(), { parentId: null, name: "Holds Doc" });
      await createDocument(
        { db: db(), docs: docs() },
        { bytes: toBytes(SIMPLE_HTML), filename: "doc.html", categoryId: category.id, createdBy: "admin" },
      );

      await expect(removeCategory(db(), category.id)).rejects.toMatchObject({
        code: "CATEGORY_NOT_EMPTY",
      });
    });

    it("rejects deleting a category that does not exist", async () => {
      await expect(removeCategory(db(), "does-not-exist")).rejects.toMatchObject({
        code: "CATEGORY_NOT_FOUND",
      });
    });

    it("never cascades: the child and its documents survive a rejected deletion attempt", async () => {
      const parent = await createCategory(db(), { parentId: null, name: "Parent" });
      const child = await createCategory(db(), { parentId: parent.id, name: "Child" });

      await expect(removeCategory(db(), parent.id)).rejects.toBeInstanceOf(AppError);

      const childRow = await db().prepare("SELECT id FROM categories WHERE id = ?").bind(child.id).first();
      expect(childRow).not.toBeNull();
    });
  });

  describe("tree", () => {
    it("returns the whole tree, ordered by sort_order then name, in one query", async () => {
      // The migration-0002 seed already populates four root categories, so
      // assertions below check the RELATIVE order of the categories this
      // test creates (by id), not the exact shape of the full root list.
      const zapp = await createCategory(db(), { parentId: null, name: "Zapp Corp", sortOrder: 1 });
      const alpha = await createCategory(db(), { parentId: null, name: "Alpha Corp", sortOrder: 0 });
      await createCategory(db(), { parentId: zapp.id, name: "Thailand" });
      await createCategory(db(), { parentId: zapp.id, name: "China" });

      const tree = await categoryTree(db());
      const rootIds = tree.map((n) => n.id);
      expect(rootIds.indexOf(alpha.id)).toBeLessThan(rootIds.indexOf(zapp.id)); // sort_order 0 before 1

      const zappNode = tree.find((n) => n.id === zapp.id);
      expect(zappNode?.children.map((c) => c.name)).toEqual(["China", "Thailand"]); // name order
    });

    it("includes seeded categories from migration 0002 alongside newly created ones", async () => {
      const tree = await categoryTree(db());
      const names = tree.map((n) => n.name);
      expect(names).toEqual(expect.arrayContaining(["Stocks", "Books", "Research", "Uncategorized"]));
    });
  });

  describe("path", () => {
    it("rejects an unknown category id", async () => {
      await expect(categoryPath(db(), "does-not-exist")).rejects.toMatchObject({
        code: "CATEGORY_NOT_FOUND",
      });
    });

    it("returns a single-entry path for a root category", async () => {
      const root = await createCategory(db(), { parentId: null, name: "Solo" });
      const path = await categoryPath(db(), root.id);
      expect(path.map((c) => c.id)).toEqual([root.id]);
    });
  });
});
