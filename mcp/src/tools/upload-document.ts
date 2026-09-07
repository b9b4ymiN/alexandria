// `upload_document` — publishes a local HTML file as a new document
// (node G5.2 Scope; SPEC.md §19; Agent API: POST /api/agent/documents).
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolDeps } from "../deps.js";
import { validateLocalHtmlFile } from "../local-validation.js";
import { apiError, localError, success } from "../tool-result.js";

const inputSchema = z.object({
  filePath: z.string().min(1).describe("Absolute or relative path to a local .html file to publish."),
  categoryId: z.string().min(1).describe("Id of an existing category to publish into."),
  title: z.string().optional().describe("Overrides the title Alexandria would otherwise extract from the HTML."),
  description: z
    .string()
    .optional()
    .describe("Overrides the description Alexandria would otherwise extract from the HTML."),
  tags: z.array(z.string()).optional().describe("Tag names to attach. Unknown tag names are created."),
  note: z.string().max(500).optional().describe("Optional note describing this version (max 500 characters)."),
});

const outputSchema = z.object({
  documentId: z.string(),
  slug: z.string(),
  url: z.string(),
  versionId: z.string(),
  versionNo: z.number(),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
});

export function registerUploadDocument(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "upload_document",
    {
      title: "Upload Document",
      description:
        "Publish a local HTML file to the Alexandria library as a new document, in an existing category.",
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const validation = await validateLocalHtmlFile(args.filePath, deps.maxUploadBytes);
      if (!validation.ok) {
        return localError(validation.message);
      }

      const bytes = await readFile(args.filePath);

      const result = await deps.apiClient.uploadDocument({
        bytes,
        filename: validation.filename,
        categoryId: args.categoryId,
        title: args.title,
        description: args.description,
        tags: args.tags,
        note: args.note,
      });

      if (result.kind !== "ok") {
        return apiError(result);
      }

      const data = result.data;
      return success(`Published "${data.title}" as ${data.slug} (version ${data.versionNo}): ${data.url}`, {
        documentId: data.documentId,
        slug: data.slug,
        url: data.url,
        versionId: data.versionId,
        versionNo: data.versionNo,
        title: data.title,
        description: data.description,
        tags: data.tags,
      });
    },
  );
}
