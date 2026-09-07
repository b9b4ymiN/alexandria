// `update_metadata` — updates title/description/tags on an existing
// document (node G5.2 Scope; Agent API: PATCH /api/agent/documents/:slug).
// No local file is involved, so there is nothing to validate before the
// network call.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolDeps } from "../deps.js";
import { apiError, success } from "../tool-result.js";

const inputSchema = z.object({
  slug: z.string().min(1).describe("Slug of the document to update."),
  title: z.string().optional().describe("New title. Omit to leave unchanged."),
  description: z.string().optional().describe("New description. Omit to leave unchanged; an empty string clears it."),
  tags: z.array(z.string()).optional().describe("Replaces the full tag set. Omit to leave tags unchanged."),
});

const outputSchema = z.object({
  documentId: z.string(),
  slug: z.string(),
  url: z.string(),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
});

export function registerUpdateMetadata(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "update_metadata",
    {
      title: "Update Metadata",
      description: "Update the title, description, and/or tags of an existing document. The slug itself never changes.",
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const result = await deps.apiClient.updateMetadata({
        slug: args.slug,
        title: args.title,
        description: args.description,
        tags: args.tags,
      });

      if (result.kind !== "ok") {
        return apiError(result);
      }

      const data = result.data;
      return success(`Updated metadata for ${data.slug}: ${data.url}`, {
        documentId: data.documentId,
        slug: data.slug,
        url: data.url,
        title: data.title,
        description: data.description,
        tags: data.tags,
      });
    },
  );
}
