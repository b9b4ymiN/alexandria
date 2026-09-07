// Node G4.1 — Metadata Search Service & Public Search API, exercised through
// the real Hono app with REAL bindings, matching the pattern established by
// tests/integration/api-documents.test.ts and tests/integration/
// public-browse.test.ts.
//
// This node extends the `GET /api/public/documents` listing G1.8 shipped
// (and G2.4 extended with category/tag filters) with a `q` search
// parameter. The search SEMANTICS (validation, accent-insensitive
// normalization, substring matching, relevance ordering) live in
// src/domain/search/metadata-search-service.ts; this file proves the
// contract end to end, plus unit-level checks that the TypeScript-side and
// SQL-side normalization tables agree and that the generated SQL never uses
// `LIKE` — see PLAN DELTA 2, and the comment on that test for why the
// difference between local and production D1 makes it necessary.
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
import {
  LATIN_DIACRITIC_MAP,
  accentInsensitiveColumnExpr,
  buildRelevanceOrderBy,
  buildSearchWhereClause,
  normalizeSearchText,
} from "../../src/domain/search/metadata-search-service";

const SIGNING_SECRET = "search-test-signing-secret";
const APP_ORIGIN = "https://app.test";
const CONTENT_ORIGIN = "https://content.test";

// A distinctive string that must never appear in a search response — proof
// that no HTML body content leaks into a metadata listing.
const BODY_MARKER = "SEARCH-NODE-G4-1-BODY-MARKER-DO-NOT-LEAK";

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

function htmlFile(name: string): File {
  const content = `<!doctype html>
<html><head><title>Fixture</title></head>
<body><h1>Fixture</h1><p>${BODY_MARKER}</p></body></html>`;
  return new File([content], name, { type: "text/html" });
}

async function insertCategory(name: string, slug: string): Promise<string> {
  const id = `cat-${slug}`;
  const now = "2026-09-06T00:00:00.000Z";
  await db()
    .prepare(
      "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES (?, NULL, ?, ?, 0, ?, ?)",
    )
    .bind(id, name, slug, now, now)
    .run();
  return id;
}

interface PublishFields {
  title: string;
  description?: string;
  categoryId: string;
  tags?: string[];
}

async function publish(
  app: ReturnType<typeof createApp>,
  token: string,
  filename: string,
  fields: PublishFields,
): Promise<{ slug: string; documentId: string }> {
  const form = new FormData();
  form.set("file", htmlFile(filename));
  form.set("categoryId", fields.categoryId);
  form.set("title", fields.title);
  if (fields.description !== undefined) form.set("description", fields.description);
  if (fields.tags !== undefined) form.set("tags", JSON.stringify(fields.tags));

  const res = await app.fetch(
    new Request("https://app.test/api/admin/documents", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }),
    testEnv(),
  );
  if (res.status !== 201) {
    throw new Error(`publish() failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { data: { slug: string; documentId: string } };
  return body.data;
}

interface SearchListResponse {
  data: {
    total: number;
    page: number;
    pageSize: number;
    query: string;
    items: Array<{ slug: string; title: string }>;
  };
}

async function search(app: ReturnType<typeof createApp>, qs: string): Promise<Response> {
  return app.fetch(new Request(`https://app.test/api/public/documents?${qs}`), testEnv());
}

describe("Metadata Search Service — public search API (G4.1)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  describe("positive matches across every metadata field", () => {
    it("finds a document by a title match", async () => {
      const app = createApp();
      const token = await adminToken();
      const categoryId = await insertCategory("Search Fixtures A", "search-fixtures-a");
      const doc = await publish(app, token, "a.html", {
        title: "Quarterly Architecture Review",
        categoryId,
      });

      const res = await search(app, "q=architecture");
      const body = (await res.json()) as SearchListResponse;
      expect(body.data.total).toBe(1);
      expect(body.data.items[0]?.slug).toBe(doc.slug);
    });

    it("finds a document by a description match", async () => {
      const app = createApp();
      const token = await adminToken();
      const categoryId = await insertCategory("Search Fixtures B", "search-fixtures-b");
      const doc = await publish(app, token, "b.html", {
        title: "Unrelated Title",
        description: "Notes on system resilience patterns under load.",
        categoryId,
      });

      const res = await search(app, "q=resilience");
      const body = (await res.json()) as SearchListResponse;
      expect(body.data.total).toBe(1);
      expect(body.data.items[0]?.slug).toBe(doc.slug);
    });

    it("finds a document by a category-name match", async () => {
      const app = createApp();
      const token = await adminToken();
      const categoryId = await insertCategory("Distributed Systems", "distributed-systems-test");
      const doc = await publish(app, token, "c.html", {
        title: "Unrelated Title Two",
        categoryId,
      });

      const res = await search(app, "q=distributed");
      const body = (await res.json()) as SearchListResponse;
      expect(body.data.total).toBe(1);
      expect(body.data.items[0]?.slug).toBe(doc.slug);
    });

    it("finds a document by a tag match", async () => {
      const app = createApp();
      const token = await adminToken();
      const categoryId = await insertCategory("Search Fixtures D", "search-fixtures-d");
      const doc = await publish(app, token, "d.html", {
        title: "Unrelated Title Three",
        categoryId,
        tags: ["Observability"],
      });

      const res = await search(app, "q=observability");
      const body = (await res.json()) as SearchListResponse;
      expect(body.data.total).toBe(1);
      expect(body.data.items[0]?.slug).toBe(doc.slug);
    });
  });

  it("finds a Thai-titled document by a Thai substring query", async () => {
    const app = createApp();
    const token = await adminToken();
    const categoryId = await insertCategory("Search Fixtures Thai", "search-fixtures-thai");
    const doc = await publish(app, token, "thai.html", {
      title: "มูลค่ากิจการ",
      categoryId,
    });

    const res = await search(app, `q=${encodeURIComponent("มูลค่า")}`);
    const body = (await res.json()) as SearchListResponse;
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]?.slug).toBe(doc.slug);
  });

  it("matches Latin text accent-insensitively (Résumé matches resume)", async () => {
    const app = createApp();
    const token = await adminToken();
    const categoryId = await insertCategory("Search Fixtures Accent", "search-fixtures-accent");
    const doc = await publish(app, token, "accent.html", {
      title: "Résumé Writing Guide",
      categoryId,
    });

    const res = await search(app, "q=resume");
    const body = (await res.json()) as SearchListResponse;
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]?.slug).toBe(doc.slug);
  });

  it("orders results by relevance tier — title, then tag, then category, then description", async () => {
    const app = createApp();
    const token = await adminToken();
    const genericCategoryId = await insertCategory("Tier Generic", "tier-generic");
    // The category-tier fixture needs "zzyzx" in the CATEGORY name itself,
    // so it is filed here from the start rather than moved afterwards.
    const zzyzxCategoryId = await insertCategory("zzyzx Category", "tier-zzyzx-category");

    // Each document matches the term "zzyzx" in exactly one field, so tier
    // is the only thing that can explain the order.
    const descriptionDoc = await publish(app, token, "tier-description.html", {
      title: "Tier Description Fixture",
      description: "Contains the marker zzyzx in its description only.",
      categoryId: genericCategoryId,
    });
    const categoryDoc = await publish(app, token, "tier-category.html", {
      title: "Tier Category Fixture",
      categoryId: zzyzxCategoryId,
    });
    const tagDoc = await publish(app, token, "tier-tag.html", {
      title: "Tier Tag Fixture",
      categoryId: genericCategoryId,
      tags: ["zzyzx"],
    });
    const titleDoc = await publish(app, token, "tier-title.html", {
      title: "Tier zzyzx Fixture",
      categoryId: genericCategoryId,
    });

    const res = await search(app, "q=zzyzx");
    const body = (await res.json()) as SearchListResponse;
    expect(body.data.total).toBe(4);
    expect(body.data.items.map((i) => i.slug)).toEqual([
      titleDoc.slug,
      tagDoc.slug,
      categoryDoc.slug,
      descriptionDoc.slug,
    ]);
  });

  it("combines a search term with category and tag filters using AND semantics", async () => {
    const app = createApp();
    const token = await adminToken();
    const matchingCategoryId = await insertCategory("Combine Match", "combine-match");
    const otherCategoryId = await insertCategory("Combine Other", "combine-other");

    const inScope = await publish(app, token, "combine-a.html", {
      title: "Combine Filter Target",
      categoryId: matchingCategoryId,
      tags: ["combine-tag"],
    });
    // Same title term, wrong category — must be excluded by the category filter.
    await publish(app, token, "combine-b.html", {
      title: "Combine Filter Target",
      categoryId: otherCategoryId,
      tags: ["combine-tag"],
    });
    // Same title term and category, wrong tag — must be excluded by the tag filter.
    await publish(app, token, "combine-c.html", {
      title: "Combine Filter Target",
      categoryId: matchingCategoryId,
      tags: ["unrelated-tag"],
    });

    const res = await search(app, `q=combine&categoryId=${matchingCategoryId}&tag=combine-tag`);
    const body = (await res.json()) as SearchListResponse;
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]?.slug).toBe(inScope.slug);
  });

  it("returns an empty page when the search term matches nothing in the given category filter", async () => {
    const app = createApp();
    const token = await adminToken();
    const matchingCategoryId = await insertCategory("Empty Page Match", "empty-page-match");
    const otherCategoryId = await insertCategory("Empty Page Other", "empty-page-other");
    await publish(app, token, "empty-page.html", {
      title: "Empty Page Target",
      categoryId: otherCategoryId,
    });

    const res = await search(app, `q=target&categoryId=${matchingCategoryId}`);
    const body = (await res.json()) as SearchListResponse;
    expect(body.data.total).toBe(0);
    expect(body.data.items).toEqual([]);
  });

  describe("wildcard characters are treated literally", () => {
    it("treats a literal % as a plain character, not a wildcard", async () => {
      const app = createApp();
      const token = await adminToken();
      const categoryId = await insertCategory("Percent Fixtures", "percent-fixtures");
      const literalDoc = await publish(app, token, "percent-literal.html", {
        title: "100% Guaranteed Results",
        categoryId,
      });
      await publish(app, token, "percent-other.html", {
        title: "100X Guaranteed Results",
        categoryId,
      });

      const res = await search(app, `q=${encodeURIComponent("100%")}`);
      const body = (await res.json()) as SearchListResponse;
      expect(body.data.total).toBe(1);
      expect(body.data.items[0]?.slug).toBe(literalDoc.slug);
    });

    it("treats a literal _ as a plain character, not a single-character wildcard", async () => {
      const app = createApp();
      const token = await adminToken();
      const categoryId = await insertCategory("Underscore Fixtures", "underscore-fixtures");
      const literalDoc = await publish(app, token, "underscore-literal.html", {
        title: "file_name_pattern",
        categoryId,
      });
      await publish(app, token, "underscore-other.html", {
        title: "fileXnameXpattern",
        categoryId,
      });

      const res = await search(app, `q=${encodeURIComponent("file_name")}`);
      const body = (await res.json()) as SearchListResponse;
      expect(body.data.total).toBe(1);
      expect(body.data.items[0]?.slug).toBe(literalDoc.slug);
    });
  });

  describe("query length validation", () => {
    it("accepts a query exactly 200 characters long", async () => {
      const app = createApp();
      await insertCategory("Length Fixtures", "length-fixtures");
      const term = "a".repeat(200);

      const res = await search(app, `q=${term}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as SearchListResponse;
      expect(body.data.query).toBe(term);
    });

    it("rejects a query over 200 characters with SEARCH_QUERY_TOO_LONG", async () => {
      const app = createApp();
      const term = "a".repeat(201);

      const res = await search(app, `q=${term}`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("SEARCH_QUERY_TOO_LONG");
    });
  });

  it("trims leading and trailing whitespace from the query and echoes the trimmed term", async () => {
    const app = createApp();
    const token = await adminToken();
    const categoryId = await insertCategory("Trim Fixtures", "trim-fixtures");
    const doc = await publish(app, token, "trim.html", {
      title: "Trimmed Query Target",
      categoryId,
    });

    const res = await search(app, `q=${encodeURIComponent("  trimmed  ")}`);
    const body = (await res.json()) as SearchListResponse;
    expect(body.data.query).toBe("trimmed");
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]?.slug).toBe(doc.slug);
  });

  describe("empty or whitespace-only query behaves like the unfiltered listing", () => {
    it("returns the full listing for an absent query", async () => {
      const app = createApp();
      const token = await adminToken();
      const categoryId = await insertCategory("Absent Query Fixtures", "absent-query-fixtures");
      await publish(app, token, "absent-a.html", { title: "Absent A", categoryId });
      await publish(app, token, "absent-b.html", { title: "Absent B", categoryId });

      const res = await search(app, "");
      const body = (await res.json()) as SearchListResponse;
      expect(body.data.total).toBe(2);
      expect(body.data.query).toBe("");
    });

    it("returns the full listing for a whitespace-only query", async () => {
      const app = createApp();
      const token = await adminToken();
      const categoryId = await insertCategory("Whitespace Query Fixtures", "whitespace-query-fixtures");
      await publish(app, token, "ws-a.html", { title: "Whitespace A", categoryId });

      const res = await search(app, `q=${encodeURIComponent("   ")}`);
      const body = (await res.json()) as SearchListResponse;
      expect(body.data.total).toBe(1);
      expect(body.data.query).toBe("");
    });
  });

  it("prefers q over query when both are present", async () => {
    const app = createApp();
    const token = await adminToken();
    const categoryId = await insertCategory("Alias Fixtures", "alias-fixtures");
    const qDoc = await publish(app, token, "alias-q.html", { title: "Zootropolis Target", categoryId });
    await publish(app, token, "alias-query.html", { title: "Marmoset Target", categoryId });

    const res = await search(app, "q=Zootropolis&query=Marmoset");
    const body = (await res.json()) as SearchListResponse;
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]?.slug).toBe(qDoc.slug);
  });

  it("still honours query as an alias when q is absent", async () => {
    const app = createApp();
    const token = await adminToken();
    const categoryId = await insertCategory("Query Alias Fixtures", "query-alias-fixtures");
    const doc = await publish(app, token, "query-alias.html", { title: "Marmoset Target", categoryId });

    const res = await search(app, "query=Marmoset");
    const body = (await res.json()) as SearchListResponse;
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]?.slug).toBe(doc.slug);
  });

  it("returns a document once even when it matches in title, description and tag", async () => {
    const app = createApp();
    const token = await adminToken();
    const categoryId = await insertCategory("Duplicate Fixtures", "duplicate-fixtures");
    const doc = await publish(app, token, "dup.html", {
      title: "Duplicate-Test Title",
      description: "Also mentions duplicate-test in the description.",
      categoryId,
      tags: ["duplicate-test"],
    });

    const res = await search(app, "q=duplicate-test");
    const body = (await res.json()) as SearchListResponse;
    expect(body.data.total).toBe(1);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.slug).toBe(doc.slug);
  });

  it("returns no HTML body content in a search response", async () => {
    const app = createApp();
    const token = await adminToken();
    const categoryId = await insertCategory("No Body Fixtures", "no-body-fixtures");
    // Description is set explicitly so metadata extraction has no reason to
    // fall back to the fixture's body paragraph (which carries BODY_MARKER)
    // as the description — this test is about the RESPONSE never carrying
    // body bytes, not about what a fallback-derived metadata field contains.
    await publish(app, token, "no-body.html", {
      title: "No Body Leak Target",
      description: "A harmless, unrelated description.",
      categoryId,
    });

    const text = await (await search(app, "q=leak")).text();
    expect(text).not.toContain(BODY_MARKER);
    expect(text).not.toContain("<body");
    expect(text).not.toContain("<!doctype");
  });

  it("performs no R2 operation while searching", async () => {
    const app = createApp();
    const token = await adminToken();
    const categoryId = await insertCategory("No R2 Fixtures", "no-r2-fixtures");
    await publish(app, token, "no-r2.html", { title: "No R2 Access Target", categoryId });

    const bucket = (workersEnv as unknown as { DOCS: R2Bucket }).DOCS;
    const getSpy = vi.spyOn(bucket, "get");
    const listSpy = vi.spyOn(bucket, "list");
    try {
      await search(app, "q=access");
      expect(getSpy).not.toHaveBeenCalled();
      expect(listSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
      listSpy.mockRestore();
    }
  });

  it("keeps the unfiltered listing's updated_at DESC, id ASC ordering unchanged when q is absent (regression)", async () => {
    const app = createApp();
    const token = await adminToken();
    const categoryId = await insertCategory("Regression Fixtures", "regression-fixtures");
    const first = await publish(app, token, "regression-first.html", { title: "Regression First", categoryId });
    const second = await publish(app, token, "regression-second.html", { title: "Regression Second", categoryId });

    // Force a deterministic timestamp ordering rather than relying on
    // real-clock precision between two sequential publishes in the same test.
    await db()
      .prepare("UPDATE documents SET updated_at = ? WHERE slug = ?")
      .bind("2026-09-06T00:00:00.000Z", first.slug)
      .run();
    await db()
      .prepare("UPDATE documents SET updated_at = ? WHERE slug = ?")
      .bind("2026-09-06T01:00:00.000Z", second.slug)
      .run();

    const res = await search(app, `categoryId=${categoryId}&pageSize=1&page=1`);
    const body = (await res.json()) as SearchListResponse;
    // Most-recently updated (second) sorts first under updated_at DESC —
    // identical to G1.8's pre-G4.1 contract.
    expect(body.data.items[0]?.slug).toBe(second.slug);
  });
});

describe("Metadata Search Service — TS/SQL normalization agreement (unit-level)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  it("normalizes every sample string identically in TypeScript and in SQL", async () => {
    const samples = [
      "Résumé",
      "RÉSUMÉ",
      "Café Naïve Façade",
      "STRASSE", // ASCII-only, no diacritics
      "มูลค่ากิจการ", // Thai — must pass through unchanged by both sides
      "Ångström Über Ørsted",
      "plain ascii text 123",
      "100% off_er", // wildcard characters are not touched by normalization itself
    ];

    const expr = accentInsensitiveColumnExpr("?");
    for (const sample of samples) {
      const row = await db().prepare(`SELECT ${expr} AS normalized`).bind(sample).first<{
        normalized: string;
      }>();
      expect(row?.normalized).toBe(normalizeSearchText(sample));
    }
  });

  it("leaves Thai text completely unchanged (no case, no accents to fold)", () => {
    const thai = "มูลค่ากิจการ investing";
    expect(normalizeSearchText(thai)).toBe("มูลค่ากิจการ investing");
  });

  it("maps every table entry to a lower-case ASCII base letter", () => {
    for (const [, base] of LATIN_DIACRITIC_MAP) {
      expect(base).toMatch(/^[a-z]$/);
    }
  });

  // PLAN DELTA 2. This asserts on the generated SQL rather than on behaviour
  // because the failure it guards against CANNOT be reproduced here: D1 in
  // production is built with SQLITE_MAX_LIKE_PATTERN_LENGTH = 50 BYTES and
  // answers "LIKE or GLOB pattern too complex: SQLITE_ERROR [code: 7500]"
  // for anything longer, while the miniflare D1 these tests run against has
  // no such limit. The LIKE form node G4.1 originally specified therefore
  // passed every test here and returned 500 in production for any term over
  // 48 bytes — 16 Thai characters, since Thai is 3 bytes per character.
  // `instr()` has no pattern-length limit, so the guard is "no LIKE".
  it("builds substring matching with instr(), never LIKE (D1 caps LIKE patterns at 50 bytes)", () => {
    const term = "x".repeat(200);
    for (const fragment of [buildSearchWhereClause(term), buildRelevanceOrderBy(term)]) {
      expect(fragment.sql).toContain("instr(");
      expect(fragment.sql).not.toMatch(/\bLIKE\b/);
      expect(fragment.sql).not.toContain("ESCAPE");
      // The needle is bound, never interpolated, and carries no wildcards to
      // escape — `%` and `_` are ordinary characters to instr().
      for (const binding of fragment.bindings) {
        expect(binding).toBe(term);
      }
    }
  });

  it("passes a 200-character term straight through as one bound needle", () => {
    const term = "ก".repeat(200);
    const { bindings } = buildSearchWhereClause(term);
    expect(bindings).toHaveLength(4);
    for (const binding of bindings) {
      expect(binding).toBe(term);
      // 600 bytes in UTF-8 — twelve times over what a LIKE pattern could
      // carry on D1, which is the whole point of PLAN DELTA 2.
      expect(new TextEncoder().encode(binding).length).toBe(600);
    }
  });
});
