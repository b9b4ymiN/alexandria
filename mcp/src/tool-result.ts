// Shared CallToolResult builders (node G5.2 requirement 5, requirement 6).
//
// A tool reports failure by returning `{ isError: true, ... }`, never by
// throwing (MCP SDK v2 convention) — every code path here is a normal
// return.
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { ApiResult } from "./api-client.js";

/** A local validation failure, before any network call was made. */
export function localError(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

/** An API-level failure (SPEC.md §24 error code) or a transport failure,
 * surfaced verbatim so the calling agent can act on the code
 * (node G5.2 requirement 5, edge case CATEGORY_NOT_FOUND). */
export function apiError(result: { kind: "api-error"; code: string; message: string } | { kind: "transport-error"; message: string }): CallToolResult {
  const text =
    result.kind === "api-error" ? `${result.code}: ${result.message}` : `TRANSPORT_ERROR: ${result.message}`;
  return { isError: true, content: [{ type: "text", text }] };
}

export function success(text: string, structuredContent?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent !== undefined ? { structuredContent } : {}),
  };
}

/** Runs `fn`, returning either its success result or a formatted
 * {@link apiError} — the one place every write tool routes a non-`ok`
 * {@link ApiResult} through. */
export function isApiOk<T>(result: ApiResult<T>): result is { kind: "ok"; data: T } {
  return result.kind === "ok";
}
