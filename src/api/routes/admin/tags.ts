// Owned by node G2.2 (Tag Management — service + admin API).
// Do not add handlers here from any other node.
//
// Mounted at /api/admin/tags by src/api/routes/admin/index.ts.
// Will eventually implement (SPEC.md §18 Admin):
//   POST   /api/admin/tags           -> "/"
//   PATCH  /api/admin/tags/:id       -> "/:id"
//   POST   /api/admin/tags/:id/merge -> "/:id/merge"
//   DELETE /api/admin/tags/:id       -> "/:id"
//
// Empty on purpose — G1.2 only wires the mount point.
import { Hono } from "hono";
import type { Env } from "../../../shared/types";

const tags = new Hono<{ Bindings: Env }>();

export default tags;
