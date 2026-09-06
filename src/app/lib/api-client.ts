// Typed client for the Alexandria API envelope.
//
// Written by node G1.10. Every response the API produces is either
// { ok: true, data } or { ok: false, error: { code, message } } (SPEC.md
// §18), so unwrapping belongs in one place rather than in every component.
//
// This file is imported by PUBLIC routes (reader.tsx, library.tsx,
// category.tsx) as well as Admin ones, and Vite's dev server resolves an
// `import` statement eagerly, with no bundling or tree-shaking, so a
// top-level `import ... from "./admin-session"` here would fetch
// admin-session.ts on every public page load. That is exactly what
// library.spec.ts/public-browse.spec.ts "never downloads admin code while
// browsing" and AGENT.md §25 "lazy load Admin" rule out — see the
// node G3.5 section below for why its request functions live elsewhere.
export interface ApiErrorShape {
  code: string;
  message: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, error: ApiErrorShape) {
    super(error.message);
    this.name = "ApiError";
    this.code = error.code;
    this.status = status;
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: ApiErrorShape };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, init);

  let envelope: Envelope<T>;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError(response.status, {
      code: "INVALID_RESPONSE",
      message: "The server returned a response that could not be read.",
    });
  }

  if (!envelope.ok) {
    throw new ApiError(response.status, envelope.error);
  }
  return envelope.data;
}

export interface CategoryPathEntry {
  id: string;
  name: string;
  slug: string;
}

export interface DocumentSummary {
  slug: string;
  title: string;
  description: string;
  categoryPath: CategoryPathEntry[];
  tags: string[];
  updatedAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  documentId: string;
  categoryId: string;
  currentVersionId: string;
  /**
   * Absolute URL on the CONTENT origin. Always taken from the API and never
   * assembled in the browser, so the content origin can change without a
   * frontend release and no component can accidentally point the iframe at
   * the app origin (SPEC.md §16).
   */
  contentUrl: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
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
 * A node in the public category tree (`GET /api/public/categories`, node
 * G2.4). `documentCount` is direct membership; `descendantDocumentCount` is
 * the whole subtree — the number a "browse this category" click actually
 * shows, since the category filter defaults to the subtree (node G2.6).
 */
export interface CategoryTreeNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  sortOrder: number;
  documentCount: number;
  descendantDocumentCount: number;
  children: CategoryTreeNode[];
}

export interface TagSummary {
  id: string;
  name: string;
  documentCount: number;
}

export function listDocuments(
  params: { page?: number; pageSize?: number; query?: string; categoryId?: string; tag?: string } = {},
) {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.pageSize !== undefined) query.set("pageSize", String(params.pageSize));
  if (params.query !== undefined) query.set("query", params.query);
  if (params.categoryId !== undefined) query.set("categoryId", params.categoryId);
  if (params.tag !== undefined) query.set("tag", params.tag);
  const suffix = query.toString() === "" ? "" : `?${query.toString()}`;
  return request<Paginated<DocumentSummary>>(`/api/public/documents${suffix}`);
}

export function getDocument(slug: string) {
  return request<DocumentDetail>(`/api/public/documents/${encodeURIComponent(slug)}`);
}

/** The nested tree, fetched once per page (node G2.6 requirement 7) — never per node. */
export function listPublicCategories() {
  return request<{ categories: CategoryTreeNode[] }>("/api/public/categories");
}

/** Every public tag, fetched once per page — never once per chip. */
export function listPublicTags() {
  return request<TagSummary[]>("/api/public/tags");
}

/**
 * Walks the tree matching one slug per level, root first. Sibling slugs are
 * unique (enforced in `categories`, D1 UNIQUE(parent_id, slug) — including
 * the NULL/root level), so a given path resolves to at most one chain; this
 * is what makes `/category/*` routing unambiguous (node G2.6 stop
 * condition). Returns `null` when any segment fails to match, which is the
 * "unknown category path" case the route renders as not-found.
 */
export function findCategoryChain(tree: CategoryTreeNode[], segments: readonly string[]): CategoryTreeNode[] | null {
  if (segments.length === 0) return null;
  const chain: CategoryTreeNode[] = [];
  let level = tree;
  for (const segment of segments) {
    const match = level.find((node) => node.slug === segment);
    if (match === undefined) return null;
    chain.push(match);
    level = match.children;
  }
  return chain;
}

/** Builds a shareable `/category/...` URL from an ordered list of slugs. */
export function categoryPathHref(segments: readonly string[]): string {
  return `/category/${segments.map(encodeURIComponent).join("/")}`;
}

// ---------------------------------------------------------------------------
// Version history types — node G3.5.
//
// TYPES ONLY, deliberately no functions and no `adminRequest` import (see
// the file-level comment above). Every one of these six endpoints is
// bearer-authenticated (`requireAdmin`, src/api/routes/admin/versions.ts
// and admin/documents.ts), so the request functions that call them live
// next to their one caller instead — inline in
// src/app/routes/admin/document-edit.tsx and
// src/app/features/versions/VersionPreview.tsx — calling `adminRequest`
// directly, exactly the way every other Admin screen already does
// (categories.tsx, tags.tsx, UploadForm.tsx). Only the response shapes are
// shared from here, and a `type`-only import costs the public bundle
// nothing.
// ---------------------------------------------------------------------------

export interface VersionHistoryEntry {
  versionNo: number;
  versionId: string;
  sizeBytes: number;
  sha256: string;
  createdBy: "admin" | "agent";
  createdAt: string;
  note: string;
  restoredFromVersionNo: number | null;
  isCurrent: boolean;
}

export interface UploadVersionResult {
  unchanged: boolean;
  versionId: string;
  versionNo: number;
  url?: string;
}

export interface RestoreVersionResult {
  versionId: string;
  versionNo: number;
  restoredFromVersionNo: number;
}

export interface DeleteDocumentResult {
  deleted: true;
  documentId: string;
  versionsDeleted: number;
  r2ObjectsDeleted: number;
  r2ObjectsFailed: number;
}

export interface VersionPreviewUrl {
  url: string;
  expiresAt: string;
}
