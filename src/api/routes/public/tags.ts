// Owned by node G2.4 (Public API — Tree, Tags, Filters).
// Do not add handlers here from any other node.
//
// Mounted at /api/public/tags by src/api/routes/public/index.ts.
// Will eventually implement (SPEC.md §18 Public):
//   GET /api/public/tags -> "/"
//
// Empty on purpose — G1.2 only wires the mount point.
import { Hono } from "hono";
import type { Env } from "../../../shared/types";

const tags = new Hono<{ Bindings: Env }>();

export default tags;
