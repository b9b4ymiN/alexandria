// Owned by node G1.8 (flat listing), extended by node G2.4 (nested tree
// with descendant counts). Do not add handlers here from any other node.
//
// Mounted at /api/public/categories by src/api/routes/public/index.ts.
// Implements (SPEC.md §18 Public):
//   GET /api/public/categories -> "/"
//
// Returns the nested tree with both direct and whole-subtree document
// counts (node G2.4). Admin's flat listing (src/api/routes/admin/categories.ts)
// still uses listCategories() unchanged — this route is the only consumer
// of categoryTreeWithCounts().
import { Hono } from "hono";
import type { Env } from "../../../shared/types";
import { ok } from "../../../shared/envelope";
import { categoryTreeWithCounts } from "../../../domain/documents/document-read";

const categories = new Hono<{ Bindings: Env }>();

categories.get("/", async (c) => {
  return ok({ categories: await categoryTreeWithCounts(c.env.DB) });
});

export default categories;
