// Owned by node G5.1 (Agent Auth & Agent API Routes).
// Do not add handlers here from any other node.
//
// Mounted at /api/agent/documents by src/api/routes/agent/index.ts.
// Implements (SPEC.md §18 Agent — no destructive routes):
//   POST  /api/agent/documents               -> "/"
//   GET   /api/agent/documents                -> "/"
//   GET   /api/agent/documents/:slug          -> "/:slug"
//   PATCH /api/agent/documents/:slug          -> "/:slug"
//   POST  /api/agent/documents/:slug/versions -> "/:slug/versions"
//   POST  /api/agent/documents/:slug/move     -> "/:slug/move"
//
// TRANSPORT ONLY, exactly like the Admin route files this mirrors
// (src/api/routes/admin/documents.ts, admin/versions.ts,
// public/documents.ts): parses the request, authorizes it via
// requireAgent, delegates to the same Domain Services the Admin UI uses,
// and shapes the response. No SQL and no R2 access appears here
// (AGENT.md §6, §9, §10; node G5.1 requirement 6) — every read and write
// below is a call into src/domain/**.
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../shared/types";
import { AppError } from "../../../shared/errors";
import { ok } from "../../../shared/envelope";
import { requireAgent } from "../../middleware/agent-auth";
import { createDocument, moveDocument, updateDocumentMetadata } from "../../../domain/documents/document-service";
import { getDocumentBySlug, listDocuments } from "../../../domain/documents/document-read";
import { updateDocumentVersion } from "../../../domain/versions/version-service";
import { validateSearchQuery } from "../../../domain/search/metadata-search-service";

const documents = new Hono<{ Bindings: Env }>();

const MAX_TAGS = 20;
const MAX_NOTE_LENGTH = 500;

function documentUrl(env: Env, slug: string): string {
  return `${env.APP_ORIGIN.replace(/\/+$/, "")}/docs/${slug}`;
}

/**
 * Requirement 5: a request body carrying `slug` is REJECTED with
 * SLUG_IMMUTABLE rather than silently ignored, checked against the RAW
 * parsed body before any schema strips or renames fields — identical rule
 * to `rejectSlugField` in src/api/routes/admin/documents.ts.
 */
function rejectSlugField(body: unknown): void {
  if (body !== null && typeof body === "object" && !Array.isArray(body) && "slug" in body) {
    throw new AppError("SLUG_IMMUTABLE", {
      message: "The document slug is stable and cannot be changed through this API.",
    });
  }
}

// ---------------------------------------------------------------------------
// POST / — create a document. Same multipart/form-data transport as
// src/api/routes/admin/documents.ts POST "/", differing only in
// `createdBy` (requirement 8).
// ---------------------------------------------------------------------------

const createFieldsSchema = z.object({
  categoryId: z.string().trim().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).max(MAX_TAGS).optional(),
  note: z.string().max(MAX_NOTE_LENGTH).optional(),
});

/** Parses the JSON `tags` field, rejecting a comma-joined string outright. */
function parseTags(raw: File | string | null): string[] | undefined {
  if (raw === null || typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("INVALID_HTML", {
      message: "The tags field must be a JSON array of strings.",
    });
  }
  if (!Array.isArray(parsed)) {
    throw new AppError("INVALID_HTML", {
      message: "The tags field must be a JSON array of strings.",
    });
  }
  return parsed as string[];
}

documents.post("/", requireAgent, async (c) => {
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

  const categoryIdRaw = form.get("categoryId");
  if (typeof categoryIdRaw !== "string" || categoryIdRaw.trim().length === 0) {
    throw new AppError("CATEGORY_REQUIRED", { message: "A category must be chosen." });
  }

  const parsed = createFieldsSchema.safeParse({
    categoryId: categoryIdRaw,
    title: typeof form.get("title") === "string" ? String(form.get("title")) : undefined,
    description:
      typeof form.get("description") === "string" ? String(form.get("description")) : undefined,
    tags: parseTags(form.get("tags")),
    note: typeof form.get("note") === "string" ? String(form.get("note")) : undefined,
  });
  if (!parsed.success) {
    // Same NOTE_TOO_LONG carve-out as admin's create route: an over-long
    // note gets its own code rather than the INVALID_HTML catch-all, since
    // it is handed to MCP agents verbatim (node G4.1/G3.1 precedent).
    const noteIssue = parsed.error.issues.some((issue) => issue.path[0] === "note");
    throw new AppError(noteIssue ? "NOTE_TOO_LONG" : "INVALID_HTML", {
      message: noteIssue
        ? `Version note must be ${MAX_NOTE_LENGTH} characters or fewer.`
        : "Upload fields failed validation.",
      detail: parsed.error.issues,
    });
  }

  const result = await createDocument(
    { db: c.env.DB, docs: c.env.DOCS },
    {
      bytes: await file.arrayBuffer(),
      filename: file.name,
      categoryId: parsed.data.categoryId,
      createdBy: "agent",
      overrides: {
        title: parsed.data.title,
        description: parsed.data.description,
        tags: parsed.data.tags,
      },
      note: parsed.data.note,
    },
  );

  return ok({ ...result, url: documentUrl(c.env, result.slug) }, { status: 201 });
});

// ---------------------------------------------------------------------------
// GET / — list/search documents. Reuses the identical parameter handling
// as src/api/routes/public/documents.ts GET "/" so agent search returns
// the same results as public search by construction: `validateSearchQuery`
// and `listDocuments` own every search semantic, this handler only shapes
// the request/response.
// ---------------------------------------------------------------------------

function numberParam(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function textParam(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value === "" || value === undefined ? undefined : value;
}

documents.get("/", requireAgent, async (c) => {
  const rawQuery = c.req.query("q") ?? c.req.query("query");
  const query = validateSearchQuery(textParam(rawQuery));

  const result = await listDocuments(c.env.DB, {
    page: numberParam(c.req.query("page")),
    pageSize: numberParam(c.req.query("pageSize")),
    query,
    categoryId: textParam(c.req.query("categoryId")),
    tag: textParam(c.req.query("tag")),
    depth: c.req.query("depth") === "self" ? "self" : undefined,
  });
  return ok({ ...result, query });
});

// ---------------------------------------------------------------------------
// GET /:slug — full metadata for one document, same DocumentDetail shape
// public reads use (never HTML body bytes).
// ---------------------------------------------------------------------------

documents.get("/:slug", requireAgent, async (c) => {
  const detail = await getDocumentBySlug(c.env.DB, c.req.param("slug"), c.env.CONTENT_ORIGIN);
  return ok(detail);
});

// ---------------------------------------------------------------------------
// PATCH /:slug — update title/description/tags. Same JSON transport as
// src/api/routes/admin/documents.ts PATCH "/:slug".
// ---------------------------------------------------------------------------

const patchMetadataSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).max(MAX_TAGS).optional(),
});

documents.patch("/:slug", requireAgent, async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  rejectSlugField(body);

  const parsed = patchMetadataSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("INVALID_HTML", {
      message: "Metadata fields failed validation.",
      detail: parsed.error.issues,
    });
  }

  const result = await updateDocumentMetadata(c.env.DB, c.req.param("slug"), {
    title: parsed.data.title,
    description: parsed.data.description,
    tags: parsed.data.tags,
  });

  return ok({ ...result, url: documentUrl(c.env, result.slug) });
});

// ---------------------------------------------------------------------------
// POST /:slug/versions — upload new bytes for an existing document. Same
// multipart transport and UNCHANGED-is-not-an-error handling as
// src/api/routes/admin/versions.ts POST "/:slug/versions".
// ---------------------------------------------------------------------------

const noteSchema = z.string().max(MAX_NOTE_LENGTH).optional();

documents.post("/:slug/versions", requireAgent, async (c) => {
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
  const parsedNote = noteSchema.safeParse(typeof noteRaw === "string" ? noteRaw : undefined);
  if (!parsedNote.success) {
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
      createdBy: "agent",
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
// POST /:slug/move — move a document into an existing category. Same JSON
// transport as src/api/routes/admin/documents.ts POST "/:slug/move". The
// target category is only ever looked up (never created) by
// DocumentService.moveDocument — an unknown category raises
// CATEGORY_NOT_FOUND (requirement 4, AGENT.md §32).
// ---------------------------------------------------------------------------

const moveSchema = z.object({
  categoryId: z.string().trim().min(1),
});

documents.post("/:slug/move", requireAgent, async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  rejectSlugField(body);

  const parsed = moveSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("CATEGORY_REQUIRED", {
      message: "A target category is required to move a document.",
      detail: parsed.error.issues,
    });
  }

  const result = await moveDocument(c.env.DB, c.req.param("slug"), parsed.data.categoryId);

  return ok({ ...result, url: documentUrl(c.env, result.slug) });
});

export default documents;
