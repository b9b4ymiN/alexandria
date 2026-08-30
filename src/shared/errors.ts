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

  // 413 — request body exceeds an accepted size
  FILE_TOO_LARGE: 413,

  // 404 — the referenced resource does not exist
  CATEGORY_NOT_FOUND: 404,
  DOCUMENT_NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,

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
