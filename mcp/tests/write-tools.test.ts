// Node G5.2 Tests Required: the four write tools, local validation
// short-circuiting the network, API errors and UNCHANGED surfaced
// faithfully, the agent key never leaking, no forbidden tool name, and no
// domain logic duplicated in this package.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readdir, readFile as readFileSync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentApiClient, type FetchFn } from "../src/api-client.js";
import { ConfigError, loadConfig } from "../src/config.js";
import type { ToolDeps } from "../src/deps.js";
import { registerMoveDocument } from "../src/tools/move-document.js";
import { registerUpdateDocument } from "../src/tools/update-document.js";
import { registerUpdateMetadata } from "../src/tools/update-metadata.js";
import { registerUploadDocument } from "../src/tools/upload-document.js";

const AGENT_KEY = "super-secret-agent-key-do-not-leak";

// ---------------------------------------------------------------------------
// Fake McpServer — captures each tool's callback so tests can invoke it
// directly, without going through a real transport. This is the same
// pattern the register* functions are built for: `server.registerTool`
// is the only interaction with the SDK.
// ---------------------------------------------------------------------------
type Captured = { name: string; config: unknown; cb: (args: unknown, ctx?: unknown) => Promise<CallToolResult> };

function fakeServer() {
  const tools = new Map<string, Captured>();
  const server = {
    registerTool(name: string, config: unknown, cb: (args: unknown, ctx?: unknown) => Promise<CallToolResult>) {
      tools.set(name, { name, config, cb });
      return { name };
    },
    // Unused by the register* functions but present on the real McpServer.
  };
  return { server: server as never, tools };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "alexandria-mcp-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeDeps(fetchFn: FetchFn, maxUploadBytes = 20 * 1024 * 1024): ToolDeps {
  return {
    apiClient: new AgentApiClient({ apiUrl: "https://alexandria.example.test", agentKey: AGENT_KEY, fetchFn }),
    maxUploadBytes,
  };
}

// ---------------------------------------------------------------------------
// Positive
// ---------------------------------------------------------------------------

describe("upload_document", () => {
  it("publishes a local file and returns a slug and URL", async () => {
    const filePath = join(tmpDir, "report.html");
    await writeFile(filePath, "<html><head><title>Report</title></head><body>hi</body></html>");

    const fetchFn = vi.fn<FetchFn>(async () =>
      jsonResponse(201, {
        ok: true,
        data: {
          documentId: "doc_1",
          slug: "report",
          versionId: "ver_1",
          versionNo: 1,
          title: "Report",
          description: "",
          tags: [],
          url: "https://alexandria.example.test/docs/report",
        },
      }),
    );

    const { server, tools } = fakeServer();
    registerUploadDocument(server, makeDeps(fetchFn));
    const result = await tools.get("upload_document")!.cb({
      filePath,
      categoryId: "cat_1",
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      slug: "report",
      url: "https://alexandria.example.test/docs/report",
      versionNo: 1,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://alexandria.example.test/api/agent/documents");
    expect(init?.method).toBe("POST");
  });
});

describe("update_document", () => {
  it("creates a new version", async () => {
    const filePath = join(tmpDir, "report.html");
    await writeFile(filePath, "<html><body>v2</body></html>");

    const fetchFn = vi.fn<FetchFn>(async () =>
      jsonResponse(201, {
        ok: true,
        data: {
          versionId: "ver_2",
          versionNo: 2,
          unchanged: false,
          url: "https://alexandria.example.test/docs/report",
        },
      }),
    );

    const { server, tools } = fakeServer();
    registerUpdateDocument(server, makeDeps(fetchFn));
    const result = await tools.get("update_document")!.cb({ slug: "report", filePath });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ versionNo: 2, unchanged: false });
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text).toContain("Published version 2");
  });

  it("reports UNCHANGED as a successful no-op, not an error", async () => {
    const filePath = join(tmpDir, "report.html");
    await writeFile(filePath, "<html><body>same bytes</body></html>");

    const fetchFn = vi.fn<FetchFn>(async () =>
      jsonResponse(200, {
        ok: true,
        data: { unchanged: true, versionId: "ver_1", versionNo: 1 },
      }),
    );

    const { server, tools } = fakeServer();
    registerUpdateDocument(server, makeDeps(fetchFn));
    const result = await tools.get("update_document")!.cb({ slug: "report", filePath });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ unchanged: true, versionNo: 1 });
    expect((result.content[0] as { text: string }).text).toContain("No change");
  });
});

describe("update_metadata", () => {
  it("behaves as the API does", async () => {
    const fetchFn = vi.fn<FetchFn>(async (url, init) => {
      expect(url).toBe("https://alexandria.example.test/api/agent/documents/report");
      expect(init?.method).toBe("PATCH");
      return jsonResponse(200, {
        ok: true,
        data: {
          documentId: "doc_1",
          slug: "report",
          title: "New Title",
          description: "New description",
          categoryId: "cat_1",
          currentVersionId: "ver_1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          tags: ["a", "b"],
          url: "https://alexandria.example.test/docs/report",
        },
      });
    });

    const { server, tools } = fakeServer();
    registerUpdateMetadata(server, makeDeps(fetchFn));
    const result = await tools.get("update_metadata")!.cb({ slug: "report", title: "New Title" });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ slug: "report", title: "New Title", tags: ["a", "b"] });
  });
});

describe("move_document", () => {
  it("behaves as the API does", async () => {
    const fetchFn = vi.fn<FetchFn>(async (url, init) => {
      expect(url).toBe("https://alexandria.example.test/api/agent/documents/report/move");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ categoryId: "cat_2" });
      return jsonResponse(200, {
        ok: true,
        data: {
          documentId: "doc_1",
          slug: "report",
          title: "Report",
          description: "",
          categoryId: "cat_2",
          currentVersionId: "ver_1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          tags: [],
          url: "https://alexandria.example.test/docs/report",
        },
      });
    });

    const { server, tools } = fakeServer();
    registerMoveDocument(server, makeDeps(fetchFn));
    const result = await tools.get("move_document")!.cb({ slug: "report", categoryId: "cat_2" });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ slug: "report", categoryId: "cat_2" });
  });
});

// ---------------------------------------------------------------------------
// Negative
// ---------------------------------------------------------------------------

describe("configuration", () => {
  it("prevents startup when required variables are missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ ALEXANDRIA_API_URL: "https://x.test" })).toThrow(/ALEXANDRIA_AGENT_KEY/);
    expect(() => loadConfig({ ALEXANDRIA_AGENT_KEY: "k" })).toThrow(/ALEXANDRIA_API_URL/);
  });

  it("succeeds when both variables are present", () => {
    const config = loadConfig({ ALEXANDRIA_API_URL: "https://x.test", ALEXANDRIA_AGENT_KEY: "k" });
    expect(config.apiUrl).toBe("https://x.test");
    expect(config.agentKey).toBe("k");
  });
});

describe("local validation short-circuits the network", () => {
  it("does not call fetch when the file does not exist", async () => {
    const fetchFn = vi.fn<FetchFn>();
    const { server, tools } = fakeServer();
    registerUploadDocument(server, makeDeps(fetchFn));

    const result = await tools.get("upload_document")!.cb({
      filePath: join(tmpDir, "does-not-exist.html"),
      categoryId: "cat_1",
    });

    expect(result.isError).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not call fetch when the file is not .html", async () => {
    const filePath = join(tmpDir, "report.txt");
    await writeFile(filePath, "not html");
    const fetchFn = vi.fn<FetchFn>();
    const { server, tools } = fakeServer();
    registerUploadDocument(server, makeDeps(fetchFn));

    const result = await tools.get("upload_document")!.cb({ filePath, categoryId: "cat_1" });

    expect(result.isError).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not call fetch when the file is empty", async () => {
    const filePath = join(tmpDir, "empty.html");
    await writeFile(filePath, "");
    const fetchFn = vi.fn<FetchFn>();
    const { server, tools } = fakeServer();
    registerUploadDocument(server, makeDeps(fetchFn));

    const result = await tools.get("upload_document")!.cb({ filePath, categoryId: "cat_1" });

    expect(result.isError).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not call fetch, and names the limit, when the file exceeds the size limit", async () => {
    const filePath = join(tmpDir, "big.html");
    await writeFile(filePath, "<html>this is bigger than the tiny limit below</html>");
    const fetchFn = vi.fn<FetchFn>();
    const { server, tools } = fakeServer();
    registerUploadDocument(server, makeDeps(fetchFn, 5));

    const result = await tools.get("upload_document")!.cb({ filePath, categoryId: "cat_1" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("5 bytes");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("applies the same local validation to update_document", async () => {
    const fetchFn = vi.fn<FetchFn>();
    const { server, tools } = fakeServer();
    registerUpdateDocument(server, makeDeps(fetchFn));

    const result = await tools.get("update_document")!.cb({
      slug: "report",
      filePath: join(tmpDir, "missing.html"),
    });

    expect(result.isError).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("API error codes are surfaced verbatim", () => {
  it("CATEGORY_NOT_FOUND from upload_document", async () => {
    const filePath = join(tmpDir, "report.html");
    await writeFile(filePath, "<html><body>hi</body></html>");

    const fetchFn = vi.fn<FetchFn>(async () =>
      jsonResponse(404, {
        ok: false,
        error: { code: "CATEGORY_NOT_FOUND", message: "No category with that id." },
      }),
    );

    const { server, tools } = fakeServer();
    registerUploadDocument(server, makeDeps(fetchFn));
    const result = await tools.get("upload_document")!.cb({ filePath, categoryId: "does-not-exist" });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("CATEGORY_NOT_FOUND");
    expect(text).toContain("No category with that id.");
  });

  it("AGENT_KEY_INVALID from move_document", async () => {
    const fetchFn = vi.fn<FetchFn>(async () =>
      jsonResponse(401, {
        ok: false,
        error: { code: "AGENT_KEY_INVALID", message: "Invalid agent key." },
      }),
    );

    const { server, tools } = fakeServer();
    registerMoveDocument(server, makeDeps(fetchFn));
    const result = await tools.get("move_document")!.cb({ slug: "report", categoryId: "cat_1" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("AGENT_KEY_INVALID");
  });

  it("a malformed ok:false body becomes a tool error, never a thrown TypeError", async () => {
    // Added by the orchestrator while verifying G5.2. The envelope guard
    // used to narrow on `ok === false` alone and then read `error.code`,
    // so a body shaped like this — anything answering JSON of its own that
    // is not the Alexandria envelope — threw out of the tool callback and
    // reached the calling agent as a protocol failure instead of the
    // readable tool error this package exists to produce.
    const fetchFn = vi.fn<FetchFn>(async () => jsonResponse(502, { ok: false }));

    const { server, tools } = fakeServer();
    registerMoveDocument(server, makeDeps(fetchFn));

    const result = await tools.get("move_document")!.cb({ slug: "report", categoryId: "cat_1" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("unrecognized response shape");
  });

  it("a transport failure (API unreachable) is a clear error, not a retry storm", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => {
      throw new Error("ECONNREFUSED");
    });

    const { server, tools } = fakeServer();
    registerMoveDocument(server, makeDeps(fetchFn));
    const result = await tools.get("move_document")!.cb({ slug: "report", categoryId: "cat_1" });

    expect(result.isError).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((result.content[0] as { text: string }).text).toContain("ECONNREFUSED");
  });
});

describe("the agent key never leaks", () => {
  it("is absent from every tool result across success, API-error and transport-error paths", async () => {
    const filePath = join(tmpDir, "report.html");
    await writeFile(filePath, "<html><body>hi</body></html>");

    const results: CallToolResult[] = [];

    // Success
    {
      const fetchFn = vi.fn<FetchFn>(async () =>
        jsonResponse(201, {
          ok: true,
          data: {
            documentId: "doc_1",
            slug: "report",
            versionId: "ver_1",
            versionNo: 1,
            title: "Report",
            description: "",
            tags: [],
            url: "https://alexandria.example.test/docs/report",
          },
        }),
      );
      const { server, tools } = fakeServer();
      registerUploadDocument(server, makeDeps(fetchFn));
      results.push(await tools.get("upload_document")!.cb({ filePath, categoryId: "cat_1" }));
    }

    // API error
    {
      const fetchFn = vi.fn<FetchFn>(async () =>
        jsonResponse(404, { ok: false, error: { code: "CATEGORY_NOT_FOUND", message: "not found" } }),
      );
      const { server, tools } = fakeServer();
      registerUploadDocument(server, makeDeps(fetchFn));
      results.push(await tools.get("upload_document")!.cb({ filePath, categoryId: "cat_1" }));
    }

    // Transport error
    {
      const fetchFn = vi.fn<FetchFn>(async () => {
        throw new Error("network down");
      });
      const { server, tools } = fakeServer();
      registerUploadDocument(server, makeDeps(fetchFn));
      results.push(await tools.get("upload_document")!.cb({ filePath, categoryId: "cat_1" }));
    }

    for (const result of results) {
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(AGENT_KEY);
    }
  });

  it("is sent only via the Authorization header, and only as a Bearer token", async () => {
    const filePath = join(tmpDir, "report.html");
    await writeFile(filePath, "<html><body>hi</body></html>");

    const fetchFn = vi.fn<FetchFn>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe(`Bearer ${AGENT_KEY}`);
      return jsonResponse(201, {
        ok: true,
        data: {
          documentId: "doc_1",
          slug: "report",
          versionId: "ver_1",
          versionNo: 1,
          title: "Report",
          description: "",
          tags: [],
          url: "https://alexandria.example.test/docs/report",
        },
      });
    });

    const { server, tools } = fakeServer();
    registerUploadDocument(server, makeDeps(fetchFn));
    await tools.get("upload_document")!.cb({ filePath, categoryId: "cat_1" });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("no forbidden tool name is registered", () => {
  const FORBIDDEN = [
    "delete_document",
    "delete_version",
    "restore_version",
    "create_category",
    "rename_category",
    "move_category",
    "delete_category",
    "change_slug",
  ];

  it("registers exactly the four write tools and none of the forbidden names", () => {
    const fetchFn = vi.fn<FetchFn>();
    const { server, tools } = fakeServer();
    const deps = makeDeps(fetchFn);
    registerUploadDocument(server, deps);
    registerUpdateDocument(server, deps);
    registerUpdateMetadata(server, deps);
    registerMoveDocument(server, deps);

    expect(new Set(tools.keys())).toEqual(
      new Set(["upload_document", "update_document", "update_metadata", "move_document"]),
    );
    for (const forbidden of FORBIDDEN) {
      expect(tools.has(forbidden)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Regression: no domain rule duplicated in mcp/src
// ---------------------------------------------------------------------------

describe("no domain logic is duplicated in mcp/src", () => {
  it("contains no SQL, D1 or R2 access", async () => {
    const srcDir = join(import.meta.dirname, "..", "src");
    const files = await collectTsFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);

    const forbiddenPatterns = [
      /\bSELECT\b/i,
      /\bINSERT INTO\b/i,
      /\bUPDATE\s+\w+\s+SET\b/i,
      /\.prepare\(/,
      /D1Database/,
      /R2Bucket/,
      /env\.DB\b/,
      /env\.DOCS\b/,
    ];

    for (const file of files) {
      const content = await readFileSync(file, "utf8");
      for (const pattern of forbiddenPatterns) {
        expect(pattern.test(content), `${file} matched forbidden pattern ${pattern}`).toBe(false);
      }
    }
  });
});

async function collectTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(full)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}
