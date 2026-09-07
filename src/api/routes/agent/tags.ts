// Owned by node G5.1 (Agent Auth & Agent API Routes).
// Do not add handlers here from any other node.
//
// Mounted at /api/agent/tags by src/api/routes/agent/index.ts.
// Implements (SPEC.md §18 Agent — read only):
//   GET /api/agent/tags -> "/"
//
// TRANSPORT ONLY. No SQL and no R2 access here — TagService.listTags owns
// the query (AGENT.md §6, §9, §10). Narrows the result to the same public
// contract shape — { id, name, documentCount } — as
// src/api/routes/public/tags.ts, dropping normalizedName.
import { Hono } from "hono";
import type { Env } from "../../../shared/types";
import { ok } from "../../../shared/envelope";
import { requireAgent } from "../../middleware/agent-auth";
import { listTags } from "../../../domain/tags/tag-service";

const tags = new Hono<{ Bindings: Env }>();

tags.get("/", requireAgent, async (c) => {
  const items = await listTags(c.env.DB);
  return ok(items.map(({ id, name, documentCount }) => ({ id, name, documentCount })));
});

export default tags;
