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
// POST restore/:versionNo and DELETE versions/:versionNo belong to G3.2.
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
import { listVersionHistory, updateDocumentVersion } from "../../../domain/versions/version-service";

const versions = new Hono<{ Bindings: Env }>();

const MAX_NOTE_LENGTH = 500;
const noteSchema = z.string().max(MAX_NOTE_LENGTH).optional();

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
    throw new AppError("INVALID_HTML", {
      message: "Note failed validation.",
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

export default versions;
