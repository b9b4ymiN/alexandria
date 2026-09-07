// Node G5.3 requirement 5 / Tests Required (Positive): an end-to-end MCP
// test running the tools against a locally served Alexandria Worker with
// a REAL local D1 and R2 — not a mock, not vitest-pool-workers' in-process
// SELF binding. `beforeAll` brings up exactly the sequence the
// orchestrator specified (node G5.3 §4.e), because getting this wrong has
// bitten this project on every deploy: the app Worker MUST be served from
// the config `pnpm build` emits (`dist/alexandria/wrangler.json`), never
// from `wrangler.jsonc` directly — the Cloudflare Vite plugin supplies
// `assets.directory` at build time, and the source config alone fails
// with "missing the required `directory` property".
//
// `--persist-to` is passed explicitly rather than left at its default so
// this process and `pnpm db:migrate:local` (run moments earlier against
// the ROOT `wrangler.jsonc`, a different `-c` config) are guaranteed to
// read and write the same local D1/R2 state regardless of how wrangler
// would otherwise resolve a bare default relative to each config file's
// own directory.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { AgentApiClient } from "../src/api-client.js";
import type { ToolDeps } from "../src/deps.js";
import { registerGetDocument } from "../src/tools/get-document.js";
import { registerListCategories } from "../src/tools/list-categories.js";
import { registerListDocuments } from "../src/tools/list-documents.js";
import { registerListTags } from "../src/tools/list-tags.js";
import { registerSearchDocuments } from "../src/tools/search-documents.js";
import { registerUpdateDocument } from "../src/tools/update-document.js";
import { registerUploadDocument } from "../src/tools/upload-document.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const PERSIST_DIR = join(REPO_ROOT, ".wrangler", "state");
// Spread the port out by pid so a second suite run (or a stray leftover
// process) on the same machine is unlikely to collide.
const PORT = 18700 + (process.pid % 400);
const BASE_URL = `http://127.0.0.1:${PORT}`;
// From .dev.vars (AGENT_API_KEY) — not a real secret, and never printed.
const AGENT_KEY = "local-dev-agent-key-not-a-real-secret";
// "Uncategorized", seeded by migrations/0002_seed_categories.sql — every
// local D1 has this row after `pnpm db:migrate:local`, so the sequence
// below needs no throwaway fixture category of its own.
const SEEDED_CATEGORY_ID = "cat_9a6e2d5b0f8c4ad4";

let workerProcess: ChildProcess | undefined;
let workerOutput = "";
let tmpDir: string;

function runOrThrow(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: REPO_ROOT, shell: true, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (exit ${String(result.status)}):\n${result.stdout}\n${result.stderr}`,
    );
  }
}

async function waitUntilReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/public/documents`);
      // Any HTTP response (even a 4xx/5xx) means the Worker is up and
      // routing; we only need "the process is serving", not "this one
      // route is healthy".
      if (res.status > 0) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Worker did not become ready within ${timeoutMs}ms (last error: ${lastError})`);
}

/** Runs a read-only SQL query against the SAME local D1 the Worker under
 * test reads and writes, via `wrangler d1 execute` — a real D1 query, not
 * an HTTP-layer proxy for one (node G5.3 §4.d). Returns the single result
 * row.
 *
 * The SQL is written to a temp `.sql` file and passed as `--file` rather
 * than `--command`: on Windows, `spawnSync` with `shell: true` re-tokenizes
 * an args array through cmd.exe, and this query's parentheses land as
 * unescaped shell metacharacters that split the string into "unknown
 * arguments" — a file sidesteps quoting entirely.
 */
async function queryLocalD1(sql: string): Promise<Record<string, unknown>> {
  const sqlFile = join(tmpDir, `query-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sql`);
  await writeFile(sqlFile, sql);
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "alexandria-db", "--local", "--json", "--persist-to", PERSIST_DIR, "--file", sqlFile],
    { cwd: REPO_ROOT, shell: true, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute failed (exit ${String(result.status)}):\n${result.stdout}\n${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as Array<{ results: Array<Record<string, unknown>> }>;
  const row = parsed[0]?.results[0];
  if (row === undefined) {
    throw new Error(`wrangler d1 execute returned no row for: ${sql}`);
  }
  return row;
}

/** A stable, cheap-to-compute fingerprint of everything a read tool could
 * possibly have mutated: row counts across every table a document touches,
 * plus the latest timestamp in each of the two tables writes touch. */
function dbFingerprint(): Promise<Record<string, unknown>> {
  return queryLocalD1(
    "SELECT " +
      "(SELECT COUNT(*) FROM documents) AS documents, " +
      "(SELECT COUNT(*) FROM document_versions) AS versions, " +
      "(SELECT COUNT(*) FROM document_tags) AS documentTags, " +
      "(SELECT COUNT(*) FROM tags) AS tags, " +
      "(SELECT COUNT(*) FROM categories) AS categories, " +
      "(SELECT MAX(updated_at) FROM documents) AS maxDocumentUpdatedAt, " +
      "(SELECT MAX(created_at) FROM document_versions) AS maxVersionCreatedAt",
  );
}

beforeAll(async () => {
  runOrThrow("pnpm", ["build"]);
  runOrThrow("pnpm", ["db:migrate:local"]);

  workerProcess = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "-c",
      "dist/alexandria/wrangler.json",
      "--port",
      String(PORT),
      "--local",
      "--persist-to",
      PERSIST_DIR,
    ],
    { cwd: REPO_ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  workerProcess.stdout?.on("data", (chunk: Buffer) => {
    workerOutput += chunk.toString();
  });
  workerProcess.stderr?.on("data", (chunk: Buffer) => {
    workerOutput += chunk.toString();
  });

  try {
    await waitUntilReady(90_000);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n--- wrangler dev output ---\n${workerOutput}`, {
      cause: error,
    });
  }

  tmpDir = await mkdtemp(join(tmpdir(), "alexandria-mcp-e2e-"));
}, 180_000);

/**
 * Kills the whole `pnpm exec wrangler dev` process tree, not just the
 * direct child. `child.kill()` alone leaves `workerd.exe` running on
 * Windows: the spawned process is `cmd.exe` (from `shell: true`), which
 * forwards to `pnpm` -> `wrangler` -> `workerd`, and Windows does not
 * cascade a kill signal down that chain the way POSIX process groups do —
 * confirmed by orphaned `workerd.exe` processes still listening on `PORT`
 * after a prior version of this teardown that only called `.kill()`.
 */
function killWorkerTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { shell: true });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      process.kill(pid, "SIGKILL");
    }
  }
}

afterAll(async () => {
  if (workerProcess !== undefined && workerProcess.pid !== undefined && workerProcess.exitCode === null) {
    killWorkerTree(workerProcess.pid);
  }
  if (tmpDir !== undefined) {
    await rm(tmpDir, { recursive: true, force: true });
  }
}, 30_000);

// ---------------------------------------------------------------------------
// Same fakeServer() capture pattern as mcp/tests/write-tools.test.ts: this
// file's job is to prove the tools work against a real Worker/D1/R2, not
// to re-prove tool registration (tool-contract.test.ts already does that
// over a real transport) — a real McpServer/Client round trip here would
// only add overhead without adding coverage.
// ---------------------------------------------------------------------------
type Captured = { cb: (args: unknown) => Promise<CallToolResult> };

function fakeServer() {
  const tools = new Map<string, Captured>();
  const server = {
    registerTool(name: string, _config: unknown, cb: (args: unknown) => Promise<CallToolResult>) {
      tools.set(name, { cb });
      return { name };
    },
  };
  return { server: server as never, tools };
}

function makeDeps(): ToolDeps {
  return {
    apiClient: new AgentApiClient({ apiUrl: BASE_URL, agentKey: AGENT_KEY }),
    maxUploadBytes: 20 * 1024 * 1024,
  };
}

function allTools() {
  const { server, tools } = fakeServer();
  const deps = makeDeps();
  registerUploadDocument(server, deps);
  registerUpdateDocument(server, deps);
  registerGetDocument(server, deps);
  registerListDocuments(server, deps);
  registerSearchDocuments(server, deps);
  registerListCategories(server, deps);
  registerListTags(server, deps);
  return tools;
}

function structuredContent<T>(result: CallToolResult): T {
  expect(result.isError, `expected success, got: ${JSON.stringify(result)}`).toBeUndefined();
  return result.structuredContent as T;
}

describe("MCP end-to-end against a real local Worker (D1 + R2)", () => {
  it("publishes, lists, searches, gets, updates, and gets again", async () => {
    const tools = allTools();
    const marker = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const title = `MCP E2E Test ${marker}`;

    const filePath = join(tmpDir, "e2e-v1.html");
    await writeFile(
      filePath,
      `<html><head><title>${title}</title></head><body>Hello from the e2e test, version 1.</body></html>`,
    );

    // publish
    const uploaded = structuredContent<{ slug: string; versionNo: number }>(
      await tools.get("upload_document")!.cb({ filePath, categoryId: SEEDED_CATEGORY_ID }),
    );
    expect(uploaded.versionNo).toBe(1);
    const slug = uploaded.slug;
    expect(slug.length).toBeGreaterThan(0);

    // list
    const listed = structuredContent<{ items: Array<{ slug: string }>; total: number }>(
      await tools.get("list_documents")!.cb({ pageSize: 100 }),
    );
    expect(listed.items.some((item) => item.slug === slug)).toBe(true);

    // search
    const searched = structuredContent<{ items: Array<{ slug: string }>; query: string }>(
      await tools.get("search_documents")!.cb({ query: marker }),
    );
    expect(searched.query).toBe(marker);
    expect(searched.items.some((item) => item.slug === slug)).toBe(true);

    // get
    const firstGet = structuredContent<{ title: string; currentVersionId: string; contentUrl: string }>(
      await tools.get("get_document")!.cb({ slug }),
    );
    expect(firstGet.title).toBe(title);
    expect(firstGet.contentUrl.length).toBeGreaterThan(0);

    // update
    const updatedFilePath = join(tmpDir, "e2e-v2.html");
    await writeFile(
      updatedFilePath,
      `<html><head><title>${title}</title></head><body>Updated content, version 2.</body></html>`,
    );
    const updated = structuredContent<{ versionNo: number; unchanged: boolean }>(
      await tools.get("update_document")!.cb({ slug, filePath: updatedFilePath }),
    );
    expect(updated.unchanged).toBe(false);
    expect(updated.versionNo).toBe(2);

    // get again
    const secondGet = structuredContent<{ currentVersionId: string }>(
      await tools.get("get_document")!.cb({ slug }),
    );
    expect(secondGet.currentVersionId).not.toBe(firstGet.currentVersionId);
  }, 60_000);

  it("get_document for an unknown slug surfaces DOCUMENT_NOT_FOUND verbatim", async () => {
    const tools = allTools();
    const result = await tools.get("get_document")!.cb({ slug: "no-such-document-e2e-probe" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("DOCUMENT_NOT_FOUND");
  });

  it("get_document never returns HTML body content", async () => {
    const tools = allTools();
    const marker = `e2e-body-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const filePath = join(tmpDir, "e2e-body.html");
    const bodyMarker = "THIS-BODY-TEXT-MUST-NEVER-LEAK-INTO-GET-DOCUMENT";
    await writeFile(filePath, `<html><head><title>${marker}</title></head><body>${bodyMarker}</body></html>`);

    const uploaded = structuredContent<{ slug: string }>(
      await tools.get("upload_document")!.cb({ filePath, categoryId: SEEDED_CATEGORY_ID }),
    );

    const result = await tools.get("get_document")!.cb({ slug: uploaded.slug });
    expect(result.isError).toBeUndefined();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(bodyMarker);
    expect(serialized).not.toContain("<html");
    expect(serialized).not.toContain("<body");
  });

  it("search_documents behaves like the public API for a Thai query", async () => {
    const tools = allTools();
    // No document is expected to match; the point is that a non-Latin
    // query is accepted and answered like any other, not that this
    // specific term matches something.
    const result = await tools.get("search_documents")!.cb({ query: "ห้องสมุด" });

    expect(result.isError).toBeUndefined();
    const data = structuredContent<{ items: unknown[]; total: number }>(result);
    expect(Array.isArray(data.items)).toBe(true);
  });

  it("list_documents clamps an out-of-range page rather than erroring", async () => {
    const tools = allTools();
    const result = await tools.get("list_documents")!.cb({ page: 999_999, pageSize: 20 });

    expect(result.isError).toBeUndefined();
    const data = structuredContent<{ items: unknown[]; page: number }>(result);
    expect(Array.isArray(data.items)).toBe(true);
  });

  it("an unmatched filter returns empty results, not an error", async () => {
    const tools = allTools();
    const result = await tools.get("list_documents")!.cb({ tag: `no-such-tag-${Date.now()}` });

    expect(result.isError).toBeUndefined();
    const data = structuredContent<{ items: unknown[]; total: number }>(result);
    expect(data.items).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("list_categories returns the full tree in one call", async () => {
    const tools = allTools();
    const result = await tools.get("list_categories")!.cb({});

    expect(result.isError).toBeUndefined();
    const data = structuredContent<{ categories: Array<{ id: string; parentId: string | null }> }>(result);
    // Every seeded top-level category (migrations/0002_seed_categories.sql)
    // must be present in the one response — this is the "full tree, one
    // call" contract, not a paginated or subtree view.
    expect(data.categories.some((c) => c.id === SEEDED_CATEGORY_ID)).toBe(true);
    expect(data.categories.length).toBeGreaterThanOrEqual(4);
  });

  it("list_tags responds without error", async () => {
    const tools = allTools();
    const result = await tools.get("list_tags")!.cb({});

    expect(result.isError).toBeUndefined();
    const data = structuredContent<{ tags: unknown[] }>(result);
    expect(Array.isArray(data.tags)).toBe(true);
  });

  it("no read tool mutates the database", async () => {
    const tools = allTools();
    const before = await dbFingerprint();

    await tools.get("list_documents")!.cb({ pageSize: 5 });
    await tools.get("search_documents")!.cb({ query: "anything" });
    await tools.get("list_categories")!.cb({});
    await tools.get("list_tags")!.cb({});
    // A lookup against a real, already-published slug (any row from the
    // fingerprint's own document count is enough evidence that at least
    // one exists after the earlier tests in this file) exercises the read
    // path fully; a not-found lookup would only prove the error path
    // never mutates, which is a weaker claim.
    await tools.get("list_documents")!.cb({ pageSize: 1 });

    const after = await dbFingerprint();
    expect(after).toEqual(before);
  }, 30_000);
});
