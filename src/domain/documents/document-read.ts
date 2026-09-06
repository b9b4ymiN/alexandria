// Read-side queries for the public Library.
//
// Written by node G1.8. Two rules govern everything here:
//
//   1. NO endpoint in this group ever reads R2. Listing a library must not
//      touch object storage — the document body is fetched only when a
//      reader actually opens the document, from the content origin
//      (TECHSTACK.md §22, AGENT.md §25).
//   2. NO response carries HTML body bytes. Only metadata columns are
//      selected, so a body can never leak into a list payload by accident.
//
// A document with no current version is invisible to the public: it has
// nothing readable, so listing it would produce a dead link.

import { AppError } from "../../shared/errors";
import type { PaginatedResult } from "../../shared/types";
import { normalizeTagName } from "../tags/normalize";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface DocumentSummary {
  slug: string;
  title: string;
  description: string;
  categoryPath: CategoryPathEntry[];
  tags: string[];
  updatedAt: string;
}

export interface CategoryPathEntry {
  id: string;
  name: string;
  slug: string;
}

export interface DocumentDetail extends DocumentSummary {
  documentId: string;
  categoryId: string;
  currentVersionId: string;
  contentUrl: string;
}

export interface CategoryListEntry {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  sortOrder: number;
  documentCount: number;
}

/**
 * `"subtree"` (the default) includes documents filed anywhere under
 * `categoryId`; `"self"` narrows to documents filed directly in it
 * (IMPLEMENTATION_PLAN.md node G2.4, requirement 1).
 */
export type CategoryFilterDepth = "self" | "subtree";

export interface DocumentListParams {
  page?: number;
  pageSize?: number;
  query?: string;
  categoryId?: string;
  /** Defaults to `"subtree"` when `categoryId` is set. */
  depth?: CategoryFilterDepth;
  /** Matched by normalized name (node G2.4 requirement 3). */
  tag?: string;
}

export interface CategoryTreeNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  sortOrder: number;
  /** Documents filed directly in this category. */
  documentCount: number;
  /** Documents filed in this category or anywhere in its subtree. */
  descendantDocumentCount: number;
  children: CategoryTreeNode[];
}

/**
 * Clamps caller-supplied paging into a sane range rather than rejecting it.
 * A nonsense page size is a client bug, not a reason to fail a public read.
 */
export function clampPagination(page?: number, pageSize?: number): { page: number; pageSize: number } {
  const safePage = Number.isFinite(page) && (page as number) >= 1 ? Math.floor(page as number) : 1;
  const requested =
    Number.isFinite(pageSize) && (pageSize as number) >= 1 ? Math.floor(pageSize as number) : DEFAULT_PAGE_SIZE;
  return { page: safePage, pageSize: Math.min(requested, MAX_PAGE_SIZE) };
}

/**
 * Root-to-leaf category path, resolved with a recursive CTE so the whole
 * ancestry costs one query regardless of depth.
 */
async function categoryPath(db: D1Database, categoryId: string): Promise<CategoryPathEntry[]> {
  const result = await db
    .prepare(
      `WITH RECURSIVE ancestry(id, parent_id, name, slug, depth) AS (
         SELECT id, parent_id, name, slug, 0 FROM categories WHERE id = ?
         UNION ALL
         SELECT c.id, c.parent_id, c.name, c.slug, a.depth + 1
         FROM categories c JOIN ancestry a ON c.id = a.parent_id
       )
       SELECT id, name, slug FROM ancestry ORDER BY depth DESC`,
    )
    .bind(categoryId)
    .all<CategoryPathEntry>();
  return result.results;
}

async function tagsFor(db: D1Database, documentIds: readonly string[]): Promise<Map<string, string[]>> {
  const byDocument = new Map<string, string[]>();
  for (const id of documentIds) {
    byDocument.set(id, []);
  }
  if (documentIds.length === 0) {
    return byDocument;
  }
  const placeholders = documentIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT dt.document_id AS documentId, t.name AS name
       FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
       WHERE dt.document_id IN (${placeholders})
       ORDER BY t.normalized_name`,
    )
    .bind(...documentIds)
    .all<{ documentId: string; name: string }>();
  for (const row of rows.results) {
    byDocument.get(row.documentId)?.push(row.name);
  }
  return byDocument;
}

/**
 * Every category id in the filter scope of `categoryId`: just itself for
 * `depth: "self"`, or itself plus every descendant (the default) — resolved
 * with ONE recursive query regardless of subtree size, the same pattern
 * `moveCategory`'s cycle guard uses (src/domain/categories/category-service.ts).
 * Throws `CATEGORY_NOT_FOUND` when `categoryId` does not exist, since an
 * empty scope would otherwise be indistinguishable from "category exists
 * but has nothing in it" (IMPLEMENTATION_PLAN.md node G2.4 edge case).
 */
async function resolveCategoryScope(
  db: D1Database,
  categoryId: string,
  depth: CategoryFilterDepth | undefined,
): Promise<string[]> {
  if (depth === "self") {
    const row = await db.prepare("SELECT 1 AS present FROM categories WHERE id = ?").bind(categoryId).first<{
      present: number;
    }>();
    if (row === null) {
      throw new AppError("CATEGORY_NOT_FOUND", { message: "No category with that id.", detail: { categoryId } });
    }
    return [categoryId];
  }

  const subtree = await db
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM categories WHERE id = ?
         UNION ALL
         SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
       )
       SELECT id FROM subtree`,
    )
    .bind(categoryId)
    .all<{ id: string }>();

  if (subtree.results.length === 0) {
    throw new AppError("CATEGORY_NOT_FOUND", { message: "No category with that id.", detail: { categoryId } });
  }
  return subtree.results.map((row) => row.id);
}

/**
 * One page of publicly visible documents.
 *
 * Ordering is `updated_at DESC, id ASC`: the secondary key makes paging
 * stable when several documents share a timestamp, which is common when a
 * batch is published together.
 */
export async function listDocuments(db: D1Database, params: DocumentListParams = {}): Promise<PaginatedResult<DocumentSummary>> {
  const { page, pageSize } = clampPagination(params.page, params.pageSize);
  const query = params.query?.trim().slice(0, 160);
  const categoryId = params.categoryId?.trim().slice(0, 160);
  const tag = params.tag?.trim().slice(0, 160);
  const filters = ["d.current_version_id IS NOT NULL"];
  const bindings: string[] = [];

  if (categoryId !== undefined && categoryId !== "") {
    const scopeIds = await resolveCategoryScope(db, categoryId, params.depth);
    const placeholders = scopeIds.map(() => "?").join(", ");
    filters.push(`d.category_id IN (${placeholders})`);
    bindings.push(...scopeIds);
  }

  if (tag !== undefined && tag !== "") {
    // Unknown tag name deliberately raises no error — a tag may simply have
    // no documents, and that is an empty page, not a failure (edge case).
    const normalizedTag = normalizeTagName(tag);
    filters.push(
      `EXISTS (
        SELECT 1
        FROM document_tags dt_scope
        JOIN tags t_scope ON t_scope.id = dt_scope.tag_id
        WHERE dt_scope.document_id = d.id AND t_scope.normalized_name = ?
      )`,
    );
    bindings.push(normalizedTag);
  }

  if (query !== undefined && query !== "") {
    const pattern = `%${query.toLocaleLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
    filters.push(`(
      LOWER(d.title) LIKE ? ESCAPE '\\'
      OR LOWER(d.description) LIKE ? ESCAPE '\\'
      OR LOWER(c.name) LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM document_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.document_id = d.id AND LOWER(t.name) LIKE ? ESCAPE '\\'
      )
    )`);
    bindings.push(pattern, pattern, pattern, pattern);
  }

  const where = filters.join(" AND ");

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM documents d JOIN categories c ON c.id = d.category_id WHERE ${where}`)
    .bind(...bindings)
    .first<{ total: number }>();
  const total = totalRow?.total ?? 0;

  const rows = await db
    .prepare(
      `SELECT d.id, d.slug, d.title, d.description, d.category_id AS categoryId, d.updated_at AS updatedAt
       FROM documents d JOIN categories c ON c.id = d.category_id
       WHERE ${where}
       ORDER BY d.updated_at DESC, d.id ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, pageSize, (page - 1) * pageSize)
    .all<{
      id: string;
      slug: string;
      title: string;
      description: string;
      categoryId: string;
      updatedAt: string;
    }>();

  const tagMap = await tagsFor(
    db,
    rows.results.map((row) => row.id),
  );
  const paths = new Map<string, CategoryPathEntry[]>();
  for (const row of rows.results) {
    if (!paths.has(row.categoryId)) {
      paths.set(row.categoryId, await categoryPath(db, row.categoryId));
    }
  }

  return {
    page,
    pageSize,
    total,
    items: rows.results.map((row) => ({
      slug: row.slug,
      title: row.title,
      description: row.description,
      categoryPath: paths.get(row.categoryId) ?? [],
      tags: tagMap.get(row.id) ?? [],
      updatedAt: row.updatedAt,
    })),
  };
}

/**
 * Full metadata for one document, including the absolute URL the Reader
 * points its iframe at.
 *
 * `contentUrl` is built here from configuration rather than assembled by
 * the browser, so no client ever hard-codes the content origin and the
 * origin can change without a frontend release.
 */
export async function getDocumentBySlug(
  db: D1Database,
  slug: string,
  contentOrigin: string,
): Promise<DocumentDetail> {
  const row = await db
    .prepare(
      `SELECT id, slug, title, description, category_id AS categoryId,
              current_version_id AS currentVersionId, updated_at AS updatedAt
       FROM documents WHERE slug = ?`,
    )
    .bind(slug)
    .first<{
      id: string;
      slug: string;
      title: string;
      description: string;
      categoryId: string;
      currentVersionId: string | null;
      updatedAt: string;
    }>();

  if (row === null || row.currentVersionId === null) {
    throw new AppError("DOCUMENT_NOT_FOUND", {
      message: "No published document with that slug.",
      detail: { slug },
    });
  }

  const tagMap = await tagsFor(db, [row.id]);

  return {
    documentId: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    categoryId: row.categoryId,
    categoryPath: await categoryPath(db, row.categoryId),
    tags: tagMap.get(row.id) ?? [],
    updatedAt: row.updatedAt,
    currentVersionId: row.currentVersionId,
    contentUrl: `${contentOrigin.replace(/\/+$/, "")}/d/${row.slug}`,
  };
}

/** Every category with the number of publicly visible documents filed directly in it. */
export async function listCategories(db: D1Database): Promise<CategoryListEntry[]> {
  const rows = await db
    .prepare(
      `SELECT c.id AS id, c.parent_id AS parentId, c.name AS name, c.slug AS slug,
              c.sort_order AS sortOrder,
              (SELECT COUNT(*) FROM documents d
                WHERE d.category_id = c.id AND d.current_version_id IS NOT NULL) AS documentCount
       FROM categories c
       ORDER BY c.sort_order ASC, c.name ASC`,
    )
    .all<CategoryListEntry>();
  return rows.results;
}

/**
 * The full category tree for the public Library, nested, with both a
 * direct `documentCount` and a whole-subtree `descendantDocumentCount` on
 * every node.
 *
 * Both counts come from ONE recursive query — never one query per node, so
 * a deep tree costs the same as a shallow one (IMPLEMENTATION_PLAN.md node
 * G2.4, requirement 2). `descend` walks every category down to every
 * descendant once; grouping by `ancestor_id` turns that into a
 * subtree-aggregate count per category in the same statement. Nesting is
 * then built in memory from the single flat result set, the same
 * Map-based approach `categoryTree()` uses in
 * src/domain/categories/category-service.ts.
 */
export async function categoryTreeWithCounts(db: D1Database): Promise<CategoryTreeNode[]> {
  const rows = await db
    .prepare(
      `WITH RECURSIVE descend(ancestor_id, id) AS (
         SELECT id, id FROM categories
         UNION ALL
         SELECT d.ancestor_id, c.id
         FROM categories c JOIN descend d ON c.parent_id = d.id
       ),
       descendant_counts AS (
         SELECT descend.ancestor_id AS categoryId, COUNT(doc.id) AS total
         FROM descend
         LEFT JOIN documents doc
           ON doc.category_id = descend.id AND doc.current_version_id IS NOT NULL
         GROUP BY descend.ancestor_id
       ),
       direct_counts AS (
         SELECT category_id AS categoryId, COUNT(*) AS total
         FROM documents
         WHERE current_version_id IS NOT NULL
         GROUP BY category_id
       )
       SELECT c.id AS id, c.parent_id AS parentId, c.name AS name, c.slug AS slug,
              c.sort_order AS sortOrder,
              COALESCE(dir.total, 0) AS documentCount,
              COALESCE(dc.total, 0) AS descendantDocumentCount
       FROM categories c
       LEFT JOIN direct_counts dir ON dir.categoryId = c.id
       LEFT JOIN descendant_counts dc ON dc.categoryId = c.id
       ORDER BY c.sort_order ASC, c.name ASC`,
    )
    .all<{
      id: string;
      parentId: string | null;
      name: string;
      slug: string;
      sortOrder: number;
      documentCount: number;
      descendantDocumentCount: number;
    }>();

  const nodes = new Map<string, CategoryTreeNode>();
  for (const row of rows.results) {
    nodes.set(row.id, { ...row, children: [] });
  }

  const roots: CategoryTreeNode[] = [];
  for (const row of rows.results) {
    const node = nodes.get(row.id);
    if (node === undefined) continue;
    const parent = row.parentId !== null ? nodes.get(row.parentId) : undefined;
    if (parent !== undefined) {
      parent.children.push(node);
    } else {
      // Root, or an orphan that should be impossible under FK RESTRICT —
      // surfaced rather than silently dropped from the tree either way
      // (same reasoning as categoryTree() in category-service.ts).
      roots.push(node);
    }
  }
  return roots;
}
