// Node G3.2 — Restore & Version Delete Guards (restore half).
//
// Exercised through the real Hono app with REAL bindings
// (createApp().fetch(request, env)), matching the pattern established by
// tests/integration/document-update.test.ts (G3.1), whose harness,
// fixtures and assertion style this file reuses. G3.1's own suite is
// frozen and untouched.
//
// SPEC.md §12 Restore Contract:
//   v4 current, restore v2 -> create v5 from v2 bytes -> v5 current
//   -> restored_from_version_no = 2
// Restore is append-only: it never mutates, re-keys or deletes the source
// version, and — the deliberate divergence from the upload UNCHANGED rule —
// restoring identical bytes still creates a new version, because restoring
// is an explicit editorial act that history must record (AGENT.md §5).
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
import {
  appendVersion,
  deleteVersion,
  restoreVersion,
  type Storage,
} from "../../src/domain/versions/version-service";
import { buildR2Key } from "../../src/domain/versions/r2-keys";
import { sha256Hex } from "../../src/domain/versions/hash";
import { AppError } from "../../src/shared/errors";

const SIGNING_SECRET = "version-restore-test-signing-secret";
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

function db(): D1Database {
  return storage().db;
}

async function applyMigrations(database: D1Database): Promise<void> {
  for (const statement of [...splitStatements(migration0001), ...splitStatements(migration0002)]) {
    await database.prepare(statement).run();
  }
}

async function adminToken(): Promise<string> {
  return (await signToken(SIGNING_SECRET)).token;
}

function toBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

const SIMPLE_HTML = `<!doctype html>
<html><head><title>Quarterly Review</title>
<meta name="description" content="A review of the quarter just gone.">
</head><body><h1>Quarterly Review</h1><p>Body.</p></body></html>`;

async function seedCategory(database: D1Database, id = "cat-restore"): Promise<string> {
  const now = "2026-08-30T00:00:00.000Z";
  await database
    .prepare(
      "INSERT INTO categories (id, parent_id, name, slug, sort_order, created_at, updated_at) VALUES (?, NULL, 'Restore Test', ?, 0, ?, ?)",
    )
    .bind(id, `slug-${id}`, now, now)
    .run();
  return id;
}

function restoreRequest(slug: string, versionNo: number | string, token: string | null): Request {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request(`https://app.test/api/admin/documents/${slug}/restore/${versionNo}`, {
    method: "POST",
    headers,
  });
}

async function documentRow(
  documentId: string,
): Promise<{ currentVersionId: string } | null> {
  return db()
    .prepare("SELECT current_version_id AS currentVersionId FROM documents WHERE id = ?")
    .bind(documentId)
    .first<{ currentVersionId: string }>();
}

async function versionRow(
  documentId: string,
  versionNo: number,
): Promise<{ id: string; r2Key: string; sha256: string; createdAt: string } | null> {
  return db()
    .prepare(
      "SELECT id, r2_key AS r2Key, sha256, created_at AS createdAt FROM document_versions WHERE document_id = ? AND version_no = ?",
    )
    .bind(documentId, versionNo)
    .first<{ id: string; r2Key: string; sha256: string; createdAt: string }>();
}

async function versionCount(documentId: string): Promise<number> {
  const row = await db()
    .prepare("SELECT COUNT(*) AS c FROM document_versions WHERE document_id = ?")
    .bind(documentId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

async function currentVersionNo(documentId: string): Promise<number> {
  const row = await db()
    .prepare(
      `SELECT v.version_no AS versionNo
       FROM documents d JOIN document_versions v ON v.id = d.current_version_id
       WHERE d.id = ?`,
    )
    .bind(documentId)
    .first<{ versionNo: number }>();
  if (row === null) throw new Error("document has no current version");
  return row.versionNo;
}

describe("Admin API — restore version (G3.2)", () => {
  beforeEach(async () => {
    await reset();
    await applyMigrations(db());
  });

  describe("HTTP route — restore appends a new version", () => {
    it("restores an old version while a later one is current: v4 current, restore v2 -> v5 current, restoredFromVersionNo = 2", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });
      for (let i = 2; i <= 4; i += 1) {
        await appendVersion(store, {
          documentId: created.documentId,
          bytes: toBytes(SIMPLE_HTML.replace("Body.", `Body ${i}.`)),
          createdBy: "admin",
        });
      }
      expect(await currentVersionNo(created.documentId)).toBe(4);

      const app = createApp();
      const res = await app.fetch(restoreRequest(created.slug, 2, await adminToken()), testEnv());

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        data: { versionId: string; versionNo: number; restoredFromVersionNo: number };
      };
      expect(body.data.versionNo).toBe(5);
      expect(body.data.restoredFromVersionNo).toBe(2);

      const row = await documentRow(created.documentId);
      expect(row?.currentVersionId).toBe(body.data.versionId);

      const v5 = await versionRow(created.documentId, 5);
      expect(v5?.id).toBe(body.data.versionId);
    });

    it("restored bytes are byte-identical to the source version", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });
      const sourceBytes = toBytes(SIMPLE_HTML.replace("Body.", "Body 2."));
      const second = await appendVersion(store, {
        documentId: created.documentId,
        bytes: sourceBytes,
        createdBy: "admin",
      });
      await appendVersion(store, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Body 3.")),
        createdBy: "admin",
      });

      const restored = await restoreVersion(store, {
        slug: created.slug,
        versionNo: second.versionNo,
        createdBy: "admin",
      });

      const restoredKey = buildR2Key(created.documentId, restored.versionId);
      const restoredObject = await store.docs.get(restoredKey);
      const restoredBytes = await restoredObject!.arrayBuffer();
      expect(await sha256Hex(restoredBytes)).toBe(await sha256Hex(sourceBytes));
      expect(new Uint8Array(restoredBytes)).toEqual(new Uint8Array(sourceBytes));
    });

    it("restoring the CURRENT version still creates a new version and advances the pointer", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const before = await versionCount(created.documentId);
      const restored = await restoreVersion(store, {
        slug: created.slug,
        versionNo: 1,
        createdBy: "admin",
      });

      expect(restored.versionNo).toBe(2);
      expect(restored.restoredFromVersionNo).toBe(1);
      expect(await versionCount(created.documentId)).toBe(before + 1);
      const row = await documentRow(created.documentId);
      expect(row?.currentVersionId).toBe(restored.versionId);
    });
  });

  describe("HTTP route — negative cases", () => {
    it("rejects an unknown version number with VERSION_NOT_FOUND", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const app = createApp();
      const res = await app.fetch(restoreRequest(created.slug, 999, await adminToken()), testEnv());
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("VERSION_NOT_FOUND");
    });

    it("rejects an unauthenticated restore", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const app = createApp();
      const res = await app.fetch(restoreRequest(created.slug, 1, null), testEnv());
      expect(res.status).toBe(401);

      const row = await documentRow(created.documentId);
      expect(row?.currentVersionId).toBe(created.versionId);
    });

    it("raises R2_READ_FAILED and writes nothing when the source R2 object is missing", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });
      const second = await appendVersion(store, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Body 2.")),
        createdBy: "admin",
      });

      // Simulate a corrupted/lost object for version 1, independent of the
      // domain layer's own delete path.
      await store.docs.delete(buildR2Key(created.documentId, created.versionId));

      const countBefore = await versionCount(created.documentId);

      await expect(
        restoreVersion(store, { slug: created.slug, versionNo: 1, createdBy: "admin" }),
      ).rejects.toMatchObject({ code: "R2_READ_FAILED" });

      expect(await versionCount(created.documentId)).toBe(countBefore);
      const row = await documentRow(created.documentId);
      expect(row?.currentVersionId).toBe(second.versionId);
    });
  });

  describe("regression — source version untouched by restore", () => {
    it("leaves the source version's row and R2 object unchanged", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });
      await appendVersion(store, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Body 2.")),
        createdBy: "admin",
      });

      const sourceBefore = await versionRow(created.documentId, 1);
      const sourceObjectBefore = await store.docs.get(sourceBefore!.r2Key);
      const sourceHashBefore = await sha256Hex(await sourceObjectBefore!.arrayBuffer());

      await restoreVersion(store, { slug: created.slug, versionNo: 1, createdBy: "admin" });

      const sourceAfter = await versionRow(created.documentId, 1);
      expect(sourceAfter).toEqual(sourceBefore);
      const sourceObjectAfter = await store.docs.get(sourceAfter!.r2Key);
      const sourceHashAfter = await sha256Hex(await sourceObjectAfter!.arrayBuffer());
      expect(sourceHashAfter).toBe(sourceHashBefore);
    });
  });

  describe("regression — numbering never renumbered, restore follows the maximum after a gap", () => {
    it("restore immediately after a gap-creating delete takes MAX(version_no) + 1, not COUNT + 1", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });
      // v2..v5
      for (let i = 2; i <= 5; i += 1) {
        await appendVersion(store, {
          documentId: created.documentId,
          bytes: toBytes(SIMPLE_HTML.replace("Body.", `Body ${i}.`)),
          createdBy: "admin",
        });
      }
      // Delete v2 (non-current, non-last) -> gap at 2, five rows become four,
      // but the maximum version_no on record is still 5.
      await deleteVersion(store, { slug: created.slug, versionNo: 2 });
      expect(await versionCount(created.documentId)).toBe(4);

      const restored = await restoreVersion(store, {
        slug: created.slug,
        versionNo: 1,
        createdBy: "admin",
      });

      // COUNT is 4 (5 minus the deleted one); if numbering followed COUNT,
      // the next number would wrongly be 5, colliding with the still-current
      // v5. It must instead follow MAX(version_no) = 5, landing on 6.
      expect(restored.versionNo).toBe(6);
    });
  });

  describe("regression — current_version_id never moves to a lower version number", () => {
    it("stays monotonic across a 10-operation mixed restore/delete sequence", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      let previousCurrent = 1;
      const assertMonotonic = async () => {
        const current = await currentVersionNo(created.documentId);
        expect(current).toBeGreaterThanOrEqual(previousCurrent);
        previousCurrent = current;
      };

      // Ops 1-4: ordinary updates -> v2..v5, all current in turn.
      for (let i = 2; i <= 5; i += 1) {
        await appendVersion(store, {
          documentId: created.documentId,
          bytes: toBytes(SIMPLE_HTML.replace("Body.", `Update ${i}.`)),
          createdBy: "admin",
        });
        await assertMonotonic();
      }

      // Op 5: restore v1 while v5 is current -> v6 current.
      await restoreVersion(store, { slug: created.slug, versionNo: 1, createdBy: "admin" });
      await assertMonotonic();

      // Op 6: delete a non-current, non-last version (v2) -> pointer
      // untouched, still monotonic (unchanged counts).
      await deleteVersion(store, { slug: created.slug, versionNo: 2 });
      await assertMonotonic();

      // Op 7: restore v3 (an old, non-deleted version) while v6 is current
      // -> v7 current.
      await restoreVersion(store, { slug: created.slug, versionNo: 3, createdBy: "admin" });
      await assertMonotonic();

      // Op 8: delete another non-current, non-last version (v4).
      await deleteVersion(store, { slug: created.slug, versionNo: 4 });
      await assertMonotonic();

      // Op 9: restore the version created by the very first restore (v6,
      // now old) -> v8 current.
      await restoreVersion(store, { slug: created.slug, versionNo: 6, createdBy: "admin" });
      await assertMonotonic();

      // Op 10: one more ordinary update -> v9 current.
      await appendVersion(store, {
        documentId: created.documentId,
        bytes: toBytes(SIMPLE_HTML.replace("Body.", "Final update.")),
        createdBy: "admin",
      });
      await assertMonotonic();

      expect(previousCurrent).toBe(9);
    });
  });

  describe("route inventory — no agent route exposes restore", () => {
    it("returns 404 (no route) for every plausible agent restore path", async () => {
      const categoryId = await seedCategory(db());
      const store = storage();
      const created = await createDocument(store, {
        bytes: toBytes(SIMPLE_HTML),
        filename: "one.html",
        categoryId,
        createdBy: "admin",
      });

      const app = createApp();
      const candidates = [
        `https://app.test/api/agent/documents/${created.slug}/restore/1`,
        `https://app.test/api/agent/documents/${created.slug}/versions/1/restore`,
      ];
      for (const url of candidates) {
        const res = await app.fetch(new Request(url, { method: "POST" }), testEnv());
        expect(res.status).toBe(404);
      }

      // Nothing was written regardless of route shape.
      expect(await versionCount(created.documentId)).toBe(1);
    });

    it("no agent-owned route file references a restore handler", async () => {
      const strip = (raw: string) => raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const sources = await Promise.all([
        // @ts-expect-error - Vite ?raw import has no shipped ambient type
        import("../../src/api/routes/agent/index.ts?raw"),
        // @ts-expect-error - Vite ?raw import has no shipped ambient type
        import("../../src/api/routes/agent/documents.ts?raw"),
        // @ts-expect-error - Vite ?raw import has no shipped ambient type
        import("../../src/api/routes/agent/categories.ts?raw"),
        // @ts-expect-error - Vite ?raw import has no shipped ambient type
        import("../../src/api/routes/agent/tags.ts?raw"),
      ]);
      for (const module of sources) {
        expect(strip((module as { default: string }).default)).not.toMatch(/restore/i);
      }
    });
  });

  describe("keeps the route handlers thin", () => {
    it("has no SQL and no direct storage access anywhere in the versions route file", async () => {
      // @ts-expect-error - Vite ?raw import has no shipped ambient type
      const raw = (await import("../../src/api/routes/admin/versions.ts?raw")).default as string;
      const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

      expect(source).not.toMatch(/\.prepare\s*\(/);
      expect(source).not.toMatch(/\.batch\s*\(/);
      expect(source).not.toMatch(/env\.DB\s*\./);
      expect(source).not.toMatch(/env\.DOCS\s*\./);
      expect(source).not.toMatch(/\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i);
    });
  });

  describe("domain service — direct checks", () => {
    it("raises DOCUMENT_NOT_FOUND for an unknown slug", async () => {
      await expect(
        restoreVersion(storage(), { slug: "does-not-exist", versionNo: 1, createdBy: "admin" }),
      ).rejects.toBeInstanceOf(AppError);
      await expect(
        restoreVersion(storage(), { slug: "does-not-exist", versionNo: 1, createdBy: "admin" }),
      ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    });
  });
});
