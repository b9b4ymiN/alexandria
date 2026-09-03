import { describe, expect, it } from "vitest";
import { createApp } from "../../src/api/app";
import { AppError } from "../../src/shared/errors";
import appWorker from "../../src/index";
import type { Env } from "../../src/shared/types";

describe("routing skeleton — JSON 404 under /api/**", () => {
  it("returns a JSON 404 envelope for an unmatched path under /api/public", async () => {
    const app = createApp();
    const res = await app.fetch(new Request("https://example.com/api/public/anything-unknown"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false,
      error: { code: expect.any(String), message: expect.any(String) },
    });
  });

  it("returns a JSON 404 envelope for unmatched paths under /api/admin and /api/agent", async () => {
    const app = createApp();
    for (const path of ["/api/admin/anything-unknown", "/api/agent/anything-unknown"]) {
      const res = await app.fetch(new Request(`https://example.com${path}`));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false });
    }
  });

  // Orchestrator update (2026-08-30): this test originally asserted that
  // EVERY leaf mount answered 404, which was true only while every leaf was
  // an empty router. G1.7 and G1.8 have since implemented real handlers on
  // /api/public/documents, /api/public/categories and /api/admin/*, so the
  // list below keeps only the mounts that are still genuinely unclaimed,
  // plus unrouted sub-paths that must stay JSON 404 forever. The invariant
  // under test is unchanged: nothing under /api/** ever answers with the
  // SPA HTML shell.
  //
  // Node G2.4 update (2026-09-03): /api/public/tags now has a real GET
  // handler (see tests/integration/public-browse.test.ts), so it is
  // dropped from this "still unclaimed" list the same way G1.7/G1.8's
  // routes were.
  it("returns a JSON 404 envelope for unclaimed mounts and unrouted /api paths", async () => {
    const app = createApp();
    const paths = [
      "/api/agent/documents",
      "/api/agent/categories",
      "/api/agent/tags",
      "/api/public/documents/not-a-real-route/deeper",
      "/api/admin/nothing-here",
      "/api/nothing-here-either",
    ];
    for (const path of paths) {
      const res = await app.fetch(new Request(`https://example.com${path}`));
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
  });
});

describe("no CORS middleware anywhere", () => {
  it("never sets a CORS header on any API response", async () => {
    const app = createApp();
    const res = await app.fetch(new Request("https://example.com/api/public/anything-unknown"));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBeNull();
    expect(res.headers.get("access-control-allow-headers")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("global error handler", () => {
  it("converts a thrown AppError into the matching envelope and status", async () => {
    const app = createApp();
    app.get("/__test/throw-app-error", () => {
      throw new AppError("CATEGORY_NOT_FOUND", { message: "Category was not found." });
    });
    const res = await app.fetch(new Request("https://example.com/__test/throw-app-error"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      error: { code: "CATEGORY_NOT_FOUND", message: "Category was not found." },
    });
  });

  it("converts an unexpected throw into a 500 leaking no stack trace or internal detail", async () => {
    const app = createApp();
    const secret = "super-secret-internal-detail-12345";
    app.get("/__test/throw-unexpected", () => {
      throw new Error(secret);
    });
    const res = await app.fetch(new Request("https://example.com/__test/throw-unexpected"));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain(secret);
    expect(text.toLowerCase()).not.toContain("at src/"); // crude stack-frame guard
    const body = JSON.parse(text) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(typeof body.error.code).toBe("string");
    expect(body.error.message).not.toContain(secret);
  });

  it("passes a Response returned directly by a handler through untouched", async () => {
    const app = createApp();
    app.get("/__test/direct-response", (c) => c.text("untouched", 201));
    const res = await app.fetch(new Request("https://example.com/__test/direct-response"));
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("untouched");
  });
});

describe("app Worker entry — /api/* vs SPA fallthrough", () => {
  it("routes /api/* through the Hono app and returns its JSON envelope", async () => {
    const res = await appWorker.fetch(
      new Request("https://example.com/api/public/anything-unknown"),
      {} as unknown as Env,
      {} as unknown as ExecutionContext,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false });
  });

  it("never answers a non-/api path with the JSON API envelope (falls through to the SPA layer)", async () => {
    const res = await appWorker.fetch(
      new Request("https://example.com/docs/some-slug"),
      {} as unknown as Env,
      {} as unknown as ExecutionContext,
    );
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).not.toContain("application/json");
    const text = await res.text();
    expect(text).not.toContain('"ok":false');
  });
});
