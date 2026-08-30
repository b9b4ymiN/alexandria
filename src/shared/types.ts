// Shared DTO types and the Worker `Env` binding contract.
//
// Written by node G1.2. Domain Services, Hono routes and MCP tools all
// consume these types rather than each inventing their own shape.

// ---------------------------------------------------------------------------
// Env — every binding and secret name a Phase 1 node will need, declared as
// a type contract so downstream nodes compile against a stable `Env` from
// day one. THIS FILE DOES NOT READ any of these bindings or secrets — it
// only types them (IMPLEMENTATION_PLAN.md node G1.2 scope). Wiring the
// actual bindings into wrangler.jsonc belongs to other nodes:
//   DB   (D1Database) — added by G1.1 (binding name "DB", confirmed by the
//                        G1.1 node contract)
//   DOCS (R2Bucket)   — added by G1.5 (binding name "DOCS", confirmed by
//                        the G1.5 node contract)
//   secrets           — added when the node that needs them is authorized
//                        to add a Worker secret (AGENT.md §13):
//                        ADMIN_PASSWORD / ADMIN_SESSION_SIGNING_SECRET (G1.6),
//                        AGENT_API_KEY (G5.1),
//                        CONTENT_PREVIEW_SIGNING_SECRET (G3.4)
// ---------------------------------------------------------------------------
// ORCHESTRATOR ADDITION (2026-08-30): APP_ORIGIN and CONTENT_ORIGIN are
// plain configuration vars, not secrets. They are declared on the shared
// contract rather than re-extended locally by each consumer because BOTH
// G1.7 (which returns an absolute reader URL) and G1.8 (which returns an
// absolute contentUrl) need them, and a shared value declared twice drifts.
// Keeping them in configuration is what lets Alexandria move to a custom
// domain later without a code change (IMPLEMENTATION_PLAN.md §3 Non-Goals,
// "Custom domain ... swappable via configuration").
export interface Env {
  DB: D1Database;
  DOCS: R2Bucket;
  APP_ORIGIN: string;
  CONTENT_ORIGIN: string;
  ADMIN_PASSWORD: string;
  ADMIN_SESSION_SIGNING_SECRET: string;
  AGENT_API_KEY: string;
  CONTENT_PREVIEW_SIGNING_SECRET: string;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Category — mirrors SPEC.md §5 `categories`
// ---------------------------------------------------------------------------
export interface CategoryDTO {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Tag — mirrors SPEC.md §5 `tags`
// ---------------------------------------------------------------------------
export interface TagDTO {
  id: string;
  name: string;
  normalizedName: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Document version — mirrors SPEC.md §5 `document_versions`. The R2 key is
// deliberately not exposed here: it is internal storage identity
// (AGENT.md §12), not a public/API-facing field.
// ---------------------------------------------------------------------------
export interface DocumentVersionDTO {
  id: string;
  documentId: string;
  versionNo: number;
  sha256: string;
  sizeBytes: number;
  createdBy: "admin" | "agent";
  createdAt: string;
  restoredFromVersionNo: number | null;
  note: string;
}

// ---------------------------------------------------------------------------
// Document — mirrors SPEC.md §5 `documents`. `tags` is populated by callers
// that join document_tags; list endpoints may omit it.
// ---------------------------------------------------------------------------
export interface DocumentDTO {
  id: string;
  slug: string;
  title: string;
  description: string;
  categoryId: string;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  tags?: TagDTO[];
}
