// Owned by node G2.1 (Category Management — service + admin API).
// Do not add handlers here from any other node.
//
// Mounted at /api/admin/categories by src/api/routes/admin/index.ts.
// Will eventually implement (SPEC.md §18 Admin):
//   POST   /api/admin/categories             -> "/"
//   PATCH  /api/admin/categories/:id         -> "/:id"
//   POST   /api/admin/categories/:id/move    -> "/:id/move"
//   DELETE /api/admin/categories/:id         -> "/:id"
//
// Empty on purpose — G1.2 only wires the mount point.
import { Hono } from "hono";
import type { Env } from "../../../shared/types";

const categories = new Hono<{ Bindings: Env }>();

export default categories;
