// Node G2.4 — Public API: Tree, Tags & Filters, exercised through the real
// Hono app with REAL bindings, matching the pattern established by
// tests/integration/api-documents.test.ts.
//
// This node builds on top of the `query`/`categoryId` filtering and the
// flat `/api/public/categories` listing that node G1.8 already shipped
// (commit 79a7e5c, see IMPLEMENTATION_PLAN.md §12.2 Plan Delta 1). This
// file owns ONLY what Plan Delta 1 records as still owed: subtree
// semantics with a `depth=self` narrowing option, a tag filter matched by
// normalized name, AND semantics when both filters are combined, a nested
// category tree carrying both direct and whole-subtree counts computed in
// one recursive query, and the previously-stub `/api/public/tags`.
import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error - "cloudflare:test" has no ambient type outside the
// package's optional "./types" subpath
import { env as workersEnv, reset } from "cloudflare:test";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0001 from "../../migrations/0001_init.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0002 from "../../migrations/0002_seed_categories.sql?raw";

import { createApp } from "../../src/api/app";
import { signToken } from "../../src/shared/token";
import type { Env } from "../../src/shared/types";

const SIGNING_SECRET = "public-browse-test-signing-secret";
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

async function applyMigrations(db: D1Database): Promise<void> {
  for (const statement of [...splitStatements(migration0001), ...splitStatements(migration0002)]) {
    await db.prepare(statement).run();
  }
}

async function adminToken(): Promise<string> {
  return (await signToken(SIGNING_SECRET)).token;
}

function db(): D1Database {
  return (workersEnv as unknown as { DB: D1Database }).DB;
}

function htmlFile(name: string, title: string): File {
  const content = `<!doctype html>
<html><head><title>${title}</title>
<meta name="description" content="Fixture for ${title}.">
</head><body><h1>${title}</h1><p>Body.</p></body></html>`;
  return new File([content], name, { type: "text/html" });
}

function uploadRequest(token: string, fields: { file: File; categoryId: string; tags?: string[] }): Request {
  const form = new FormData();
  form.set("file", fields.file);
  form.set("categoryId", fields.categoryId);
  if (fields.tags !== undefined) form.set("tags", JSON.stringify(fields.tags));
  return new Request("https://app.test/api/admin/documents", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

async function insertCategory(
  parentId: string | null,
  name: string,
  slug: string,
  sortOrder = 0,
): Promise<string> {
  const id = `cat-${slug}`;
  const now = "2026-09-01T00:00:00.000Z";
  await db()
    .prepare(
      "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, parentId, name, slug, sortOrder, now, now)
    .run();
  return id;
}

async function publish(
  app: ReturnType<typeof createApp>,
  token: string,
  filename: string,
  title: string,
  categoryId: string,
  tags?: string[],
): Promise<{ slug: string; documentId: string }> {
  const res = await app.fetch(uploadRequest(token, { file: htmlFile(filename, title), categoryId, tags }), testEnv());
  const body = (await res.json()) as { data: { slug: string; documentId: string } };
  return body.data;
}

// Fixture tree shared by most tests:
//
//   Investing (root, no direct documents)
//   +-- Stocks
//       +-- Stocks / Thailand
//   Recipes (unrelated root)
//
// docA -> Stocks, tag "Value Investing"
// docB -> Stocks / Thailand, tag "Thailand Bank"
// docC -> Recipes, tag "Family Recipe"
async function seedTree(app: ReturnType<typeof createApp>, token: string) {
  const investingId = await insertCategory(null, "Investing", "investing-test", 0);
  const stocksId = await insertCategory(investingId, "Stocks", "stocks-test", 0);
  const thailandId = await insertCategory(stocksId, "Stocks / Thailand", "stocks-thailand-test", 0);
  const recipesId = await insertCategory(null, "Recipes", "recipes-test", 1);

  const docA = await publish(app, token, "doc-a.html", "Doc A", stocksId, ["Value Investing"]);
  const docB = await publish(app, token, "doc-b.html", "Doc B", thailandId, ["Thailand Bank"]);
  const docC = await publish(app, token, "doc-c.html", "Doc C", recipesId, ["Family Recipe"]);

  return { investingId, stocksId, thailandId, recipesId, docA, docB, docC };
}

describe("Public API — tree, tags & filters (G2.4)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  describe("GET /api/public/categories — nested tree with counts", () => {
    it("carries direct and descendant counts at every level, computed in one recursive query", async () => {
      const app = createApp();
      const token = await adminToken();
      const { investingId, stocksId, thailandId, recipesId } = await seedTree(app, token);

      const prepareSpy = vi.spyOn(db(), "prepare");
      const res = await app.fetch(new Request("https://app.test/api/public/categories"), testEnv());
      // The whole tree, both counts included, comes from ONE statement —
      // never one query per node (requirement 2).
      expect(prepareSpy).toHaveBeenCalledTimes(1);
      prepareSpy.mockRestore();

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: {
          categories: Array<{
            id: string;
            documentCount: number;
            descendantDocumentCount: number;
            children: unknown[];
          }>;
        };
      };

      function findAnywhere(
        nodes: typeof body.data.categories,
        id: string,
      ): (typeof body.data.categories)[number] | undefined {
        for (const node of nodes) {
          if (node.id === id) return node;
          const found = findAnywhere(node.children as typeof body.data.categories, id);
          if (found !== undefined) return found;
        }
        return undefined;
      }

      // Edge case: a category with no direct documents but populated
      // descendants — zero direct count, non-zero descendant count.
      const investing = findAnywhere(body.data.categories, investingId);
      expect(investing?.documentCount).toBe(0);
      expect(investing?.descendantDocumentCount).toBe(2);

      const stocks = findAnywhere(body.data.categories, stocksId);
      expect(stocks?.documentCount).toBe(1);
      expect(stocks?.descendantDocumentCount).toBe(2);

      const thailand = findAnywhere(body.data.categories, thailandId);
      expect(thailand?.documentCount).toBe(1);
      expect(thailand?.descendantDocumentCount).toBe(1);

      const recipes = findAnywhere(body.data.categories, recipesId);
      expect(recipes?.documentCount).toBe(1);
      expect(recipes?.descendantDocumentCount).toBe(1);
    });

    it("nests Stocks / Thailand under Stocks under Investing", async () => {
      const app = createApp();
      const token = await adminToken();
      const { investingId, stocksId, thailandId } = await seedTree(app, token);

      interface TreeNode {
        id: string;
        children: TreeNode[];
      }
      const res = await app.fetch(new Request("https://app.test/api/public/categories"), testEnv());
      const body = (await res.json()) as { data: { categories: TreeNode[] } };

      const investing = body.data.categories.find((c) => c.id === investingId);
      const stocks = investing?.children.find((c) => c.id === stocksId);
      expect(stocks?.children.some((c) => c.id === thailandId)).toBe(true);
    });

    it("performs no R2 operation and returns no HTML body content", async () => {
      const app = createApp();
      const token = await adminToken();
      await seedTree(app, token);

      const bucket = (workersEnv as unknown as { DOCS: R2Bucket }).DOCS;
      const getSpy = vi.spyOn(bucket, "get");
      const listSpy = vi.spyOn(bucket, "list");
      try {
        const text = await (
          await app.fetch(new Request("https://app.test/api/public/categories"), testEnv())
        ).text();
        expect(getSpy).not.toHaveBeenCalled();
        expect(listSpy).not.toHaveBeenCalled();
        expect(text).not.toContain("<body");
        expect(text).not.toContain("<!doctype");
      } finally {
        getSpy.mockRestore();
        listSpy.mockRestore();
      }
    });
  });

  describe("GET /api/public/tags", () => {
    it("returns id, name and documentCount for every tag", async () => {
      const app = createApp();
      const token = await adminToken();
      await seedTree(app, token);

      const res = await app.fetch(new Request("https://app.test/api/public/tags"), testEnv());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Array<{ id: string; name: string; documentCount: number }> };

      const valueInvesting = body.data.find((t) => t.name === "Value Investing");
      expect(valueInvesting?.documentCount).toBe(1);
      expect(valueInvesting?.id).toBeTruthy();

      const thailandBank = body.data.find((t) => t.name === "Thailand Bank");
      expect(thailandBank?.documentCount).toBe(1);

      // Contract shape is exactly { id, name, documentCount } — no
      // normalizedName leaking through from TagService.listTags.
      for (const entry of body.data) {
        expect(Object.keys(entry).sort()).toEqual(["documentCount", "id", "name"]);
      }
    });

    it("returns an empty array rather than an error for a library with no tags", async () => {
      const app = createApp();
      const res = await app.fetch(new Request("https://app.test/api/public/tags"), testEnv());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it("performs no R2 operation and returns no HTML body content", async () => {
      const app = createApp();
      const token = await adminToken();
      await seedTree(app, token);

      const bucket = (workersEnv as unknown as { DOCS: R2Bucket }).DOCS;
      const getSpy = vi.spyOn(bucket, "get");
      const listSpy = vi.spyOn(bucket, "list");
      try {
        const text = await (await app.fetch(new Request("https://app.test/api/public/tags"), testEnv())).text();
        expect(getSpy).not.toHaveBeenCalled();
        expect(listSpy).not.toHaveBeenCalled();
        expect(text).not.toContain("<body");
      } finally {
        getSpy.mockRestore();
        listSpy.mockRestore();
      }
    });
  });

  describe("GET /api/public/documents — category subtree filtering", () => {
    it("includes the whole subtree by default", async () => {
      const app = createApp();
      const token = await adminToken();
      const { investingId, docA, docB } = await seedTree(app, token);

      const res = await app.fetch(
        new Request(`https://app.test/api/public/documents?categoryId=${investingId}`),
        testEnv(),
      );
      const body = (await res.json()) as { data: { total: number; items: Array<{ slug: string }> } };
      expect(body.data.total).toBe(2);
      expect(body.data.items.map((i) => i.slug).sort()).toEqual([docA.slug, docB.slug].sort());
    });

    it("narrows to direct members with depth=self, even when that category has none directly", async () => {
      const app = createApp();
      const token = await adminToken();
      const { investingId } = await seedTree(app, token);

      const res = await app.fetch(
        new Request(`https://app.test/api/public/documents?categoryId=${investingId}&depth=self`),
        testEnv(),
      );
      const body = (await res.json()) as { data: { total: number; items: unknown[] } };
      expect(res.status).toBe(200);
      expect(body.data.total).toBe(0);
      expect(body.data.items).toEqual([]);
    });

    it("depth=self on a category with direct documents excludes its descendants' documents", async () => {
      const app = createApp();
      const token = await adminToken();
      const { stocksId, docA } = await seedTree(app, token);

      const res = await app.fetch(
        new Request(`https://app.test/api/public/documents?categoryId=${stocksId}&depth=self`),
        testEnv(),
      );
      const body = (await res.json()) as { data: { total: number; items: Array<{ slug: string }> } };
      expect(body.data.total).toBe(1);
      expect(body.data.items[0]?.slug).toBe(docA.slug);
    });

    it("rejects an unknown categoryId with CATEGORY_NOT_FOUND, for both subtree and self depth", async () => {
      const app = createApp();

      const subtreeRes = await app.fetch(
        new Request("https://app.test/api/public/documents?categoryId=nope"),
        testEnv(),
      );
      expect(subtreeRes.status).toBe(404);
      expect(((await subtreeRes.json()) as { error: { code: string } }).error.code).toBe("CATEGORY_NOT_FOUND");

      const selfRes = await app.fetch(
        new Request("https://app.test/api/public/documents?categoryId=nope&depth=self"),
        testEnv(),
      );
      expect(selfRes.status).toBe(404);
      expect(((await selfRes.json()) as { error: { code: string } }).error.code).toBe("CATEGORY_NOT_FOUND");
    });

    it("resolves a deeply nested subtree filter without failing or timing out", async () => {
      const app = createApp();
      const token = await adminToken();
      let parentId = await insertCategory(null, "Deep Root", "deep-root-test", 0);
      const rootId = parentId;
      for (let level = 1; level <= 8; level += 1) {
        parentId = await insertCategory(parentId, `Deep ${level}`, `deep-${level}-test`, 0);
      }
      const leafDoc = await publish(app, token, "deep-leaf.html", "Deep Leaf", parentId);

      const res = await app.fetch(
        new Request(`https://app.test/api/public/documents?categoryId=${rootId}`),
        testEnv(),
      );
      const body = (await res.json()) as { data: { total: number; items: Array<{ slug: string }> } };
      expect(body.data.total).toBe(1);
      expect(body.data.items[0]?.slug).toBe(leafDoc.slug);
    });
  });

  describe("GET /api/public/documents — tag filtering", () => {
    it("matches by normalized name, regardless of casing or spacing in the query", async () => {
      const app = createApp();
      const token = await adminToken();
      const { docA } = await seedTree(app, token);

      const res = await app.fetch(
        new Request(`https://app.test/api/public/documents?tag=${encodeURIComponent("  VALUE   Investing  ")}`),
        testEnv(),
      );
      const body = (await res.json()) as { data: { total: number; items: Array<{ slug: string }> } };
      expect(body.data.total).toBe(1);
      expect(body.data.items[0]?.slug).toBe(docA.slug);
    });

    it("returns an empty page rather than an error for an unknown tag name", async () => {
      const app = createApp();
      const token = await adminToken();
      await seedTree(app, token);

      const res = await app.fetch(
        new Request(`https://app.test/api/public/documents?tag=${encodeURIComponent("no-such-tag")}`),
        testEnv(),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { total: number; items: unknown[] } };
      expect(body.data.total).toBe(0);
      expect(body.data.items).toEqual([]);
    });
  });

  describe("GET /api/public/documents — combined category and tag filters", () => {
    it("applies AND semantics: category subtree narrowed further by tag", async () => {
      const app = createApp();
      const token = await adminToken();
      const { stocksId, docA } = await seedTree(app, token);

      const res = await app.fetch(
        new Request(
          `https://app.test/api/public/documents?categoryId=${stocksId}&tag=${encodeURIComponent("Value Investing")}`,
        ),
        testEnv(),
      );
      const body = (await res.json()) as { data: { total: number; items: Array<{ slug: string }> } };
      expect(body.data.total).toBe(1);
      expect(body.data.items[0]?.slug).toBe(docA.slug);
    });

    it("returns an empty page when the category and tag filters share no document", async () => {
      const app = createApp();
      const token = await adminToken();
      const { thailandId } = await seedTree(app, token);

      // docB lives in Stocks / Thailand but is tagged "Thailand Bank", not
      // "Value Investing" — no document satisfies both filters.
      const res = await app.fetch(
        new Request(
          `https://app.test/api/public/documents?categoryId=${thailandId}&tag=${encodeURIComponent("Value Investing")}`,
        ),
        testEnv(),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { total: number; items: unknown[] } };
      expect(body.data.total).toBe(0);
      expect(body.data.items).toEqual([]);
    });
  });

  describe("regression — pagination, ordering and R2 isolation on the filtered listing", () => {
    it("keeps the updated_at DESC, id ASC ordering and page-size clamp under a tag filter", async () => {
      const app = createApp();
      const token = await adminToken();
      const categoryId = await insertCategory(null, "Ordering", "ordering-test", 0);
      await publish(app, token, "first.html", "First", categoryId, ["Shared Tag"]);
      await publish(app, token, "second.html", "Second", categoryId, ["Shared Tag"]);

      const res = await app.fetch(
        new Request(
          `https://app.test/api/public/documents?tag=${encodeURIComponent("Shared Tag")}&pageSize=100000&page=-5`,
        ),
        testEnv(),
      );
      const body = (await res.json()) as { data: { total: number; page: number; pageSize: number } };
      expect(body.data.total).toBe(2);
      expect(body.data.page).toBe(1);
      expect(body.data.pageSize).toBe(100);
    });

    it("performs no R2 operation and returns no HTML body content on a filtered listing", async () => {
      const app = createApp();
      const token = await adminToken();
      const { stocksId } = await seedTree(app, token);

      const bucket = (workersEnv as unknown as { DOCS: R2Bucket }).DOCS;
      const getSpy = vi.spyOn(bucket, "get");
      const listSpy = vi.spyOn(bucket, "list");
      try {
        const text = await (
          await app.fetch(
            new Request(`https://app.test/api/public/documents?categoryId=${stocksId}`),
            testEnv(),
          )
        ).text();
        expect(getSpy).not.toHaveBeenCalled();
        expect(listSpy).not.toHaveBeenCalled();
        expect(text).not.toContain("<body");
        expect(text).not.toContain("<!doctype");
      } finally {
        getSpy.mockRestore();
        listSpy.mockRestore();
      }
    });
  });
});
