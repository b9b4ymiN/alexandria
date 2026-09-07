// `list_documents` — paginated library listing (node G5.3 Scope; Agent
// API: GET /api/agent/documents). Shares the exact query semantics of the
// public Library (node G4.1) and of `search_documents` through one
// `AgentApiClient.listDocuments` method (requirement 4) — this tool
// simply never supplies a text query, so results are the unfiltered
// listing, most-recently-updated first. An out-of-range page is clamped
// by the API rather than rejected, and an empty result set is a normal
// empty page, not an error (Edge Cases).
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolDeps } from "../deps.js";
import { apiError, success } from "../tool-result.js";

const inputSchema = z.object({
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Page number, starting at 1. Out-of-range values are clamped, not rejected."),
  pageSize: z.number().int().min(1).optional().describe("Items per page."),
  categoryId: z.string().optional().describe("Restrict to this category (and, by default, its subtree)."),
  depth: z
    .enum(["self", "subtree"])
    .optional()
    .describe('With categoryId: "self" for that category only, "subtree" (default) to include descendants.'),
  tag: z.string().optional().describe("Restrict to documents carrying this tag name."),
});

const documentSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  categoryPath: z.array(z.object({ id: z.string(), name: z.string(), slug: z.string() })),
  tags: z.array(z.string()),
  updatedAt: z.string(),
});

const outputSchema = z.object({
  items: z.array(documentSummarySchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});

export function registerListDocuments(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "list_documents",
    {
      title: "List Documents",
      description:
        "List published documents in the library, paginated, optionally filtered by category or tag. For text search, use search_documents instead.",
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const result = await deps.apiClient.listDocuments({
        page: args.page,
        pageSize: args.pageSize,
        categoryId: args.categoryId,
        tag: args.tag,
        depth: args.depth,
      });

      if (result.kind !== "ok") {
        return apiError(result);
      }

      const data = result.data;
      const totalPages = data.pageSize > 0 ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
      return success(`${data.total} document(s), page ${data.page} of ${totalPages}.`, {
        items: data.items,
        page: data.page,
        pageSize: data.pageSize,
        total: data.total,
      });
    },
  );
}
