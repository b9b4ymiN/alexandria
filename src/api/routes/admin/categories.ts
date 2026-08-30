// Owned by node G2.1 (Category Management — service + admin API) for every
// MUTATION. Node G1.7 owns ONLY the read-only listing below, which the
// upload form needs to populate its category selector.
// Do not add handlers here from any other node.
//
// Mounted at /api/admin/categories by src/api/routes/admin/index.ts.
// Implemented here (G1.7):
//   GET    /api/admin/categories             -> "/"
// Reserved for G2.1 (SPEC.md §18 Admin):
//   POST   /api/admin/categories             -> "/"
//   PATCH  /api/admin/categories/:id         -> "/:id"
//   POST   /api/admin/categories/:id/move    -> "/:id/move"
//   DELETE /api/admin/categories/:id         -> "/:id"
import { Hono } from "hono";
import type { Env } from "../../../shared/types";
import { ok } from "../../../shared/envelope";
import { requireAdmin } from "../../middleware/admin-auth";
import { listCategories } from "../../../domain/documents/document-read";

const categories = new Hono<{ Bindings: Env }>();

categories.get("/", requireAdmin, async (c) => {
  return ok({ categories: await listCategories(c.env.DB) });
});

export default categories;
