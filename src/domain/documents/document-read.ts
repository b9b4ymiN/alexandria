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
 * One page of publicly visible documents.
 *
 * Ordering is `updated_at DESC, id ASC`: the secondary key makes paging
 * stable when several documents share a timestamp, which is common when a
 * batch is published together.
 */
export async function listDocuments(
  db: D1Database,
  params: { page?: number; pageSize?: number } = {},
): Promise<PaginatedResult<DocumentSummary>> {
  const { page, pageSize } = clampPagination(params.page, params.pageSize);

  const totalRow = await db
    .prepare("SELECT COUNT(*) AS total FROM documents WHERE current_version_id IS NOT NULL")
    .first<{ total: number }>();
  const total = totalRow?.total ?? 0;

  const rows = await db
    .prepare(
      `SELECT id, slug, title, description, category_id AS categoryId, updated_at AS updatedAt
       FROM documents
       WHERE current_version_id IS NOT NULL
       ORDER BY updated_at DESC, id ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(pageSize, (page - 1) * pageSize)
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
