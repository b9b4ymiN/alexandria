// CategoryService — the arbitrary-depth category tree Admin owns exclusively.
//
// Written by node G2.1. This is the ONLY place that mutates `categories`;
// Hono routes (src/api/routes/admin/categories.ts) validate transport
// input and delegate here, exactly like DocumentService (G1.5) does for
// documents (AGENT.md §9, §10).
//
// This is a DESIGNATED HIGH-RISK node (IMPLEMENTATION_PLAN.md §10): a
// cycle or a permitted non-empty deletion corrupts navigation for every
// document filed underneath the affected category, and the damage is not
// obvious until someone browses. Every mutating function here re-derives
// its guard from the database on every call rather than trusting a cached
// shape, and no function ever cascades, reparents, or moves a document on
// the operator's behalf (Implementation Requirement 3).
//
// Error-vocabulary note: SPEC.md §24 gives the category domain exactly one
// 400-level code, CATEGORY_REQUIRED. This module reuses it as the general
// "category request failed validation" code for every 400 case below (a
// blank name, a malformed explicit slug, a move that would exceed the max
// depth) — distinguished by AppError's message/detail, not by a new code.
// Node scope forbids inventing a new ErrorCode; CATEGORY_REQUIRED is the
// closest fit already in the fixed vocabulary (src/shared/errors.ts, owned
// by G1.2).

import { AppError } from "../../shared/errors";
import { generateSlug, isValidSlug, resolveCollision } from "../documents/slug";

/** Implementation Requirement 7: protects the UI from a pathological tree. */
const MAX_CATEGORY_DEPTH = 10;

export interface CategorySummary {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryNode extends CategorySummary {
  children: CategoryNode[];
}

export interface CreateCategoryInput {
  parentId: string | null;
  name: string;
  /** Explicit slug, validated and checked for a conflict rather than auto-resolved. */
  slug?: string;
  sortOrder?: number;
}

interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_ROW_COLUMNS = `id, parent_id AS parentId, name, slug, sort_order AS sortOrder,
       created_at AS createdAt, updated_at AS updatedAt`;

/** Sibling-slug uniqueness enforced at the database level (Requirement 2). */
function isSlugUniquenessFailure(error: unknown): boolean {
  const message = String(error);
  return (
    message.includes("categories.parent_id, categories.slug") ||
    message.includes("ux_categories_root_slug") ||
    (message.includes("UNIQUE constraint failed") && message.includes("categories"))
  );
}

async function getById(db: D1Database, id: string): Promise<CategorySummary> {
  const row = await db
    .prepare(`SELECT ${CATEGORY_ROW_COLUMNS} FROM categories WHERE id = ?`)
    .bind(id)
    .first<CategoryRow>();
  if (row === null) {
    throw new AppError("CATEGORY_NOT_FOUND", {
      message: "No category with that id.",
      detail: { id },
    });
  }
  return row;
}

/** Requirement 2: sibling-slug uniqueness, root level included (`parentId === null`). */
async function siblingSlugTaken(
  db: D1Database,
  parentId: string | null,
  slug: string,
  excludeId?: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS present FROM categories
       WHERE slug = ? AND parent_id IS ? AND id != ?`,
    )
    .bind(slug, parentId, excludeId ?? "")
    .first<{ present: number }>();
  return row !== null;
}

/** Number of every document filed directly in this category. */
export async function countCategoryDocuments(db: D1Database, categoryId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM documents WHERE category_id = ?")
    .bind(categoryId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

async function countChildCategories(db: D1Database, categoryId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS c FROM categories WHERE parent_id = ?")
    .bind(categoryId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

/**
 * Requirement 4: category slug uses the same rules as documents
 * (src/domain/documents/slug.ts), then is made unique within the parent.
 * An explicit `slug` is validated and conflict-checked rather than
 * silently suffixed — Admin asked for that exact slug on purpose.
 */
async function resolveCategorySlug(
  db: D1Database,
  parentId: string | null,
  name: string,
  explicitSlug: string | undefined,
  selfId: string,
): Promise<string> {
  const exists = (candidate: string) => siblingSlugTaken(db, parentId, candidate);

  if (explicitSlug !== undefined) {
    const trimmed = explicitSlug.trim();
    if (!isValidSlug(trimmed)) {
      throw new AppError("CATEGORY_REQUIRED", {
        message: "Category slug must match ^[a-z0-9]+(?:-[a-z0-9]+)*$.",
        detail: { slug: explicitSlug },
      });
    }
    if (await exists(trimmed)) {
      throw new AppError("CATEGORY_SLUG_CONFLICT", {
        message: "A sibling category already uses that slug.",
        detail: { slug: trimmed, parentId },
      });
    }
    return trimmed;
  }

  const base = generateSlug({ title: name, documentId: selfId });
  try {
    return await resolveCollision(base, exists);
  } catch (error) {
    // resolveCollision raises the document-domain SLUG_CONFLICT after its
    // bound of suffixed attempts; remapped so this module's callers only
    // ever see category-domain codes.
    if (error instanceof AppError && error.code === "SLUG_CONFLICT") {
      throw new AppError("CATEGORY_SLUG_CONFLICT", { message: error.message, detail: error.detail });
    }
    throw error;
  }
}

/**
 * Creates a category under `parentId` (null = root). Requirement 4: slug is
 * generated from `name` (or validated if explicitly supplied), then made
 * unique within the parent. The parent, if given, must already exist.
 */
export async function createCategory(
  db: D1Database,
  input: CreateCategoryInput,
): Promise<CategorySummary> {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new AppError("CATEGORY_REQUIRED", { message: "Category name is required." });
  }

  if (input.parentId !== null) {
    await getById(db, input.parentId); // throws CATEGORY_NOT_FOUND if missing
  }

  const id = crypto.randomUUID();
  const slug = await resolveCategorySlug(db, input.parentId, name, input.slug, id);
  const sortOrder = input.sortOrder ?? 0;
  const now = new Date().toISOString();

  try {
    await db
      .prepare(
        `INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, input.parentId, name, slug, sortOrder, now, now)
      .run();
  } catch (error) {
    if (isSlugUniquenessFailure(error)) {
      // Requirement 2: the database constraint is the backstop for a
      // concurrent create; still surfaced as CATEGORY_SLUG_CONFLICT, never
      // a raw constraint failure.
      throw new AppError("CATEGORY_SLUG_CONFLICT", {
        message: "A sibling category already uses that slug.",
        detail: { slug, parentId: input.parentId },
      });
    }
    throw error;
  }

  return { id, parentId: input.parentId, name, slug, sortOrder, createdAt: now, updatedAt: now };
}

/**
 * Requirement 5: renaming changes `name` ONLY. The slug — and therefore
 * every document's category path segment identity — never moves.
 */
export async function renameCategory(
  db: D1Database,
  id: string,
  name: string,
): Promise<CategorySummary> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new AppError("CATEGORY_REQUIRED", { message: "Category name is required." });
  }

  const existing = await getById(db, id);
  const now = new Date().toISOString();
  await db.prepare("UPDATE categories SET name = ?, updated_at = ? WHERE id = ?").bind(trimmed, now, id).run();

  return { ...existing, name: trimmed, updatedAt: now };
}

/**
 * Requirement 1: rejects a move whose target parent is the category itself
 * or any of its descendants (`CATEGORY_CYCLE`), detected with a recursive
 * CTE walking the subtree rooted at `id`.
 * Requirement 7: also rejects a move that would push the deepest node in
 * the moved subtree beyond MAX_CATEGORY_DEPTH.
 * Requirement 2: re-checks sibling-slug uniqueness at the destination,
 * since the category keeps its own slug but gets new siblings.
 */
export async function moveCategory(
  db: D1Database,
  id: string,
  newParentId: string | null,
): Promise<CategorySummary> {
  const category = await getById(db, id); // CATEGORY_NOT_FOUND if `id` itself is missing

  if (newParentId === id) {
    throw new AppError("CATEGORY_CYCLE", {
      message: "A category cannot become its own parent.",
      detail: { id },
    });
  }

  let newParentDepth = 0; // depth of a root parent is 0; a category's own depth is parentDepth + 1
  if (newParentId !== null) {
    await getById(db, newParentId); // CATEGORY_NOT_FOUND if the target parent is missing

    const subtree = await db
      .prepare(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM categories WHERE id = ?
           UNION ALL
           SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
         )
         SELECT id FROM subtree`,
      )
      .bind(id)
      .all<{ id: string }>();
    if (subtree.results.some((row) => row.id === newParentId)) {
      throw new AppError("CATEGORY_CYCLE", {
        message: "Cannot move a category into its own subtree.",
        detail: { id, newParentId },
      });
    }

    const ancestry = await db
      .prepare(
        `WITH RECURSIVE ancestry(id, parent_id, depth) AS (
           SELECT id, parent_id, 1 FROM categories WHERE id = ?
           UNION ALL
           SELECT c.id, c.parent_id, a.depth + 1 FROM categories c JOIN ancestry a ON c.id = a.parent_id
         )
         SELECT MAX(depth) AS depth FROM ancestry`,
      )
      .bind(newParentId)
      .first<{ depth: number | null }>();
    newParentDepth = ancestry?.depth ?? 1;
  }

  const height = await db
    .prepare(
      `WITH RECURSIVE subtree(id, depth) AS (
         SELECT id, 0 FROM categories WHERE id = ?
         UNION ALL
         SELECT c.id, s.depth + 1 FROM categories c JOIN subtree s ON c.parent_id = s.id
       )
       SELECT MAX(depth) AS height FROM subtree`,
    )
    .bind(id)
    .first<{ height: number | null }>();
  const subtreeHeight = height?.height ?? 0;

  const resultingDepth = newParentDepth + 1 + subtreeHeight;
  if (resultingDepth > MAX_CATEGORY_DEPTH) {
    throw new AppError("CATEGORY_REQUIRED", {
      message: `Move would place a category at depth ${resultingDepth}, exceeding the maximum of ${MAX_CATEGORY_DEPTH}.`,
      detail: { id, newParentId, resultingDepth, maxDepth: MAX_CATEGORY_DEPTH },
    });
  }

  if (await siblingSlugTaken(db, newParentId, category.slug, id)) {
    throw new AppError("CATEGORY_SLUG_CONFLICT", {
      message: "A sibling category at the destination already uses that slug.",
      detail: { slug: category.slug, newParentId },
    });
  }

  const now = new Date().toISOString();
  await db
    .prepare("UPDATE categories SET parent_id = ?, updated_at = ? WHERE id = ?")
    .bind(newParentId, now, id)
    .run();

  return { ...category, parentId: newParentId, updatedAt: now };
}

/**
 * Requirement 3: deleting a category with ANY child category or ANY
 * document raises CATEGORY_NOT_EMPTY. Never cascades, never reparents,
 * never moves documents on the operator's behalf.
 */
export async function removeCategory(db: D1Database, id: string): Promise<void> {
  await getById(db, id); // CATEGORY_NOT_FOUND if missing

  if ((await countChildCategories(db, id)) > 0) {
    throw new AppError("CATEGORY_NOT_EMPTY", {
      message: "Category has child categories and cannot be deleted.",
      detail: { id },
    });
  }
  if ((await countCategoryDocuments(db, id)) > 0) {
    throw new AppError("CATEGORY_NOT_EMPTY", {
      message: "Category still has documents filed in it and cannot be deleted.",
      detail: { id },
    });
  }

  await db.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
}

/**
 * Requirement 6: the whole tree in ONE query, ordered by sort_order then
 * name; nesting is built in memory from that single flat result set.
 */
export async function categoryTree(db: D1Database): Promise<CategoryNode[]> {
  const rows = await db
    .prepare(`SELECT ${CATEGORY_ROW_COLUMNS} FROM categories ORDER BY sort_order ASC, name ASC`)
    .all<CategoryRow>();

  const nodes = new Map<string, CategoryNode>();
  for (const row of rows.results) {
    nodes.set(row.id, { ...row, children: [] });
  }

  const roots: CategoryNode[] = [];
  for (const row of rows.results) {
    const node = nodes.get(row.id);
    if (node === undefined) continue;
    const parent = row.parentId !== null ? nodes.get(row.parentId) : undefined;
    if (parent !== undefined) {
      parent.children.push(node);
    } else {
      // Root, or an orphan that should be impossible under FK RESTRICT —
      // surfaced rather than silently dropped from the tree either way.
      roots.push(node);
    }
  }
  return roots;
}

/** Root-to-leaf ancestry of `id`, resolved in one recursive-CTE query. */
export async function categoryPath(db: D1Database, id: string): Promise<CategorySummary[]> {
  const rows = await db
    .prepare(
      `WITH RECURSIVE ancestry(id, parent_id, name, slug, sort_order, created_at, updated_at, depth) AS (
         SELECT id, parent_id, name, slug, sort_order, created_at, updated_at, 0
         FROM categories WHERE id = ?
         UNION ALL
         SELECT c.id, c.parent_id, c.name, c.slug, c.sort_order, c.created_at, c.updated_at, a.depth + 1
         FROM categories c JOIN ancestry a ON c.id = a.parent_id
       )
       SELECT ${CATEGORY_ROW_COLUMNS}, depth FROM ancestry ORDER BY depth DESC`,
    )
    .bind(id)
    .all<CategoryRow & { depth: number }>();

  if (rows.results.length === 0) {
    throw new AppError("CATEGORY_NOT_FOUND", { message: "No category with that id.", detail: { id } });
  }

  return rows.results.map(({ depth: _depth, ...row }) => row);
}
