// `get_document` — full metadata for one existing document, including its
// public content URL (node G5.3 Scope; Agent API:
// GET /api/agent/documents/:slug). Never returns HTML body content
// (requirement 3): an agent that wants the content fetches `contentUrl`
// itself, the same document-read boundary src/domain/documents/
// document-read.ts already enforces at the API layer (no field selected
// there ever carries body bytes).
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolDeps } from "../deps.js";
import { apiError, success } from "../tool-result.js";

const inputSchema = z.object({
  slug: z.string().min(1).describe("Slug of the document to fetch."),
});

const categoryPathEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

const outputSchema = z.object({
  documentId: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  categoryId: z.string(),
  categoryPath: z.array(categoryPathEntrySchema),
  tags: z.array(z.string()),
  updatedAt: z.string(),
  currentVersionId: z.string(),
  contentUrl: z.string(),
});

export function registerGetDocument(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "get_document",
    {
      title: "Get Document",
      description:
        "Fetch metadata for one existing document by slug, including its public content URL. Never returns HTML body content — fetch contentUrl directly for that. An unknown slug reports DOCUMENT_NOT_FOUND.",
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const result = await deps.apiClient.getDocument(args.slug);
      if (result.kind !== "ok") {
        return apiError(result);
      }

      const data = result.data;
      return success(`${data.slug}: "${data.title}" — ${data.contentUrl}`, {
        documentId: data.documentId,
        slug: data.slug,
        title: data.title,
        description: data.description,
        categoryId: data.categoryId,
        categoryPath: data.categoryPath,
        tags: data.tags,
        updatedAt: data.updatedAt,
        currentVersionId: data.currentVersionId,
        contentUrl: data.contentUrl,
      });
    },
  );
}
