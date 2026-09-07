// `list_tags` — every tag with its document count (node G5.3 Scope; Agent
// API: GET /api/agent/tags). Takes no input. The Agent API returns a bare
// array; it is wrapped as `{ tags: [...] }` here only for
// `structuredContent`/`outputSchema`, which the MCP protocol expects to
// be a JSON object — the underlying data is unchanged.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolDeps } from "../deps.js";
import { apiError, success } from "../tool-result.js";

const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  documentCount: z.number(),
});

const outputSchema = z.object({
  tags: z.array(tagSchema),
});

export function registerListTags(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "list_tags",
    {
      title: "List Tags",
      description: "List every tag in the library with the number of documents carrying it.",
      outputSchema,
    },
    async () => {
      const result = await deps.apiClient.listTags();
      if (result.kind !== "ok") {
        return apiError(result);
      }

      const tags = result.data;
      return success(`${tags.length} tag${tags.length === 1 ? "" : "s"}.`, { tags });
    },
  );
}
