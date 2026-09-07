// `search_documents` — text search over the library (node G5.3 Scope;
// Agent API: GET /api/agent/documents?q=...). This is deliberately the
// SAME endpoint and the SAME `AgentApiClient.listDocuments` call as
// `list_documents` (requirement 4, IMPLEMENTATION_PLAN.md node G5.3 §4 —
// "two tools over one endpoint... do not add a second search
// implementation"); the query text is the only thing this tool adds.
// Query validation (length cap, normalization) lives entirely in
// src/domain/search/metadata-search-service.ts and is never duplicated
// here — an over-long or malformed query surfaces the API's error
// verbatim, same as every other tool in this package.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolDeps } from "../deps.js";
import { apiError, success } from "../tool-result.js";

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Search text, matched against title, description, category and tags — the same behavior as the public Library search, including non-Latin scripts.",
    ),
  page: z.number().int().min(1).optional().describe("Page number, starting at 1. Out-of-range values are clamped, not rejected."),
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
  query: z.string(),
});

export function registerSearchDocuments(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "search_documents",
    {
      title: "Search Documents",
      description:
        "Search the library by title, description, category and tags. Same relevance and query semantics as the public Library search. An empty result set is a normal empty page, not an error.",
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const result = await deps.apiClient.listDocuments({
        query: args.query,
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
      return success(`${data.total} result(s) for "${data.query}", page ${data.page}.`, {
        items: data.items,
        page: data.page,
        pageSize: data.pageSize,
        total: data.total,
        query: data.query,
      });
    },
  );
}
