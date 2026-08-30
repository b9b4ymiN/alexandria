// OWNERSHIP: this file is written by node G1.2 and must not be edited by
// any later node. It mounts the fixed set of leaf route files below; each
// leaf file is owned and populated only by the node named in its own
// header comment. auth.ts, documents.ts and versions.ts intentionally
// share the "/" and "/documents" prefixes with disjoint sub-paths — see
// each file's own header for the exact paths it owns.
//
// Mounted at /api/admin by src/api/app.ts.
import { Hono } from "hono";
import type { Env } from "../../../shared/types";
import auth from "./auth"; // owned by G1.6
import documents from "./documents"; // owned by G1.7
import versions from "./versions"; // owned by G3.1 / G3.2
import categories from "./categories"; // owned by G2.1
import tags from "./tags"; // owned by G2.2

const adminRouter = new Hono<{ Bindings: Env }>();

adminRouter.route("/", auth);
adminRouter.route("/documents", documents);
adminRouter.route("/documents", versions);
adminRouter.route("/categories", categories);
adminRouter.route("/tags", tags);

export default adminRouter;
