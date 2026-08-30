// Owned by node G3.1 (Update Document & Version History), extended by
// G3.2 (Restore & Version Delete Guards).
// Do not add handlers here from any other node.
//
// Mounted at /api/admin/documents by src/api/routes/admin/index.ts,
// alongside (not instead of) admin/documents.ts — the two leaf routers
// share the "/documents" prefix but own disjoint sub-paths.
// Will eventually implement (SPEC.md §18 Admin):
//   POST   /api/admin/documents/:slug/versions              -> "/:slug/versions"
//   GET    /api/admin/documents/:slug/versions               -> "/:slug/versions"
//   POST   /api/admin/documents/:slug/restore/:versionNo     -> "/:slug/restore/:versionNo"
//   DELETE /api/admin/documents/:slug/versions/:versionNo    -> "/:slug/versions/:versionNo"
//
// Empty on purpose — G1.2 only wires the mount point.
import { Hono } from "hono";
import type { Env } from "../../../shared/types";

const versions = new Hono<{ Bindings: Env }>();

export default versions;
