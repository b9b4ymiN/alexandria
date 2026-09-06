// Owned by node G1.7 (Admin API — Create Document).
// Do not add handlers here from any other node.
//
// Mounted at /api/admin/documents by src/api/routes/admin/index.ts.
// Implements (SPEC.md §18 Admin):
//   POST  /api/admin/documents             -> "/"
//   PATCH /api/admin/documents/:slug       -> "/:slug"             (G2.3)
//   POST  /api/admin/documents/:slug/move  -> "/:slug/move"        (G2.3)
//   DELETE /api/admin/documents/:slug      -> "/:slug"             (G3.3)
// Version sub-routes live in src/api/routes/admin/versions.ts (G3.1, G3.2).
//
// TRANSPORT ONLY. This file parses the request, authorizes it, hands off to
// DocumentService, and shapes the response. It contains no SQL, no R2
// access and no business rule — those belong to the domain layer, so the
// Admin UI, the Agent API and MCP all get identical behaviour
// (AGENT.md §9, §10; TECHSTACK.md §8).
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../shared/types";
import { AppError } from "../../../shared/errors";
import { ok } from "../../../shared/envelope";
import { requireAdmin } from "../../middleware/admin-auth";
import {
  createDocument,
  deleteDocument,
  moveDocument,
  updateDocumentMetadata,
} from "../../../domain/documents/document-service";

const documents = new Hono<{ Bindings: Env }>();

const MAX_TAGS = 20;
const MAX_NOTE_LENGTH = 500;

const fieldsSchema = z.object({
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

documents.post("/", requireAdmin, async (c) => {
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

  const parsed = fieldsSchema.safeParse({
    categoryId: categoryIdRaw,
    title: typeof form.get("title") === "string" ? String(form.get("title")) : undefined,
    description:
      typeof form.get("description") === "string" ? String(form.get("description")) : undefined,
    tags: parseTags(form.get("tags")),
    note: typeof form.get("note") === "string" ? String(form.get("note")) : undefined,
  });
  if (!parsed.success) {
    throw new AppError("INVALID_HTML", {
      message: "Upload fields failed validation.",
      detail: parsed.error.issues,
    });
  }

  const result = await createDocument(
    { db: c.env.DB, docs: c.env.DOCS },
    {
      bytes: await file.arrayBuffer(),
      filename: file.name,
      categoryId: parsed.data.categoryId,
      createdBy: "admin",
      overrides: {
        title: parsed.data.title,
        description: parsed.data.description,
        tags: parsed.data.tags,
      },
      note: parsed.data.note,
    },
  );

  return ok(
    { ...result, url: `${c.env.APP_ORIGIN.replace(/\/+$/, "")}/docs/${result.slug}` },
    { status: 201 },
  );
});

// ---------------------------------------------------------------------------
// PATCH /:slug and POST /:slug/move — node G2.3.
// ---------------------------------------------------------------------------

function documentUrl(env: Env, slug: string): string {
  return `${env.APP_ORIGIN.replace(/\/+$/, "")}/docs/${slug}`;
}

/**
 * Requirement 1: a request body carrying `slug` is REJECTED with
 * SLUG_IMMUTABLE rather than silently ignored — a caller must learn the
 * operation is impossible, not have it quietly no-op the field (node G2.3
 * requirement 1). Checked against the RAW parsed body, before any schema
 * strips or renames fields, so the field can never slip through unnoticed.
 */
function rejectSlugField(body: unknown): void {
  if (body !== null && typeof body === "object" && !Array.isArray(body) && "slug" in body) {
    throw new AppError("SLUG_IMMUTABLE", {
      message: "The document slug is stable and cannot be changed through this API.",
    });
  }
}

const patchMetadataSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).max(MAX_TAGS).optional(),
});

documents.patch("/:slug", requireAdmin, async (c) => {
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

const moveSchema = z.object({
  categoryId: z.string().trim().min(1),
});

documents.post("/:slug/move", requireAdmin, async (c) => {
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

// ---------------------------------------------------------------------------
// DELETE /:slug — node G3.3.
//
// The only irreversible operation in Phase 1 (SPEC.md §13). The body must
// echo the slug back exactly; the check itself lives in DocumentService, so
// the Admin UI and any future caller are held to the same contract rather
// than to whatever each transport remembered to validate.
//
// The response reports what actually happened to R2 rather than assuming
// success, because a failed object delete leaves a paid-for orphan the
// operator may want to reconcile later.
// ---------------------------------------------------------------------------

const deleteSchema = z.object({
  confirmSlug: z.string(),
});

documents.delete("/:slug", requireAdmin, async (c) => {
  const body: unknown = await c.req.json().catch(() => null);

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("CONFIRMATION_MISMATCH", {
      message: "Deleting a document requires a confirmSlug field repeating its slug. Nothing was deleted.",
      detail: parsed.error.issues,
    });
  }

  const result = await deleteDocument(
    { db: c.env.DB, docs: c.env.DOCS },
    { slug: c.req.param("slug"), confirmSlug: parsed.data.confirmSlug },
  );

  return ok(result);
});

export default documents;
