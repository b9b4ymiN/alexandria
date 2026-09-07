#!/usr/bin/env node
// Alexandria MCP server — stdio transport, write tools only (node G5.2).
// Read tools (get_document, list_documents, search_documents,
// list_categories, list_tags) are added by node G5.3, which is the only
// node allowed to extend this file further (node G5.2 §4.j).
//
// Never writes to stdout: on a stdio MCP server stdout is the protocol
// wire, so every diagnostic here goes to stderr (node G5.2 requirement 1,
// §4.g).
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { AgentApiClient } from "./api-client.js";
import { ConfigError, loadConfig } from "./config.js";
import type { ToolDeps } from "./deps.js";
import { registerMoveDocument } from "./tools/move-document.js";
import { registerUpdateDocument } from "./tools/update-document.js";
import { registerUpdateMetadata } from "./tools/update-metadata.js";
import { registerUploadDocument } from "./tools/upload-document.js";

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`alexandria-mcp: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const deps: ToolDeps = {
    apiClient: new AgentApiClient({ apiUrl: config.apiUrl, agentKey: config.agentKey }),
    maxUploadBytes: config.maxUploadBytes,
  };

  serveStdio(() => {
    const server = new McpServer(
      { name: "alexandria", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );

    registerUploadDocument(server, deps);
    registerUpdateDocument(server, deps);
    registerUpdateMetadata(server, deps);
    registerMoveDocument(server, deps);

    return server;
  });
}

main();
