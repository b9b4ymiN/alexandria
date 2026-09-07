// `update_document` — appends a new version to an existing document from
// a local HTML file (node G5.2 Scope; Agent API:
// POST /api/agent/documents/:slug/versions). Identical bytes are an
// UNCHANGED no-op, not an error (requirement 6, Edge Cases).
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolDeps } from "../deps.js";
import { validateLocalHtmlFile } from "../local-validation.js";
import { apiError, localError, success } from "../tool-result.js";

const inputSchema = z.object({
  slug: z.string().min(1).describe("Slug of the existing document to add a version to."),
  filePath: z.string().min(1).describe("Absolute or relative path to a local .html file with the new content."),
  note: z.string().max(500).optional().describe("Optional note describing this version (max 500 characters)."),
});

const outputSchema = z.object({
  slug: z.string(),
  versionId: z.string(),
  versionNo: z.number(),
  unchanged: z.boolean(),
  url: z.string().optional(),
});

export function registerUpdateDocument(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "update_document",
    {
      title: "Update Document",
      description:
        "Publish a new version of an existing document from a local HTML file. Identical bytes report an UNCHANGED no-op rather than an error.",
      inputSchema,
      outputSchema,
    },
    async (args) => {
      const validation = await validateLocalHtmlFile(args.filePath, deps.maxUploadBytes);
      if (!validation.ok) {
        return localError(validation.message);
      }

      const bytes = await readFile(args.filePath);

      const result = await deps.apiClient.updateDocumentVersion({
        slug: args.slug,
        bytes,
        filename: validation.filename,
        note: args.note,
      });

      if (result.kind !== "ok") {
        return apiError(result);
      }

      const data = result.data;
      const text = data.unchanged
        ? `No change: ${args.slug} is still at version ${data.versionNo} (uploaded bytes were identical).`
        : `Published version ${data.versionNo} of ${args.slug}: ${data.url}`;

      return success(text, {
        slug: args.slug,
        versionId: data.versionId,
        versionNo: data.versionNo,
        unchanged: data.unchanged,
        ...(data.url !== undefined ? { url: data.url } : {}),
      });
    },
  );
}
