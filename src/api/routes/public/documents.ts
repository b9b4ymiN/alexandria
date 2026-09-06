// Owned by node G1.8 (Public API — List & Get Document). The listing route
// was extended by node G4.1 (Metadata Search Service) to add the `q` search
// parameter and echo the term in the response — the search SEMANTICS live in
// src/domain/search/metadata-search-service.ts, not here.
// Do not add handlers here from any other node.
//
// Mounted at /api/public/documents by src/api/routes/public/index.ts.
// Implements (SPEC.md §18 Public):
//   GET /api/public/documents        -> "/"
//   GET /api/public/documents/:slug  -> "/:slug"
//
// No authentication: the current published document is readable by anyone,
// which is the whole point of a public library (GOAL.md §8).
import { Hono } from "hono";
import type { Env } from "../../../shared/types";
import { ok } from "../../../shared/envelope";
import { getDocumentBySlug, listDocuments } from "../../../domain/documents/document-read";
import { validateSearchQuery } from "../../../domain/search/metadata-search-service";

const documents = new Hono<{ Bindings: Env }>();

function numberParam(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function textParam(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value === "" || value === undefined ? undefined : value;
}

documents.get("/", async (c) => {
  // `q` is the canonical search parameter (node G4.1). `query` remains an
  // accepted alias — it was already live and tests/integration/api-
  // documents.test.ts depends on it — but when both are present `q` wins.
  const rawQuery = c.req.query("q") ?? c.req.query("query");
  // Validated once here so the 200 envelope can echo back the exact term
  // the search ran with; listDocuments validates again internally (the
  // same pure, idempotent function), since it must stay safe to call with
  // an unvalidated term from any other caller too.
  const query = validateSearchQuery(textParam(rawQuery));

  const result = await listDocuments(c.env.DB, {
    page: numberParam(c.req.query("page")),
    pageSize: numberParam(c.req.query("pageSize")),
    query,
    categoryId: textParam(c.req.query("categoryId")),
    tag: textParam(c.req.query("tag")),
    // Anything other than the literal "self" stays the subtree default —
    // an unrecognized value is a client typo, not a reason to fail a
    // public read (same philosophy as clampPagination).
    depth: c.req.query("depth") === "self" ? "self" : undefined,
  });
  return ok({ ...result, query });
});

documents.get("/:slug", async (c) => {
  const detail = await getDocumentBySlug(c.env.DB, c.req.param("slug"), c.env.CONTENT_ORIGIN);
  return ok(detail);
});

export default documents;
