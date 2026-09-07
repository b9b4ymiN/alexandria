// `list_categories` — every category, in one call (node G5.3 Scope; Agent
// API: GET /api/agent/categories). Takes no input: the Category tree is
// Admin-owned (AGENT.md §5, §32) and this package exposes no way to
// filter, page or otherwise partially view it — every category comes back
// every time, each row carrying its own `parentId` so a caller can
// reconstruct the tree itself (Edge Cases: "a deep tree returned in one
// call").
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolDeps } from "../deps.js";
import { apiError, success } from "../tool-result.js";

const categorySchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  slug: z.string(),
  sortOrder: z.number(),
  documentCount: z.number(),
});

const outputSchema = z.object({
  categories: z.array(categorySchema),
});

export function registerListCategories(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "list_categories",
    {
      title: "List Categories",
      description:
        "List every category in the library's category tree. Categories are Admin-owned and cannot be created, renamed, moved or deleted through this server.",
      outputSchema,
    },
    async () => {
      const result = await deps.apiClient.listCategories();
      if (result.kind !== "ok") {
        return apiError(result);
      }

      const data = result.data;
      return success(`${data.categories.length} categor${data.categories.length === 1 ? "y" : "ies"}.`, {
        categories: data.categories,
      });
    },
  );
}
