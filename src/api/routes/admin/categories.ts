// Owned by node G2.1 (Category Management — service + admin API) for every
// MUTATION. Node G1.7 owns ONLY the read-only listing below, which the
// upload form needs to populate its category selector.
// Do not add handlers here from any other node.
//
// Mounted at /api/admin/categories by src/api/routes/admin/index.ts.
// Implemented here (G1.7):
//   GET    /api/admin/categories             -> "/"
// Implemented here (G2.1):
//   POST   /api/admin/categories             -> "/"
//   PATCH  /api/admin/categories/:id         -> "/:id"
//   POST   /api/admin/categories/:id/move    -> "/:id/move"
//   DELETE /api/admin/categories/:id         -> "/:id"
//
// TRANSPORT ONLY (AGENT.md §9, §10): parses/validates the request,
// authorizes it via requireAdmin, delegates to CategoryService, and shapes
// the response. No SQL, no direct D1 access here — every rule (cycle
// detection, non-empty deletion, slug uniqueness, max depth) lives in
// src/domain/categories/category-service.ts.
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../shared/types";
import { AppError } from "../../../shared/errors";
import { ok } from "../../../shared/envelope";
import { requireAdmin } from "../../middleware/admin-auth";
import { listCategories } from "../../../domain/documents/document-read";
import {
  createCategory,
  moveCategory,
  removeCategory,
  renameCategory,
} from "../../../domain/categories/category-service";

const categories = new Hono<{ Bindings: Env }>();

const createSchema = z.object({
  parentId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1).optional(),
  sortOrder: z.number().int().optional(),
});

const renameSchema = z.object({
  name: z.string().trim().min(1),
});

const moveSchema = z.object({
  parentId: z.string().trim().min(1).nullable(),
});

/** Every 400 here is CATEGORY_REQUIRED — see category-service.ts's header note on the fixed error vocabulary. */
function invalidBody(message: string, detail: unknown): never {
  throw new AppError("CATEGORY_REQUIRED", { message, detail });
}

categories.get("/", requireAdmin, async (c) => {
  return ok({ categories: await listCategories(c.env.DB) });
});

categories.post("/", requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    invalidBody("Category fields failed validation.", parsed.error.issues);
  }

  const result = await createCategory(c.env.DB, {
    parentId: parsed.data.parentId ?? null,
    name: parsed.data.name,
    slug: parsed.data.slug,
    sortOrder: parsed.data.sortOrder,
  });
  return ok(result, { status: 201 });
});

categories.patch("/:id", requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) {
    invalidBody("Category name failed validation.", parsed.error.issues);
  }

  const result = await renameCategory(c.env.DB, c.req.param("id"), parsed.data.name);
  return ok(result);
});

categories.post("/:id/move", requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = moveSchema.safeParse(body);
  if (!parsed.success) {
    invalidBody("Move target failed validation.", parsed.error.issues);
  }

  const result = await moveCategory(c.env.DB, c.req.param("id"), parsed.data.parentId);
  return ok(result);
});

categories.delete("/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  await removeCategory(c.env.DB, id);
  return ok({ id, deleted: true });
});

export default categories;
