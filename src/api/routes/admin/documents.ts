// Owned by node G1.7 (Admin API — Create Document).
// Do not add handlers here from any other node.
//
// Mounted at /api/admin/documents by src/api/routes/admin/index.ts.
// Will eventually implement (SPEC.md §18 Admin):
//   POST   /api/admin/documents        -> "/"
//   PATCH  /api/admin/documents/:slug  -> "/:slug"
//   DELETE /api/admin/documents/:slug  -> "/:slug"
// (Version sub-routes under /api/admin/documents/:slug/... belong to
// src/api/routes/admin/versions.ts, owned by G3.1.)
//
// Empty on purpose — G1.2 only wires the mount point.
import { Hono } from "hono";
import type { Env } from "../../../shared/types";

const documents = new Hono<{ Bindings: Env }>();

export default documents;
