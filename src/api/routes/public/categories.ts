// Owned by node G1.8 (Public API — List & Get Document).
// Do not add handlers here from any other node.
//
// Mounted at /api/public/categories by src/api/routes/public/index.ts.
// Will eventually implement (SPEC.md §18 Public):
//   GET /api/public/categories -> "/"
//
// Empty on purpose — G1.2 only wires the mount point.
import { Hono } from "hono";
import type { Env } from "../../../shared/types";

const categories = new Hono<{ Bindings: Env }>();

export default categories;
