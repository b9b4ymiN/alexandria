// Owned by node G2.2 (Tag Management — service + admin API).
// Do not add handlers here from any other node.
//
// Mounted at /api/admin/tags by src/api/routes/admin/index.ts.
// Implements (SPEC.md §18 Admin):
//   POST   /api/admin/tags           -> "/"
//   PATCH  /api/admin/tags/:id       -> "/:id"
//   POST   /api/admin/tags/:id/merge -> "/:id/merge"
//   DELETE /api/admin/tags/:id       -> "/:id"
//
// TRANSPORT ONLY, same discipline as admin/documents.ts: parse, authorize,
// delegate to TagService, shape the response. No SQL and no direct binding
// use here (AGENT.md §9, §10).
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../shared/types";
import { ok } from "../../../shared/envelope";
import { requireAdmin } from "../../middleware/admin-auth";
import { createTag, deleteTag, mergeTags, renameTag } from "../../../domain/tags/tag-service";

const tags = new Hono<{ Bindings: Env }>();

const nameSchema = z.object({ name: z.string().optional() });
const mergeSchema = z.object({ targetId: z.string().optional() });

/**
 * Reads the body defensively rather than failing the whole request on a
 * missing/malformed field. TagService owns every real validation rule
 * (TAG_NAME_REQUIRED, TAG_NAME_TOO_LONG, TAG_NOT_FOUND, ...), so a shape
 * mismatch here is simply forwarded to the domain layer as an empty value
 * rather than invented as a separate transport-level error code.
 */
async function readBody<T extends z.ZodTypeAny>(c: { req: { json: () => Promise<unknown> } }, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : ({} as z.infer<T>);
}

tags.post("/", requireAdmin, async (c) => {
  const body = await readBody(c, nameSchema);
  const tag = await createTag(c.env.DB, body.name ?? "");
  return ok(tag, { status: 201 });
});

tags.patch("/:id", requireAdmin, async (c) => {
  const body = await readBody(c, nameSchema);
  const tag = await renameTag(c.env.DB, c.req.param("id"), body.name ?? "");
  return ok(tag);
});

tags.post("/:id/merge", requireAdmin, async (c) => {
  const body = await readBody(c, mergeSchema);
  const result = await mergeTags(c.env.DB, c.req.param("id"), body.targetId ?? "");
  return ok(result);
});

tags.delete("/:id", requireAdmin, async (c) => {
  const result = await deleteTag(c.env.DB, c.req.param("id"));
  return ok(result);
});

export default tags;
