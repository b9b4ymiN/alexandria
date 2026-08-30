// OWNERSHIP: this file is written by node G1.2 and must not be edited by
// any later node. It mounts the fixed set of leaf route files below; each
// leaf file is owned and populated only by the node named in its own
// header comment.
//
// Mounted at /api/public by src/api/app.ts.
import { Hono } from "hono";
import type { Env } from "../../../shared/types";
import documents from "./documents"; // owned by G1.8
import categories from "./categories"; // owned by G1.8
import tags from "./tags"; // owned by G2.4

const publicRouter = new Hono<{ Bindings: Env }>();

publicRouter.route("/documents", documents);
publicRouter.route("/categories", categories);
publicRouter.route("/tags", tags);

export default publicRouter;
