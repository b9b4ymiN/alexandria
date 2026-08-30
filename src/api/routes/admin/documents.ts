// Owned by node G1.7 (Admin API — Create Document).
// Do not add handlers here from any other node.
//
// Mounted at /api/admin/documents by src/api/routes/admin/index.ts.
// Implements (SPEC.md §18 Admin):
//   POST /api/admin/documents -> "/"
// PATCH and DELETE on /:slug belong to later nodes (G2.3, G3.3); version
// sub-routes live in src/api/routes/admin/versions.ts (G3.1).
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
import { createDocument } from "../../../domain/documents/document-service";

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

export default documents;
