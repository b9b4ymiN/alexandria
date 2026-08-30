// Shared error vocabulary for the Alexandria API (Hono routes), MCP server,
// and any future consumer of Domain Services.
//
// Written by node G1.2. Every Domain Service, Hono route and MCP tool
// throws an AppError built from one of these codes — no consumer invents a
// new code or a second error shape.
//
// Scope: Phase 1 codes only, taken verbatim from SPEC.md §24. DRIA_* and
// AI_* codes belong to the Phase 1.5 Dria plan and are intentionally
// absent here (AGENT.md §3, §19; IMPLEMENTATION_PLAN.md Non-Goals).

export type ErrorCode =
  // Auth
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "AUTH_EXPIRED"
  | "AGENT_KEY_INVALID"
  // Upload / file validation
  | "FILE_REQUIRED"
  | "INVALID_FILE_EXTENSION"
  | "INVALID_HTML"
  | "FILE_TOO_LARGE"
  // Metadata validation
  | "TITLE_REQUIRED"
  | "CATEGORY_REQUIRED"
  | "CATEGORY_NOT_FOUND"
  | "CATEGORY_NOT_EMPTY"
  | "CATEGORY_CYCLE"
  | "CATEGORY_SLUG_CONFLICT"
  // Document / slug
  | "DOCUMENT_NOT_FOUND"
  | "SLUG_CONFLICT"
  | "SLUG_IMMUTABLE"
  // Version
  | "VERSION_NOT_FOUND"
  | "VERSION_IS_CURRENT"
  | "LAST_VERSION_CANNOT_DELETE"
  | "UNCHANGED"
  // Tag (IMPLEMENTATION_PLAN.md node G2.2, authorized 2026-08-30: SPEC.md
  // §24 opens with "At minimum," and lists no TAG_* code — these six are
  // additive extensions the orchestrator approved for G2.2, not codes
  // invented outside the plan. Names carry the TAG_ prefix like every other
  // domain, and the statuses follow the same bands as CATEGORY_*: a
  // not-found is 404, a request that can never succeed regardless of state
  // (self-merge, a name that is invalid on its face) is 400, and a
  // conflict that depends on what else currently exists is 409.
  | "TAG_NOT_FOUND"
  | "TAG_NAME_REQUIRED"
  | "TAG_NAME_TOO_LONG"
  | "TAG_NAME_CONFLICT"
  | "TAG_SELF_MERGE"
  | "TAG_LIMIT_EXCEEDED"
  // Storage / infra
  | "R2_WRITE_FAILED"
  | "R2_READ_FAILED"
  | "R2_DELETE_FAILED"
  | "DATABASE_ERROR";

/**
 * Explicit, TOTAL mapping from every Phase 1 ErrorCode to its HTTP status
 * (IMPLEMENTATION_PLAN.md node G1.2, requirement 2):
 *   auth                       -> 401
 *   permission / immutability  -> 403
 *   not-found                  -> 404
 *   conflict                   -> 409
 *   validation                 -> 400
 *   size                       -> 413
 *   storage / database failure -> 500
 *
 * "Total" means every member of ErrorCode has an entry here. TypeScript's
 * `Record<ErrorCode, number>` already enforces that at compile time; the
 * negative test in tests/unit/errors.test.ts additionally iterates
 * ERROR_CODES at runtime so the check survives even if this type is ever
 * loosened.
 */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  // 401 — caller is not authenticated, or presented an invalid credential
  AUTH_REQUIRED: 401,
  AUTH_INVALID: 401,
  AUTH_EXPIRED: 401,
  AGENT_KEY_INVALID: 401,

  // 400 — the request itself is malformed or missing required data
  FILE_REQUIRED: 400,
  INVALID_FILE_EXTENSION: 400,
  INVALID_HTML: 400,
  TITLE_REQUIRED: 400,
  CATEGORY_REQUIRED: 400,
  TAG_NAME_REQUIRED: 400,
  TAG_NAME_TOO_LONG: 400,
  // A tag merged into itself can never succeed regardless of what else
  // exists, so it is 400 (invalid on its face), not 409 (see the TAG block
  // comment on the ErrorCode union above).
  TAG_SELF_MERGE: 400,
  TAG_LIMIT_EXCEEDED: 400,

  // 413 — request body exceeds an accepted size
  FILE_TOO_LARGE: 413,

  // 404 — the referenced resource does not exist
  CATEGORY_NOT_FOUND: 404,
  DOCUMENT_NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  TAG_NOT_FOUND: 404,

  // 403 — request is understood but forbidden by a permission or
  // immutability invariant, not by a missing/invalid credential
  SLUG_IMMUTABLE: 403,
  VERSION_IS_CURRENT: 403,
  LAST_VERSION_CANNOT_DELETE: 403,

  // 409 — the request conflicts with the current state of the resource
  CATEGORY_NOT_EMPTY: 409,
  CATEGORY_CYCLE: 409,
  CATEGORY_SLUG_CONFLICT: 409,
  SLUG_CONFLICT: 409,
  UNCHANGED: 409,
  TAG_NAME_CONFLICT: 409,

  // 500 — storage or database failure, not the caller's fault
  R2_WRITE_FAILED: 500,
  R2_READ_FAILED: 500,
  R2_DELETE_FAILED: 500,
  DATABASE_ERROR: 500,
};

/**
 * Every Phase 1 error code, derived from ERROR_STATUS so the code list and
 * the status mapping can never drift apart.
 */
export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

export function statusForCode(code: ErrorCode): number {
  return ERROR_STATUS[code];
}

export interface AppErrorOptions {
  /** Human-readable message. Defaults to the code itself when omitted. */
  message?: string;
  /**
   * Optional internal detail for server-side logging only. AppError never
   * serializes this to a client response — see src/shared/envelope.ts
   * `fail()`, which reads only `code` and `message`.
   */
  detail?: unknown;
}

/**
 * The one error type every Domain Service, route and MCP tool throws.
 * `status` is derived from `code` via ERROR_STATUS, so it can never
 * disagree with the canonical mapping above.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: unknown;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? code);
    this.name = "AppError";
    this.code = code;
    this.status = statusForCode(code);
    this.detail = options.detail;
  }
}
