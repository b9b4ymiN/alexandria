// Typed client for the Alexandria API envelope.
//
// Written by node G1.10. Every response the API produces is either
// { ok: true, data } or { ok: false, error: { code, message } } (SPEC.md
// §18), so unwrapping belongs in one place rather than in every component.

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

export function listDocuments(params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.pageSize !== undefined) query.set("pageSize", String(params.pageSize));
  const suffix = query.toString() === "" ? "" : `?${query.toString()}`;
  return request<Paginated<DocumentSummary>>(`/api/public/documents${suffix}`);
}

export function getDocument(slug: string) {
  return request<DocumentDetail>(`/api/public/documents/${encodeURIComponent(slug)}`);
}

export function listPublicCategories() {
  return request<{ categories: CategoryListEntry[] }>("/api/public/categories");
}
