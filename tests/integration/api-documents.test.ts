// Nodes G1.7 (Admin API — Create Document) and G1.8 (Public API — List &
// Get Document), exercised through the real Hono app with REAL bindings.
//
// Every request goes through createApp().fetch(request, env) with the
// Workers pool's live D1 and R2, never a bare fetch with no env — an auth
// or storage test that runs against undefined bindings proves nothing.
import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error - "cloudflare:test" has no ambient type outside the
// package's optional "./types" subpath
import { env as workersEnv, reset } from "cloudflare:test";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0001 from "../../migrations/0001_init.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0002 from "../../migrations/0002_seed_categories.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import mauboussinFixture from "../../mauboussin-expectations-investing-summary.html?raw";

import { createApp } from "../../src/api/app";
import { signToken } from "../../src/shared/token";
import type { Env } from "../../src/shared/types";

const SIGNING_SECRET = "api-test-signing-secret";
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

const SIMPLE_HTML = `<!doctype html>
<html><head><title>Quarterly Review</title>
<meta name="description" content="A review of the quarter just gone.">
<meta name="keywords" content="Review, Quarterly">
</head><body><h1>Quarterly Review</h1><p>Body.</p></body></html>`;

function uploadRequest(
  token: string | null,
  fields: { file?: File; categoryId?: string; title?: string; description?: string; tags?: string; note?: string },
  contentTypeOverride?: string,
): Request {
  const form = new FormData();
  if (fields.file) form.set("file", fields.file);
  if (fields.categoryId !== undefined) form.set("categoryId", fields.categoryId);
  if (fields.title !== undefined) form.set("title", fields.title);
  if (fields.description !== undefined) form.set("description", fields.description);
  if (fields.tags !== undefined) form.set("tags", fields.tags);
  if (fields.note !== undefined) form.set("note", fields.note);

  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (contentTypeOverride !== undefined) headers["content-type"] = contentTypeOverride;

  return new Request("https://app.test/api/admin/documents", {
    method: "POST",
    headers,
    body: contentTypeOverride === undefined ? form : "not-a-form",
  });
}

function htmlFile(name: string, content = SIMPLE_HTML): File {
  return new File([content], name, { type: "text/html" });
}

async function seedCategory(db: D1Database, id = "cat-api"): Promise<string> {
  const now = "2026-08-30T00:00:00.000Z";
  await db
    .prepare(
      "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES (?, NULL, 'Stocks API', ?, 0, ?, ?)",
    )
    .bind(id, `slug-${id}`, now, now)
    .run();
  return id;
}

function db(): D1Database {
  return (workersEnv as unknown as { DB: D1Database }).DB;
}

describe("Admin API — create document (G1.7)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  it("publishes the acceptance fixture and returns an absolute reader URL", async () => {
    const categoryId = await seedCategory(db());
    const token = await adminToken();
    const app = createApp();

    const res = await app.fetch(
      uploadRequest(token, {
        file: htmlFile("mauboussin-expectations-investing-summary.html", mauboussinFixture),
        categoryId,
      }),
      testEnv(),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; data: { slug: string; url: string; versionNo: number } };
    expect(body.ok).toBe(true);
    expect(body.data.versionNo).toBe(1);
    expect(body.data.url).toBe(`${APP_ORIGIN}/docs/${body.data.slug}`);
  });

  it("passes explicit overrides through to the domain service", async () => {
    const categoryId = await seedCategory(db());
    const app = createApp();

    const res = await app.fetch(
      uploadRequest(await adminToken(), {
        file: htmlFile("simple.html"),
        categoryId,
        title: "Overridden Title",
        tags: JSON.stringify(["Moat", "moat", "ROIC"]),
      }),
      testEnv(),
    );

    const body = (await res.json()) as { data: { title: string; tags: string[] } };
    expect(body.data.title).toBe("Overridden Title");
    expect(body.data.tags).toEqual(["moat", "roic"]);
  });

  it("rejects an unauthenticated upload and writes nothing", async () => {
    const categoryId = await seedCategory(db());
    const app = createApp();

    const res = await app.fetch(
      uploadRequest(null, { file: htmlFile("simple.html"), categoryId }),
      testEnv(),
    );

    expect(res.status).toBe(401);
    const count = await db().prepare("SELECT COUNT(*) AS c FROM documents").first<{ c: number }>();
    expect(count?.c).toBe(0);
  });

  it("rejects a missing file with FILE_REQUIRED", async () => {
    const categoryId = await seedCategory(db());
    const app = createApp();
    const res = await app.fetch(uploadRequest(await adminToken(), { categoryId }), testEnv());
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FILE_REQUIRED");
  });

  it("rejects a non-.html file with INVALID_FILE_EXTENSION", async () => {
    const categoryId = await seedCategory(db());
    const app = createApp();
    const res = await app.fetch(
      uploadRequest(await adminToken(), { file: htmlFile("report.txt"), categoryId }),
      testEnv(),
    );
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_FILE_EXTENSION");
  });

  it("rejects a missing category with CATEGORY_REQUIRED", async () => {
    await seedCategory(db());
    const app = createApp();
    const res = await app.fetch(
      uploadRequest(await adminToken(), { file: htmlFile("simple.html") }),
      testEnv(),
    );
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CATEGORY_REQUIRED");
  });

  it("rejects an unknown category with CATEGORY_NOT_FOUND", async () => {
    await seedCategory(db());
    const app = createApp();
    const res = await app.fetch(
      uploadRequest(await adminToken(), { file: htmlFile("simple.html"), categoryId: "nope" }),
      testEnv(),
    );
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CATEGORY_NOT_FOUND");
  });

  it("rejects a non-multipart body", async () => {
    await seedCategory(db());
    const app = createApp();
    const res = await app.fetch(
      uploadRequest(await adminToken(), {}, "application/json"),
      testEnv(),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("lists categories for the upload form, and refuses to do so anonymously", async () => {
    await seedCategory(db());
    const app = createApp();

    const anonymous = await app.fetch(
      new Request("https://app.test/api/admin/categories"),
      testEnv(),
    );
    expect(anonymous.status).toBe(401);

    const authorized = await app.fetch(
      new Request("https://app.test/api/admin/categories", {
        headers: { authorization: `Bearer ${await adminToken()}` },
      }),
      testEnv(),
    );
    const body = (await authorized.json()) as { data: { categories: unknown[] } };
    // Four seeded categories plus the one this test added.
    expect(body.data.categories.length).toBe(5);
  });

  it("keeps the route thin: no SQL and no direct storage access in the route file", async () => {
    // @ts-expect-error - Vite ?raw import has no shipped ambient type
    const raw = (await import("../../src/api/routes/admin/documents.ts?raw")).default as string;

    // Strip comments before asserting. A route file legitimately NAMES the
    // HTTP verbs it does not own ("PATCH and DELETE belong to later
    // nodes"), and a scan that trips on prose is a false alarm that trains
    // people to ignore the check.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    // The real marker of a fat route is USING a binding, not passing one
    // along: handing { db, docs } to a Domain Service is exactly the
    // delegation the architecture asks for, so `c.env.DB` as an argument is
    // fine while `c.env.DB.prepare(...)` is not.
    expect(source).not.toMatch(/\.prepare\s*\(/);
    expect(source).not.toMatch(/\.batch\s*\(/);
    expect(source).not.toMatch(/env\.DB\s*\./);
    expect(source).not.toMatch(/env\.DOCS\s*\./);
    expect(source).not.toMatch(/\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i);
  });
});

describe("Public API — list and get (G1.8)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  async function publish(app: ReturnType<typeof createApp>, filename: string, content: string, categoryId: string) {
    const res = await app.fetch(
      uploadRequest(await adminToken(), { file: htmlFile(filename, content), categoryId }),
      testEnv(),
    );
    return (await res.json()) as { data: { slug: string; documentId: string } };
  }

  it("returns an empty page rather than a 404 for an empty library", async () => {
    const app = createApp();
    const res = await app.fetch(new Request("https://app.test/api/public/documents"), testEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: unknown[]; total: number; page: number } };
    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
    expect(body.data.page).toBe(1);
  });

  it("lists published documents anonymously with their category path and tags", async () => {
    const categoryId = await seedCategory(db());
    const app = createApp();
    await publish(app, "one.html", SIMPLE_HTML, categoryId);

    const res = await app.fetch(new Request("https://app.test/api/public/documents"), testEnv());
    const body = (await res.json()) as {
      data: { items: Array<{ slug: string; tags: string[]; categoryPath: Array<{ name: string }> }> };
    };
    expect(body.data.items.length).toBe(1);
    expect(body.data.items[0]?.categoryPath.map((c) => c.name)).toEqual(["Stocks API"]);
    expect(body.data.items[0]?.tags.sort()).toEqual(["Quarterly", "Review"]);
  });

  it("returns full detail plus an absolute contentUrl on the content origin", async () => {
    const categoryId = await seedCategory(db());
    const app = createApp();
    const created = await publish(app, "one.html", SIMPLE_HTML, categoryId);

    const res = await app.fetch(
      new Request(`https://app.test/api/public/documents/${created.data.slug}`),
      testEnv(),
    );
    const body = (await res.json()) as {
      data: { contentUrl: string; currentVersionId: string; documentId: string };
    };
    expect(body.data.contentUrl).toBe(`${CONTENT_ORIGIN}/d/${created.data.slug}`);
    expect(body.data.contentUrl.startsWith(APP_ORIGIN)).toBe(false);
    expect(body.data.currentVersionId).toBeTruthy();
  });

  it("returns DOCUMENT_NOT_FOUND for an unknown slug", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("https://app.test/api/public/documents/no-such-document"),
      testEnv(),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("DOCUMENT_NOT_FOUND");
  });

  it("never includes HTML body bytes in a list or detail payload", async () => {
    const categoryId = await seedCategory(db());
    const app = createApp();
    const created = await publish(
      app,
      "mauboussin-expectations-investing-summary.html",
      mauboussinFixture,
      categoryId,
    );

    const list = await (
      await app.fetch(new Request("https://app.test/api/public/documents"), testEnv())
    ).text();
    const detail = await (
      await app.fetch(
        new Request(`https://app.test/api/public/documents/${created.data.slug}`),
        testEnv(),
      )
    ).text();

    for (const payload of [list, detail]) {
      expect(payload).not.toContain("<body");
      expect(payload).not.toContain("<!doctype");
      expect(payload).not.toContain("</html>");
    }
  });

  it("performs no R2 operation while listing or reading metadata", async () => {
    const categoryId = await seedCategory(db());
    const app = createApp();
    await publish(app, "one.html", SIMPLE_HTML, categoryId);

    const bucket = (workersEnv as unknown as { DOCS: R2Bucket }).DOCS;
    const getSpy = vi.spyOn(bucket, "get");
    const listSpy = vi.spyOn(bucket, "list");
    try {
      await app.fetch(new Request("https://app.test/api/public/documents"), testEnv());
      await app.fetch(new Request("https://app.test/api/public/documents/quarterly-review"), testEnv());
      expect(getSpy).not.toHaveBeenCalled();
      expect(listSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
      listSpy.mockRestore();
    }
  });

  it("clamps nonsense pagination instead of failing", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("https://app.test/api/public/documents?page=-5&pageSize=100000"),
      testEnv(),
    );
    const body = (await res.json()) as { data: { page: number; pageSize: number } };
    expect(body.data.page).toBe(1);
    expect(body.data.pageSize).toBe(100);
  });

  it("orders by updated_at descending with a stable secondary key", async () => {
    const categoryId = await seedCategory(db());
    const app = createApp();
    await publish(app, "first.html", SIMPLE_HTML, categoryId);
    await publish(app, "second.html", SIMPLE_HTML.replace("Body.", "Second body."), categoryId);

    const res = await app.fetch(
      new Request("https://app.test/api/public/documents?pageSize=1&page=1"),
      testEnv(),
    );
    const body = (await res.json()) as { data: { items: Array<{ slug: string }>; total: number } };
    expect(body.data.total).toBe(2);
    expect(body.data.items.length).toBe(1);
  });

  it("lists categories anonymously with document counts", async () => {
    const categoryId = await seedCategory(db());
    const app = createApp();
    await publish(app, "one.html", SIMPLE_HTML, categoryId);

    const res = await app.fetch(new Request("https://app.test/api/public/categories"), testEnv());
    const body = (await res.json()) as {
      data: { categories: Array<{ id: string; documentCount: number }> };
    };
    const seeded = body.data.categories.find((c) => c.id === categoryId);
    expect(seeded?.documentCount).toBe(1);
  });
});
