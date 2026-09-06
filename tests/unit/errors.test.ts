import { describe, expect, it } from "vitest";
import {
  AppError,
  ERROR_CODES,
  ERROR_STATUS,
  statusForCode,
  type ErrorCode,
} from "../../src/shared/errors";
import { ok, fail } from "../../src/shared/envelope";

// SPEC.md §24 "at minimum" list, Phase 1 subset, PLUS the six TAG_* codes
// node G2.2 was authorized to add additively on 2026-08-30, PLUS
// CONFIRMATION_MISMATCH, authorized for node G3.3 on 2026-09-06 on the same
// footing (SPEC.md §24 opens with "At minimum," so these are authorized
// extensions, not deviations — see the block comments in
// src/shared/errors.ts). DRIA_* and AI_* codes are the Phase 1.5 Dria
// contract (AGENT.md §3, §19) and must be absent.
//
// This list is deliberately hand-written rather than derived from the
// implementation: adding a code to the union alone fails this test, which
// is what forces a new code through review.
const SPEC_PHASE_1_CODES: ErrorCode[] = [
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "AUTH_EXPIRED",
  "AGENT_KEY_INVALID",
  "FILE_REQUIRED",
  "INVALID_FILE_EXTENSION",
  "INVALID_HTML",
  "FILE_TOO_LARGE",
  "TITLE_REQUIRED",
  "CATEGORY_REQUIRED",
  "CATEGORY_NOT_FOUND",
  "CATEGORY_NOT_EMPTY",
  "CATEGORY_CYCLE",
  "CATEGORY_SLUG_CONFLICT",
  "DOCUMENT_NOT_FOUND",
  "SLUG_CONFLICT",
  "SLUG_IMMUTABLE",
  "CONFIRMATION_MISMATCH",
  "VERSION_NOT_FOUND",
  "VERSION_IS_CURRENT",
  "LAST_VERSION_CANNOT_DELETE",
  "UNCHANGED",
  "TAG_NOT_FOUND",
  "TAG_NAME_REQUIRED",
  "TAG_NAME_TOO_LONG",
  "TAG_NAME_CONFLICT",
  "TAG_SELF_MERGE",
  "TAG_LIMIT_EXCEEDED",
  "R2_WRITE_FAILED",
  "R2_READ_FAILED",
  "R2_DELETE_FAILED",
  "DATABASE_ERROR",
];

const PHASE_1_5_CODES = [
  "DRIA_UNAVAILABLE",
  "AI_QUOTA_EXCEEDED",
  "AI_SEARCH_UNAVAILABLE",
  "DOCUMENT_NOT_INDEXED",
  "RETRIEVAL_EMPTY",
];

describe("ErrorCode union", () => {
  it("contains exactly the Phase 1 codes from SPEC.md §24", () => {
    expect(new Set(ERROR_CODES)).toEqual(new Set(SPEC_PHASE_1_CODES));
    expect(ERROR_CODES).toHaveLength(SPEC_PHASE_1_CODES.length);
  });

  it("never contains a DRIA_* or AI_* code", () => {
    for (const forbidden of PHASE_1_5_CODES) {
      expect(ERROR_CODES).not.toContain(forbidden);
    }
    for (const code of ERROR_CODES) {
      expect(code.startsWith("DRIA_")).toBe(false);
      expect(code.startsWith("AI_")).toBe(false);
    }
  });
});

describe("status mapping (total)", () => {
  it("maps every ErrorCode to a numeric status", () => {
    expect(ERROR_CODES.length).toBeGreaterThan(0);
    for (const code of ERROR_CODES) {
      expect(typeof ERROR_STATUS[code]).toBe("number");
      expect(statusForCode(code)).toBe(ERROR_STATUS[code]);
    }
  });

  it("classifies every code into the specified status family", () => {
    const expected: Record<ErrorCode, number> = {
      // auth -> 401
      AUTH_REQUIRED: 401,
      AUTH_INVALID: 401,
      AUTH_EXPIRED: 401,
      AGENT_KEY_INVALID: 401,
      // validation -> 400
      FILE_REQUIRED: 400,
      INVALID_FILE_EXTENSION: 400,
      INVALID_HTML: 400,
      TITLE_REQUIRED: 400,
      CATEGORY_REQUIRED: 400,
      TAG_NAME_REQUIRED: 400,
      TAG_NAME_TOO_LONG: 400,
      TAG_SELF_MERGE: 400,
      TAG_LIMIT_EXCEEDED: 400,
      CONFIRMATION_MISMATCH: 400,
      // size -> 413
      FILE_TOO_LARGE: 413,
      // not-found -> 404
      CATEGORY_NOT_FOUND: 404,
      DOCUMENT_NOT_FOUND: 404,
      VERSION_NOT_FOUND: 404,
      TAG_NOT_FOUND: 404,
      // permission / immutability -> 403
      SLUG_IMMUTABLE: 403,
      VERSION_IS_CURRENT: 403,
      LAST_VERSION_CANNOT_DELETE: 403,
      // conflict -> 409
      CATEGORY_NOT_EMPTY: 409,
      CATEGORY_CYCLE: 409,
      CATEGORY_SLUG_CONFLICT: 409,
      SLUG_CONFLICT: 409,
      UNCHANGED: 409,
      TAG_NAME_CONFLICT: 409,
      // storage / database failure -> 500
      R2_WRITE_FAILED: 500,
      R2_READ_FAILED: 500,
      R2_DELETE_FAILED: 500,
      DATABASE_ERROR: 500,
    };
    expect(ERROR_STATUS).toEqual(expected);
  });
});

describe("AppError", () => {
  it("derives status from ERROR_STATUS and carries an optional detail payload", () => {
    const err = new AppError("DOCUMENT_NOT_FOUND", {
      message: "Document was not found.",
      detail: { slug: "x" },
    });
    expect(err.code).toBe("DOCUMENT_NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Document was not found.");
    expect(err.detail).toEqual({ slug: "x" });
  });

  it("defaults message to the code when none is given", () => {
    const err = new AppError("SLUG_CONFLICT");
    expect(err.message).toBe("SLUG_CONFLICT");
    expect(err.status).toBe(409);
  });
});

describe("envelope helpers", () => {
  it("ok() produces the exact SPEC.md §18 success shape", async () => {
    const res = ok({ hello: "world" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({ ok: true, data: { hello: "world" } });
  });

  it("fail() produces the exact SPEC.md §18 error shape and never leaks detail", async () => {
    const err = new AppError("DOCUMENT_NOT_FOUND", {
      message: "Document was not found.",
      detail: { internalRowId: 42 },
    });
    const res = fail(err);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      error: { code: "DOCUMENT_NOT_FOUND", message: "Document was not found." },
    });
    expect(JSON.stringify(body)).not.toContain("internalRowId");
  });
});
