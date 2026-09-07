// Owned by node G3.1 (Update Document & Version History), extended by
// G3.2 (Restore & Version Delete Guards).
// Do not add handlers here from any other node.
//
// Mounted at /api/admin/documents by src/api/routes/admin/index.ts,
// alongside (not instead of) admin/documents.ts — the two leaf routers
// share the "/documents" prefix but own disjoint sub-paths.
// Implements (SPEC.md §18 Admin):
//   POST   /api/admin/documents/:slug/versions              -> "/:slug/versions"
//   GET    /api/admin/documents/:slug/versions               -> "/:slug/versions"
//   POST   /api/admin/documents/:slug/restore/:versionNo    -> "/:slug/restore/:versionNo"
//   DELETE /api/admin/documents/:slug/versions/:versionNo    -> "/:slug/versions/:versionNo"
//   GET    /api/admin/documents/:slug/versions/:versionNo/preview-url (G3.4)
//
// Neither restore nor version delete is ever mounted under /api/agent —
// see src/api/routes/agent/index.ts (AGENT.md §6, SPEC.md §18 Agent:
// "No destructive Agent routes").
//
// TRANSPORT ONLY. This file parses the request, authorizes it, hands off
// to VersionService, and shapes the response. It contains no SQL and no
// direct R2/D1 access — that lives in the domain layer (AGENT.md §9, §10).
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../shared/types";
import { AppError } from "../../../shared/errors";
import { ok } from "../../../shared/envelope";
import { requireAdmin } from "../../middleware/admin-auth";
import {
  deleteVersion,
  listVersionHistory,
  resolveVersionIdentity,
  restoreVersion,
  updateDocumentVersion,
} from "../../../domain/versions/version-service";
import {
  DEFAULT_PREVIEW_TTL_SECONDS,
  buildPreviewUrl,
  nowSeconds,
  signPreviewClaim,
  type PreviewClaim,
} from "../../../shared/signing";

const versions = new Hono<{ Bindings: Env }>();

const MAX_NOTE_LENGTH = 500;
const noteSchema = z.string().max(MAX_NOTE_LENGTH).optional();
const versionNoSchema = z.coerce.number().int().positive();

/**
 * A version-number path segment that fails basic shape validation
 * (non-numeric, fractional, zero or negative) can never match a real row,
 * so it is reported the same way an out-of-range number is:
 * VERSION_NOT_FOUND, not a generic 400.
 */
function parseVersionNo(raw: string): number {
  const parsed = versionNoSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("VERSION_NOT_FOUND", {
      message: "Invalid version number.",
      detail: { raw },
    });
  }
  return parsed.data;
}

function documentUrl(env: Env, slug: string): string {
  return `${env.APP_ORIGIN.replace(/\/+$/, "")}/docs/${slug}`;
}

// ---------------------------------------------------------------------------
// POST /:slug/versions — upload new bytes for an existing document.
//
// UNCHANGED is NOT routed through fail(): `ERROR_STATUS` maps the
// `UNCHANGED` code to 409 for the union's sake (SPEC.md §24 lists the
// code), but identical bytes are a successful no-op here, not an error
// (orchestrator clarification on node G3.1). The domain layer never throws
// for this case — `updateDocumentVersion` returns `unchanged: true` — so
// this handler always answers through `ok()`.
// ---------------------------------------------------------------------------
versions.post("/:slug/versions", requireAdmin, async (c) => {
  if (!(c.req.header("content-type") ?? "").includes("multipart/form-data")) {
    throw new AppError("FILE_REQUIRED", {
      message: "Upload must be sent as multipart/form-data.",
    });
  }

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new AppError("FILE_REQUIRED", { message: "No file part was supplied." });
  }

  const noteRaw = form.get("note");
  const parsedNote = noteSchema.safeParse(
    typeof noteRaw === "string" ? noteRaw : undefined,
  );
  if (!parsedNote.success) {
    // Length is the only way this schema can fail — the value reaching it is
    // already narrowed to string | undefined above — so the code says so
    // (PLAN DELTA 2). It used to be the INVALID_HTML catch-all, which node
    // G5.2 hands to MCP agents verbatim: an agent that sent a long note was
    // told to fix its HTML.
    throw new AppError("NOTE_TOO_LONG", {
      message: `Version note must be ${MAX_NOTE_LENGTH} characters or fewer.`,
      detail: parsedNote.error.issues,
    });
  }

  const result = await updateDocumentVersion(
    { db: c.env.DB, docs: c.env.DOCS },
    {
      slug: c.req.param("slug"),
      bytes: await file.arrayBuffer(),
      filename: file.name,
      createdBy: "admin",
      note: parsedNote.data,
    },
  );

  if (result.unchanged) {
    return ok({ unchanged: true, versionId: result.versionId, versionNo: result.versionNo });
  }

  return ok(
    {
      versionId: result.versionId,
      versionNo: result.versionNo,
      unchanged: false,
      url: documentUrl(c.env, result.slug),
    },
    { status: 201 },
  );
});

// ---------------------------------------------------------------------------
// GET /:slug/versions — full version history, newest first.
// ---------------------------------------------------------------------------
versions.get("/:slug/versions", requireAdmin, async (c) => {
  const history = await listVersionHistory(c.env.DB, c.req.param("slug"));
  return ok({ versions: history });
});

// ---------------------------------------------------------------------------
// POST /:slug/restore/:versionNo — append a new current version from an
// older version's bytes (SPEC.md §12 Restore Contract). Always answers
// through ok() at 201: restoring identical bytes still creates a version
// (VersionService.restoreVersion never returns `unchanged`), so there is no
// 200/unchanged branch to handle here, unlike the upload route above.
// ---------------------------------------------------------------------------
versions.post("/:slug/restore/:versionNo", requireAdmin, async (c) => {
  const versionNo = parseVersionNo(c.req.param("versionNo"));

  const result = await restoreVersion(
    { db: c.env.DB, docs: c.env.DOCS },
    {
      slug: c.req.param("slug"),
      versionNo,
      createdBy: "admin",
    },
  );

  return ok(
    {
      versionId: result.versionId,
      versionNo: result.versionNo,
      restoredFromVersionNo: result.restoredFromVersionNo,
    },
    { status: 201 },
  );
});

// ---------------------------------------------------------------------------
// DELETE /:slug/versions/:versionNo — permanently remove one non-current,
// non-last version (SPEC.md §13 Delete Rules). Guard precedence lives in
// VersionService.deleteVersion, not here.
// ---------------------------------------------------------------------------
versions.delete("/:slug/versions/:versionNo", requireAdmin, async (c) => {
  const versionNo = parseVersionNo(c.req.param("versionNo"));

  const result = await deleteVersion(
    { db: c.env.DB, docs: c.env.DOCS },
    {
      slug: c.req.param("slug"),
      versionNo,
    },
  );

  return ok({ deletedVersionNo: result.deletedVersionNo });
});

// ---------------------------------------------------------------------------
// GET /:slug/versions/:versionNo/preview-url — node G3.4.
//
// Mints a short-lived signed URL on the CONTENT origin for one historical
// version. Only this URL crosses over; no admin session material is ever
// handed to the content origin, which is the whole point of keeping the two
// origins apart (AGENT.md §8).
//
// The expiry is computed here from the configured lifetime — a caller
// cannot ask for a longer-lived link, the same rule signToken() applies to
// admin sessions.
// ---------------------------------------------------------------------------
versions.get("/:slug/versions/:versionNo/preview-url", requireAdmin, async (c) => {
  const versionNo = parseVersionNo(c.req.param("versionNo"));

  const identity = await resolveVersionIdentity(c.env.DB, c.req.param("slug"), versionNo);

  const claim: PreviewClaim = {
    documentId: identity.documentId,
    versionId: identity.versionId,
    exp: nowSeconds() + DEFAULT_PREVIEW_TTL_SECONDS,
  };
  const signature = await signPreviewClaim(claim, c.env.CONTENT_PREVIEW_SIGNING_SECRET);

  return ok({
    url: buildPreviewUrl(c.env.CONTENT_ORIGIN, claim, signature),
    expiresAt: new Date(claim.exp * 1000).toISOString(),
  });
});

export default versions;
