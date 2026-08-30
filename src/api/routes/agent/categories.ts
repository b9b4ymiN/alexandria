// Owned by node G5.1 (Agent Auth & Agent API Routes).
// Do not add handlers here from any other node.
//
// Mounted at /api/agent/categories by src/api/routes/agent/index.ts.
// Will eventually implement (SPEC.md §18 Agent — read only, no create):
//   GET /api/agent/categories -> "/"
//
// Empty on purpose — G1.2 only wires the mount point.
import { Hono } from "hono";
import type { Env } from "../../../shared/types";

const categories = new Hono<{ Bindings: Env }>();

export default categories;
