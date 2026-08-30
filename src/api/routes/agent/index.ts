// OWNERSHIP: this file is written by node G1.2 and must not be edited by
// any later node. It mounts the fixed set of leaf route files below; each
// leaf file is owned and populated only by the node named in its own
// header comment. No destructive Agent route may ever be added under this
// router (AGENT.md §6, SPEC.md §18 Agent).
//
// Mounted at /api/agent by src/api/app.ts.
import { Hono } from "hono";
import type { Env } from "../../../shared/types";
import documents from "./documents"; // owned by G5.1
import categories from "./categories"; // owned by G5.1
import tags from "./tags"; // owned by G5.1

const agentRouter = new Hono<{ Bindings: Env }>();

agentRouter.route("/documents", documents);
agentRouter.route("/categories", categories);
agentRouter.route("/tags", tags);

export default agentRouter;
