// Node G2.3 — Document Metadata Update & Move, exercised through the real
// Hono app with REAL bindings (createApp().fetch(request, env)), never a
// bare fetch with no env, matching the pattern established by
// tests/integration/api-documents.test.ts and tests/integration/
// category-api.test.ts.
//
// This is the node the plan singles out for its own negative tests
// because the stable-slug invariant (AGENT.md §5) is most likely to be
// broken here by a well-meaning change: every shared reader link depends
// on the slug never moving. The regression suite at the bottom proves the
// slug, the public URL and the current version id survive a title change,
// a category move AND a tag replacement, all at once.
import { beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error - "cloudflare:test" has no ambient type outside the
// package's optional "./types" subpath, which is out of this node's scope
import { env as workersEnv, reset } from "cloudflare:test";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0001 from "../../migrations/0001_init.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0002 from "../../migrations/0002_seed_categories.sql?raw";

import { createApp } from "../../src/api/app";
import { signToken } from "../../src/shared/token";
import type { Env } from "../../src/shared/types";
import { createDocument } from "../../src/domain/documents/document-service";
import type { Storage } from "../../src/domain/versions/version-service";

const SIGNING_SECRET = "document-metadata-test-signing-secret";
const APP_ORIGIN = "https://app.test";
const CONTENT_ORIGIN = "https://content.test";

function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => {
      const commentIndex = line.indexOf("--");
      return commentIndex === -1 ? line : line.slice(0, commentIndex);
    })
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...(workersEnv as Env),
    APP_ORIGIN,
    CONTENT_ORIGIN,
    ADMIN_PASSWORD: "irrelevant-for-these-tests",
    ADMIN_SESSION_SIGNING_SECRET: SIGNING_SECRET,
    ...overrides,
  };
}

function storage(): Storage {
  const typed = workersEnv as unknown as { DB: D1Database; DOCS: R2Bucket };
  return { db: typed.DB, docs: typed.DOCS };
}

async function applyMigrations(database: D1Database): Promise<void> {
  for (const statement of [...splitStatements(migration0001), ...splitStatements(migration0002)]) {
    await database.prepare(statement).run();
  }
}

async function adminToken(): Promise<string> {
  return (await signToken(SIGNING_SECRET)).token;
}

function jsonRequest(path: string, method: string, token: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request(`https://app.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function toBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

const SIMPLE_HTML = `<!doctype html>
<html><head><title>Simple Report</title>
<meta name="description" content="A short description.">
</head><body><h1>Simple Report</h1><p>Body text.</p></body></html>`;

let categorySeq = 0;

async function seedCategory(db: D1Database, name = "Category"): Promise<string> {
  categorySeq += 1;
  const id = `cat-${categorySeq}`;
  const now = "2026-08-30T00:00:00.000Z";
  await db
    .prepare(
      "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES (?, NULL, ?, ?, 0, ?, ?)",
    )
    .bind(id, `${name} ${id}`, `slug-${id}`, now, now)
    .run();
  return id;
}

/** Creates a document directly through DocumentService, bypassing HTTP — pure test setup, not the thing under test. */
async function seedDocument(
  store: Storage,
  categoryId: string,
  overrides: { title?: string; tags?: string[] } = {},
): Promise<{ documentId: string; slug: string; versionId: string }> {
  const result = await createDocument(store, {
    bytes: toBytes(SIMPLE_HTML),
    filename: `doc-${crypto.randomUUID()}.html`,
    categoryId,
    createdBy: "admin",
    overrides,
  });
  return result;
}

/** Records every method invoked on a real R2Bucket without changing its behaviour. */
function spyOnBucket(bucket: R2Bucket): { bucket: R2Bucket; calls: string[] } {
  const calls: string[] = [];
  const proxy = new Proxy(bucket, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function" && typeof prop === "string") {
        calls.push(prop);
        return value.bind(target);
      }
      return value;
    },
  });
  return { bucket: proxy as R2Bucket, calls };
}

interface MetadataResponseBody {
  data?: {
    documentId: string;
    slug: string;
    title: string;
    description: string;
    categoryId: string;
    categoryPath: { id: string; name: string; slug: string }[];
    currentVersionId: string | null;
    createdAt: string;
    updatedAt: string;
    tags: string[];
    url: string;
  };
  error?: { code: string };
}

describe("Admin API — document metadata update & move (G2.3)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(storage().db);
  });

  describe("source assertion — no statement anywhere ever mutates documents.slug", () => {
    it("finds no UPDATE documents SET ... slug statement in the codebase", () => {
      // Vite resolves this glob at transform time into static imports, so
      // it works inside the Workers runtime this suite runs in (no
      // node:fs available — see tests/integration/content-worker-readonly
      // .test.ts for the same constraint on the content Worker's suite).
      // @ts-expect-error - `ImportMeta.glob` is a Vite build-time API with
      // no ambient type under this tsconfig's "@cloudflare/workers-types"
      // types (only tsconfig.json, for src/app, carries "vite/client");
      // adding that here is out of this node's scope, same rationale as
      // the "cloudflare:test" and "?raw" suppressions elsewhere.
      const modules = import.meta.glob("/src/**/*.ts", {
        query: "?raw",
        import: "default",
        eager: true,
      }) as Record<string, string>;

      const files = Object.entries(modules);
      // Sanity check: if the glob ever resolved to nothing, the assertion
      // below would trivially "pass" for the wrong reason.
      expect(files.length).toBeGreaterThan(10);

      const offenders: string[] = [];
      for (const [path, source] of files) {
        const stripped = stripComments(source);
        if (SLUG_MUTATION.test(stripped)) {
          offenders.push(path);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe("PATCH /api/admin/documents/:slug", () => {
    it("updates title, description and tags independently", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const token = await adminToken();
      const created = await seedDocument(store, categoryId);

      const titleRes = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", token, { title: "New Title" }),
        testEnv(),
      );
      const titleBody = (await titleRes.json()) as MetadataResponseBody;
      expect(titleRes.status).toBe(200);
      expect(titleBody.data?.title).toBe("New Title");
      expect(titleBody.data?.description).toBe("A short description.");

      const descRes = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", token, {
          description: "Updated description.",
        }),
        testEnv(),
      );
      const descBody = (await descRes.json()) as MetadataResponseBody;
      expect(descBody.data?.title).toBe("New Title");
      expect(descBody.data?.description).toBe("Updated description.");

      const tagsRes = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", token, { tags: ["alpha", "beta"] }),
        testEnv(),
      );
      const tagsBody = (await tagsRes.json()) as MetadataResponseBody;
      expect(tagsBody.data?.tags).toEqual(["alpha", "beta"]);
      expect(tagsBody.data?.title).toBe("New Title");
    });

    it("updates title, description and tags together in one request", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const token = await adminToken();
      const created = await seedDocument(store, categoryId);

      const res = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", token, {
          title: "Combined Title",
          description: "Combined description.",
          tags: ["combined"],
        }),
        testEnv(),
      );
      const body = (await res.json()) as MetadataResponseBody;
      expect(body.data?.title).toBe("Combined Title");
      expect(body.data?.description).toBe("Combined description.");
      expect(body.data?.tags).toEqual(["combined"]);
    });

    it("leaves an absent field untouched", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const token = await adminToken();
      const created = await seedDocument(store, categoryId, { title: "Original", tags: ["kept"] });

      const res = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", token, {
          description: "Only description changes.",
        }),
        testEnv(),
      );
      const body = (await res.json()) as MetadataResponseBody;
      expect(body.data?.title).toBe("Original");
      expect(body.data?.tags).toEqual(["kept"]);
      expect(body.data?.description).toBe("Only description changes.");
    });

    it("honours an explicitly empty description as a real intent to clear it", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const token = await adminToken();
      const created = await seedDocument(store, categoryId);

      const res = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", token, { description: "" }),
        testEnv(),
      );
      const body = (await res.json()) as MetadataResponseBody;
      expect(res.status).toBe(200);
      expect(body.data?.description).toBe("");
    });

    it("unlinks every tag when given an empty tags array", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const token = await adminToken();
      const created = await seedDocument(store, categoryId, { tags: ["one", "two"] });

      const res = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", token, { tags: [] }),
        testEnv(),
      );
      const body = (await res.json()) as MetadataResponseBody;
      expect(body.data?.tags).toEqual([]);

      const links = await store.db
        .prepare("SELECT COUNT(*) AS c FROM document_tags WHERE document_id = ?")
        .bind(created.documentId)
        .first<{ c: number }>();
      expect(links?.c).toBe(0);
    });

    it("advances updated_at without touching created_at", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const token = await adminToken();
      const created = await seedDocument(store, categoryId);

      const before = await store.db
        .prepare("SELECT created_at AS createdAt, updated_at AS updatedAt FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ createdAt: string; updatedAt: string }>();

      await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", token, { title: "Bumped" }),
        testEnv(),
      );

      const after = await store.db
        .prepare("SELECT created_at AS createdAt, updated_at AS updatedAt FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ createdAt: string; updatedAt: string }>();

      expect(after?.createdAt).toBe(before?.createdAt);
      expect(after?.updatedAt).not.toBe(before?.updatedAt);
    });

    it("rejects a body containing slug with SLUG_IMMUTABLE and changes nothing", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const token = await adminToken();
      const created = await seedDocument(store, categoryId);

      const res = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", token, {
          slug: "attempted-new-slug",
          title: "Should Not Apply",
        }),
        testEnv(),
      );
      const body = (await res.json()) as MetadataResponseBody;
      expect(res.status).toBe(403);
      expect(body.error?.code).toBe("SLUG_IMMUTABLE");

      const row = await store.db
        .prepare("SELECT slug, title FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ slug: string; title: string }>();
      expect(row?.slug).toBe(created.slug);
      expect(row?.title).not.toBe("Should Not Apply");
    });

    it("rejects an empty title with TITLE_REQUIRED", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const token = await adminToken();
      const created = await seedDocument(store, categoryId, { title: "Keep Me" });

      const res = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", token, { title: "   " }),
        testEnv(),
      );
      const body = (await res.json()) as MetadataResponseBody;
      expect(res.status).toBe(400);
      expect(body.error?.code).toBe("TITLE_REQUIRED");

      const row = await store.db
        .prepare("SELECT title FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ title: string }>();
      expect(row?.title).toBe("Keep Me");
    });

    it("returns DOCUMENT_NOT_FOUND for an unknown slug", async () => {
      const app = createApp();
      const token = await adminToken();

      const res = await app.fetch(
        jsonRequest("/api/admin/documents/does-not-exist", "PATCH", token, { title: "New" }),
        testEnv(),
      );
      const body = (await res.json()) as MetadataResponseBody;
      expect(res.status).toBe(404);
      expect(body.error?.code).toBe("DOCUMENT_NOT_FOUND");
    });

    it("rejects an unauthenticated request and writes nothing", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const created = await seedDocument(store, categoryId, { title: "Untouched" });

      const res = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", null, { title: "Hacked" }),
        testEnv(),
      );
      expect(res.status).toBe(401);

      const row = await store.db
        .prepare("SELECT title FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ title: string }>();
      expect(row?.title).toBe("Untouched");
    });
  });

  describe("POST /api/admin/documents/:slug/move", () => {
    it("relocates the document and updates its category path", async () => {
      const app = createApp();
      const store = storage();
      const from = await seedCategory(store.db, "From");
      const to = await seedCategory(store.db, "To");
      const token = await adminToken();
      const created = await seedDocument(store, from);

      const res = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}/move`, "POST", token, { categoryId: to }),
        testEnv(),
      );
      const body = (await res.json()) as MetadataResponseBody;
      expect(res.status).toBe(200);
      expect(body.data?.categoryId).toBe(to);
      expect(body.data?.categoryPath.map((c) => c.id)).toEqual([to]);

      const row = await store.db
        .prepare("SELECT category_id AS categoryId FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ categoryId: string }>();
      expect(row?.categoryId).toBe(to);
    });

    it("succeeds as a no-op when moved into its current category, and still advances updated_at", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const token = await adminToken();
      const created = await seedDocument(store, categoryId);

      const before = await store.db
        .prepare("SELECT updated_at AS updatedAt FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ updatedAt: string }>();

      const res = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}/move`, "POST", token, { categoryId }),
        testEnv(),
      );
      const body = (await res.json()) as MetadataResponseBody;
      expect(res.status).toBe(200);
      expect(body.data?.categoryId).toBe(categoryId);

      const after = await store.db
        .prepare("SELECT updated_at AS updatedAt FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ updatedAt: string }>();
      expect(after?.updatedAt).not.toBe(before?.updatedAt);
    });

    it("rejects a move to a non-existent category with CATEGORY_NOT_FOUND and changes nothing", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const token = await adminToken();
      const created = await seedDocument(store, categoryId);

      const res = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}/move`, "POST", token, {
          categoryId: "does-not-exist",
        }),
        testEnv(),
      );
      const body = (await res.json()) as MetadataResponseBody;
      expect(res.status).toBe(404);
      expect(body.error?.code).toBe("CATEGORY_NOT_FOUND");

      const row = await store.db
        .prepare("SELECT category_id AS categoryId FROM documents WHERE id = ?")
        .bind(created.documentId)
        .first<{ categoryId: string }>();
      expect(row?.categoryId).toBe(categoryId);
    });

    it("returns DOCUMENT_NOT_FOUND for an unknown slug", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const token = await adminToken();

      const res = await app.fetch(
        jsonRequest("/api/admin/documents/does-not-exist/move", "POST", token, { categoryId }),
        testEnv(),
      );
      const body = (await res.json()) as MetadataResponseBody;
      expect(res.status).toBe(404);
      expect(body.error?.code).toBe("DOCUMENT_NOT_FOUND");
    });

    it("rejects a body containing slug with SLUG_IMMUTABLE", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const token = await adminToken();
      const created = await seedDocument(store, categoryId);

      const res = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}/move`, "POST", token, {
          categoryId,
          slug: "attempted-new-slug",
        }),
        testEnv(),
      );
      const body = (await res.json()) as MetadataResponseBody;
      expect(res.status).toBe(403);
      expect(body.error?.code).toBe("SLUG_IMMUTABLE");
    });

    it("rejects an unauthenticated request", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const created = await seedDocument(store, categoryId);

      const res = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}/move`, "POST", null, { categoryId }),
        testEnv(),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("stable-slug regression — the invariant this node exists to guard", () => {
    it("keeps slug, public URL and current version id unchanged through a title change, a category move and a tag replacement", async () => {
      const app = createApp();
      const store = storage();
      const from = await seedCategory(store.db, "Origin");
      const to = await seedCategory(store.db, "Destination");
      const token = await adminToken();
      const created = await seedDocument(store, from, { title: "Before", tags: ["old-tag"] });

      const versionsBefore = await store.db
        .prepare("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?")
        .bind(created.documentId)
        .first<{ c: number }>();

      const { bucket, calls } = spyOnBucket(store.docs);
      const spyEnv = testEnv({ DOCS: bucket });

      const titleRes = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", token, { title: "After" }),
        spyEnv,
      );
      expect(titleRes.status).toBe(200);

      const moveRes = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}/move`, "POST", token, { categoryId: to }),
        spyEnv,
      );
      expect(moveRes.status).toBe(200);

      const tagsRes = await app.fetch(
        jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", token, { tags: ["new-tag"] }),
        spyEnv,
      );
      expect(tagsRes.status).toBe(200);
      const tagsBody = (await tagsRes.json()) as MetadataResponseBody;

      // The invariant: slug, public URL and current version id never move.
      expect(tagsBody.data?.slug).toBe(created.slug);
      expect(tagsBody.data?.url).toBe(`${APP_ORIGIN}/docs/${created.slug}`);
      expect(tagsBody.data?.currentVersionId).toBe(created.versionId);

      const row = await store.db
        .prepare(
          "SELECT slug, current_version_id AS currentVersionId, category_id AS categoryId FROM documents WHERE id = ?",
        )
        .bind(created.documentId)
        .first<{ slug: string; currentVersionId: string; categoryId: string }>();
      expect(row?.slug).toBe(created.slug);
      expect(row?.currentVersionId).toBe(created.versionId);
      expect(row?.categoryId).toBe(to);

      const versionsAfter = await store.db
        .prepare("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?")
        .bind(created.documentId)
        .first<{ c: number }>();
      expect(versionsAfter?.c).toBe(versionsBefore?.c);

      // Neither operation ever touched R2.
      expect(calls).toEqual([]);
    });

    it("leaves no partial tag state when a second concurrent metadata update races the first", async () => {
      const app = createApp();
      const store = storage();
      const categoryId = await seedCategory(store.db);
      const token = await adminToken();
      const created = await seedDocument(store, categoryId, { tags: ["initial"] });
      const env = testEnv();

      const [firstRes, secondRes] = await Promise.all([
        app.fetch(
          jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", token, { tags: ["race-a", "shared"] }),
          env,
        ),
        app.fetch(
          jsonRequest(`/api/admin/documents/${created.slug}`, "PATCH", token, { tags: ["race-b", "shared"] }),
          env,
        ),
      ]);

      expect(firstRes.status).toBe(200);
      expect(secondRes.status).toBe(200);

      // Whichever write landed last, the tag set on disk must be a
      // complete, valid set from ONE of the two requests — never a mix
      // (e.g. three or one tags, or a tag from neither request).
      const links = await store.db
        .prepare(
          `SELECT t.normalized_name AS n FROM document_tags dt
           JOIN tags t ON t.id = dt.tag_id WHERE dt.document_id = ? ORDER BY t.normalized_name`,
        )
        .bind(created.documentId)
        .all<{ n: string }>();
      const finalTags = links.results.map((r) => r.n).sort();

      const validOutcomes = [
        ["race-a", "shared"].sort(),
        ["race-b", "shared"].sort(),
      ];
      expect(validOutcomes.some((outcome) => JSON.stringify(outcome) === JSON.stringify(finalTags))).toBe(true);
    });
  });
});

/**
 * Mirrors the orchestrator's own verification command:
 *   grep -rniE "update +documents +set +[^;]*slug" src/
 * as a regex over comment-stripped source, so prose that merely mentions
 * the phrase (as several header comments in this very change do) can
 * never trip it — only a real statement can.
 */
const SLUG_MUTATION = /update\s+documents\s+set\s+[^;"'`]*\bslug\b/i;

/**
 * Strips `//` line comments and `/* *\/` block comments from TypeScript
 * source while leaving string and template literal CONTENTS untouched —
 * a real SQL statement always lives inside a string, so it must survive
 * this pass; prose that merely talks ABOUT such a statement lives inside
 * a comment and must not.
 */
function stripComments(source: string): string {
  let result = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < n && source.slice(i, i + 2) !== "*/") i += 1;
      i += 2;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      result += ch;
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") {
          result += source[i];
          i += 1;
          if (i < n) {
            result += source[i];
            i += 1;
          }
          continue;
        }
        result += source[i];
        i += 1;
      }
      if (i < n) {
        result += source[i];
        i += 1;
      }
      continue;
    }
    result += ch;
    i += 1;
  }
  return result;
}
