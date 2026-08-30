// Node G1.6 — Admin Auth & Login Rate Limit.
//
// Exercises POST /api/admin/login, POST /api/admin/logout and the
// requireAdmin middleware through the real Hono app and the real
// vitest-pool-workers bindings declared in wrangler.jsonc — in particular
// the real, local-only Workers Rate Limiting binding (`LOGIN_RATE_LIMITER`)
// — rather than a bare `fetch(request)` with no env, so the rate-limit
// assertions exercise the actual binding, not `undefined`.
//
// `cloudflare:test` and Vite's `?raw` suffix import both resolve and work
// at runtime here but ship no ambient type usable from an ordinary `.ts`
// file (same situation documented in tests/integration/schema.test.ts,
// which this file follows for the suppression pattern).
// @ts-expect-error - "cloudflare:test" has no ambient type outside the
// package's optional "./types" subpath, which is out of this node's scope.
import { env as workersEnv, reset } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/api/app";
import { requireAdmin } from "../../src/api/middleware/admin-auth";
import { signToken, DEFAULT_TOKEN_TTL_SECONDS } from "../../src/shared/token";
import type { Env } from "../../src/shared/types";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import tokenSource from "../../src/shared/token.ts?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import authRouteSource from "../../src/api/routes/admin/auth.ts?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import middlewareSource from "../../src/api/middleware/admin-auth.ts?raw";

const TEST_ADMIN_PASSWORD = "correct-horse-battery-staple";
const TEST_SIGNING_SECRET = "test-signing-secret-does-not-appear-in-any-real-env";
const OTHER_SIGNING_SECRET = "a-different-secret-nobody-should-ever-accept";
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...(workersEnv as Env),
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    ADMIN_SESSION_SIGNING_SECRET: TEST_SIGNING_SECRET,
    ...overrides,
  };
}

function loginRequest(password: string, ip = "203.0.113.7"): Request {
  return new Request("https://example.com/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ password }),
  });
}

async function login(env: Env, password = TEST_ADMIN_PASSWORD, ip = "203.0.113.7") {
  const app = createApp();
  return app.fetch(loginRequest(password, ip), env);
}

beforeEach(async () => {
  // Fresh storage per test — in particular a fresh Rate Limiting bucket,
  // so one test's login attempts never bleed into another's (same
  // reset()-per-test pattern as tests/integration/schema.test.ts).
  await reset();
});

describe("POST /api/admin/login — positive", () => {
  it("issues a token that requireAdmin accepts", async () => {
    const env = testEnv();
    const res = await login(env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { token: string; expiresAt: string } };
    expect(body.ok).toBe(true);
    expect(typeof body.data.token).toBe("string");

    const app = createApp();
    app.get("/__test/protected", requireAdmin, (c) => c.json({ ok: true, data: { protected: true } }));
    const protectedRes = await app.fetch(
      new Request("https://example.com/__test/protected", {
        headers: { Authorization: `Bearer ${body.data.token}` },
      }),
      env,
    );
    expect(protectedRes.status).toBe(200);
    const protectedBody = (await protectedRes.json()) as { ok: boolean };
    expect(protectedBody.ok).toBe(true);
  });

  it("returns expiresAt approximately 8 hours ahead", async () => {
    const before = Date.now();
    const res = await login(testEnv());
    const after = Date.now();
    const body = (await res.json()) as { data: { expiresAt: string } };
    const expiresAtMs = new Date(body.data.expiresAt).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + EIGHT_HOURS_MS - 5000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + EIGHT_HOURS_MS + 5000);
  });
});

describe("POST /api/admin/login — negative", () => {
  it("rejects a wrong password with AUTH_INVALID and no hint of closeness", async () => {
    const res = await login(testEnv(), "totally-wrong-password");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("AUTH_INVALID");
    expect(body.error.message).not.toContain(TEST_ADMIN_PASSWORD);
  });

  it("rejects an empty password with AUTH_INVALID (and still counts against the rate limit)", async () => {
    const res = await login(testEnv(), "");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_INVALID");
  });

  it("fails closed with 500 when ADMIN_PASSWORD is not configured, logging only server-side", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = testEnv({ ADMIN_PASSWORD: "" });
    const res = await login(env, "anything");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    // No secret in the response body.
    expect(JSON.stringify(body)).not.toContain(TEST_SIGNING_SECRET);
    // The log records the fact of misconfiguration only — never a secret
    // value (there is none configured to leak here, but assert the
    // invariant broadly: no call argument, across the whole spy, contains
    // either secret string).
    for (const call of errorSpy.mock.calls) {
      const joined = call.map((arg) => String(arg)).join(" ");
      expect(joined).not.toContain(TEST_SIGNING_SECRET);
      expect(joined).not.toContain("anything");
    }
    errorSpy.mockRestore();
  });
});

describe("POST /api/admin/login — rate limiting", () => {
  it("allows 10 attempts inside the window and rejects the 11th with 429", async () => {
    const env = testEnv();
    const sameIp = "198.51.100.42";
    for (let i = 0; i < 10; i++) {
      const res = await login(env, "wrong-password", sameIp);
      expect(res.status).toBe(401); // password wrong, but not yet rate limited
    }
    const eleventh = await login(env, "wrong-password", sameIp);
    expect(eleventh.status).toBe(429);
    const body = (await eleventh.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    // 429 reveals nothing about password correctness.
    expect(body.error.code).not.toBe("AUTH_INVALID");
  });

  it("does not read X-Forwarded-For for the rate-limit key (falls back to the shared bucket instead)", async () => {
    const env = testEnv();
    const app = createApp();
    // Same X-Forwarded-For, no CF-Connecting-IP at all, from what look
    // like eleven different attacker-controlled forwarded IPs: since
    // X-Forwarded-For must never be read, these all land in the single
    // shared bucket and the 11th is still 429.
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await app.fetch(
        new Request("https://example.com/api/admin/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Forwarded-For": `10.0.0.${i}`,
          },
          body: JSON.stringify({ password: "wrong-password" }),
        }),
        env,
      );
    }
    expect(last?.status).toBe(429);
  });
});

describe("requireAdmin — token rejection, one distinct code per case", () => {
  function protectedApp() {
    const app = createApp();
    app.get("/__test/protected", requireAdmin, (c) => c.json({ ok: true, data: {} }));
    return app;
  }

  async function callProtected(env: Env, headers: Record<string, string> = {}) {
    const app = protectedApp();
    return app.fetch(new Request("https://example.com/__test/protected", { headers }), env);
  }

  it("missing Authorization header -> AUTH_REQUIRED (401)", async () => {
    const res = await callProtected(testEnv());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("Authorization present but not Bearer -> AUTH_INVALID (401)", async () => {
    const res = await callProtected(testEnv(), { Authorization: "Basic dXNlcjpwYXNz" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_INVALID");
  });

  it("malformed token -> AUTH_INVALID (401)", async () => {
    const res = await callProtected(testEnv(), { Authorization: "Bearer not-a-real-token" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_INVALID");
  });

  it("tampered signature -> AUTH_INVALID (401)", async () => {
    const { token } = await signToken(TEST_SIGNING_SECRET);
    const [payloadB64, signatureB64] = token.split(".");
    if (!signatureB64) throw new Error("test setup: signToken produced no signature segment");
    const tamperedChar = signatureB64[0] === "A" ? "B" : "A";
    const tampered = `${payloadB64}.${tamperedChar}${signatureB64.slice(1)}`;
    const res = await callProtected(testEnv(), { Authorization: `Bearer ${tampered}` });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_INVALID");
  });

  it("token signed with a different secret -> AUTH_INVALID (401)", async () => {
    const { token } = await signToken(OTHER_SIGNING_SECRET);
    const res = await callProtected(testEnv(), { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_INVALID");
  });

  it("payload swapped for another validly-signed payload -> AUTH_INVALID (401)", async () => {
    // Different TTLs guarantee the two payloads differ (both `iat` values
    // are second-granularity and could otherwise coincide within a fast
    // test run, making the "swap" a no-op).
    const a = await signToken(TEST_SIGNING_SECRET, DEFAULT_TOKEN_TTL_SECONDS);
    const b = await signToken(TEST_SIGNING_SECRET, DEFAULT_TOKEN_TTL_SECONDS + 3600);
    const [payloadA] = a.token.split(".");
    const [, signatureB] = b.token.split(".");
    const swapped = `${payloadA}.${signatureB}`;
    const res = await callProtected(testEnv(), { Authorization: `Bearer ${swapped}` });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_INVALID");
  });

  it("token expired one second ago -> AUTH_EXPIRED (401)", async () => {
    const { token } = await signToken(TEST_SIGNING_SECRET, -1);
    const res = await callProtected(testEnv(), { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_EXPIRED");
  });

  it("a valid, unexpired token succeeds", async () => {
    const { token } = await signToken(TEST_SIGNING_SECRET);
    const res = await callProtected(testEnv(), { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/logout", () => {
  it("is stateless and returns success for a currently valid token", async () => {
    const { token } = await signToken(TEST_SIGNING_SECRET);
    const app = createApp();
    const res = await app.fetch(
      new Request("https://example.com/api/admin/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
      testEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe("no cookie is ever set", () => {
  const cases: Array<{ name: string; make: (env: Env) => Promise<Response> }> = [
    { name: "successful login", make: (env) => login(env) },
    { name: "wrong password", make: (env) => login(env, "wrong") },
    { name: "rate-limited login", make: async (env) => {
        for (let i = 0; i < 10; i++) await login(env, "wrong", "192.0.2.99");
        return login(env, "wrong", "192.0.2.99");
      },
    },
    {
      name: "logout",
      make: async (env) => {
        const { token } = await signToken(TEST_SIGNING_SECRET);
        const app = createApp();
        return app.fetch(
          new Request("https://example.com/api/admin/logout", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          }),
          env,
        );
      },
    },
  ];

  for (const { name, make } of cases) {
    it(`${name} response has no Set-Cookie header`, async () => {
      const res = await make(testEnv());
      expect(res.headers.get("set-cookie")).toBeNull();
    });
  }
});

describe("no secret ever leaks into a response body", () => {
  it("login response never contains ADMIN_PASSWORD or ADMIN_SESSION_SIGNING_SECRET", async () => {
    const res = await login(testEnv());
    const text = await res.text();
    expect(text).not.toContain(TEST_ADMIN_PASSWORD);
    expect(text).not.toContain(TEST_SIGNING_SECRET);
  });

  it("a rejected-token response never contains the signing secret", async () => {
    const app = createApp();
    app.get("/__test/protected", requireAdmin, (c) => c.json({ ok: true, data: {} }));
    const res = await app.fetch(
      new Request("https://example.com/__test/protected", {
        headers: { Authorization: "Bearer garbage.garbage" },
      }),
      testEnv(),
    );
    const text = await res.text();
    expect(text).not.toContain(TEST_SIGNING_SECRET);
  });
});

describe("regression — timing-safe comparison, never naive equality on a secret path", () => {
  it("token verification and password check both use crypto.subtle.timingSafeEqual", () => {
    expect(tokenSource as string).toContain("crypto.subtle.timingSafeEqual");
    expect(authRouteSource as string).toContain("crypto.subtle.timingSafeEqual");
  });

  it("no naive === comparison is used on the password or signature/secret path", () => {
    // Deliberately broad: any of these patterns in the auth source files
    // would indicate a timing-unsafe shortcut had crept in.
    // `(?<!typeof\s)` excludes legitimate `typeof x === "string"` type
    // guards, which are not a secret-value comparison.
    const suspiciousPatterns = [
      /(?<!typeof\s)\bpassword\s*===/,
      /===\s*password\b/,
      /(?<!typeof\s)\bsecret\s*===/,
      /===\s*secret\b/,
      /\bsignature\w*\s*===\s*\w*[Ss]ignature/,
    ];
    for (const source of [tokenSource as string, authRouteSource as string, middlewareSource as string]) {
      for (const pattern of suspiciousPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });
});
