// Owned by node G2.4 (Public API — Tree, Tags, Filters).
// Do not add handlers here from any other node.
//
// Mounted at /api/public/tags by src/api/routes/public/index.ts.
// Implements (SPEC.md §18 Public):
//   GET /api/public/tags -> "/"
//
// Reuses TagService.listTags (node G2.2) rather than duplicating the
// count query, and narrows its result to the public contract's exact
// shape — { id, name, documentCount } — dropping normalizedName, which is
// an internal identity detail with no reader-facing purpose.
import { Hono } from "hono";
import type { Env } from "../../../shared/types";
import { ok } from "../../../shared/envelope";
import { listTags } from "../../../domain/tags/tag-service";

const tags = new Hono<{ Bindings: Env }>();

tags.get("/", async (c) => {
  const items = await listTags(c.env.DB);
  return ok(items.map(({ id, name, documentCount }) => ({ id, name, documentCount })));
});

export default tags;
