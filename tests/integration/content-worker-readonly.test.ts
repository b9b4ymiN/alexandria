// Node G1.9 — Content Worker: read-only constraint and binding boundary.
//
// This is the automated enforcement mechanism referenced by
// IMPLEMENTATION_PLAN.md §5 Architecture Constraint 3 and Node G1.9
// Implementation Requirements 1-2: a D1 binding does not itself enforce
// read-only permission, so this suite asserts, by static inspection of the
// actual shipped source and config, that the content Worker never mutates
// D1 and carries no admin/agent secret binding. Assertions run over the
// real files via Vite's `?raw` import (same technique
// tests/integration/schema.test.ts uses for the migration SQL) rather than
// hand-copied text, and rather than `node:fs`, which is unavailable inside
// the Workers runtime this suite runs in (see vitest.config.ts, "content"
// project).
import { describe, expect, it } from "vitest";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import handlerSource from "../../src/content/handler.ts?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import indexSource from "../../src/content/index.ts?raw";
// @ts-expect-error - Vite ?raw import has no shipped ambient type
import wranglerContentRaw from "../../wrangler.content.jsonc?raw";

// Mirrors the orchestrator's own verification command exactly:
//   grep -riE "insert |update |delete " src/content/
// (a trailing space, not a strict word boundary) so this test enforces the
// identical rule, not a looser or stricter approximation of it.
const MUTATION_KEYWORD = /(insert |update |delete )/i;

/**
 * Strips `//` line comments from JSONC so the config can be parsed with
 * `JSON.parse`. Tracks whether each character is inside a quoted string,
 * so a `//` inside a string value (wrangler.content.jsonc's APP_ORIGIN is
 * `https://...`) is never mistaken for a comment.
 */
function stripJsonComments(text: string): string {
  let result = "";
  let inString = false;
  let escapedNext = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      result += char;
      if (escapedNext) {
        escapedNext = false;
      } else if (char === "\\") {
        escapedNext = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") {
        i++;
      }
      result += "\n";
      continue;
    }

    result += char;
  }

  return result;
}

interface WranglerContentConfig {
  name: string;
  compatibility_date: string;
  main: string;
  vars?: Record<string, unknown>;
  d1_databases?: { binding: string; database_name: string; database_id: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
  [key: string]: unknown;
}

const config: WranglerContentConfig = JSON.parse(stripJsonComments(wranglerContentRaw));

const FORBIDDEN_SECRET_NAMES = [
  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SIGNING_SECRET",
  "AGENT_API_KEY",
  // G3.4 gives the content Worker this one secret, but as a runtime secret
  // set with `wrangler secret put` — never as a name or value in the config
  // file. It stays on this list so a future change that moves it into
  // `vars` (where it would be checked in) fails loudly.
  "CONTENT_PREVIEW_SIGNING_SECRET",
];

describe("content worker — read-only constraint (source assertion)", () => {
  it("contains no INSERT, UPDATE or DELETE keyword anywhere in src/content/", () => {
    expect(handlerSource).not.toMatch(MUTATION_KEYWORD);
    expect(indexSource).not.toMatch(MUTATION_KEYWORD);
  });

  it("never references the Cookie request header", () => {
    // Complements the runtime "same bytes with or without Cookie" test in
    // content-worker.test.ts with a static guarantee: there is no code
    // path here that even looks at a Cookie header, let alone acts on one.
    expect(handlerSource.toLowerCase()).not.toContain('"cookie"');
    expect(handlerSource.toLowerCase()).not.toContain("'cookie'");
  });

  it("never sets a Set-Cookie response header", () => {
    expect(handlerSource.toLowerCase()).not.toContain("set-cookie");
    expect(indexSource.toLowerCase()).not.toContain("set-cookie");
  });

  it("imports nothing from src/shared/ except the signing utility (G1.9 clarification, G3.4 exception)", () => {
    // The G1.9 ban exists so the content Worker never picks up the JSON API
    // envelope, the AppError vocabulary or a domain service. Node G3.4
    // authorized exactly ONE exception — src/shared/signing.ts, which is
    // pure WebCrypto with no imports, no storage and no environment access
    // — because the alternative was a second copy of the signature formula
    // living in the content Worker. The assertion is therefore an
    // allowlist, not a removal: any OTHER shared import still fails here.
    const ALLOWED_SHARED_IMPORTS = ["../shared/signing"];

    for (const source of [handlerSource, indexSource]) {
      const imported = [...source.matchAll(/from\s+["'](\.\.\/shared\/[^"']+)["']/g)].map(
        (match) => match[1],
      );
      expect(imported.every((specifier) => ALLOWED_SHARED_IMPORTS.includes(specifier as string))).toBe(true);
    }
  });
});

describe("content worker — binding boundary (wrangler.content.jsonc)", () => {
  it("declares exactly one D1 database binding, named DB", () => {
    expect(config.d1_databases).toHaveLength(1);
    expect(config.d1_databases?.[0]?.binding).toBe("DB");
  });

  it("declares exactly one R2 bucket binding, named DOCS", () => {
    expect(config.r2_buckets).toHaveLength(1);
    expect(config.r2_buckets?.[0]?.binding).toBe("DOCS");
  });

  it("declares no admin or agent secret, and no other binding kind", () => {
    // Top-level keys are exactly what this node's scope allows: worker
    // identity/config plus the two storage bindings. Anything else
    // (kv_namespaces, durable_objects, services, secrets_store_secrets, a
    // third binding array, ...) would widen this Worker's reach beyond
    // "D1 read use and the R2 bucket only" (Node G1.9 Scope) and must fail
    // this test loudly.
    expect(Object.keys(config).sort()).toEqual(
      ["$schema", "compatibility_date", "d1_databases", "main", "name", "r2_buckets", "vars"].sort(),
    );

    expect(Object.keys(config.vars ?? {})).toEqual(["APP_ORIGIN"]);

    for (const forbidden of FORBIDDEN_SECRET_NAMES) {
      expect(wranglerContentRaw).not.toContain(forbidden);
    }
  });

  it("does not declare a migrations_dir on its D1 binding (this Worker never applies migrations)", () => {
    expect(config.d1_databases?.[0]).not.toHaveProperty("migrations_dir");
  });
});
