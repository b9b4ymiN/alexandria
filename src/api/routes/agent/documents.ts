// Owned by node G5.1 (Agent Auth & Agent API Routes).
// Do not add handlers here from any other node.
//
// Mounted at /api/agent/documents by src/api/routes/agent/index.ts.
// Will eventually implement (SPEC.md §18 Agent — no destructive routes):
//   POST  /api/agent/documents               -> "/"
//   GET   /api/agent/documents                -> "/"
//   GET   /api/agent/documents/:slug          -> "/:slug"
//   PATCH /api/agent/documents/:slug          -> "/:slug"
//   POST  /api/agent/documents/:slug/versions -> "/:slug/versions"
//   POST  /api/agent/documents/:slug/move     -> "/:slug/move"
//
// Empty on purpose — G1.2 only wires the mount point.
import { Hono } from "hono";
import type { Env } from "../../../shared/types";

const documents = new Hono<{ Bindings: Env }>();

export default documents;
