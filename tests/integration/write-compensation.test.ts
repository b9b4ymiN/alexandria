// Node G1.5 — R2/D1 compensation.
//
// R2 and D1 cannot share a transaction, so the interesting behaviour is not
// the happy path but what survives a failure. Every test here INJECTS a
// failure by wrapping the real binding, then asserts the invariant that
// matters: metadata must never reference an object that does not exist.
//
// The chosen trade-off is asserted explicitly — an orphaned object is
// acceptable, dangling metadata is not.
import { beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error - "cloudflare:test" has no ambient type outside the
// package's optional "./types" subpath, which is out of this node's scope
import { env, reset } from "cloudflare:test";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0001 from "../../migrations/0001_init.sql?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import migration0002 from "../../migrations/0002_seed_categories.sql?raw";

import { createDocument } from "../../src/domain/documents/document-service";
import { type Storage } from "../../src/domain/versions/version-service";

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

function realStorage(): Storage {
  const typed = env as unknown as { DB: D1Database; DOCS: R2Bucket };
  return { db: typed.DB, docs: typed.DOCS };
}

async function applyMigrations(db: D1Database): Promise<void> {
  for (const statement of [...splitStatements(migration0001), ...splitStatements(migration0002)]) {
    await db.prepare(statement).run();
  }
}

function toBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

const HTML = `<!doctype html><html><head><title>Compensation Case</title></head>
<body><p>A paragraph long enough to serve as a description candidate here.</p></body></html>`;

async function seedCategory(db: D1Database): Promise<string> {
  const now = "2026-08-30T00:00:00.000Z";
  await db
    .prepare(
      "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES ('cat-c', NULL, 'C', 'c', 0, ?, ?)",
    )
    .bind(now, now)
    .run();
  return "cat-c";
}

/**
 * Wraps a live binding so ONE named method fails while every other method
 * still runs for real.
 *
 * Methods are bound back to the original object rather than handed out
 * unbound: the runtime's R2 and D1 implementations are native and reject a
 * call whose `this` is the proxy, which would make an injected-delete
 * failure masquerade as an injected-put failure.
 */
function failingMethod<T extends object>(base: T, method: string, message: string): T {
  return new Proxy(base, {
    get(target, prop) {
      if (prop === method) {
        return () => Promise.reject(new Error(message));
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as T;
}

/** A bucket whose put() always fails. */
function bucketWithFailingPut(base: R2Bucket): R2Bucket {
  return failingMethod(base, "put", "injected R2 put failure");
}

/** A bucket whose delete() always fails, so compensation cannot clean up. */
function bucketWithFailingDelete(base: R2Bucket): R2Bucket {
  return failingMethod(base, "delete", "injected R2 delete failure");
}

/** A database whose batch() always fails, after prepare() worked normally. */
function dbWithFailingBatch(base: D1Database): D1Database {
  return failingMethod(base, "batch", "injected D1 batch failure");
}

describe("R2/D1 write compensation", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(realStorage().db);
  });

  it("leaves zero D1 rows when the R2 write fails", async () => {
    const real = realStorage();
    const categoryId = await seedCategory(real.db);
    const store: Storage = { db: real.db, docs: bucketWithFailingPut(real.docs) };

    await expect(
      createDocument(store, {
        bytes: toBytes(HTML),
        filename: "case.html",
        categoryId,
        createdBy: "admin",
      }),
    ).rejects.toMatchObject({ code: "R2_WRITE_FAILED" });

    const documents = await real.db.prepare("SELECT COUNT(*) AS c FROM documents").first<{ c: number }>();
    const versions = await real.db
      .prepare("SELECT COUNT(*) AS c FROM document_versions")
      .first<{ c: number }>();
    expect(documents?.c).toBe(0);
    expect(versions?.c).toBe(0);
  });

  it("deletes the object and leaves zero D1 rows when the D1 batch fails", async () => {
    const real = realStorage();
    const categoryId = await seedCategory(real.db);
    const store: Storage = { db: dbWithFailingBatch(real.db), docs: real.docs };

    await expect(
      createDocument(store, {
        bytes: toBytes(HTML),
        filename: "case.html",
        categoryId,
        createdBy: "admin",
      }),
    ).rejects.toMatchObject({ code: "DATABASE_ERROR" });

    const documents = await real.db.prepare("SELECT COUNT(*) AS c FROM documents").first<{ c: number }>();
    expect(documents?.c).toBe(0);

    // Compensation removed the object it had just written.
    const objects = await real.docs.list();
    expect(objects.objects.length).toBe(0);
  });

  it("logs the orphan with its identifiers when both the batch and the cleanup fail", async () => {
    const real = realStorage();
    const categoryId = await seedCategory(real.db);
    const store: Storage = {
      db: dbWithFailingBatch(real.db),
      docs: bucketWithFailingDelete(real.docs),
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        createDocument(store, {
          bytes: toBytes(HTML),
          filename: "case.html",
          categoryId,
          createdBy: "admin",
        }),
      ).rejects.toMatchObject({ code: "DATABASE_ERROR" });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const line = String(errorSpy.mock.calls[0]?.[0]);
      const logged = JSON.parse(line) as {
        event: string;
        documentId: string;
        versionId: string;
        r2Key: string;
      };
      expect(logged.event).toBe("r2_orphan_cleanup_failed");
      expect(logged.documentId).toMatch(/^[0-9a-f-]{36}$/);
      expect(logged.versionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(logged.r2Key).toBe(
        `documents/${logged.documentId}/versions/${logged.versionId}.html`,
      );
    } finally {
      errorSpy.mockRestore();
    }

    // The documented trade-off: the object survives as an orphan, but no
    // metadata references it.
    const documents = await real.db.prepare("SELECT COUNT(*) AS c FROM documents").first<{ c: number }>();
    expect(documents?.c).toBe(0);
    expect((await real.docs.list()).objects.length).toBe(1);
  });

  it("never leaves metadata pointing at a missing object", async () => {
    const real = realStorage();
    const categoryId = await seedCategory(real.db);

    // A successful create, then a failed one, then another successful one.
    await createDocument(real, {
      bytes: toBytes(HTML),
      filename: "ok-one.html",
      categoryId,
      createdBy: "admin",
    });
    await expect(
      createDocument(
        { db: dbWithFailingBatch(real.db), docs: real.docs },
        { bytes: toBytes(HTML.replace("case", "other")), filename: "bad.html", categoryId, createdBy: "admin" },
      ),
    ).rejects.toMatchObject({ code: "DATABASE_ERROR" });
    await createDocument(real, {
      bytes: toBytes(HTML.replace("A paragraph", "Another paragraph")),
      filename: "ok-two.html",
      categoryId,
      createdBy: "admin",
    });

    const rows = await real.db
      .prepare("SELECT r2_key FROM document_versions")
      .all<{ r2_key: string }>();
    expect(rows.results.length).toBe(2);
    for (const row of rows.results) {
      const object = await real.docs.get(row.r2_key);
      expect(object).not.toBeNull();
    }
  });
});
