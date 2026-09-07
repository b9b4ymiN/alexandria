#!/usr/bin/env node
// Alexandria MCP server — stdio transport, the full nine-tool surface
// (node G5.2 write tools + node G5.3 read tools; SPEC.md §19).
//
// Never writes to stdout: on a stdio MCP server stdout is the protocol
// wire, so every diagnostic here goes to stderr (node G5.2 requirement 1,
// §4.g).
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { AgentApiClient } from "./api-client.js";
import { ConfigError, loadConfig } from "./config.js";
import type { ToolDeps } from "./deps.js";
import { registerGetDocument } from "./tools/get-document.js";
import { registerListCategories } from "./tools/list-categories.js";
import { registerListDocuments } from "./tools/list-documents.js";
import { registerListTags } from "./tools/list-tags.js";
import { registerMoveDocument } from "./tools/move-document.js";
import { registerSearchDocuments } from "./tools/search-documents.js";
import { registerUpdateDocument } from "./tools/update-document.js";
import { registerUpdateMetadata } from "./tools/update-metadata.js";
import { registerUploadDocument } from "./tools/upload-document.js";

/**
 * Builds a fully registered `McpServer` — every one of the nine allowed
 * tools (SPEC.md §19), no more and no fewer. Exported so
 * mcp/tests/tool-contract.test.ts can connect a real MCP `Client` to
 * exactly the server the binary serves (via `main()` below) rather than
 * to a second, hand-built stand-in — the only way a `tools/list` call can
 * prove anything about what this file actually registers (node G5.3 §4.c).
 */
export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "alexandria", version: "0.1.0" }, { capabilities: { tools: {} } });

  registerUploadDocument(server, deps);
  registerUpdateDocument(server, deps);
  registerUpdateMetadata(server, deps);
  registerMoveDocument(server, deps);
  registerGetDocument(server, deps);
  registerListDocuments(server, deps);
  registerSearchDocuments(server, deps);
  registerListCategories(server, deps);
  registerListTags(server, deps);

  return server;
}

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

  serveStdio(() => createServer(deps));
}

/**
 * True only when this file is the process entry point (`node
 * dist/server.js`, or the `bin` shim in package.json) — never on a plain
 * `import`. The guard is what lets mcp/tests/tool-contract.test.ts
 * `import { createServer }` from this module without `main()` reading real
 * environment variables and calling `process.exit` out from under the test
 * runner (node G5.3 §4.c).
 *
 * The comparison goes through `realpathSync` deliberately. Node resolves
 * symlinks for the entry module but NOT for `process.argv[1]`, so a launch
 * through a `node_modules/.bin` symlink — how a package's `bin` is normally
 * invoked on Linux and macOS — gives `import.meta.url` the real path and
 * `argv[1]` the link path. Comparing them raw would silently take the
 * `false` branch there: the process would start, register nothing, write
 * nothing, and leave the MCP client waiting on an `initialize` that never
 * comes. That is the worst failure shape a stdio server has, so it is
 * closed here rather than left to be discovered.
 */
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  const thisFile = fileURLToPath(import.meta.url);
  try {
    return realpathSync(argv1) === thisFile;
  } catch {
    // argv[1] is not a path that exists — nothing was launched from this
    // file, so this module is being imported.
    return false;
  }
}

if (isEntryPoint()) {
  main();
}
