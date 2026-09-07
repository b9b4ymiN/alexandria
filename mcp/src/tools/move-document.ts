// `move_document` — moves an existing document into an existing category
// (node G5.2 Scope; Agent API: POST /api/agent/documents/:slug/move). The
// target category must already exist — the API raises CATEGORY_NOT_FOUND
// otherwise (AGENT.md §32); this tool never creates one.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolDeps } from "../deps.js";
import { apiError, success } from "../tool-result.js";

const inputSchema = z.object({
  slug: z.string().min(1).describe("Slug of the document to move."),
  categoryId: z.string().min(1).describe("Id of an existing category to move the document into."),
});

const outputSchema = z.object({
  documentId: z.string(),
  slug: z.string(),
  url: z.string(),
  categoryId: z.string(),
});

export function registerMoveDocument(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "move_document",
    {
      title: "Move Document",
      description: "Move an existing document into an existing category. The document's slug never changes.",
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const result = await deps.apiClient.moveDocument({
        slug: args.slug,
        categoryId: args.categoryId,
      });

      if (result.kind !== "ok") {
        return apiError(result);
      }

      const data = result.data;
      return success(`Moved ${data.slug} to category ${data.categoryId}: ${data.url}`, {
        documentId: data.documentId,
        slug: data.slug,
        url: data.url,
        categoryId: data.categoryId,
      });
    },
  );
}
