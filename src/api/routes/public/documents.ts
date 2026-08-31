// Owned by node G1.8 (Public API — List & Get Document).
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
  const result = await listDocuments(c.env.DB, {
    page: numberParam(c.req.query("page")),
    pageSize: numberParam(c.req.query("pageSize")),
    query: textParam(c.req.query("query")),
    categoryId: textParam(c.req.query("categoryId")),
  });
  return ok(result);
});

documents.get("/:slug", async (c) => {
  const detail = await getDocumentBySlug(c.env.DB, c.req.param("slug"), c.env.CONTENT_ORIGIN);
  return ok(detail);
});

export default documents;
