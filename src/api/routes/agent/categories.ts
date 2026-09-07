// Owned by node G5.1 (Agent Auth & Agent API Routes).
// Do not add handlers here from any other node.
//
// Mounted at /api/agent/categories by src/api/routes/agent/index.ts.
// Implements (SPEC.md §18 Agent — read only, no create):
//   GET /api/agent/categories -> "/"
//
// TRANSPORT ONLY. No SQL and no R2 access here — listCategories owns the
// query (AGENT.md §6, §9, §10). Category structure is Admin-owned
// (AGENT.md §5, §32): this file exposes no route that creates, renames,
// moves or deletes a category.
import { Hono } from "hono";
import type { Env } from "../../../shared/types";
import { ok } from "../../../shared/envelope";
import { requireAgent } from "../../middleware/agent-auth";
import { listCategories } from "../../../domain/documents/document-read";

const categories = new Hono<{ Bindings: Env }>();

categories.get("/", requireAgent, async (c) => {
  return ok({ categories: await listCategories(c.env.DB) });
});

export default categories;
