// Node G5.3 Tests Required (Negative): the exposed tool set equals
// exactly the nine allowed names, and none of the eight forbidden names
// is registered.
//
// Requirement 1 and orchestrator clarification §4.b: the allow/forbid
// lists below are typed out by hand, never imported from or derived from
// the server's own registry — a test that reads the registry to build its
// own expectation could never catch the registry being wrong.
//
// Orchestrator clarification §4.c: `mcp/src/server.ts`'s private
// `_registeredTools` proves nothing to an outside caller, so this
// connects a REAL `@modelcontextprotocol/client` `Client` to the REAL
// `createServer()` factory `mcp/src/server.ts` exports (the same factory
// its `main()` calls) over a real `InMemoryTransport` pair, and asserts on
// what `client.listTools()` returns — the same view any MCP agent gets.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { AgentApiClient, type FetchFn } from "../src/api-client.js";
import { createServer } from "../src/server.js";

const ALLOWED = [
  "upload_document",
  "update_document",
  "get_document",
  "list_documents",
  "search_documents",
  "update_metadata",
  "move_document",
  "list_categories",
  "list_tags",
] as const;

const FORBIDDEN = [
  "delete_document",
  "delete_version",
  "restore_version",
  "create_category",
  "rename_category",
  "move_category",
  "delete_category",
  "change_slug",
] as const;

function makeDeps() {
  const fetchFn = vi.fn<FetchFn>();
  return {
    apiClient: new AgentApiClient({ apiUrl: "https://alexandria.example.test", agentKey: "test-key", fetchFn }),
    maxUploadBytes: 20 * 1024 * 1024,
  };
}

async function connectRealClient() {
  const server = createServer(makeDeps());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tool-contract-test-client", version: "0.0.0" });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return client;
}

describe("tool contract: the nine-tool surface, over a real MCP transport", () => {
  it("registers exactly the nine allowed tools, no more and no fewer", async () => {
    const client = await connectRealClient();
    const { tools } = await client.listTools();
    const names = new Set(tools.map((tool) => tool.name));

    expect(names).toEqual(new Set(ALLOWED));
  });

  it("registers none of the eight forbidden tool names", async () => {
    const client = await connectRealClient();
    const { tools } = await client.listTools();
    const names = new Set(tools.map((tool) => tool.name));

    for (const forbidden of FORBIDDEN) {
      expect(names.has(forbidden)).toBe(false);
    }
  });
});

describe("docs/MCP.md", () => {
  it("lists exactly the tools the server registers", async () => {
    const docsPath = join(import.meta.dirname, "..", "..", "docs", "MCP.md");
    const content = await readFile(docsPath, "utf8");

    // Every tool gets its own "### `tool_name`" heading (§3); the
    // "deliberately unavailable" section (§4) names the forbidden tools
    // only in prose, never as a heading, so this pattern cannot pick them
    // up by accident.
    const headings = [...content.matchAll(/^### `(\w+)`$/gm)].map((match) => match[1]);

    expect(new Set(headings)).toEqual(new Set(ALLOWED));
    expect(headings.length).toBe(ALLOWED.length);

    for (const forbidden of FORBIDDEN) {
      expect(content).toContain(forbidden);
    }
  });
});
