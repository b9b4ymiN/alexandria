// Thin HTTP client for the Alexandria Agent API (SPEC.md §18).
//
// Node G5.2 requirement 8: no HTTP client dependency — this uses the
// global `fetch`/`FormData`/`Blob` Node provides (Node >= 20). Requirement
// 3: every request carries `Authorization: Bearer <agentKey>`, and the
// key is only ever placed in that header — never returned, logged, or
// echoed into an error message. `fetchFn` is a constructor parameter
// (not a hardcoded global reference) purely so a test can inject a spy to
// prove "no network call happened" for local-validation failures and to
// simulate API responses without a live server (node G5.2 §4.e, Tests
// Required).
//
// This module performs no domain logic: it sends exactly the request
// shapes src/api/routes/agent/documents.ts expects and returns the
// envelope's `data` or `error` unchanged (requirement 4, requirement 5).

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

interface OkEnvelope<T> {
  ok: true;
  data: T;
}

interface ErrorEnvelope {
  ok: false;
  error: { code: string; message: string };
}

/** Successful call: the API's `data`. */
export interface ApiOk<T> {
  kind: "ok";
  data: T;
}

/** The API responded with `{ ok: false, error }` — a domain-level failure
 * (SPEC.md §24), e.g. CATEGORY_NOT_FOUND or AGENT_KEY_INVALID. Surfaced
 * verbatim (node G5.2 requirement 5). */
export interface ApiError {
  kind: "api-error";
  code: string;
  message: string;
}

/** The request never got a well-formed envelope back: the network call
 * failed, or the response body was not the expected JSON shape. */
export interface ApiTransportError {
  kind: "transport-error";
  message: string;
}

export type ApiResult<T> = ApiOk<T> | ApiError | ApiTransportError;

export interface ApiClientDeps {
  apiUrl: string;
  agentKey: string;
  fetchFn?: FetchFn;
}

export interface UploadDocumentInput {
  bytes: Buffer;
  filename: string;
  categoryId: string;
  title?: string;
  description?: string;
  tags?: string[];
  note?: string;
}

export interface UploadDocumentData {
  documentId: string;
  slug: string;
  versionId: string;
  versionNo: number;
  title: string;
  description: string;
  tags: string[];
  url: string;
}

export interface UpdateDocumentVersionInput {
  slug: string;
  bytes: Buffer;
  filename: string;
  note?: string;
}

export interface UpdateDocumentVersionData {
  versionId: string;
  versionNo: number;
  unchanged: boolean;
  url?: string;
}

export interface UpdateMetadataInput {
  slug: string;
  title?: string;
  description?: string;
  tags?: string[];
}

export interface MoveDocumentInput {
  slug: string;
  categoryId: string;
}

export interface DocumentMetadataData {
  documentId: string;
  slug: string;
  title: string;
  description: string;
  categoryId: string;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  url: string;
}

// ---------------------------------------------------------------------------
// Read tools (node G5.3) — GET /api/agent/documents[/:slug], /categories,
// /tags. Every shape below mirrors its route's actual response exactly
// (src/api/routes/agent/documents.ts, categories.ts, tags.ts) rather than
// reusing DocumentMetadataData above: GET /:slug returns a DocumentDetail
// (`contentUrl`, no `createdAt`), a different shape from the
// DocumentMetadataResult the write routes return (`url`, `createdAt`) —
// node G5.3 requirement 3.
// ---------------------------------------------------------------------------

export interface CategoryPathEntryData {
  id: string;
  name: string;
  slug: string;
}

export interface DocumentSummaryData {
  slug: string;
  title: string;
  description: string;
  categoryPath: CategoryPathEntryData[];
  tags: string[];
  updatedAt: string;
}

/** GET /api/agent/documents/:slug — metadata and the public content URL
 * only. No field here ever carries HTML body bytes (requirement 3). */
export interface GetDocumentData extends DocumentSummaryData {
  documentId: string;
  categoryId: string;
  currentVersionId: string;
  contentUrl: string;
}

export interface ListDocumentsInput {
  page?: number;
  pageSize?: number;
  /** Omitted (or empty) for `list_documents`; set for `search_documents`.
   * Both tools share this one method (requirement 4) — the presence of a
   * query is the only thing that distinguishes them. */
  query?: string;
  categoryId?: string;
  tag?: string;
  /** Defaults to `"subtree"` on the API side when `categoryId` is set. */
  depth?: "self" | "subtree";
}

export interface ListDocumentsData {
  items: DocumentSummaryData[];
  page: number;
  pageSize: number;
  total: number;
  query: string;
}

export interface CategoryEntryData {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  sortOrder: number;
  documentCount: number;
}

export interface ListCategoriesData {
  categories: CategoryEntryData[];
}

export interface TagEntryData {
  id: string;
  name: string;
  documentCount: number;
}

/**
 * Narrows to a well-formed error envelope. `ok === false` alone is NOT
 * enough: the guard also proves `error.code` and `error.message` are
 * strings before the caller reads them. A body that says `ok: false` but
 * carries no usable error — a proxy or edge that answers JSON of its own
 * shape, say — must fall through to the transport-error branch, because a
 * TypeError thrown here would escape the tool callback and reach the agent
 * as a protocol failure instead of the readable tool error this whole
 * package exists to produce (node G5.2 requirement 5).
 */
function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (typeof body !== "object" || body === null) return false;
  const envelope = body as { ok?: unknown; error?: unknown };
  if (envelope.ok !== false) return false;
  const error = envelope.error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function isOkEnvelope<T>(body: unknown): body is OkEnvelope<T> {
  return (
    typeof body === "object" &&
    body !== null &&
    "ok" in body &&
    (body as { ok: unknown }).ok === true
  );
}

export class AgentApiClient {
  private readonly baseUrl: string;
  private readonly agentKey: string;
  private readonly fetchFn: FetchFn;

  constructor(deps: ApiClientDeps) {
    this.baseUrl = deps.apiUrl.replace(/\/+$/, "");
    this.agentKey = deps.agentKey;
    this.fetchFn = deps.fetchFn ?? fetch;
  }

  private async send<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.agentKey}`);

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, { ...init, headers });
    } catch (error) {
      return {
        kind: "transport-error",
        message: `Could not reach the Alexandria API at ${this.baseUrl}: ${errorMessage(error)}`,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        kind: "transport-error",
        message: `The Alexandria API returned a non-JSON response (HTTP ${response.status}).`,
      };
    }

    if (isErrorEnvelope(body)) {
      return { kind: "api-error", code: body.error.code, message: body.error.message };
    }
    if (isOkEnvelope<T>(body)) {
      return { kind: "ok", data: body.data };
    }
    return {
      kind: "transport-error",
      message: `The Alexandria API returned an unrecognized response shape (HTTP ${response.status}).`,
    };
  }

  async uploadDocument(input: UploadDocumentInput): Promise<ApiResult<UploadDocumentData>> {
    const form = new FormData();
    form.set("file", new Blob([bufferToArrayBuffer(input.bytes)], { type: "text/html" }), input.filename);
    form.set("categoryId", input.categoryId);
    if (input.title !== undefined) form.set("title", input.title);
    if (input.description !== undefined) form.set("description", input.description);
    if (input.tags !== undefined) form.set("tags", JSON.stringify(input.tags));
    if (input.note !== undefined) form.set("note", input.note);

    return this.send<UploadDocumentData>("/api/agent/documents", { method: "POST", body: form });
  }

  async updateDocumentVersion(
    input: UpdateDocumentVersionInput,
  ): Promise<ApiResult<UpdateDocumentVersionData>> {
    const form = new FormData();
    form.set("file", new Blob([bufferToArrayBuffer(input.bytes)], { type: "text/html" }), input.filename);
    if (input.note !== undefined) form.set("note", input.note);

    return this.send<UpdateDocumentVersionData>(
      `/api/agent/documents/${encodeURIComponent(input.slug)}/versions`,
      { method: "POST", body: form },
    );
  }

  async updateMetadata(input: UpdateMetadataInput): Promise<ApiResult<DocumentMetadataData>> {
    const payload: Record<string, unknown> = {};
    if (input.title !== undefined) payload.title = input.title;
    if (input.description !== undefined) payload.description = input.description;
    if (input.tags !== undefined) payload.tags = input.tags;

    return this.send<DocumentMetadataData>(`/api/agent/documents/${encodeURIComponent(input.slug)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async moveDocument(input: MoveDocumentInput): Promise<ApiResult<DocumentMetadataData>> {
    return this.send<DocumentMetadataData>(
      `/api/agent/documents/${encodeURIComponent(input.slug)}/move`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryId: input.categoryId }),
      },
    );
  }

  async getDocument(slug: string): Promise<ApiResult<GetDocumentData>> {
    return this.send<GetDocumentData>(`/api/agent/documents/${encodeURIComponent(slug)}`, {
      method: "GET",
    });
  }

  /** Backs both `list_documents` and `search_documents` (requirement 4) —
   * the one place that builds the querystring for
   * GET /api/agent/documents, so the two tools can never drift into two
   * different implementations of the same contract. */
  async listDocuments(input: ListDocumentsInput = {}): Promise<ApiResult<ListDocumentsData>> {
    const params = new URLSearchParams();
    if (input.page !== undefined) params.set("page", String(input.page));
    if (input.pageSize !== undefined) params.set("pageSize", String(input.pageSize));
    if (input.query !== undefined && input.query !== "") params.set("q", input.query);
    if (input.categoryId !== undefined) params.set("categoryId", input.categoryId);
    if (input.tag !== undefined) params.set("tag", input.tag);
    if (input.depth !== undefined) params.set("depth", input.depth);

    const qs = params.toString();
    return this.send<ListDocumentsData>(`/api/agent/documents${qs.length > 0 ? `?${qs}` : ""}`, {
      method: "GET",
    });
  }

  async listCategories(): Promise<ApiResult<ListCategoriesData>> {
    return this.send<ListCategoriesData>("/api/agent/categories", { method: "GET" });
  }

  async listTags(): Promise<ApiResult<TagEntryData[]>> {
    return this.send<TagEntryData[]>("/api/agent/tags", { method: "GET" });
  }
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
